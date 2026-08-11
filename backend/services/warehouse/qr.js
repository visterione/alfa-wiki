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

function roomPublicUrl(token) {
  return `${PUBLIC_BASE_URL}/p/r/${token}`;
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
const LABEL_SIZES = {
  '58x40':  { w: 58,  h: 40, qr: 20, nameSize: 2.6, numberSize: 3.2, maxNameChars: 30 },
  '100x70': { w: 100, h: 70, qr: 35, nameSize: 4.0, numberSize: 5.0, maxNameChars: 34 },
};

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Разбивает строку на несколько по ширине. Без этого длинное наименование
 * прибора («Аппарат ультразвуковой диагностический Mindray DC-70 Exp»)
 * уезжает за край этикетки.
 */
function wrap(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '…');
  }
  return lines;
}

/**
 * SVG этикетки актива.
 */
async function assetLabelSvg(asset, { size = '58x40', orgName = 'ООО «Медцентр»' } = {}) {
  const cfg = LABEL_SIZES[size] || LABEL_SIZES['58x40'];
  const url = assetPublicUrl(asset.publicToken);

  // Вкладываем QR как вложенный <svg> с явными координатами: так он
  // масштабируется вместе с этикеткой и не требует растеризации.
  const rawQr = await qrSvg(url, { margin: 0, width: 100 });
  const qrInner = rawQr
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();
  const qrViewBox = (rawQr.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';

  const pad = 2;
  const textX = pad + cfg.qr + 2.5;
  const textW = cfg.w - textX - pad;
  const nameLines = wrap(
    [asset.name, asset.model].filter(Boolean).join(' '),
    Math.floor(textW / (cfg.nameSize * 0.5)),
    2
  );

  const room = asset.room
    ? `Каб. ${asset.room.number}${asset.room.department?.name ? ` · ${asset.room.department.name}` : ''}`
    : 'Не размещён';

  const nextTo = asset.nextMaintenanceDate
    ? `ТО до: ${formatDate(asset.nextMaintenanceDate)}`
    : 'ТО: не запланировано';

  const footerY = cfg.h - pad - 1;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.w}mm" height="${cfg.h}mm"
     viewBox="0 0 ${cfg.w} ${cfg.h}" role="img" aria-label="Этикетка ${escapeXml(asset.inventoryNumber)}">
  <rect x="0" y="0" width="${cfg.w}" height="${cfg.h}" fill="#fff" stroke="#e2e8f0" stroke-width="0.2"/>
  <svg x="${pad}" y="${pad}" width="${cfg.qr}" height="${cfg.qr}" viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">${qrInner}</svg>
  <text x="${textX}" y="${pad + cfg.numberSize}" font-family="Helvetica, Arial, sans-serif"
        font-size="${cfg.numberSize}" font-weight="700" fill="#0f172a">${escapeXml(asset.inventoryNumber)}</text>
  ${nameLines.map((l, i) => `<text x="${textX}" y="${pad + cfg.numberSize + 2.2 + i * (cfg.nameSize + 0.6)}"
        font-family="Helvetica, Arial, sans-serif" font-size="${cfg.nameSize}" fill="#1f2937">${escapeXml(l)}</text>`).join('\n  ')}
  <text x="${textX}" y="${pad + cfg.numberSize + 2.2 + nameLines.length * (cfg.nameSize + 0.6) + 1.4}"
        font-family="Helvetica, Arial, sans-serif" font-size="${cfg.nameSize}" fill="#475569">${escapeXml(room)}</text>
  ${asset.serialNumber && size === '100x70' ? `<text x="${textX}" y="${pad + cfg.numberSize + 2.2 + nameLines.length * (cfg.nameSize + 0.6) + 1.4 + cfg.nameSize + 1}"
        font-family="Helvetica, Arial, sans-serif" font-size="${cfg.nameSize}" fill="#475569">S/N: ${escapeXml(asset.serialNumber)}</text>` : ''}
  <line x1="${pad}" y1="${footerY - cfg.nameSize - 1.2}" x2="${cfg.w - pad}" y2="${footerY - cfg.nameSize - 1.2}"
        stroke="#cbd5e1" stroke-width="0.2"/>
  <text x="${pad}" y="${footerY}" font-family="Helvetica, Arial, sans-serif"
        font-size="${cfg.nameSize * 0.85}" fill="#334155">${escapeXml(nextTo)}</text>
  <text x="${cfg.w - pad}" y="${footerY}" text-anchor="end" font-family="Helvetica, Arial, sans-serif"
        font-size="${cfg.nameSize * 0.85}" fill="#64748b">${escapeXml(orgName)}</text>
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
  const nameLines = wrap([asset.name, asset.model].filter(Boolean).join(' '), 28, 2);
  const room = asset.room
    ? `Каб. ${asset.room.number}${asset.room.department?.name ? ` · ${asset.room.department.name}` : ''}`
    : 'Не размещён';
  const nextTo = asset.nextMaintenanceDate ? formatDate(asset.nextMaintenanceDate) : '—';

  return `^XA
^CI28
^PW464
^LL320
^LH0,0
^MMT
^MD${density}

^FO16,16^BQN,2,5,Q,7
^FDQA,${url}^FS

^FO180,20^A0N,32,32^FD${asset.inventoryNumber}^FS

${nameLines.map((l, i) => `^FO180,${62 + i * 26}^A0N,22,22^FD${l}^FS`).join('\n')}

^FO180,${62 + nameLines.length * 26 + 4}^A0N,20,20^FD${room}^FS

^FO16,230^GB432,2,2^FS

^FO16,244^A0N,18,18^FDТО до: ${nextTo}^FS
^FO16,272^A0N,16,16^FD${orgName}^FS

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

module.exports = {
  PUBLIC_BASE_URL,
  LABEL_SIZES,
  generateToken,
  assetPublicUrl,
  roomPublicUrl,
  qrSvg,
  qrPngDataUrl,
  assetLabelSvg,
  assetLabelZpl,
  toPublicAsset,
  formatDate,
};
