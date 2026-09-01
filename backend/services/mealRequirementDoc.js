'use strict';

/**
 * Бланк порционного требования: раскладка А4 и два способа её нарисовать —
 * PDF (печать и архив) и PNG (то, что уходит в чат буфета).
 *
 * Раскладка считается один раз и отдаётся обоим рисовальщикам списком примитивов.
 * Иначе бумажный бланк и картинка в чате разъезжались бы при каждой правке формы,
 * а сверять их глазами по двум разным кускам кода — гарантированная рассинхронизация.
 *
 * Ширины строк всегда меряются pdfkit, даже когда рисуем SVG: переносы в столбце
 * ФИО должны встать в одних и тех же местах на обоих носителях. Шрифт для PDF
 * встроен в файл, а SVG рисует librsvg системным — если на сервере нет DejaVu,
 * поедет только картинка, и это видно сразу (проверять: fc-list | grep -i dejavu).
 */

const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const FONT_REGULAR = path.join(FONTS_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf');

// Семейство для SVG: на сервере рисует librsvg системным шрифтом, DejaVu тут
// первый номер только чтобы совпасть с PDF по метрикам.
const SVG_FONT_FAMILY = "'DejaVu Sans','Liberation Sans',Arial,sans-serif";

const PAGE = { width: 595.28, height: 841.89, margin: 42 };

const COLS = [
  { key: 'room',      title: '№ палаты', width: 55 },
  { key: 'patients',  title: 'ФИО',      width: 200 },
  { key: 'diet',      title: 'Стол №',   width: 60 },
  { key: 'breakfast', title: 'Завтрак',  width: 65, meal: true },
  { key: 'lunch',     title: 'Обед',     width: 65, meal: true },
  { key: 'dinner',    title: 'Ужин',     width: 65, meal: true }
];

const FS = { title: 13, subtitle: 11, head: 9, body: 9, footer: 10, hint: 7.5 };
const LINE_H = 11.5;

// Единственный экземпляр pdfkit ради измерения ширины строк: создавать документ
// на каждый вызов дороже самой отрисовки.
let measureDoc = null;
function measure(text, size, bold) {
  if (!measureDoc) {
    measureDoc = new PDFDocument({ size: 'A4', margin: 0 });
    measureDoc.registerFont('dv', FONT_REGULAR);
    measureDoc.registerFont('dv-bold', FONT_BOLD);
  }
  return measureDoc.font(bold ? 'dv-bold' : 'dv').fontSize(size).widthOfString(String(text || ''));
}

/**
 * Число из ячейки количества. В ячейке бывает не цифра, а пометка вроде
 * «выписан» — такие в сумму не идут, иначе итог молча превратится в мусор.
 * Клиент считает по тому же правилу (meal-requirement.html), их нельзя разводить.
 */
function parseAmount(value) {
  const m = String(value == null ? '' : value).match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return 0;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function sumMeal(entries, key) {
  return (entries || []).reduce((acc, row) => acc + parseAmount(row && row[key]), 0);
}

function formatSum(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

// Дата в шапке бланка — в том виде, в каком её пишут на бумаге: 01.09.26
function formatDateShort(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : String(iso || '');
}

function wrapLine(text, width, size, bold) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (measure(candidate, size, bold) <= width) current = candidate;
    else { lines.push(current); current = words[i]; }
  }
  lines.push(current);
  return lines;
}

// В ячейке ФИО может лежать несколько пациентов — по одному в строке.
function cellLines(text, width, size, bold) {
  const raw = String(text == null ? '' : text).split(/\r?\n/);
  const out = [];
  raw.forEach(line => {
    const wrapped = wrapLine(line, width, size, bold);
    if (wrapped.length) out.push(...wrapped);
    else if (raw.length === 1) out.push('');
  });
  return out.length ? out : [''];
}

/**
 * Примитивы бланка: { t:'rect' } — рамка ячейки, { t:'line' } — линия подписи,
 * { t:'text' } — строка текста (y — верх строки, как в pdfkit).
 */
function buildLayout({ department, reportDate, entries, nurseName, correction }) {
  const items = [];
  const left = PAGE.margin;
  const tableWidth = COLS.reduce((sum, c) => sum + c.width, 0);
  const colX = [];
  COLS.reduce((x, c) => { colX.push(x); return x + c.width; }, left);

  const text = (o) => items.push({ t: 'text', align: 'left', size: FS.body, bold: false, ...o });
  const rect = (x, y, w, h) => items.push({ t: 'rect', x, y, w, h });

  let y = PAGE.margin;
  text({ x: left, y, w: tableWidth, text: 'Порционное требование', size: FS.title, bold: true, align: 'center' });
  y += FS.title * 1.6;
  text({ x: left, y, w: tableWidth, text: `на питание больных ${department.title}`, size: FS.subtitle, align: 'center' });
  y += FS.subtitle * 1.5;
  text({ x: left, y, w: tableWidth, text: `дата ${formatDateShort(reportDate)}`, size: FS.subtitle, align: 'center' });
  y += FS.subtitle * 1.5;

  if (correction) {
    text({ x: left, y, w: tableWidth, text: correction, size: FS.hint + 1, bold: true, align: 'center' });
    y += FS.subtitle * 1.4;
  }
  y += 6;

  // Шапка в два яруса: «Количество» накрывает три приёма пищи, остальные
  // заголовки занимают оба яруса по высоте.
  const headTop = y;
  const headRow1 = 18;
  const headRow2 = 16;
  const headHeight = headRow1 + headRow2;
  const mealStartIdx = COLS.findIndex(c => c.meal);
  const mealsWidth = COLS.filter(c => c.meal).reduce((s, c) => s + c.width, 0);

  COLS.forEach((col, i) => {
    if (col.meal) {
      rect(colX[i], headTop + headRow1, col.width, headRow2);
      text({ x: colX[i], y: headTop + headRow1 + (headRow2 - FS.head) / 2 + 1, w: col.width, text: col.title, size: FS.head, bold: true, align: 'center' });
    } else {
      rect(colX[i], headTop, col.width, headHeight);
      text({ x: colX[i] + 2, y: headTop + (headHeight - FS.head) / 2 + 1, w: col.width - 4, text: col.title, size: FS.head, bold: true, align: 'center' });
    }
  });
  rect(colX[mealStartIdx], headTop, mealsWidth, headRow1);
  text({ x: colX[mealStartIdx], y: headTop + (headRow1 - FS.head) / 2 + 1, w: mealsWidth, text: 'Количество', size: FS.head, bold: true, align: 'center' });

  y = headTop + headHeight;

  (entries || []).forEach(row => {
    const patients = cellLines(row.patients, COLS[1].width - 6, FS.body);
    const rowHeight = Math.max(22, patients.length * LINE_H + 9);

    COLS.forEach((col, i) => rect(colX[i], y, col.width, rowHeight));

    text({ x: colX[0], y: y + (rowHeight - FS.body) / 2, w: COLS[0].width, text: row.room || '', align: 'center' });
    patients.forEach((line, idx) => {
      text({ x: colX[1] + 3, y: y + 5 + idx * LINE_H, w: COLS[1].width - 6, text: line });
    });
    text({ x: colX[2], y: y + (rowHeight - FS.body) / 2, w: COLS[2].width, text: row.diet || '', align: 'center' });
    COLS.forEach((col, i) => {
      if (!col.meal) return;
      text({ x: colX[i] + 2, y: y + (rowHeight - FS.body) / 2, w: col.width - 4, text: row[col.key] || '', align: 'center' });
    });

    y += rowHeight;
  });

  // Итого: подпись занимает первые три столбца, дальше суммы по приёмам пищи
  const totalHeight = 22;
  rect(colX[0], y, COLS[0].width + COLS[1].width + COLS[2].width, totalHeight);
  text({ x: colX[0], y: y + (totalHeight - FS.body) / 2, w: COLS[0].width + COLS[1].width + COLS[2].width, text: 'Итого', size: FS.body, bold: true, align: 'center' });
  COLS.forEach((col, i) => {
    if (!col.meal) return;
    rect(colX[i], y, col.width, totalHeight);
    text({ x: colX[i], y: y + (totalHeight - FS.body) / 2, w: col.width, text: formatSum(sumMeal(entries, col.key)), size: FS.body, bold: true, align: 'center' });
  });
  y += totalHeight + 34;

  text({ x: left, y, w: tableWidth, text: 'Постовая медицинская сестра', size: FS.footer });
  y += 34;

  // Две полоски: слева под подпись от руки, справа — ФИО, оно же напечатано над
  // линией. Правая прижата к краю таблицы, как в бумажном бланке.
  const signWidth = 150;
  const nameWidth = 230;
  const nameX = left + tableWidth - nameWidth;
  text({ x: nameX, y: y - FS.footer - 3, w: nameWidth, text: nurseName || '', size: FS.footer, align: 'center' });
  items.push({ t: 'line', x1: left, y1: y, x2: left + signWidth, y2: y });
  items.push({ t: 'line', x1: nameX, y1: y, x2: nameX + nameWidth, y2: y });
  y += 4;
  text({ x: left, y, w: signWidth, text: '(подпись)', size: FS.hint, align: 'center' });
  text({ x: nameX, y, w: nameWidth, text: '(расшифровка подписи)', size: FS.hint, align: 'center' });
  y += FS.hint + PAGE.margin;

  return { items, contentHeight: y };
}

function renderPdf(day) {
  return new Promise((resolve, reject) => {
    try {
      const { items } = buildLayout(day);
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      doc.registerFont('dv', FONT_REGULAR);
      doc.registerFont('dv-bold', FONT_BOLD);

      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      items.forEach(item => {
        if (item.t === 'rect') {
          doc.lineWidth(0.7).rect(item.x, item.y, item.w, item.h).stroke('#000');
        } else if (item.t === 'line') {
          doc.lineWidth(0.7).moveTo(item.x1, item.y1).lineTo(item.x2, item.y2).stroke('#000');
        } else {
          doc.font(item.bold ? 'dv-bold' : 'dv').fontSize(item.size).fillColor('#000')
             .text(String(item.text), item.x, item.y, { width: item.w, align: item.align, lineBreak: false });
        }
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Картинка бланка. Масштаб 3 — компромисс: с телефона читается без открытия
 * файла, а весит меньше сотни килобайт.
 */
async function renderPng(day, { scale = 3 } = {}) {
  const { items } = buildLayout(day);
  // Полный лист А4, без обрезки пустого хвоста: в буфете привыкли к бумажному
  // бланку, и картинка должна быть им же, а не выкадровкой по последней строке.
  const width = PAGE.width;
  const height = PAGE.height;
  const parts = [`<rect width="${width}" height="${height}" fill="#ffffff"/>`];

  items.forEach(item => {
    if (item.t === 'rect') {
      parts.push(`<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" fill="none" stroke="#000" stroke-width="0.7"/>`);
    } else if (item.t === 'line') {
      parts.push(`<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="#000" stroke-width="0.7"/>`);
    } else {
      // pdfkit кладёт y на верх строки, SVG — на базовую линию: 0.93em это
      // подъём DejaVu Sans, с ним обе отрисовки садятся на одну высоту.
      const baseline = item.y + item.size * 0.93;
      const anchor = item.align === 'center' ? 'middle' : item.align === 'right' ? 'end' : 'start';
      const x = item.align === 'center' ? item.x + item.w / 2 : item.align === 'right' ? item.x + item.w : item.x;
      parts.push(
        `<text x="${x}" y="${baseline}" font-family="${SVG_FONT_FAMILY}" font-size="${item.size}"` +
        `${item.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}" fill="#000">${escapeXml(item.text)}</text>`
      );
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = {
  DEPARTMENT_COLUMNS: COLS,
  parseAmount,
  sumMeal,
  formatSum,
  formatDateShort,
  buildLayout,
  renderPdf,
  renderPng
};
