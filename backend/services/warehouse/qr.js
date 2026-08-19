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
 * браузера в точный размер, и вставить в PDF-лист с несколькими этикетками.
 *
 * Brother P-touch E550W печатает на узкой ленте. Доступны две ширины — 20 и
 * 24 мм; длина отрезка задаётся драйвером. Оборудование печатается только в
 * альбомных 80x20/80x24. Для кабинетов есть компактный профиль 24x45 и длинные
 * вертикальные 20x80/24x80.
 */
const LABEL_SIZES = {
  '24x45': {
    w: 24, h: 45, pad: 1.5, qr: 18, gap: 1.1,
    numberSize: 2.8, nameSize: 1.8, metaSize: 1.45, footSize: 1.4,
    nameLines: 2, layout: 'vertical', printer: 'brother', compactRoom: true,
  },
  '20x80': {
    w: 20, h: 80, pad: 1.5, qr: 17, gap: 1.5,
    numberSize: 2.6, nameSize: 2.1, metaSize: 1.7, footSize: 1.55,
    nameLines: 3, layout: 'vertical', printer: 'brother',
  },
  '24x80': {
    w: 24, h: 80, pad: 1.5, qr: 21, gap: 1.5,
    numberSize: 3.0, nameSize: 2.3, metaSize: 1.9, footSize: 1.7,
    nameLines: 3, layout: 'vertical', printer: 'brother',
  },
  '80x20': {
    w: 80, h: 20, pad: 1.5, qr: 17, gap: 1.5,
    numberSize: 2.7, nameSize: 1.9, metaSize: 1.5, footSize: 1.25,
    nameLines: 2, layout: 'horizontal', printer: 'brother', rotated: true,
  },
  '80x24': {
    w: 80, h: 24, pad: 1.5, qr: 21, gap: 1.5,
    numberSize: 3, nameSize: 2.1, metaSize: 1.65, footSize: 1.4,
    nameLines: 3, layout: 'horizontal', printer: 'brother', rotated: true,
  },
  '44x25': {
    w: 44, h: 25, pad: 1.5, qr: 16, gap: 1.5,
    numberSize: 2.7, nameSize: 2.05, metaSize: 1.7, footSize: 1.5,
    nameLines: 3, layout: 'horizontal', printer: 'tdp225',
  },
};

/**
 * Растеризует готовую этикетку в физический размер конкретного принтера.
 * PNG выбран намеренно: JPEG размывает границы модулей QR артефактами сжатия.
 */
async function labelPng(svg, size) {
  const sizeKey = LABEL_SIZES[size] ? size : '80x24';
  const cfg = LABEL_SIZES[sizeKey];
  const dpi = cfg.printer === 'tdp225' ? 203 : 180;
  const width = Math.round(cfg.w * dpi / 25.4);
  const height = Math.round(cfg.h * dpi / 25.4);

  return sharp(Buffer.from(svg), { density: dpi })
    .resize(width, height, { fit: 'fill' })
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 9, palette: true, colours: 2, dither: 0 })
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

/** Обрезает строку в одну линию по ширине. */
function clipToWidth(text, widthMm, fontSize) {
  const str = String(text || '');
  if (!str) return '';
  if (textWidth(str, fontSize) <= widthMm) return str;
  let cut = str.length;
  while (cut > 1 && textWidth(`${str.slice(0, cut)}…`, fontSize) > widthMm) cut--;
  return `${str.slice(0, cut)}…`;
}

/**
 * SVG этикетки актива.
 */
async function assetLabelSvg(asset, { size = '80x24' } = {}) {
  const equipmentSizes = ['80x20', '80x24', '44x25'];
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

  if (cfg.layout === 'horizontal') {
    const colX = pad + qr + gap;
    const colW = w - colX - pad;
    const colCenter = colX + colW / 2;
    const numberSize = fitFontSize(asset.inventoryNumber, colW, cfg.numberSize, 1.45);
    const nameLines = wrapToWidth(asset.name, colW, cfg.nameSize, cfg.nameLines);
    const brandSize = cfg.metaSize;
    const brandY = pad + brandSize;
    const nameStep = cfg.nameSize * LINE;
    const nameStart = h - pad - Math.max(0, nameLines.length - 1) * nameStep;
    const numberAreaTop = brandY + brandSize * 0.7;
    const numberAreaBottom = nameStart - cfg.nameSize * 1.15;
    const numberY = (numberAreaTop + numberAreaBottom) / 2 + numberSize * 0.35;
    const rows = [`<text x="${colCenter}" y="${brandY}" text-anchor="middle" font-family="${FONT}"
          font-size="${brandSize}" font-weight="700" fill="#000">АЛЬФА ВИКИ: СКЛАД</text>`];
    rows.push(`<text x="${colCenter}" y="${numberY}" text-anchor="middle" font-family="${FONT}" font-size="${numberSize}"
          font-weight="700" fill="#000">${escapeXml(asset.inventoryNumber)}</text>`);

    for (const [index, line] of nameLines.entries()) {
      rows.push(`<text x="${colX}" y="${nameStart + index * nameStep}" font-family="${FONT}" font-size="${cfg.nameSize}"
          fill="#000">${escapeXml(line)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm"
       viewBox="0 0 ${w} ${h}" role="img" aria-label="Этикетка ${escapeXml(asset.inventoryNumber)}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${w - 0.3}" height="${h - 0.3}" fill="none"
        stroke="#000" stroke-width="0.3" rx="0.8"/>
  <svg x="${pad}" y="${(h - qr) / 2}" width="${qr}" height="${qr}" viewBox="${qrViewBox}"
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
 * Этикетка на дверь кабинета. Для Brother по умолчанию используется компактная
 * вертикальная раскладка 24x45; длинные 20x80/24x80 оставлены как варианты.
 * TDP-225 — отдельная горизонтальная раскладка 44x25.
 * На этикетке остаётся только идентификация кабинета и сам код: инструкции про
 * портал и авторизацию занимали полезную площадь и дублировали поведение ссылки.
 */
async function roomDoorCardSvg(room, { orgName = '', orgAddress = '', size = '24x45' } = {}) {
  const sizeKey = LABEL_SIZES[size] ? size : '24x45';
  const cfg = LABEL_SIZES[sizeKey];
  const W = cfg.w, H = cfg.h, PAD = cfg.pad;
  const FONT = 'Helvetica, Arial, sans-serif';
  const LINE = 1.28;
  const qrSize = cfg.qr;
  const inner = W - PAD * 2;
  const center = W / 2;

  const url = roomAppUrl(room.id);
  const rawQr = await qrSvg(url, { margin: 2, width: 100 });
  const qrInner = rawQr
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
  const qrViewBox = (rawQr.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';

  const titleSize = cfg.compactRoom ? 1.8 : (sizeKey === '24x80' ? 2.2 : 2);
  const maxNumberSize = cfg.compactRoom ? 4.5 : (sizeKey === '24x80' ? 5.5 : 5);
  const minNumberSize = 2.5;
  const nameSize = cfg.compactRoom ? 1.8 : (sizeKey === '24x80' ? 2.2 : 2);
  const metaSize = cfg.compactRoom ? 1.45 : (sizeKey === '24x80' ? 1.8 : 1.65);

  // Номер подбирается под правую колонку: длинные варианты вроде «312а/2» не
  // должны обрезаться у края этикетки.
  const numberSize = fitFontSize(room.number, inner, maxNumberSize, minNumberSize);
  const nameLines = !cfg.compactRoom && room.name && room.name !== room.number
    ? wrapToWidth(room.name, inner, nameSize, 2) : [];

  const building = room.floor?.building?.name || '';
  const floor = room.floor ? `${room.floor.number} этаж` : '';

  if (cfg.layout === 'horizontal') {
    const colX = PAD + qrSize + cfg.gap;
    const colW = W - colX - PAD;
    const horizontalTitleSize = 2;
    const horizontalNameSize = 2;
    const horizontalMetaSize = 1.15;
    const horizontalNumberSize = fitFontSize(room.number, colW, 5.2, 2.5);
    const horizontalNameLines = room.name && room.name !== room.number
      ? wrapToWidth(room.name, colW, horizontalNameSize, 2) : [];
    const dividerY = PAD + qrSize + 1;
    const horizontalBrandSize = 1.1;
    const colCenter = colX + colW / 2;
    let horizontalY = PAD + horizontalBrandSize;
    const horizontalRows = [`<text x="${colCenter}" y="${horizontalY}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalBrandSize}" font-weight="700" fill="#000">АЛЬФА ВИКИ</text>`];
    horizontalY += horizontalBrandSize * 1.2;
    horizontalRows.push(`<text x="${colCenter}" y="${horizontalY}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalBrandSize}" font-weight="700" fill="#000">СКЛАД</text>`);
    horizontalY += horizontalTitleSize * 0.9;
    horizontalRows.push(`<text x="${colCenter}" y="${horizontalY}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalTitleSize}" letter-spacing="0.6" fill="#000">КАБИНЕТ</text>`);
    horizontalY += horizontalNumberSize + 0.7;
    horizontalRows.push(`<text x="${colCenter}" y="${horizontalY}" text-anchor="middle" font-family="${FONT}"
          font-size="${horizontalNumberSize}" font-weight="700" fill="#000">${escapeXml(room.number)}</text>`);
    horizontalY += horizontalNameSize * 1.35;
    for (const line of horizontalNameLines) {
      horizontalRows.push(`<text x="${colX}" y="${horizontalY}" font-family="${FONT}"
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
  <line x1="${PAD}" y1="${dividerY}" x2="${W - PAD}" y2="${dividerY}"
        stroke="#000" stroke-width="0.25"/>
  ${[building, floor, orgName, orgAddress].filter(Boolean).map((line, index) =>
    `<text x="${center}" y="${dividerY + 1.3 + index * 1.3}" text-anchor="middle" font-family="${FONT}"
        font-size="${horizontalMetaSize}" fill="#000">${escapeXml(clipToWidth(line, inner, horizontalMetaSize))}</text>`).join('\n  ')}
</svg>`;
  }

  if (cfg.compactRoom) {
    const compactBrandSize = 1.35;
    const compactMetaSize = 1.35;
    const compactTitleSize = 1.8;
    const compactNumberSize = fitFontSize(room.number, inner, 4.2, 2.5);
    const compactOrgSize = fitFontSize(orgName, inner, 1.2, 0.9);
    const compactAddressSize = fitFontSize(orgAddress, inner, 1.2, 0.9);
    // Реквизиты организации обязаны оставаться последними. Под них резервируем
    // нижние 7 мм, а QR ставим сразу после номера кабинета.
    const compactQrY = H - PAD - qrSize - 7;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm"
       viewBox="0 0 ${W} ${H}" role="img" aria-label="Карточка кабинета ${escapeXml(room.number)}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${W - 0.3}" height="${H - 0.3}" fill="none"
        stroke="#000" stroke-width="0.3" rx="0.8"/>

  <text x="${center}" y="${PAD + compactBrandSize}" text-anchor="middle" font-family="${FONT}"
        font-size="${compactBrandSize}" font-weight="700" fill="#000">АЛЬФА ВИКИ</text>
  <text x="${center}" y="${PAD + compactBrandSize * (1 + LINE)}" text-anchor="middle" font-family="${FONT}"
        font-size="${compactBrandSize}" font-weight="700" fill="#000">СКЛАД</text>
  ${building ? `<text x="${center}" y="7.1" text-anchor="middle" font-family="${FONT}"
        font-size="${compactMetaSize}" fill="#000">${escapeXml(clipToWidth(building, inner, compactMetaSize))}</text>` : ''}
  ${floor ? `<text x="${center}" y="8.9" text-anchor="middle" font-family="${FONT}"
        font-size="${compactMetaSize}" fill="#000">${escapeXml(floor)}</text>` : ''}
  <text x="${center}" y="14" text-anchor="middle" font-family="${FONT}"
        font-size="${compactNumberSize}" font-weight="700" fill="#000">${escapeXml(room.number)}</text>
  <text x="${center}" y="16.8" text-anchor="middle" font-family="${FONT}"
        font-size="${compactTitleSize}" letter-spacing="0.7" fill="#000">КАБИНЕТ</text>
  <svg x="${(W - qrSize) / 2}" y="${compactQrY}" width="${qrSize}" height="${qrSize}"
       viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">${qrInner}</svg>
  <line x1="${PAD}" y1="38.5" x2="${W - PAD}" y2="38.5"
        stroke="#000" stroke-width="0.25"/>
  ${orgName ? `<text x="${center}" y="40.8" text-anchor="middle" font-family="${FONT}"
        font-size="${compactOrgSize}" fill="#000">${escapeXml(clipToWidth(orgName, inner, compactOrgSize))}</text>` : ''}
  ${orgAddress ? `<text x="${center}" y="43.5" text-anchor="middle" font-family="${FONT}"
        font-size="${compactAddressSize}" fill="#000">${escapeXml(clipToWidth(orgAddress, inner, compactAddressSize))}</text>` : ''}
</svg>`;
  }

  const brandSize = metaSize;
  const brandY = PAD + brandSize;
  const warehouseY = brandY + brandSize * LINE;
  const qrY = warehouseY + 1;
  const footerLines = [
    ...wrapToWidth(orgName, inner, metaSize, 2),
    ...wrapToWidth(orgAddress, inner, metaSize, 2),
  ];
  const footerStep = metaSize * LINE;
  const footerStart = H - PAD - Math.max(0, footerLines.length - 1) * footerStep;
  const footerDividerY = footerLines.length ? footerStart - metaSize * 1.15 : H - PAD;
  let y = qrY + qrSize + cfg.gap + metaSize;
  const head = [];
  if (building) {
    head.push(`<text x="${center}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="${metaSize}" fill="#000">${escapeXml(clipToWidth(building, inner, metaSize))}</text>`);
    y += metaSize * LINE;
  }
  if (floor) {
    head.push(`<text x="${center}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="${metaSize}" fill="#000">${escapeXml(floor)}</text>`);
    y += metaSize * LINE;
  }
  if (cfg.compactRoom) {
    // На короткой этикетке блок кабинета опирается на нижний разделитель:
    // свободное место распределяется между QR, местоположением и номером.
    const compactNumberY = footerDividerY - 1;
    const compactTitleY = compactNumberY - numberSize - 0.8;
    head.push(`<text x="${center}" y="${compactTitleY}" text-anchor="middle" font-family="${FONT}"
        font-size="${titleSize}" letter-spacing="0.7" fill="#000">КАБИНЕТ</text>`);
    head.push(`<text x="${center}" y="${compactNumberY}" text-anchor="middle" font-family="${FONT}"
        font-size="${numberSize}" font-weight="700" fill="#000">${escapeXml(room.number)}</text>`);
  } else {
    y += titleSize * 0.35;
    head.push(`<text x="${center}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="${titleSize}" letter-spacing="0.7" fill="#000">КАБИНЕТ</text>`);

    y += numberSize + 0.8;
    head.push(`<text x="${center}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="${numberSize}" font-weight="700" fill="#000">${escapeXml(room.number)}</text>`);

    y += nameSize * 1.35;
    for (const line of nameLines) {
      head.push(`<text x="${PAD}" y="${y}" font-family="${FONT}"
          font-size="${nameSize}" fill="#000">${escapeXml(line)}</text>`);
      y += nameSize * LINE;
    }
  }

  footerLines.forEach((line, index) => {
    head.push(`<text x="${center}" y="${footerStart + index * footerStep}" text-anchor="middle"
        font-family="${FONT}" font-size="${metaSize}" fill="#000">${escapeXml(line)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm"
     viewBox="0 0 ${W} ${H}" role="img" aria-label="Карточка кабинета ${escapeXml(room.number)}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${W - 0.3}" height="${H - 0.3}" fill="none"
        stroke="#000" stroke-width="0.3" rx="0.8"/>

  <text x="${center}" y="${brandY}" text-anchor="middle" font-family="${FONT}"
        font-size="${brandSize}" font-weight="700" fill="#000">АЛЬФА ВИКИ</text>
  <text x="${center}" y="${warehouseY}" text-anchor="middle" font-family="${FONT}"
        font-size="${brandSize}" font-weight="700" fill="#000">СКЛАД</text>
  <svg x="${(W - qrSize) / 2}" y="${qrY}" width="${qrSize}" height="${qrSize}"
       viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">${qrInner}</svg>

  ${head.join('\n  ')}
  ${footerLines.length ? `<line x1="${PAD}" y1="${footerDividerY}" x2="${W - PAD}" y2="${footerDividerY}"
        stroke="#000" stroke-width="0.25"/>` : ''}
</svg>`;
}

/** ZPL-профиль дверной этикетки для TDP-225, строго 44x25 мм при 203 dpi. */
function roomDoorCardZpl(room, { orgName = '', orgAddress = '', copies = 1, density = 10 } = {}) {
  const DPMM = 8;
  const mm = value => Math.round(value * DPMM);
  const widthMm = 44, heightMm = 25, padMm = 1.5, qrMm = 16;
  const colXmm = padMm + qrMm + 1.5;
  const colWmm = widthMm - colXmm - padMm;
  const url = roomAppUrl(room.id);
  const numberPt = Math.max(18, Math.round(fitFontSize(room.number, colWmm, 5.2, 2.5) * DPMM));
  const namePt = 16;
  const nameLines = room.name && room.name !== room.number
    ? wrapToWidth(room.name, colWmm, namePt / DPMM, 2) : [];
  const place = [
    room.floor?.building?.name,
    room.floor ? `${room.floor.number} этаж` : null,
  ].filter(Boolean);

  let yMm = 11.2;
  const nameRows = [];
  for (const line of nameLines) {
    nameRows.push(`^FO${mm(colXmm)},${mm(yMm)}^A0N,${namePt},${namePt}^FD${line}^FS`);
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

^FO${mm(colXmm)},${mm(padMm)}^FB${mm(colWmm)},1,0,C,0^A0N,9,9^FDАЛЬФА ВИКИ^FS
^FO${mm(colXmm)},${mm(2.8)}^FB${mm(colWmm)},1,0,C,0^A0N,9,9^FDСКЛАД^FS
^FO${mm(colXmm)},${mm(4.1)}^FB${mm(colWmm)},1,0,C,0^A0N,12,12^FDКАБИНЕТ^FS
^FO${mm(colXmm)},${mm(5.8)}^FB${mm(colWmm)},1,0,C,0^A0N,${numberPt},${numberPt}^FD${room.number}^FS
${nameRows.join('\n')}

^FO${mm(padMm)},${mm(padMm + qrMm + 1)}^GB${mm(widthMm - padMm * 2)},2,2^FS
^FO${mm(padMm)},${mm(18.8)}^A0N,10,10^FD${clipToWidth(place[0], widthMm - padMm * 2, 10 / DPMM)}^FS
^FO${mm(padMm)},${mm(20.1)}^A0N,10,10^FD${clipToWidth(place[1], widthMm - padMm * 2, 10 / DPMM)}^FS
^FO${mm(padMm)},${mm(21.4)}^A0N,10,10^FD${clipToWidth(orgName, widthMm - padMm * 2, 10 / DPMM)}^FS
^FO${mm(padMm)},${mm(22.7)}^A0N,10,10^FD${clipToWidth(orgAddress, widthMm - padMm * 2, 10 / DPMM)}^FS

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
