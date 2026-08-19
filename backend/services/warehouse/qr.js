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
 * Размеры из ТЗ: 58×40 мм стандартная и 100×70 мм для дорогого оборудования.
 */
/**
 * Раскладка этикеток.
 *
 * Первая версия ставила координаты руками и получила три беды сразу: текст
 * вылезал за правый край, строки шли вплотную, а полоса под QR-кодом оставалась
 * пустой. Теперь этикетка описана как сетка из двух областей:
 *
 *   ┌──────────┬────────────────────────┐
 *   │          │ инвентарный номер      │  верх: QR слева, идентификация справа
 *   │    QR    │ наименование (2 стр.)  │
 *   │          │ модель                 │
 *   ├──────────┴────────────────────────┤
 *   │ размещение · отделение            │  низ: во всю ширину, под QR тоже
 *   │ ТО до ……                организация│
 *   └───────────────────────────────────┘
 *
 * Всё в миллиметрах, межстрочный интервал — 1,28 от кегля (полтора выглядят
 * разреженно на 2,4 мм, а 1,0 — именно то «вплотную», которое и было).
 */
const LABEL_SIZES = {
  '58x40': {
    w: 58, h: 40, pad: 2.2, qr: 21, gap: 2.4,
    numberSize: 3.4, nameSize: 2.5, metaSize: 2.2, footSize: 2.0,
    nameLines: 3,
  },
  '100x70': {
    w: 100, h: 70, pad: 4, qr: 34, gap: 4,
    numberSize: 5.4, nameSize: 4.0, metaSize: 3.4, footSize: 3.0,
    nameLines: 3,
  },
};

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

    // Само слово шире строки — рубим по буквам.
    let rest = word;
    while (textWidth(rest, fontSize) > widthMm && lines.length < maxLines) {
      let cut = rest.length;
      while (cut > 1 && textWidth(rest.slice(0, cut), fontSize) > widthMm) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  pushCur();

  const used = lines.join(' ').replace(/\s+/g, ' ');
  const full = words.join(' ');
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
async function assetLabelSvg(asset, { size = '58x40', orgName = 'ООО «Медцентр»' } = {}) {
  const cfg = LABEL_SIZES[size] || LABEL_SIZES['58x40'];
  const url = assetPublicUrl(asset.publicToken);
  const FONT = 'Helvetica, Arial, sans-serif';
  const LINE = 1.28; // межстрочный интервал в долях кегля

  // Вкладываем QR как вложенный <svg> с явными координатами: так он
  // масштабируется вместе с этикеткой и не требует растеризации.
  const rawQr = await qrSvg(url, { margin: 0, width: 100 });
  const qrInner = rawQr
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
  const qrViewBox = (rawQr.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';

  const { w, h, pad, qr, gap } = cfg;

  // ── Верхняя область: QR слева, идентификация справа ───────────────────────
  const colX = pad + qr + gap;
  const colW = w - colX - pad;

  // Кегль номера подбирается под ширину колонки: маска «МЦ-2025-ЛУЧДИАГ-00001»
  // на 21 символ шире, чем «МЦ-2025-ЛОР-00007», и фиксированный кегль обрезал
  // первую.
  // Минимум — 1,9 мм: инвентарный номер обрезать нельзя ни при какой длине маски,
  // он единственный идентификатор на этикетке. Лучше мелко, но целиком.
  const numberSize = fitFontSize(asset.inventoryNumber, colW, cfg.numberSize, 1.9);
  const nameLines = wrapToWidth(asset.name, colW, cfg.nameSize, cfg.nameLines);
  const modelLine = clipToWidth(asset.model, colW, cfg.metaSize);

  let y = pad + numberSize;
  const topRows = [`<text x="${colX}" y="${y}" font-family="${FONT}" font-size="${numberSize}"
        font-weight="700" fill="#0f172a">${escapeXml(asset.inventoryNumber)}</text>`];

  y += cfg.nameSize * LINE + 0.5;
  for (const line of nameLines) {
    topRows.push(`<text x="${colX}" y="${y}" font-family="${FONT}" font-size="${cfg.nameSize}"
        fill="#1f2937">${escapeXml(line)}</text>`);
    y += cfg.nameSize * LINE;
  }

  if (modelLine) {
    topRows.push(`<text x="${colX}" y="${y}" font-family="${FONT}" font-size="${cfg.metaSize}"
        fill="#475569">${escapeXml(modelLine)}</text>`);
    y += cfg.metaSize * LINE;
  }

  if (asset.serialNumber) {
    const sn = clipToWidth(`S/N ${asset.serialNumber}`, colW, cfg.metaSize);
    // Серийный номер помещается только если под ним ещё есть место до QR-области:
    // иначе он налезал бы на разделительную линию.
    if (y <= pad + qr) {
      topRows.push(`<text x="${colX}" y="${y}" font-family="${FONT}" font-size="${cfg.metaSize}"
        fill="#64748b">${escapeXml(sn)}</text>`);
    }
  }

  // ── Нижняя область: во всю ширину, включая полосу под QR ───────────────────
  // Именно она раньше пустовала: QR занимал только верхний левый угол, а всё,
  // что ниже него, не использовалось.
  const dividerY = Math.max(pad + qr + 1.6, y + 0.6);
  const bottomW = w - pad * 2;

  const roomText = asset.room
    ? `${asset.room.number}${asset.room.department?.name ? ` · ${asset.room.department.name}` : ''}`
    : 'Не размещён';
  const nextTo = asset.nextMaintenanceDate
    ? `ТО до ${formatDate(asset.nextMaintenanceDate)}`
    : 'ТО не назначено';

  const roomY = dividerY + cfg.metaSize + 0.4;
  const footY = h - pad;

  // Подвал делим на две части: слева срок ТО, справа организация. Ширину каждой
  // считаем от фактической длины второй — иначе длинное название юрлица
  // выдавливало дату.
  // Название юрлица уменьшаем кеглем, а не режем: «ООО «Медицинский центр П…»
  // на этикетке читается как сбой печати. На этикетку лучше отдавать shortName
  // из справочника организаций, но и полное юридическое должно влезать.
  const orgMaxW = bottomW * 0.58;
  const orgSize = fitFontSize(orgName, orgMaxW, cfg.footSize, cfg.footSize * 0.72);
  const orgText = clipToWidth(orgName, orgMaxW, orgSize);
  const orgW = textWidth(orgText, orgSize);
  const nextToText = clipToWidth(nextTo, bottomW - orgW - 2, cfg.footSize);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm"
     viewBox="0 0 ${w} ${h}" role="img" aria-label="Этикетка ${escapeXml(asset.inventoryNumber)}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>
  <rect x="0.15" y="0.15" width="${w - 0.3}" height="${h - 0.3}" fill="none"
        stroke="#e2e8f0" stroke-width="0.3" rx="0.8"/>

  <svg x="${pad}" y="${pad}" width="${qr}" height="${qr}" viewBox="${qrViewBox}"
       preserveAspectRatio="xMidYMid meet">${qrInner}</svg>

  ${topRows.join('\n  ')}

  <line x1="${pad}" y1="${dividerY}" x2="${w - pad}" y2="${dividerY}"
        stroke="#cbd5e1" stroke-width="0.25"/>

  <text x="${pad}" y="${roomY}" font-family="${FONT}" font-size="${cfg.metaSize}"
        font-weight="600" fill="#1f2937">${escapeXml(clipToWidth(roomText, bottomW, cfg.metaSize))}</text>

  <text x="${pad}" y="${footY}" font-family="${FONT}" font-size="${cfg.footSize}"
        fill="#334155">${escapeXml(nextToText)}</text>
  <text x="${w - pad}" y="${footY}" text-anchor="end" font-family="${FONT}"
        font-size="${orgSize}" fill="#64748b">${escapeXml(orgText)}</text>
</svg>`;
}

/**
 * ZPL II для термопринтера, 203 dpi. Шаблон из Приложения Б ТЗ, но с двумя
 * поправками:
 *
 *   • ^CI28 — иначе принтер печатает кириллицу мусором. В исходном шаблоне этой
 *     команды нет, и «УЗИ Mindray» вышло бы кракозябрами;
 *   • наименование режется по длине здесь, а не полагается на ^FB: при переполнении
 *     ^FB молча обрезает последнюю строку без многоточия, и на этикетке остаётся
 *     обрубок вроде «Аппарат ультразвуковой диагно».
 */
function assetLabelZpl(asset, { copies = 1, orgName = 'ООО «Медцентр»', density = 10 } = {}) {
  const url = assetPublicUrl(asset.publicToken);
  // 464 точки при 203 dpi — это 58 мм; наименование печатается кеглем 22,
  // что при ^A0 даёт ширину глифа около 11 точек. Считаем в миллиметрах тем
  // же расчётом, что и SVG, чтобы бумажная и термоэтикетка совпадали.
  // Раскладка повторяет SVG-версию: верх — QR плюс идентификация, низ — полоса во
  // всю ширину, включая место под QR. Считаем в миллиметрах и переводим в точки,
  // чтобы бумажная и термоэтикетка не расходились: 203 dpi = 8 точек на мм.
  const DPMM = 8;
  const mm = v => Math.round(v * DPMM);

  const padMm = 2;
  const qrMm = 21;
  const colXmm = padMm + qrMm + 2.4;
  const colWmm = 58 - colXmm - padMm;
  const bottomWmm = 58 - padMm * 2;

  // Кегли ZPL заданы в точках, а расчёт ширины — в миллиметрах, отсюда деление.
  const numberPt = 30, namePt = 22, metaPt = 20, footPt = 17;

  const nameLines = wrapToWidth(asset.name, colWmm, namePt / DPMM, 2);
  const modelLine = clipToWidth(asset.model, colWmm, metaPt / DPMM);
  // Кегль номера подбираем под колонку и переводим обратно в точки: обрезать
  // инвентарный номер нельзя, а при маске в 21 символ он в 30 пунктов не влезает.
  const numberFitMm = fitFontSize(asset.inventoryNumber, colWmm, numberPt / DPMM, 1.9);
  const numberPtFit = Math.max(12, Math.round(numberFitMm * DPMM));
  const numberLine = asset.inventoryNumber;

  const room = asset.room
    ? `${asset.room.number}${asset.room.department?.name ? ` · ${asset.room.department.name}` : ''}`
    : 'Не размещён';
  const roomLine = clipToWidth(room, bottomWmm, metaPt / DPMM);
  const nextTo = asset.nextMaintenanceDate
    ? `ТО до ${formatDate(asset.nextMaintenanceDate)}`
    : 'ТО не назначено';
  const orgLine = clipToWidth(orgName, bottomWmm * 0.5, footPt / DPMM);

  const lines = [];
  let yMm = padMm + numberPtFit / DPMM;
  lines.push(`^FO${mm(colXmm)},${mm(padMm + 0.4)}^A0N,${numberPtFit},${numberPtFit}^FD${numberLine}^FS`);

  yMm += 0.6;
  for (const line of nameLines) {
    lines.push(`^FO${mm(colXmm)},${mm(yMm)}^A0N,${namePt},${namePt}^FD${line}^FS`);
    yMm += (namePt / DPMM) * 1.28;
  }
  if (modelLine) {
    lines.push(`^FO${mm(colXmm)},${mm(yMm)}^A0N,${metaPt},${metaPt}^FD${modelLine}^FS`);
    yMm += (metaPt / DPMM) * 1.28;
  }

  const dividerMm = Math.max(padMm + qrMm + 1.6, yMm + 0.6);

  return `^XA
^CI28
^PW464
^LL320
^LH0,0
^MMT
^MD${density}

^FO${mm(padMm)},${mm(padMm)}^BQN,2,5,Q,7
^FDQA,${url}^FS

${lines.join('\n')}

^FO${mm(padMm)},${mm(dividerMm)}^GB${mm(bottomWmm)},2,2^FS

^FO${mm(padMm)},${mm(dividerMm + 1.2)}^A0N,${metaPt},${metaPt}^FD${roomLine}^FS
^FO${mm(padMm)},${mm(40 - padMm - footPt / DPMM)}^A0N,${footPt},${footPt}^FD${nextTo}^FS
^FO${mm(padMm + bottomWmm * 0.5)},${mm(40 - padMm - footPt / DPMM)}^FB${mm(bottomWmm * 0.5)},1,0,R,0^A0N,${footPt},${footPt}^FD${orgLine}^FS

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
 * Карточка на дверь кабинета, A5 книжной ориентации.
 *
 * Это не этикетка: этикетку клеят на прибор и печатают пачками на рулонном
 * принтере, а эту страницу печатают поштучно на обычном A4/A5 и вешают у входа.
 * Отсюда и разница в раскладке — крупный номер кабинета читается с прохода, а QR
 * нужен только тому, кто подошёл вплотную.
 *
 * ФИО материально ответственного на карточку намеренно не выводится: дверь видна
 * из коридора, и фамилия сотрудника на ней — это персональные данные, вывешенные
 * в общедоступном месте. В самом дашборде МОЛ есть.
 */
async function roomDoorCardSvg(room, { orgName = '' } = {}) {
  const W = 148, H = 210, PAD = 12;
  const FONT = 'Helvetica, Arial, sans-serif';
  const inner = W - PAD * 2;

  const url = roomAppUrl(room.id);
  const rawQr = await qrSvg(url, { margin: 0, width: 100 });
  const qrInner = rawQr
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
  const qrViewBox = (rawQr.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';

  // Номер подбирается под ширину: «305» и «312а/2» должны занимать одну и ту же
  // полосу, а не уезжать за поле.
  const numberSize = fitFontSize(room.number, inner, 46, 16);
  const nameLines = room.name && room.name !== room.number
    ? wrapToWidth(room.name, inner, 7, 2) : [];

  const place = [
    room.floor?.building?.name,
    room.floor ? `${room.floor.number} этаж` : null,
    room.department?.name,
  ].filter(Boolean).join(' · ');

  let y = PAD + 7;
  const head = [];
  head.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="4.6" letter-spacing="1.4" fill="#64748b">КАБИНЕТ</text>`);

  y += numberSize * 0.92 + 4;
  head.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="${numberSize}" font-weight="700" fill="#0f172a">${escapeXml(room.number)}</text>`);

  y += 11;
  for (const line of nameLines) {
    head.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="7" fill="#1f2937">${escapeXml(line)}</text>`);
    y += 9;
  }

  if (place) {
    y += 1;
    head.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}"
        font-size="4.4" fill="#64748b">${escapeXml(clipToWidth(place, inner, 4.4))}</text>`);
    y += 6;
  }

  // QR прижимается к низу, а не идёт следом за текстом: иначе карточки кабинетов
  // с длинным названием и без него печатаются с кодом на разной высоте, и пачка
  // выглядит небрежно.
  const qrSize = 58;
  const qrY = H - PAD - 26 - qrSize;
  const dividerY = Math.min(y + 6, qrY - 6);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm"
     viewBox="0 0 ${W} ${H}" role="img" aria-label="Карточка кабинета ${escapeXml(room.number)}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none"
        stroke="#cbd5e1" stroke-width="0.4" rx="3"/>

  ${head.join('\n  ')}

  <line x1="${PAD}" y1="${dividerY}" x2="${W - PAD}" y2="${dividerY}"
        stroke="#e2e8f0" stroke-width="0.3"/>

  <svg x="${(W - qrSize) / 2}" y="${qrY}" width="${qrSize}" height="${qrSize}"
       viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">${qrInner}</svg>

  <text x="${W / 2}" y="${qrY + qrSize + 8}" text-anchor="middle" font-family="${FONT}"
        font-size="4.2" fill="#334155">Оборудование кабинета, сроки ТО и остатки</text>
  <text x="${W / 2}" y="${qrY + qrSize + 13.6}" text-anchor="middle" font-family="${FONT}"
        font-size="3.6" fill="#94a3b8">Только для сотрудников — потребуется вход на портал</text>
  ${orgName ? `<text x="${W / 2}" y="${H - PAD}" text-anchor="middle" font-family="${FONT}"
        font-size="3.6" fill="#94a3b8">${escapeXml(clipToWidth(orgName, inner, 3.6))}</text>` : ''}
</svg>`;
}

module.exports = {
  PUBLIC_BASE_URL,
  LABEL_SIZES,
  generateToken,
  assetPublicUrl,
  roomAppUrl,
  roomDoorCardSvg,
  qrSvg,
  qrPngDataUrl,
  assetLabelSvg,
  assetLabelZpl,
  toPublicAsset,
  formatDate,
};
