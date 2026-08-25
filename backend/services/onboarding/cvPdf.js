'use strict';

/**
 * Анкета врача в PDF.
 *
 * Печать из браузера заменили на скачивание: на бумагу её отправляют редко, а
 * файл нужен постоянно — приложить к переписке, положить в папку кандидата,
 * показать на совещании. К тому же имя файла у печати задаёт браузер по
 * заголовку вкладки, и все анкеты сохранялись как «Альфа Вики.pdf».
 *
 * Собирается из того же среза, что и документ на экране: маркетолог, скачавший
 * анкету, получит ровно те поля, что видит, — без СНИЛС и даты рождения.
 *
 * Шрифт DejaVu берём из backend/fonts — тот же, что у отчётов по отзывам.
 * Встроенные шрифты pdfkit кириллицу не умеют.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');

const PAGE_MARGIN = 48;
const COLOR_TEXT = '#1d1d1f';
const COLOR_MUTED = '#6b7280';
const COLOR_RULE = '#e3e6ea';

const WEEKDAYS = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Значение поля в читаемом виде — те же правила, что в документе на экране. */
function fieldText(type, value) {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'weekdays') {
    return Array.isArray(value) ? value.map(day => WEEKDAYS[day]).filter(Boolean).join(', ') : '';
  }
  if (type === 'timerange') {
    return value.from && value.to ? `${value.from}–${value.to}` : '';
  }
  if (type === 'phone') return formatPhone(value);
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return String(value);
}

function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  if (value.length !== 11) return String(digits || '');
  return `+7 (${value.slice(1, 4)}) ${value.slice(4, 7)}-${value.slice(7, 9)}-${value.slice(9)}`;
}

function dateRu(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Строка повторяемого блока: слева год, справа содержание. */
function repeatRow(key, row) {
  if (key === 'education' || key === 'qualification') {
    return [
      String(row.year || ''),
      [row.institution, row.specialty, row.city].filter(Boolean).join(', ')
    ];
  }
  if (key === 'certificates') {
    return [row.validUntil ? `до ${row.validUntil}` : '', row.specialization || ''];
  }
  if (key === 'papers') {
    return [String(row.year || ''), [row.topic, row.publication].filter(Boolean).join(' · ')];
  }
  if (key === 'conferences') {
    return [String(row.year || ''), [row.event, row.place, row.extra].filter(Boolean).join(' · ')];
  }
  if (key === 'resources') {
    return [row.label || 'ссылка', row.url || ''];
  }
  return ['', Object.values(row).filter(Boolean).join(' · ')];
}

/**
 * @param {Object} view    Срез заявки (projection.project)
 * @param {Object} meta    { labels, sections, medCenterName }
 * @returns {PDFDocument}  Готовый к стримингу документ
 */
function buildCv(view, { labels = {}, sections = [], medCenterName = null } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });

  doc.registerFont('D', path.join(FONTS_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('D-Bold', path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf'));

  const form = view.form || {};
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - PAGE_MARGIN;

  // ── Шапка ────────────────────────────────────────────────────────────────
  doc.font('D-Bold').fontSize(18).fillColor(COLOR_TEXT)
    .text(view.fullName || 'Имя не указано', PAGE_MARGIN, PAGE_MARGIN, { width: width - 120 });

  const professions = (view.professions || []).map(p => p.name).join(' · ');
  if (professions) {
    doc.font('D').fontSize(10.5).fillColor(COLOR_MUTED).text(professions, { width: width - 130 });
  }

  // Дата справа от имени — как штамп на бумажной анкете. Пишем её последней и
  // возвращаем курсор: text() с явными координатами уводит doc.y к верху
  // страницы, и следующий блок наезжал на строку со специальностями.
  const headerBottom = doc.y;
  doc.font('D').fontSize(8.5).fillColor(COLOR_MUTED)
    .text(dateRu(view.submittedAt || view.createdAt), right - 130, PAGE_MARGIN + 4, {
      width: 130, align: 'right'
    });
  doc.y = headerBottom + 12;

  const headerPairs = [
    medCenterName && ['Филиал', medCenterName],
    view.startDate && ['Выход на работу', dateRu(view.startDate)],
    form.birthDate && ['Дата рождения', dateRu(form.birthDate)],
    view.phone && ['Телефон', formatPhone(view.phone)],
    view.email && ['Почта', view.email]
  ].filter(Boolean);

  drawPairs(doc, headerPairs, { labelWidth: 120 });

  doc.moveDown(0.5);
  rule(doc, COLOR_TEXT);

  // ── Разделы ──────────────────────────────────────────────────────────────
  for (const section of sections) {
    const rows = section.repeat
      ? (form[section.key] || [])
          .filter(row => Object.values(row).some(Boolean))
          .map(row => repeatRow(section.key, row))
      : section.fields
          .map(field => [labels[field.key] || field.key, fieldText(field.type, form[field.key])])
          .filter(([, value]) => value !== '');

    if (!rows.length) continue;

    // Заголовок и первая строка не должны разъезжаться по разным страницам.
    ensureSpace(doc, 60);

    doc.moveDown(0.7);
    doc.font('D-Bold').fontSize(7.5).fillColor(COLOR_MUTED)
      .text(section.title.toUpperCase(), PAGE_MARGIN, doc.y, { characterSpacing: 1.1 });
    doc.moveDown(0.45);

    drawPairs(doc, rows, {
      labelWidth: section.repeat ? 70 : 170,
      boldValue: section.repeat
    });

    doc.moveDown(0.3);
    rule(doc, COLOR_RULE);
  }

  return doc;
}

/** Две колонки: подпись и значение. Значение переносится, подпись — нет. */
function drawPairs(doc, pairs, { labelWidth = 150, boldValue = false } = {}) {
  const left = PAGE_MARGIN;
  const valueX = left + labelWidth + 12;
  const valueWidth = doc.page.width - PAGE_MARGIN - valueX;

  for (const [label, value] of pairs) {
    const text = String(value ?? '');
    const height = doc.font(boldValue ? 'D-Bold' : 'D').fontSize(9.5)
      .heightOfString(text, { width: valueWidth });

    ensureSpace(doc, height + 6);
    const y = doc.y;

    doc.font('D').fontSize(9.5).fillColor(COLOR_MUTED)
      .text(String(label ?? ''), left, y, { width: labelWidth, lineBreak: false, ellipsis: true });

    doc.font(boldValue ? 'D-Bold' : 'D').fontSize(9.5).fillColor(COLOR_TEXT)
      .text(text, valueX, y, { width: valueWidth });

    // Подпись бывает выше значения — берём максимум, иначе строки наезжают.
    doc.y = Math.max(doc.y, y + height) + 3;
  }
}

function rule(doc, color) {
  const y = doc.y;
  doc.strokeColor(color).lineWidth(color === COLOR_RULE ? 0.5 : 1)
    .moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).stroke();
  doc.y = y + 2;
}

/** Новая страница, если на текущей осталось меньше запрошенного. */
function ensureSpace(doc, needed) {
  const bottom = doc.page.height - PAGE_MARGIN;
  if (doc.y + needed > bottom) doc.addPage();
}

/** Имя файла: по нему анкеты потом и ищут в папке. */
function fileName(view) {
  const name = String(view.fullName || 'без имени').replace(/[\\/:*?"<>|]/g, ' ').trim();
  return `Анкета врача — ${name}.pdf`;
}

module.exports = { buildCv, fileName, fieldText, formatPhone };
