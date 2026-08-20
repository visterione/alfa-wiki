/**
 * QR-коды, этикетки и публичные карточки активов.
 *
 * ── Про что тут пришлось думать отдельно ─────────────────────────────────────
 *
 * ТЗ требует: «Карточка доступна без авторизации (read-only) по уникальному
 * URL». Это значит, что ссылка рано или поздно окажется снаружи — QR наклеен на
 * прибор в кабинете, куда заходят пациенты, его сфотографируют. Поэтому карточка
 * спроектирована так, чтобы её утечка ничего не стоила:
 *
 *   • токен — 20 байт из crypto.randomBytes в base64url (160 бит). Перебор
 *     бессмысленен, а последовательный id в ссылке дал бы возможность просто
 *     листать весь парк оборудования;
 *   • из карточки убраны стоимость, амортизация и поставщик — это коммерческая
 *     информация, и на приборе ей делать нечего;
 *   • МОЛ показывается должностью и отделением, без ФИО: фамилия сотрудника на
 *     публичной странице — персональные данные, которые мы не обязаны раскрывать
 *     и не имеем оснований;
 *   • файлы отдаются только с флагом isPublic: рядом с паспортом прибора лежат
 *     договоры и акты с ценами;
 *   • история движений показывается без ФИО и без причин — «перемещён 03.07.26»,
 *     не «перемещён из-за поломки, сдал Иванов».
 *
 * Полная карточка со стоимостью, ФИО и документами живёт внутри портала, за
 * авторизацией. Публичная — это «что это за прибор, работает ли он, когда ТО»:
 * ровно то, зачем к нему подходят со телефоном.
 *
 * Второе: камера в браузере работает только по HTTPS. На боевом 443 через nginx
 * всё в порядке, а на dev-сервере :9000 сканер молча не запустится — это ровно
 * та ловушка, о которой предупреждает CLAUDE.md. Поэтому в API есть ручной ввод
 * инвентарного номера как равноправный путь, а не как заглушка.
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const sharp = require('sharp');

// Базовый адрес портала для публичных ссылок. На проде это https://<домен>,
// который nginx уже отдаёт; на dev — что стоит в .env.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/$/, '');

/**
 * Токен публичной карточки. 20 байт → 27 символов base64url.
 */
function generateToken() {
  return crypto.randomBytes(20).toString('base64url');
}

function assetPublicUrl(token) {
  return `${PUBLIC_BASE_URL}/p/a/${token}`;
}

/**
 * Ссылка с двери кабинета. В отличие от актива, ведёт внутрь портала, а не на
 * публичную карточку: дверь кабинета выходит в коридор, где ходят пациенты, и
 * код с неё сканирует кто угодно. Перечень оборудования, ТО и остатки — сведения
 * для сотрудников, поэтому по ссылке сначала спрашивают вход.
 *
 * У актива задача обратная: наклейка висит на приборе, к нему подходит инженер
 * подрядчика с незалогиненного телефона, и там публичность оправдана.
 */
function roomAppUrl(roomId) {
  return `${PUBLIC_BASE_URL}/warehouse?room=${roomId}`;
}

/**
 * QR как SVG-строка. Уровень коррекции Q (25 %) — как в ТЗ: этикетка на приборе
 * затирается и пачкается, при L такой код перестаёт читаться месяца через три.
 */
async function qrSvg(text, { margin = 0, width = 256 } = {}) {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'Q',
    margin,
    width,
  });
}

async function qrPngDataUrl(text, { margin = 1, width = 512 } = {}) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'Q',
    margin,
    width,
    type: 'image/png',
  });
}

/**
 * Этикетка как самостоятельный SVG в миллиметрах — так её можно и напечатать из
 * браузера в точный размер и растрировать в PNG без промежуточного листа A4.
 *
 * Brother P-touch E550W печатает на узкой ленте длиной по потребности. Из
 * ширин оставлена одна — 24 мм: на 20 мм после вычета неснимаемых полей
 * оставалось около 13 мм печати, и на них не помещалось ничего, кроме кода.
 * Два почти одинаковых размера в списке только заставляли выбирать между
 * плохим и никаким.
 */
/**
 * Размеры этикеток.
 *
 * h — ширина ленты, то есть размер этикетки. printH — сколько из неё реально
 * запечатывается: у Brother лента проходит мимо головки, которая не достаёт до
 * её краёв, и по краям остаётся неснимаемое поле. На ленте 24 мм печатается
 * примерно 17–18 мм посередине, и рисунок, свёрстанный на все 24, теряет
 * верхнюю и нижнюю строки — именно так пропадали «АЛЬФА ВИКИ: СКЛАД» и
 * наименование.
 *
 * Этикетка при этом остаётся во всю ширину ленты: printH задаёт не её размер, а
 * вертикальный отступ содержимого от краёв — (h - printH) / 2 сверху и снизу.
 * Строки уходят внутрь, в ту полосу, до которой головка достаёт, а сама этикетка
 * не превращается в узкую наклейку с белыми полями по бокам.
 *
 * Значение взято с запасом (17.5 из 18.1 по паспорту TZe-ленты): миллиметр
 * запаса дешевле, чем срезанная строка, а на конкретной паре «принтер + лента»
 * его легко подправить здесь одним числом — вёрстка пересчитается сама.
 *
 * У TDP-225 высечка 44 × 25 печатается целиком, printH ему не нужен.
 */
const LABEL_SIZES = {
  '80x24': {
    // Кегли выросли за счёт убранной шапки: на ленте важны только код и
    // наименование, и читать их приходится с вытянутой руки, а не с ладони.
    w: 80, h: 24, printH: 17.5, pad: 1.4, qr: 14.7, gap: 1.6,
    // numberSize — жёсткий кегль номера, nameSize — только желаемый: если
    // наименование в него не укладывается целиком, оно мельчает до nameMin.
    numberSize: 5.2, nameSize: 2.5, nameMin: 1.35, nameGap: 0.7,
    metaSize: 1.4, footSize: 1.25,
    layout: 'horizontal', printer: 'brother', rotated: true,
  },
  '44x25': {
    w: 44, h: 25, pad: 1.5, qr: 16, gap: 1.5,
    numberSize: 2.7, nameSize: 2.05, nameMin: 1.2, nameGap: 0.6,
    metaSize: 1.7, footSize: 1.5,
    layout: 'horizontal', printer: 'tdp225',
  },
};

/**
 * Растеризует готовую этикетку в физический размер конкретного принтера.
 * PNG выбран намеренно: JPEG размывает границы модулей QR артефактами сжатия.
 *
 * rotate — поворот в градусах для ленточных принтеров. Brother печатает
 * непрерывной лентой шириной 24 мм: печатающая головка пишет поперёк ленты, и
 * страницу драйвер ждёт «стоя» — 24 мм в ширину, 80 мм в длину, — а сама
 * этикетка на ней лежит боком. Лежачий файл 80 × 24 такой драйвер разворачивает
 * сам и как придётся, поэтому поворот делается здесь, на растеризации: плотность
 * при этом остаётся прежней, и физический размер получается честные 24 × 80 мм.
 *
 * Поворот только у скачиваемого файла. Печать прямо из браузера идёт своей
 * страницей с @page нужного размера — там разворачивать нечего.
 */
async function labelPng(svg, size, { rotate = 0 } = {}) {
  const sizeKey = LABEL_SIZES[size] ? size : '80x24';
  const cfg = LABEL_SIZES[sizeKey];
  const dpi = cfg.printer === 'tdp225' ? 203 : 180;
  const width = Math.round(cfg.w * dpi / 25.4);
  const height = Math.round(cfg.h * dpi / 25.4);

  const page = sharp(Buffer.from(svg), { density: dpi })
    .resize(width, height, { fit: 'fill' });

  const png = { compressionLevel: 9, palette: true, colours: 2, dither: 0 };
  if (!rotate) return page.withMetadata({ density: dpi }).png(png).toBuffer();

  // Поворот — отдельным проходом по готовой странице. В одной цепочке sharp
  // выстраивает операции своим порядком и разворачивает картинку раньше, чем
  // добавит поля: страница выходила повёрнутой полосой без них.
  return sharp(await page.png(png).toBuffer())
    .rotate(rotate)
    .withMetadata({ density: dpi })
    .png(png)
    .toBuffer();
}

/**
 * Ширина строки в миллиметрах.
 *
 * Первая версия умножала длину строки на 0,5 кегля, вторая — на 0,58. Оба раза
 * текст всё равно вылезал за край: средний коэффициент не работает, потому что
 * разброс между «і» и «Щ» больше трёх раз, а в русских названиях оборудования
 * широкие буквы встречаются гуще, чем в латинице.
 *
 * Поэтому ширина считается по классам символов. Значения — доли кегля из метрик
 * Arial и DejaVu Sans (они близки, а в SVG стоит именно этот стек шрифтов).
 * Сверху накинут запас 4 %: недооценка приводит к обрезанному тексту на
 * принтере, переоценка — всего лишь к небольшому пустому полю справа.
 */
const GLYPH_SAFETY = 1.04;

function glyphRatio(ch) {
  if ('  '.includes(ch)) return 0.28;
  if ('ijltIÍ.,:;\'`|!’[]()'.includes(ch)) return 0.30;
  if ('fr-–—·/\\'.includes(ch)) return 0.36;
  if ('mwMWШЩЫЮmшщыю№'.includes(ch)) return 0.86;
  if ('0123456789'.includes(ch)) return 0.56;
  // Прописные — латиница и кириллица.
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= 'А' && ch <= 'Я') return 0.68;
  if (ch === 'Ё') return 0.68;
  return 0.58;
}

function textWidth(text, fontSize) {
  let units = 0;
  for (const ch of String(text || '')) units += glyphRatio(ch);
  return units * fontSize * GLYPH_SAFETY;
}

/**
 * Подбирает кегль так, чтобы строка влезла в заданную ширину, но не меньше
 * указанного минимума. Инвентарный номер сжимать до нечитаемого нельзя — если он
 * не влезает даже минимальным кеглем, значит маска слишком длинная, и это лучше
 * увидеть на превью, чем получить обрезок на принтере.
 */
function fitFontSize(text, widthMm, preferred, min) {
  let size = preferred;
  while (size > min && textWidth(text, size) > widthMm) size -= 0.1;
  return Math.round(size * 10) / 10;
}

/**
 * Кегль и разбивка наименования так, чтобы оно поместилось ЦЕЛИКОМ.
 *
 * Инвентарный номер сжимать нельзя — его читают посимвольно, — а наименование
 * можно: лучше строчка помельче, чем «Комплекс аппаратно-программный для
 * ультразвуковой диагностики Mindray DC-70…» с многоточием вместо конца. По
 * обрезанному названию вещь на полке не опознать, а ради этого этикетку и
 * читают.
 *
 * Кегль перебирается от желаемого вниз: берём первый, при котором весь текст
 * укладывается в отведённую высоту. Число строк при этом не ограничено — его
 * ограничивает сама высота.
 */
function fitTextBlock(text, widthMm, heightMm, preferred, min, lineRatio) {
  const lineCount = size => wrapToWidth(text, widthMm, size, 99).length;
  for (let size = preferred; size >= min; size = Math.round((size - 0.05) * 100) / 100) {
    if (lineCount(size) * size * lineRatio <= heightMm) {
      return { size, lines: wrapToWidth(text, widthMm, size, 99) };
    }
  }
  // Не поместилось даже минимальным кеглем: показываем сколько влезет. Это уже
  // не про вёрстку — столько текста на ленту шириной в палец не нанести.
  const maxLines = Math.max(1, Math.floor(heightMm / (min * lineRatio)));
  return { size: min, lines: wrapToWidth(text, widthMm, min, maxLines) };
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Переносит текст по строкам, укладываясь в ширину в миллиметрах.
 *
 * Раньше перенос считался по количеству символов, а количество выводилось из
 * ширины делением на полкегля — двойная аппроксимация, из-за которой длинные
 * названия («Аппарат ультразвуковой диагностический Mindray DC-70 Exp») уезжали
 * за край. Теперь ширина каждой строки проверяется напрямую.
 *
 * Слово, которое само по себе не влезает в строку, режется по буквам: иначе
 * «Электрокардиограф» в узкой колонке вылезал бы целиком.
 */
function wrapToWidth(text, widthMm, fontSize, maxLines) {
  // Дефис — законная точка переноса, поэтому дробим по нему на отдельные куски,
  // сохраняя дефис в конце левой части. Без этого «Облучатель-рециркулятор»
  // рубился по буквам и получалось «Облучатель-рециркуля / тор».
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
    .flatMap(w => (w.includes('-') && w.length > 6
      ? w.split(/(?<=-)/).filter(Boolean)
      : [w]));
  if (!words.length) return [];

  const lines = [];
  let cur = '';

  const pushCur = () => { if (cur) { lines.push(cur); cur = ''; } };

  for (const word of words) {
    if (lines.length >= maxLines) break;

    // Кусок, оставшийся после дефиса, приклеивается без пробела.
    const glue = cur && !cur.endsWith('-') ? ' ' : '';
    const candidate = cur ? `${cur}${glue}${word}` : word;
    if (textWidth(candidate, fontSize) <= widthMm) {
      cur = candidate;
      continue;
    }

    pushCur();
    if (lines.length >= maxLines) break;

    // Само слово шире строки — переносим с видимым дефисом. Сначала ищем
    // естественную границу слога (гласная + согласная + гласная), а если её нет,
    // используем максимально длинный безопасный кусок. Не оставляем по одной
    // букве с любой стороны переноса.
    let rest = word;
    while (textWidth(rest, fontSize) > widthMm && lines.length < maxLines) {
      let cut = rest.length;
      while (cut > 2 && textWidth(`${rest.slice(0, cut)}-`, fontSize) > widthMm) cut--;

      const vowels = /[аеёиоуыэюяaeiouy]/i;
      const natural = [];
      for (let i = 2; i <= cut && rest.length - i >= 2; i++) {
        if (vowels.test(rest[i - 1]) && !vowels.test(rest[i]) && vowels.test(rest[i + 1] || '')) {
          natural.push(i);
        }
      }
      if (natural.length) cut = natural[natural.length - 1];
      cut = Math.max(2, Math.min(cut, rest.length - 2));
      lines.push(`${rest.slice(0, cut)}-`);
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  pushCur();

  const used = lines.join('').replace(/[\s-]/g, '');
  const full = words.join('').replace(/[\s-]/g, '');
  // Что-то не поместилось — ставим многоточие, срезав столько символов, сколько
  // нужно, чтобы оно само влезло.
  if (lines.length && used.length < full.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && textWidth(`${last}…`, fontSize) > widthMm) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
}

/**
 * Округляет координату для SVG. Деления вроде (17.5 - 14.7) / 2 дают в двоичной
 * дроби хвост из семнадцати знаков, и он уезжает прямо в разметку.
 */
const mm = value => Math.round(value * 1000) / 1000;

/**
 * SVG этикетки актива.
 */
async function assetLabelSvg(asset, { size = '80x24' } = {}) {
  const equipmentSizes = ['80x24', '44x25'];
  const sizeKey = equipmentSizes.includes(size) ? size : '80x24';
  const cfg = LABEL_SIZES[sizeKey];
  const url = assetPublicUrl(asset.publicToken);
  const FONT = 'Helvetica, Arial, sans-serif';
  const LINE = 1.28; // межстрочный интервал в долях кегля

  // Вкладываем QR как вложенный <svg> с явными координатами: так он
  // масштабируется вместе с этикеткой и не требует растеризации.
  const rawQr = await qrSvg(url, { margin: 2, width: 100 });
  const qrInner = rawQr
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
  const qrViewBox = (rawQr.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';

  const { w, h, pad, qr, gap } = cfg;
  // Отступ содержимого сверху и снизу: сама этикетка остаётся во всю ширину
  // ленты, внутрь уезжают только строки и код — в полосу, до которой достаёт
  // головка (см. LABEL_SIZES). Рамка при этом идёт по краю ленты: её верх и низ
  // приходятся на неснимаемое поле и на ленте видны не будут, но уменьшать ради
  // них саму этикетку значит печатать узкую наклейку посреди ленты.
  const padY = pad + (h - (cfg.printH || h)) / 2;

  if (cfg.layout === 'horizontal') {
    const colX = pad + qr + gap;
    const colW = w - colX - pad;
    const colCenter = colX + colW / 2;
    const numberSize = fitFontSize(asset.inventoryNumber, colW, cfg.numberSize, 1.45);
    // Высота под наименование — всё, что остаётся от полосы после номера. Номер
    // держит свой кегль, наименование подстраивается: оно длиннее и терпимее к
    // мелкому шрифту, а обрезанным быть не должно.
    const nameMaxH = (h - padY * 2) - numberSize - cfg.nameGap;
    const { size: nameSize, lines: nameLines } =
      fitTextBlock(asset.name, colW, nameMaxH, cfg.nameSize, cfg.nameMin, LINE);
    const nameStep = nameSize * LINE;
    const nameStart = h - padY - Math.max(0, nameLines.length - 1) * nameStep;
    // Шапки «АЛЬФА ВИКИ: СКЛАД» больше нет: на этикетке ей отвечать не на что —
    // кто её читает, и так стоит внутри организации, — а высоту она отбирала у
    // инвентарного номера, ради которого этикетку и читают. Номер занял всё
    // освободившееся место сверху.
    const numberAreaBottom = nameStart - nameSize * 1.15;
    const numberY = (padY + numberAreaBottom) / 2 + numberSize * 0.35;
    const rows = [`<text x="${colCenter}" y="${mm(numberY)}" text-anchor="middle" font-family="${FONT}" font-size="${numberSize}"
          font-weight="700" fill="#000">${escapeXml(asset.inventoryNumber)}</text>`];

    for (const [index, line] of nameLines.entries()) {
      rows.push(`<text x="${colX}" y="${mm(nameStart + index * nameStep)}" font-family="${FONT}" font-size="${nameSize}"
          fill="#000">${escapeXml(line)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm"
       viewBox="0 0 ${w} ${h}" role="img" aria-label="Этикетка ${escapeXml(asset.inventoryNumber)}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${w - 0.3}" height="${h - 0.3}" fill="none"
        stroke="#000" stroke-width="0.3" rx="0.8"/>
  <svg x="${mm(pad)}" y="${mm((h - qr) / 2)}" width="${qr}" height="${qr}" viewBox="${qrViewBox}"
       preserveAspectRatio="xMidYMid meet">${qrInner}</svg>
  ${rows.join('\n  ')}
</svg>`;
  }
  throw new Error(`Неподдерживаемая раскладка этикетки оборудования: ${sizeKey}`);
}

/**
 * ZPL II для TDP-225, 203 dpi, на этикетку 44x25 мм. Это отдельный профиль:
 * размеры Brother сюда намеренно не передаются.
 *
 *   • ^CI28 — иначе принтер печатает кириллицу мусором. В исходном шаблоне этой
 *     команды нет, и «УЗИ Mindray» вышло бы кракозябрами;
 *   • наименование режется по длине здесь, а не полагается на ^FB: при переполнении
 *     ^FB молча обрезает последнюю строку без многоточия, и на этикетке остаётся
 *     обрубок вроде «Аппарат ультразвуковой диагно».
 */
function assetLabelZpl(asset, { copies = 1, density = 10 } = {}) {
  const url = assetPublicUrl(asset.publicToken);
  // 203 dpi ≈ 8 точек/мм: 44x25 мм превращаются в поле 352x200 точек.
  const DPMM = 8;
  const mm = v => Math.round(v * DPMM);

  const widthMm = 44;
  const heightMm = 25;
  const padMm = 1.5;
  const qrMm = 16;
  const colXmm = padMm + qrMm + 1.5;
  const colWmm = widthMm - colXmm - padMm;

  // Кегли ZPL заданы в точках, а расчёт ширины — в миллиметрах, отсюда деление.
  const numberPt = 22, namePt = 18, brandPt = 11;

  const nameLines = wrapToWidth(asset.name, colWmm, namePt / DPMM, 3);
  // Кегль номера подбираем под колонку и переводим обратно в точки: обрезать
  // инвентарный номер нельзя, а при маске в 21 символ он в 30 пунктов не влезает.
  const numberFitMm = fitFontSize(asset.inventoryNumber, colWmm, numberPt / DPMM, 1.45);
  const numberPtFit = Math.max(10, Math.round(numberFitMm * DPMM));
  const numberLine = asset.inventoryNumber;

  const lines = [];
  const nameStepMm = (namePt / DPMM) * 1.28;
  const nameStartMm = heightMm - padMm - nameLines.length * nameStepMm;
  const numberYmm = (3.2 + nameStartMm - numberPtFit / DPMM) / 2;
  lines.push(`^FO${mm(colXmm)},${mm(padMm)}^FB${mm(colWmm)},1,0,C,0^A0N,${brandPt},${brandPt}^FDАЛЬФА ВИКИ: СКЛАД^FS`);
  lines.push(`^FO${mm(colXmm)},${mm(numberYmm)}^FB${mm(colWmm)},1,0,C,0^A0N,${numberPtFit},${numberPtFit}^FD${numberLine}^FS`);

  let yMm = nameStartMm;
  for (const line of nameLines) {
    lines.push(`^FO${mm(colXmm)},${mm(yMm)}^A0N,${namePt},${namePt}^FD${line}^FS`);
    yMm += nameStepMm;
  }
  return `^XA
^CI28
^PW${mm(widthMm)}
^LL${mm(heightMm)}
^LH0,0
^MMT
^MD${density}

^FO${mm(padMm)},${mm(padMm)}^BQN,2,3,Q,7
^FDQA,${url}^FS

${lines.join('\n')}

^PQ${copies}
^XZ`;
}

function formatDate(d) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Публичное представление актива. Сознательно узкое — см. комментарий в начале
 * файла. Всё, чего здесь нет, отсутствует не по забывчивости.
 */
function toPublicAsset(asset, { maintenanceOrders = [], repairs = [], movements = [], files = [] } = {}) {
  const STATUS_LABELS = {
    in_use:      'В работе',
    maintenance: 'На техобслуживании',
    repair:      'В ремонте',
    storage:     'На хранении',
    written_off: 'Списано',
    reserved:    'Зарезервировано',
  };

  return {
    inventoryNumber: asset.inventoryNumber,
    name:            asset.name,
    model:           asset.model,
    manufacturer:    asset.manufacturer,
    // Серийный номер оставлен: по нему подрядчик находит прибор в своей базе, и
    // это первое, что спрашивают в сервисе. Коммерческой тайны в нём нет.
    serialNumber:    asset.serialNumber,
    status:          asset.status,
    statusLabel:     STATUS_LABELS[asset.status] || asset.status,
    commissioningDate: asset.commissioningDate,
    warrantyUntil:   asset.warrantyUntil,
    nextMaintenanceDate: asset.nextMaintenanceDate,
    location: asset.room ? {
      // У кабинетов без номера в МИС («Рентген», «КТ») номер и название совпадают,
      // и «Каб. Рентген — Рентген» читается как ошибка. Показываем один раз.
      room: asset.room.name && asset.room.name !== asset.room.number
        ? `Каб. ${asset.room.number} — ${asset.room.name}`
        : `Каб. ${asset.room.number}`,
      department: asset.room.department?.name || null,
      floor:      asset.room.floor ? `${asset.room.floor.number} этаж` : null,
      building:   asset.room.floor?.building?.name || null,
    } : null,
    // Ответственный — должностью и отделением, без ФИО.
    responsible: asset.room?.department?.name
      ? { role: 'Материально ответственное лицо', department: asset.room.department.name }
      : null,
    maintenance: maintenanceOrders.map(o => ({
      type:        o.type,
      plannedDate: o.plannedDate,
      factDate:    o.factDate,
      status:      o.status,
      result:      o.result,
    })),
    repairs: repairs.map(r => ({
      startedAt:  r.startedAt,
      finishedAt: r.finishedAt,
      result:     r.result,
    })),
    // Лента жизни без ФИО и без причин.
    timeline: movements.map(m => ({
      type:       m.type,
      occurredAt: m.occurredAt,
    })),
    files: files.filter(f => f.isPublic).map(f => ({
      kind: f.kind,
      name: f.originalName,
      url:  `/uploads/warehouse/assets/${f.storedName}`,
    })),
  };
}

/**
 * Этикетка на дверь кабинета. Brother использует альбомную 80x24, TDP-225 —
 * отдельную горизонтальную раскладку 44x25.
 *
 * На этикетке остаётся только то, ради чего к двери подходят: номер кабинета и
 * код. Инструкции про портал и авторизацию убраны давно, а следом — шапка
 * «АЛЬФА ВИКИ: СКЛАД» и подвал с названием и адресом медцентра. На ленте
 * шириной в палец каждая такая строка отбирает высоту у номера, а сообщает то,
 * что и так известно всякому, кто стоит перед этой дверью.
 */
async function roomDoorCardSvg(room, { size = '80x24' } = {}) {
  const roomSizes = ['80x24', '44x25'];
  const sizeKey = roomSizes.includes(size) ? size : '80x24';
  const cfg = LABEL_SIZES[sizeKey];
  const W = cfg.w, H = cfg.h, PAD = cfg.pad;
  const FONT = 'Helvetica, Arial, sans-serif';
  const LINE = 1.28;
  const qrSize = cfg.qr;
  const center = W / 2;

  const url = roomAppUrl(room.id);
  const rawQr = await qrSvg(url, { margin: 2, width: 100 });
  const qrInner = rawQr
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
  const qrViewBox = (rawQr.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';

  if (cfg.rotated) {
    const isWideTape = sizeKey === '80x24';
    const colX = PAD + qrSize + cfg.gap;
    const colW = W - colX - PAD;
    const colCenter = colX + colW / 2;
    // На ленте осталось два ряда: номер кабинета и слово «КАБИНЕТ». Всё
    // остальное — шапка «АЛЬФА ВИКИ / СКЛАД», линия и подвал с названием и
    // адресом медцентра — убрано. Семь рядов на ленте шириной в палец делали
    // номер мелким, а сообщали то, что известно всякому, кто стоит перед
    // дверью. Освободившееся место целиком отдано номеру.
    const band = cfg.printH || H;
    const contentTop = (H - band) / 2 + PAD;
    const contentH = band - PAD * 2;
    const titleSize = 2.4;
    const numberSize = fitFontSize(room.number, colW, 8.5, 3);
    const gapY = 0.9;
    const stack = numberSize + gapY + titleSize;
    const numberY = contentTop + (contentH - stack) / 2 + numberSize;
    const titleY = numberY + gapY + titleSize;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm"
       viewBox="0 0 ${W} ${H}" role="img" aria-label="Карточка кабинета ${escapeXml(room.number)}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${W - 0.3}" height="${H - 0.3}" fill="none"
        stroke="#000" stroke-width="0.3" rx="0.8"/>
  <svg x="${mm(PAD)}" y="${mm((H - qrSize) / 2)}" width="${qrSize}" height="${qrSize}"
       viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">${qrInner}</svg>
  <text x="${colCenter}" y="${mm(numberY)}" text-anchor="middle" font-family="${FONT}"
        font-size="${numberSize}" font-weight="700" fill="#000">${escapeXml(room.number)}</text>
  <text x="${colCenter}" y="${mm(titleY)}" text-anchor="middle" font-family="${FONT}"
        font-size="${titleSize}" letter-spacing="0.7" fill="#000">КАБИНЕТ</text>
</svg>`;
  }

  if (cfg.layout === 'horizontal') {
    const colX = PAD + qrSize + cfg.gap;
    const colW = W - colX - PAD;
    const horizontalTitleSize = 2;
    const horizontalNameSize = 2;
    // Номер стал крупнее: подвал с реквизитами убран, и место под ним свободно.
    const horizontalNumberSize = fitFontSize(room.number, colW, 6.4, 2.5);
    const horizontalNameLines = room.name && room.name !== room.number
      ? wrapToWidth(room.name, colW, horizontalNameSize, 2) : [];
    // Та же чистка, что и на ленте: остаются номер, слово «КАБИНЕТ» и название
    // кабинета, если оно отличается от номера. Шапка и подвал с реквизитами
    // медцентра убраны — на двери они не сообщают ничего нового.
    const colCenter = colX + colW / 2;
    const numberY = PAD + horizontalNumberSize;
    const titleY = numberY + horizontalTitleSize + 0.9;
    const horizontalRows = [
      `<text x="${colCenter}" y="${mm(numberY)}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalNumberSize}" font-weight="700" fill="#000">${escapeXml(room.number)}</text>`,
      `<text x="${colCenter}" y="${mm(titleY)}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalTitleSize}" letter-spacing="0.6" fill="#000">КАБИНЕТ</text>`,
    ];
    let horizontalY = Math.max(titleY + horizontalNameSize * 1.6, PAD + qrSize + horizontalNameSize);
    for (const line of horizontalNameLines) {
      horizontalRows.push(`<text x="${center}" y="${mm(horizontalY)}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalNameSize}" fill="#000">${escapeXml(line)}</text>`);
      horizontalY += horizontalNameSize * LINE;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm"
       viewBox="0 0 ${W} ${H}" role="img" aria-label="Карточка кабинета ${escapeXml(room.number)}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${W - 0.3}" height="${H - 0.3}" fill="none"
        stroke="#000" stroke-width="0.3" rx="0.8"/>
  <svg x="${PAD}" y="${PAD}" width="${qrSize}" height="${qrSize}"
       viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">${qrInner}</svg>
  ${horizontalRows.join('\n  ')}
</svg>`;
  }

  throw new Error(`Неподдерживаемый размер этикетки кабинета: ${sizeKey}`);
}

/**
 * ZPL-профиль дверной этикетки для TDP-225, строго 44x25 мм при 203 dpi.
 * Состав тот же, что у картинки: номер, «КАБИНЕТ» и название — без шапки и без
 * подвала с реквизитами медцентра.
 */
function roomDoorCardZpl(room, { copies = 1, density = 10 } = {}) {
  const DPMM = 8;
  const mm = value => Math.round(value * DPMM);
  const widthMm = 44, heightMm = 25, padMm = 1.5, qrMm = 16;
  const colXmm = padMm + qrMm + 1.5;
  const colWmm = widthMm - colXmm - padMm;
  const url = roomAppUrl(room.id);
  const numberPt = Math.max(18, Math.round(fitFontSize(room.number, colWmm, 6.4, 2.5) * DPMM));
  const namePt = 16;
  const nameLines = room.name && room.name !== room.number
    ? wrapToWidth(room.name, colWmm, namePt / DPMM, 2) : [];
  let yMm = padMm + qrMm + 1.8;
  const nameRows = [];
  for (const line of nameLines) {
    nameRows.push(`^FO${mm(padMm)},${mm(yMm)}^FB${mm(widthMm - padMm * 2)},1,0,C,0^A0N,${namePt},${namePt}^FD${line}^FS`);
    yMm += (namePt / DPMM) * 1.28;
  }

  return `^XA
^CI28
^PW${mm(widthMm)}
^LL${mm(heightMm)}
^LH0,0
^MMT
^MD${density}

^FO${mm(padMm)},${mm(padMm)}^BQN,2,3,Q,7
^FDQA,${url}^FS

^FO${mm(colXmm)},${mm(padMm)}^FB${mm(colWmm)},1,0,C,0^A0N,${numberPt},${numberPt}^FD${room.number}^FS
^FO${mm(colXmm)},${mm(padMm + numberPt / DPMM + 0.9)}^FB${mm(colWmm)},1,0,C,0^A0N,12,12^FDКАБИНЕТ^FS
${nameRows.join('\n')}

^PQ${copies}
^XZ`;
}

module.exports = {
  PUBLIC_BASE_URL,
  LABEL_SIZES,
  generateToken,
  assetPublicUrl,
  roomAppUrl,
  roomDoorCardSvg,
  roomDoorCardZpl,
  labelPng,
  qrSvg,
  qrPngDataUrl,
  assetLabelSvg,
  assetLabelZpl,
  toPublicAsset,
  formatDate,
};
