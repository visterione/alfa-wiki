'use strict';

/**
 * Анкета врача в PDF.
 *
 * Собирается на сервере, а не печатью из браузера, по двум причинам. Первая:
 * что попадёт в файл, решает тот же срез, что и карточка, — маркетолог не
 * выгрузит СНИЛС, даже открыв ссылку напрямую. Вторая: у файла осмысленное имя,
 * а печать из браузера давала «Альфа Вики.pdf» и терялась в загрузках.
 *
 * pdfkit с DejaVu уже используется в отчётах по отзывам (services/pdfService.js)
 * — второй библиотеки ради одного документа не заводим.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const schema = require('./formSchema');

const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');
const INK = '#1d1d1f';
const INK_2 = '#52525b';
const INK_3 = '#71717a';
const RULE = '#e0e0e5';

const PAGE_MARGIN = 48;

/** Дни недели хранятся номерами, интервал приёма объектом — печатать как есть нельзя. */
function fieldText(type, value) {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'weekdays') {
    const days = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    return Array.isArray(value) ? value.map(day => days[day]).filter(Boolean).join(', ') : '';
  }
  if (type === 'timerange') return value.from && value.to ? `${value.from}–${value.to}` : '';
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

/** Строка повторяемого блока: слева год, справа содержание — как в карточке. */
function repeatRow(key, row) {
  if (key === 'education' || key === 'qualification') {
    return [
      String(row.year || '—'),
      [row.institution, row.specialty, row.city].filter(Boolean).join(', ')
    ];
  }
  if (key === 'certificates') return [`до ${row.validUntil || '—'}`, row.specialization || ''];
  if (key === 'papers') {
    return [String(row.year || '—'), [row.topic, row.publication].filter(Boolean).join(' · ')];
  }
  if (key === 'conferences') {
    return [String(row.year || '—'), [row.event, row.place, row.extra].filter(Boolean).join(' · ')];
  }
  if (key === 'resources') return [row.label || 'ссылка', row.url || ''];
  return ['', Object.values(row).filter(Boolean).join(' · ')];
}

/**
 * @param {Object} app        Заявка (модель)
 * @param {Object} projected  Срез анкеты под шаг смотрящего
 * @param {Object} medCenter  Филиал
 * @returns {PDFDocument} незавершённый поток: вызывающий код подключает его к
 *   приёмнику и затем вызывает end()
 */
function buildCv(app, projected, medCenter) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
  doc.registerFont('sans', path.join(FONTS_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('sans-bold', path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf'));

  const form = projected.form || {};
  const width = doc.page.width - PAGE_MARGIN * 2;
  const labelWidth = 168;

  // ── Шапка ────────────────────────────────────────────────────────────────
  doc.font('sans-bold').fontSize(18).fillColor(INK)
    .text(app.fullName || 'Имя не указано', { width: width - 130 });

  const professions = (app.professions || []).map(p => p.name).filter(Boolean);
  if (professions.length) {
    doc.moveDown(0.25);
    doc.font('sans').fontSize(10.5).fillColor(INK_2).text(professions.join(' · '));
  }

  // Дата справа от имени. Рисуем её с явными координатами, поэтому курсор
  // уезжает наверх — запоминаем место и возвращаем, иначе следующий блок
  // ложится поверх подзаголовка со специальностями.
  const afterHeader = doc.y;
  doc.font('sans').fontSize(8.5).fillColor(INK_3)
    .text(dateRu(app.submittedAt || app.createdAt), PAGE_MARGIN, PAGE_MARGIN + 3, {
      width, align: 'right'
    });
  doc.y = afterHeader;

  doc.moveDown(1);
  const meta = [
    ['Филиал', medCenter?.name],
    ['Выход на работу', dateRu(app.startDate)],
    ['Дата рождения', dateRu(form.birthDate)],
    ['Телефон', projected.phone ? formatPhone(projected.phone) : ''],
    ['Почта', projected.email]
  ].filter(([, value]) => value);

  let y = doc.y + 6;
  for (const [label, value] of meta) {
    doc.font('sans').fontSize(9).fillColor(INK_3).text(label, PAGE_MARGIN, y, { width: labelWidth });
    doc.font('sans').fontSize(9.5).fillColor(INK)
      .text(String(value), PAGE_MARGIN + labelWidth, y, { width: width - labelWidth });
    y = doc.y + 3;
  }

  y += 6;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).lineWidth(1).strokeColor(INK).stroke();
  y += 14;

  // ── Разделы ──────────────────────────────────────────────────────────────
  for (const section of schema.sections()) {
    const rows = section.repeat
      ? (form[section.key] || []).filter(row => Object.values(row).some(Boolean))
      : section.fields
          .map(field => [field.key, fieldText(field.type, form[field.key])])
          .filter(([, value]) => value !== '');

    if (!rows.length) continue;

    // Заголовок и первая строка не должны расходиться по страницам.
    if (y > doc.page.height - PAGE_MARGIN - 70) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.font('sans-bold').fontSize(8).fillColor(INK_3)
      .text(section.title.toUpperCase(), PAGE_MARGIN, y, { characterSpacing: 1.1 });
    y = doc.y + 7;

    const labels = schema.labelMap();
    for (const row of rows) {
      const [left, right] = section.repeat
        ? repeatRow(section.key, row)
        : [labels[row[0]] || row[0], row[1]];

      if (y > doc.page.height - PAGE_MARGIN - 30) {
        doc.addPage();
        y = PAGE_MARGIN;
      }

      doc.font('sans').fontSize(9).fillColor(INK_3).text(left, PAGE_MARGIN, y, { width: labelWidth - 10 });
      const leftBottom = doc.y;
      doc.font('sans').fontSize(9.5).fillColor(INK)
        .text(String(right), PAGE_MARGIN + labelWidth, y, { width: width - labelWidth });
      y = Math.max(leftBottom, doc.y) + 4;
    }

    y += 8;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 14;
  }

  return doc;
}

/**
 * Список услуг, отмеченных врачом, — распечатать и идти по листку.
 *
 * Расхождения и позиции, вписанные текстом, выделены отдельными разделами:
 * бухгалтеру в МИС нужно разобрать именно их, а остальные строки он вносит
 * пачкой, не вчитываясь.
 */
function buildServices(app, choices = [], medCenter) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
  doc.registerFont('sans', path.join(FONTS_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('sans-bold', path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf'));

  const width = doc.page.width - PAGE_MARGIN * 2;
  const regular = choices.filter(c => !c.isCustom);
  const custom = choices.filter(c => c.isCustom);
  const changed = regular.filter(c =>
    (c.doctorDuration && Number(c.doctorDuration) !== Number(c.misDuration)) || c.comment);

  doc.font('sans-bold').fontSize(16).fillColor(INK).text('Услуги врача');
  doc.moveDown(0.3);
  doc.font('sans').fontSize(10.5).fillColor(INK_2)
    .text([app.fullName, medCenter?.name].filter(Boolean).join(' · '));
  doc.font('sans').fontSize(9).fillColor(INK_3)
    .text(`Отмечено услуг: ${regular.length}${custom.length ? `, вписано вручную: ${custom.length}` : ''}`);

  let y = doc.y + 12;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).lineWidth(1).strokeColor(INK).stroke();
  y += 12;

  // Колонки: код, название, цена, длительность. Название забирает остаток —
  // именно по нему бухгалтер ищет позицию в справочнике МИС.
  const cols = { code: 78, price: 62, mins: 52 };
  const titleWidth = width - cols.code - cols.price - cols.mins - 18;

  const header = () => {
    doc.font('sans-bold').fontSize(7.5).fillColor(INK_3);
    doc.text('КОД', PAGE_MARGIN, y, { width: cols.code });
    doc.text('УСЛУГА', PAGE_MARGIN + cols.code + 6, y, { width: titleWidth });
    doc.text('ЦЕНА', PAGE_MARGIN + cols.code + titleWidth + 12, y, { width: cols.price, align: 'right' });
    doc.text('МИН', PAGE_MARGIN + cols.code + titleWidth + cols.price + 18, y, { width: cols.mins, align: 'right' });
    y = doc.y + 6;
  };

  const row = (choice) => {
    if (y > doc.page.height - PAGE_MARGIN - 26) {
      doc.addPage();
      y = PAGE_MARGIN;
      header();
    }
    doc.font('sans').fontSize(8).fillColor(INK_3)
      .text(choice.code || '—', PAGE_MARGIN, y + 1, { width: cols.code });
    const codeBottom = doc.y;

    doc.font('sans').fontSize(9).fillColor(INK)
      .text(choice.title, PAGE_MARGIN + cols.code + 6, y, { width: titleWidth });
    const titleBottom = doc.y;

    doc.font('sans').fontSize(9).fillColor(INK)
      .text(choice.price != null ? `${Number(choice.price).toLocaleString('ru-RU')} ₽` : '—',
        PAGE_MARGIN + cols.code + titleWidth + 12, y, { width: cols.price, align: 'right' });

    const minutes = choice.doctorDuration || choice.misDuration;
    doc.font('sans').fontSize(9).fillColor(INK)
      .text(minutes ? String(minutes) : '—',
        PAGE_MARGIN + cols.code + titleWidth + cols.price + 18, y, { width: cols.mins, align: 'right' });

    y = Math.max(codeBottom, titleBottom) + 3;

    if (choice.comment) {
      doc.font('sans').fontSize(8).fillColor(INK_2)
        .text(choice.comment, PAGE_MARGIN + cols.code + 6, y, { width: titleWidth });
      y = doc.y + 3;
    }

    y += 2;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).lineWidth(0.4).strokeColor(RULE).stroke();
    y += 6;
  };

  const section = (title, rows) => {
    if (!rows.length) return;
    if (y > doc.page.height - PAGE_MARGIN - 60) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    doc.font('sans-bold').fontSize(8).fillColor(INK_3)
      .text(title.toUpperCase(), PAGE_MARGIN, y, { characterSpacing: 1.1 });
    y = doc.y + 8;
    header();
    rows.forEach(row);
    y += 8;
  };

  section('Все отмеченные услуги', regular);
  section('Из них с правками врача', changed);

  if (custom.length) {
    if (y > doc.page.height - PAGE_MARGIN - 60) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    doc.font('sans-bold').fontSize(8).fillColor(INK_3)
      .text('НЕТ В СПРАВОЧНИКЕ', PAGE_MARGIN, y, { characterSpacing: 1.1 });
    y = doc.y + 8;
    for (const choice of custom) {
      if (y > doc.page.height - PAGE_MARGIN - 26) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      doc.font('sans').fontSize(9).fillColor(INK).text(`• ${choice.title}`, PAGE_MARGIN, y, { width });
      y = doc.y + 2;
      if (choice.comment) {
        doc.font('sans').fontSize(8).fillColor(INK_2)
          .text(choice.comment, PAGE_MARGIN + 12, y, { width: width - 12 });
        y = doc.y + 2;
      }
      y += 4;
    }
  }

  return doc;
}

/** Имя файла: по нему документ находят в загрузках спустя месяц. */
function fileName(app) {
  const name = String(app.fullName || 'без имени').replace(/[\\/:*?"<>|]/g, ' ').trim();
  return `Анкета врача — ${name}.pdf`;
}

function servicesFileName(app) {
  const name = String(app.fullName || 'без имени').replace(/[\\/:*?"<>|]/g, ' ').trim();
  return `Услуги врача — ${name}.pdf`;
}

module.exports = { buildCv, buildServices, fileName, servicesFileName };
