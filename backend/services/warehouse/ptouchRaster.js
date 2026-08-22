/**
 * Задание печати для Brother P-touch в «сыром» растровом формате.
 *
 * ── Почему не SDK Brother ────────────────────────────────────────────────────
 *
 * Телефону нужно печатать этикетки, стоя в кабинете. Официальная обёртка Brother
 * под React Native (`official-react-brother-print-sdk`) для ленточных P-touch не
 * годится: в версии 1.0.3 её мост под iOS создаёт настройки печати только для
 * серий RJ, PJ и TD, а на «PT-E550W» возвращает «Invalid or wrong Printer
 * Model» и печатать отказывается совсем. На Android объект настроек создаётся,
 * но ширину ленты и автообрез выставить нечем — соответствующих сеттеров в
 * обёртке нет. Чинить это пришлось бы правкой чужого нативного кода.
 *
 * Поэтому задание собирается здесь, на сервере, а телефон просто открывает TCP
 * к 9100 и выкладывает туда байты. Печать по сети у этих принтеров так и
 * устроена — «print data from the port monitor is simply sent as is»
 * (Raster Command Reference PT-E550W/P750W/P710BT, 5.6). Плюсом мобильное
 * приложение остаётся без нативного модуля и без чужого EULA, а сама раскладка
 * этикетки живёт там же, где и раньше, — в qr.js.
 *
 * ── Геометрия 24-мм ленты ────────────────────────────────────────────────────
 *
 * Головка у этих моделей — 128 точек при 180 dpi. Лента TZe 24 мм шириной в
 * 170 точек, из которых печатаются только средние 128 (18.1 мм), по 21 точке с
 * каждого края физически недостижимы (там же, 2.3.2 и 2.3.5). Отсюда весь
 * расчёт: картинку кладём на бок, растягиваем по ширине ленты и вырезаем ту
 * самую полосу — ровно то поле, в которое qr.js и верстает содержимое
 * (см. printH в LABEL_SIZES).
 *
 * ── Ориентация: подобрана, а не выведена ─────────────────────────────────────
 *
 * Куда смотрит нулевая точка головки и с какого конца этикетка выходит из
 * приёмника, по документации не выводится: в ней нет ни одного рисунка с
 * готовой лентой в руке. Поэтому на PT-E550W была напечатана лента со всеми
 * четырьмя комбинациями поворота и зеркала — читается только «поворот 90 с
 * зеркалом», она и стоит по умолчанию.
 *
 * Параметры при этом остались: другая модель или другая прошивка вполне может
 * потребовать другой пары, и тогда её меняют на экране настроек принтера в
 * мобилке, а не правкой кода.
 */
const sharp = require('sharp');

// Лента TZe 24 мм при 180 dpi: 170 точек всего, печатается средняя полоса в 128.
const TAPE_PINS = 170;
const PRINT_PINS = 128;
const OFFSET_PINS = 21;
const RASTER_BYTES = PRINT_PINS / 8; // 16 — столько байт в одной растровой строке
const DPI = 180;
const MEDIA_WIDTH_MM = 24;

// Минимальное поле подачи по паспорту — 2 мм, это 14 точек при 180 dpi (2.3.3).
// Меньше принтер не отдаст, а больше значит лишний сантиметр ленты на каждую
// этикетку: при печати сотни дверных карточек это метры в мусор.
const MIN_MARGIN_DOTS = 14;

const mmToDots = mm => Math.round((mm * DPI) / 25.4);

/**
 * TIFF (PackBits) — единственное сжатие, которое принтер понимает.
 *
 * Считаем не ради экономии трафика, а ради времени: несжатая строка это 16 байт
 * на каждую из ~570 строк этикетки, и на пачке в полсотни этикеток по вайфаю
 * разница уже заметна на глаз.
 *
 * Повтор кодируется отрицательной длиной, серия разных байт — положительной, и
 * та и другая на единицу меньше фактической (4. Printing Command Details, «M»).
 * Если сжатая строка вышла длиннее исходных 16 байт, документация велит слать
 * её целиком литералом — на пёстрых строках QR-кода это регулярный случай.
 */
function packBits(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    let run = 1;
    while (i + run < line.length && line[i + run] === line[i] && run < 128) run += 1;
    // Порог повтора — два байта, а не три, как в классическом PackBits: именно
    // так разобран пример в документации, и расходиться с ним ради полубайта
    // экономии смысла нет.
    if (run >= 2) {
      out.push(257 - run, line[i]);
      i += run;
      continue;
    }
    let literal = 0;
    while (i + literal < line.length && literal < 128) {
      const at = i + literal;
      if (literal > 0 && at + 1 < line.length && line[at] === line[at + 1]) break;
      literal += 1;
    }
    out.push(literal - 1, ...line.subarray(i, i + literal));
    i += literal;
  }
  if (out.length > line.length) return Buffer.from([line.length - 1, ...line]);
  return Buffer.from(out);
}

/**
 * PNG этикетки → растровые строки принтера.
 *
 * Строка растра идёт поперёк ленты, а сами строки — вдоль неё, поэтому этикетка
 * 80 × 24 кладётся на бок: после поворота ширина картинки становится шириной
 * ленты, а высота — длиной наклейки. Ресайз стоит до вырезания намеренно: так
 * полоса в 128 точек берётся от честной ширины ленты, а не от того, сколько
 * пикселей случайно оказалось в исходном PNG.
 */
async function labelRasterLines(png, { lengthMm = 80, rotate = 90, mirror = true } = {}) {
  const lengthDots = mmToDots(lengthMm);
  const turn = rotate === 270 ? 270 : 90;

  const { data } = await sharp(png)
    .rotate(turn)
    .resize(TAPE_PINS, lengthDots, { fit: 'fill', kernel: 'nearest' })
    .extract({ left: OFFSET_PINS, top: 0, width: PRINT_PINS, height: lengthDots })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lines = [];
  for (let y = 0; y < lengthDots; y += 1) {
    const line = Buffer.alloc(RASTER_BYTES);
    const rowStart = y * PRINT_PINS;
    for (let x = 0; x < PRINT_PINS; x += 1) {
      // Порог посередине шкалы: PNG приходит уже двухцветным (palette: true,
      // colours: 2 в qr.js), полутонов в нём нет, и подбирать тут нечего.
      if (data[rowStart + x] >= 128) continue;
      const pin = mirror ? PRINT_PINS - 1 - x : x;
      line[pin >> 3] |= 0x80 >> (pin & 7);
    }
    lines.push(line);
  }
  return lines;
}

/** Команда «print information»: чем печатаем и сколько строк растра будет. */
function printInformation(rasterCount, isFirstPage) {
  // 0x84 — PI_WIDTH | PI_RECOVER: просим принтер сверить ширину заправленной
  // ленты с нашей. Тип ленты (PI_KIND) намеренно не проверяем: ламинированная и
  // неламинированная TZe печатают одинаково, а расхождение остановило бы печать
  // на ровном месте. Ширина — другое дело: на 12-мм ленте наша раскладка
  // превратится в кашу, и лучше получить ошибку, чем метр испорченной ленты.
  return Buffer.from([
    0x1b, 0x69, 0x7a,
    0x84,
    0x00,
    MEDIA_WIDTH_MM,
    0x00,
    rasterCount & 0xff,
    (rasterCount >> 8) & 0xff,
    (rasterCount >> 16) & 0xff,
    (rasterCount >> 24) & 0xff,
    isFirstPage ? 0x00 : 0x01,
    0x00,
  ]);
}

/**
 * Собирает поток байт для принтера из уже готовых страниц растра.
 *
 * Управляющие коды повторяются перед каждой страницей — так делает и родной
 * драйвер (2.1): принтер сбрасывает часть настроек между этикетками, и пачка,
 * настроенная один раз в начале, доезжает до конца уже не той.
 */
function buildPrintJob(pages, { autoCut = true, marginMm = 2 } = {}) {
  const marginDots = Math.max(MIN_MARGIN_DOTS, mmToDots(marginMm));
  const chunks = [
    // Сотня нулей и «инициализация» — обязательная преамбула: она возвращает
    // принтер в приём даже после оборванного посреди ленты задания.
    Buffer.alloc(100, 0x00),
    Buffer.from([0x1b, 0x40]),
  ];

  pages.forEach((lines, index) => {
    chunks.push(Buffer.from([0x1b, 0x69, 0x61, 0x01])); // растровый режим
    chunks.push(printInformation(lines.length, index === 0));
    chunks.push(Buffer.from([0x1b, 0x69, 0x4d, autoCut ? 0x40 : 0x00])); // автообрез
    chunks.push(Buffer.from([0x1b, 0x69, 0x41, 0x01])); // резать каждую этикетку
    // Бит 3 — «no chain printing»: без него принтер экономит ленту и не
    // выталкивает последнюю этикетку, а человек стоит и ждёт, пока она выедет.
    chunks.push(Buffer.from([0x1b, 0x69, 0x4b, 0x08]));
    chunks.push(Buffer.from([0x1b, 0x69, 0x64, marginDots & 0xff, (marginDots >> 8) & 0xff]));
    chunks.push(Buffer.from([0x4d, 0x02])); // сжатие TIFF

    for (const line of lines) {
      if (line.every(byte => byte === 0)) {
        chunks.push(Buffer.from([0x5a])); // пустая строка одним байтом
        continue;
      }
      const packed = packBits(line);
      chunks.push(Buffer.from([0x47, packed.length & 0xff, (packed.length >> 8) & 0xff]));
      chunks.push(packed);
    }

    // Последняя страница печатается с подачей, остальные — обычной командой:
    // иначе лента выталкивается после каждой этикетки и режется дважды.
    chunks.push(Buffer.from([index === pages.length - 1 ? 0x1a : 0x0c]));
  });

  return Buffer.concat(chunks);
}

/** Пачка PNG → одно задание печати. */
async function buildJobFromPngs(pngs, options = {}) {
  const pages = [];
  for (const png of pngs) {
    pages.push(await labelRasterLines(png, options));
  }
  return buildPrintJob(pages, options);
}

module.exports = {
  TAPE_PINS,
  PRINT_PINS,
  OFFSET_PINS,
  RASTER_BYTES,
  MIN_MARGIN_DOTS,
  mmToDots,
  packBits,
  labelRasterLines,
  buildPrintJob,
  buildJobFromPngs,
};
