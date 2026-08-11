/**
 * Выгрузка отчётов складского модуля в XLSX и PDF.
 *
 * XLSX собирается через exceljs, а не через xlsx-js-style, которым пользуется
 * остальной портал: требования раздела 1.0 ТЗ включают группировку строк
 * сворачиваемыми «плюсиками» (outlineLevel), а xlsx-js-style этого не умеет —
 * стили есть, уровней группировки нет. Для отчётов без иерархии разницы никакой,
 * но оборотно-сальдовая ведомость без сворачивания нечитаема.
 *
 * PDF — на pdfkit, как весь остальной проект. Шрифт DejaVu из backend/fonts:
 * встроенные шрифты pdfkit кириллицу не содержат, и без регистрации получается
 * страница вопросительных знаков.
 */

const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');

// Палитра. Держим здесь, чтобы XLSX и PDF красили статусы одинаково — иначе
// «красный» в выгрузке и на экране означают разное.
const COLORS = {
  headerBg: 'FF1E3A5F',
  headerFg: 'FFFFFFFF',
  totalBg: 'FFE8EEF6',
  groupBg: 'FFF4F7FB',
  red: 'FFFFD5D5',
  orange: 'FFFFE8CC',
  yellow: 'FFFFF6CC',
  green: 'FFE3F5E3',
};

/**
 * columns: [{ key, title, width?, type?: 'text'|'number'|'money'|'qty'|'date'|'percent',
 *             level?: number — уровень группировки строки }]
 */
async function toXlsx({ code, header, items, totals, columns }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Alfa-Wiki · Складской учёт';
  wb.created = new Date();

  const ws = wb.addWorksheet('Отчёт', {
    views: [{ state: 'frozen', ySplit: headerRows(header) + 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, paperSize: 9 },
  });

  const cols = columns && columns.length ? columns : inferColumns(items);
  const lastCol = cols.length;

  // ── Шапка отчёта (единый блок из раздела 1.0 ТЗ) ────────────────────────────
  let r = 1;
  const title = ws.getCell(r, 1);
  title.value = header?.title || code;
  title.font = { size: 14, bold: true };
  ws.mergeCells(r, 1, r, lastCol);
  r++;

  if (header?.period) {
    ws.getCell(r, 1).value = `за период ${fmtDate(header.period.from)} — ${fmtDate(header.period.to)}`;
    ws.mergeCells(r, 1, r, lastCol);
    r++;
  }

  ws.getCell(r, 1).value =
    `Отчёт сформирован: ${fmtDateTime(header?.generatedAt || new Date())} · ` +
    `Пользователь: ${header?.generatedBy || '—'} · Система: Alfa-Wiki, складской учёт`;
  ws.getCell(r, 1).font = { size: 9, color: { argb: 'FF64748B' } };
  ws.mergeCells(r, 1, r, lastCol);
  r++;

  if (header?.oneCNote) {
    ws.getCell(r, 1).value = header.oneCNote;
    ws.getCell(r, 1).font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };
    ws.mergeCells(r, 1, r, lastCol);
    r++;
  }
  r++;

  // ── Заголовки колонок ──────────────────────────────────────────────────────
  const headerRow = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.title;
    cell.font = { bold: true, color: { argb: COLORS.headerFg } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
  headerRow.height = 28;
  const headerRowIndex = r;
  r++;

  // ── Данные ─────────────────────────────────────────────────────────────────
  for (const item of items) {
    const row = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = formatValue(item[c.key], c.type);
      cell.numFmt = numberFormat(c.type);
      cell.alignment = { horizontal: alignOf(c.type), vertical: 'middle' };
      cell.border = thinBorder();
    });

    // Группировка: уровень приходит в самой строке. Excel рисует «плюсики» слева.
    if (item.__level) row.outlineLevel = Math.min(7, item.__level);
    if (item.__isGroup) {
      row.eachCell(c => {
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.groupBg } };
      });
    }

    // Условное форматирование статусов — заливкой строки, а не отдельным
    // значком: значок в XLSX не отфильтруешь и не отсортируешь.
    const zone = item.zone || item.status || item.stockStatus;
    const fill = zoneFill(zone);
    if (fill && !item.__isGroup) {
      row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; });
    }
    r++;
  }

  // ── Итоги ──────────────────────────────────────────────────────────────────
  if (totals && Object.keys(totals).length) {
    const row = ws.getRow(r);
    row.getCell(1).value = 'ИТОГО';
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (totals[c.key] !== undefined) {
        cell.value = formatValue(totals[c.key], c.type);
        cell.numFmt = numberFormat(c.type);
      }
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
      cell.border = thinBorder();
      cell.alignment = { horizontal: alignOf(c.type) };
    });
    r++;
  }

  // Автофильтр по строке заголовков и ширина колонок по содержимому.
  ws.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: lastCol },
  };
  cols.forEach((c, i) => {
    const contentWidth = Math.max(
      String(c.title).length,
      ...items.slice(0, 500).map(it => String(formatValue(it[c.key], c.type) ?? '').length)
    );
    ws.getColumn(i + 1).width = Math.min(c.width || contentWidth + 3, 60);
  });
  ws.properties.outlineLevelRow = 0;

  // ── Лист «Параметры отбора» ────────────────────────────────────────────────
  // Обязателен по ТЗ: без него через месяц невозможно понять, какой срез перед
  // тобой, и выгрузки начинают спорить друг с другом.
  const params = wb.addWorksheet('Параметры отбора');
  params.columns = [{ width: 32 }, { width: 60 }];
  const paramRows = [
    ['Отчёт', header?.title || code],
    ['Код отчёта', code],
    ['Период', header?.period ? `${fmtDate(header.period.from)} — ${fmtDate(header.period.to)}` : 'не задан'],
    ['Сформирован', fmtDateTime(header?.generatedAt || new Date())],
    ['Пользователь', header?.generatedBy || '—'],
    ['Строк в отчёте', items.length],
    ['Интеграция с 1С', 'не подключена'],
    ...Object.entries(header?.filters || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [`Фильтр: ${k}`, String(v)]),
  ];
  paramRows.forEach(([k, v], i) => {
    params.getCell(i + 1, 1).value = k;
    params.getCell(i + 1, 1).font = { bold: true };
    params.getCell(i + 1, 2).value = v;
  });

  return wb.xlsx.writeBuffer();
}

function headerRows(header) {
  let n = 3; // заголовок + сформирован + пустая
  if (header?.period) n++;
  if (header?.oneCNote) n++;
  return n;
}

function thinBorder() {
  const s = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  return { top: s, left: s, bottom: s, right: s };
}

function zoneFill(zone) {
  switch (zone) {
    case 'red': case 'below': return COLORS.red;
    case 'orange': return COLORS.orange;
    case 'yellow': case 'near': return COLORS.yellow;
    case 'green': case 'ok': return COLORS.green;
    default: return null;
  }
}

function numberFormat(type) {
  switch (type) {
    case 'money': return '# ##0.00';
    case 'qty': return '# ##0.000';
    case 'number': return '# ##0';
    case 'percent': return '+0.0%;-0.0%;0.0%';
    case 'date': return 'dd.mm.yyyy';
    default: return undefined;
  }
}

function alignOf(type) {
  return ['money', 'qty', 'number', 'percent'].includes(type) ? 'right'
    : type === 'date' ? 'center' : 'left';
}

function formatValue(v, type) {
  if (v === null || v === undefined) return null;
  if (type === 'percent') return Number(v) / 100;
  if (['money', 'qty', 'number'].includes(type)) return Number(v);
  if (type === 'date') return v ? new Date(v) : null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function inferColumns(items) {
  const first = items[0] || {};
  return Object.keys(first)
    .filter(k => !k.startsWith('__'))
    .map(k => ({
      key: k,
      title: k,
      type: typeof first[k] === 'number' ? 'number' : 'text',
    }));
}

/**
 * PDF. Альбомная A4 — как в ТЗ: в портретную ширину оборотно-сальдовая
 * ведомость не влезает даже с урезанными колонками.
 */
async function toPdf({ code, header, items, totals, columns }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
      doc.registerFont('DejaVu', path.join(FONTS_DIR, 'DejaVuSans.ttf'));
      doc.registerFont('DejaVu-Bold', path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf'));

      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cols = (columns && columns.length ? columns : inferColumns(items))
        // В PDF влезает ограниченное число колонок. Режем до 10 и честно
        // сообщаем об этом в подвале, а не молча теряем данные.
        .slice(0, 10);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = pageWidth / cols.length;

      // Шапка
      doc.font('DejaVu-Bold').fontSize(13).text(header?.title || code, { align: 'center' });
      if (header?.period) {
        doc.font('DejaVu').fontSize(9)
          .text(`за период ${fmtDate(header.period.from)} — ${fmtDate(header.period.to)}`, { align: 'center' });
      }
      doc.font('DejaVu').fontSize(7).fillColor('#64748b')
        .text(`Сформирован: ${fmtDateTime(header?.generatedAt || new Date())} · Пользователь: ${header?.generatedBy || '—'}`, { align: 'center' });
      if (header?.oneCNote) doc.fontSize(7).text(header.oneCNote, { align: 'center' });
      doc.fillColor('#000').moveDown(0.8);

      const drawHeader = () => {
        const y = doc.y;
        doc.rect(doc.page.margins.left, y, pageWidth, 18).fill('#1e3a5f');
        doc.fillColor('#fff').font('DejaVu-Bold').fontSize(6.5);
        cols.forEach((c, i) => {
          doc.text(String(c.title), doc.page.margins.left + i * colWidth + 2, y + 5, {
            width: colWidth - 4, height: 12, ellipsis: true,
          });
        });
        doc.fillColor('#000').font('DejaVu').fontSize(6.5);
        doc.y = y + 20;
      };

      drawHeader();

      for (const item of items) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        const zone = item.zone || item.status || item.stockStatus;
        const bg = pdfZoneColor(zone);
        if (bg) doc.rect(doc.page.margins.left, y - 1, pageWidth, 12).fill(bg).fillColor('#000');
        if (item.__isGroup) doc.font('DejaVu-Bold');

        cols.forEach((c, i) => {
          const raw = item[c.key];
          const text = pdfCell(raw, c.type);
          doc.text(text, doc.page.margins.left + i * colWidth + 2, y + 1, {
            width: colWidth - 4, height: 10, ellipsis: true,
            align: alignOf(c.type) === 'right' ? 'right' : 'left',
          });
        });
        if (item.__isGroup) doc.font('DejaVu');
        doc.y = y + 12;
      }

      if (totals && Object.keys(totals).length) {
        const y = doc.y + 2;
        doc.rect(doc.page.margins.left, y, pageWidth, 14).fill('#e8eef6').fillColor('#000');
        doc.font('DejaVu-Bold').fontSize(7);
        doc.text('ИТОГО', doc.page.margins.left + 2, y + 3, { width: colWidth - 4 });
        cols.forEach((c, i) => {
          if (totals[c.key] === undefined || i === 0) return;
          doc.text(pdfCell(totals[c.key], c.type), doc.page.margins.left + i * colWidth + 2, y + 3, {
            width: colWidth - 4, align: 'right', ellipsis: true,
          });
        });
        doc.font('DejaVu');
      }

      const allCols = (columns && columns.length ? columns : inferColumns(items)).length;
      if (allCols > cols.length) {
        doc.moveDown(0.5).fontSize(6.5).fillColor('#94a3b8')
          .text(`В PDF показаны первые ${cols.length} из ${allCols} колонок. Полный набор — в выгрузке XLSX.`);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function pdfZoneColor(zone) {
  switch (zone) {
    case 'red': case 'below': return '#ffd5d5';
    case 'orange': return '#ffe8cc';
    case 'yellow': case 'near': return '#fff6cc';
    default: return null;
  }
}

function pdfCell(v, type) {
  if (v === null || v === undefined) return '—';
  if (type === 'money') return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'qty') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (type === 'number') return Number(v).toLocaleString('ru-RU');
  if (type === 'percent') return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)} %`;
  if (type === 'date') return fmtDate(v);
  if (typeof v === 'object') return '';
  return String(v);
}

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString('ru-RU');
}

function fmtDateTime(d) {
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? String(d)
    : `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

module.exports = { toXlsx, toPdf, COLORS };
