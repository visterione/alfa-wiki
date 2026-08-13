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

/**
 * Оформление выгрузок — строгое, под официальный документооборот.
 *
 * Белый фон, чёрные линии, никаких заливок «для красоты»: такой файл кладут в
 * приложение к акту, распечатывают и подписывают. Синяя шапка таблицы и голубая
 * подсветка групп, которые были здесь раньше, годятся для экрана, но в документе
 * читаются как декорация — а на чёрно-белой печати превращаются в серые полосы,
 * сквозь которые не видно текста.
 *
 * Заливка осталась ровно в одном случае — красная зона: просрочка и остаток ниже
 * минимума. Это не оформление, а само содержание строки, и в ТЗ оно названо
 * условным форматированием отклонений. Все остальные зоны различаются словом в
 * колонке «Статус», а не цветом.
 */
const COLORS = {
  line: 'FF000000',
  // Единственная допустимая заливка: критическое отклонение. Тон светлый, чтобы
  // чёрный текст поверх читался и в печати.
  criticalBg: 'FFF2DCDB',
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
    pageSetup: {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, paperSize: 9,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  const cols = columns && columns.length ? columns : inferColumns(items);
  const lastCol = cols.length;

  // ── Шапка отчёта (единый блок из раздела 1.0 ТЗ) ────────────────────────────
  // Раскладка макета: слева юрлицо, название отчёта и период; справа — кто, когда
  // и чем сформировал. Правый блок начинается с середины таблицы, поэтому у узких
  // отчётов он прижимается к последней колонке, а не уезжает за край листа.
  const rightCol = Math.max(2, Math.min(lastCol, Math.ceil(lastCol / 2) + 1));
  const put = (row, col, value, font, alignment) => {
    const cell = ws.getCell(row, col);
    cell.value = value;
    if (font) cell.font = font;
    if (alignment) cell.alignment = alignment;
    return cell;
  };
  const LEFT = { horizontal: 'left', vertical: 'middle' };
  const RIGHT = { horizontal: 'right', vertical: 'middle' };

  let r = 1;
  put(r, 1, header?.organization || 'Организация не указана', { size: 10 }, LEFT);
  ws.mergeCells(r, 1, r, rightCol - 1);
  put(r, rightCol, 'Отчёт сформирован:', { size: 9 }, RIGHT);
  ws.mergeCells(r, rightCol, r, lastCol);
  r++;

  put(r, 1, (header?.title || code).toUpperCase(), { size: 13, bold: true }, LEFT);
  ws.mergeCells(r, 1, r, rightCol - 1);
  put(r, rightCol, fmtDateTime(header?.generatedAt || new Date()), { size: 9 }, RIGHT);
  ws.mergeCells(r, rightCol, r, lastCol);
  r++;

  put(r, 1, header?.period
    ? `за период ${fmtDate(header.period.from)} — ${fmtDate(header.period.to)}`
    : 'на текущую дату', { size: 10 }, LEFT);
  ws.mergeCells(r, 1, r, rightCol - 1);
  put(r, rightCol, `Пользователь: ${header?.generatedBy || '—'}`, { size: 9 }, RIGHT);
  ws.mergeCells(r, rightCol, r, lastCol);
  r++;

  put(r, rightCol, `Система: ${header?.system || 'Alfa-Wiki, складской учёт'}`, { size: 9 }, RIGHT);
  ws.mergeCells(r, rightCol, r, lastCol);
  r++;
  r++;

  put(r, 1, `Отбор: ${header?.filterText || 'без дополнительного отбора'}`, { size: 9 }, LEFT);
  ws.mergeCells(r, 1, r, lastCol);
  r++;

  if (header?.oneCNote) {
    put(r, 1, header.oneCNote, { size: 9, italic: true }, LEFT);
    ws.mergeCells(r, 1, r, lastCol);
    r++;
  }
  r++;

  // ── Заголовки колонок ──────────────────────────────────────────────────────
  // Без заливки: строгий документ отделяет шапку начертанием и рамкой, а не цветом.
  const headerRow = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.title;
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = boxBorder({ bottom: 'medium', top: 'medium' });
  });
  headerRow.height = 30;
  const headerRowIndex = r;
  r++;

  // ── Данные ─────────────────────────────────────────────────────────────────
  for (const item of items) {
    const row = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = formatValue(item[c.key], c.type);
      cell.numFmt = numberFormat(c.type);
      cell.alignment = { horizontal: alignOf(c.type), vertical: 'middle', wrapText: false };
      cell.border = boxBorder();
    });

    // Группировка: уровень приходит в самой строке. Excel рисует «плюсики» слева.
    if (item.__level) row.outlineLevel = Math.min(7, item.__level);
    // Уровни иерархии различаются начертанием, а не фоном: верхние — жирным,
    // нижние — обычным. На печати это работает, заливка — нет.
    if (item.__isGroup) {
      row.eachCell(c => { c.font = { bold: true }; });
    }

    // Единственное условное форматирование: критическое отклонение. Просрочка и
    // остаток ниже минимума — то, ради чего отчёт открывают, и их видно до чтения.
    const zone = item.zone || item.status || item.stockStatus;
    if (!item.__isGroup && (zone === 'red' || zone === 'below')) {
      row.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.criticalBg } };
      });
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
      // Итог отделяется двойной линией сверху — так его набирают в бухгалтерских
      // формах, и это читается на любой печати.
      cell.border = boxBorder({ top: 'double', bottom: 'medium' });
      cell.alignment = { horizontal: alignOf(c.type) };
    });
    r++;
  }

  // Рамка вокруг всей таблицы: левый и правый край — жирной линией.
  for (let row = headerRowIndex; row < r; row++) {
    for (const col of [1, lastCol]) {
      const cell = ws.getCell(row, col);
      const border = { ...(cell.border || boxBorder()) };
      border[col === 1 ? 'left' : 'right'] = { style: 'medium', color: { argb: COLORS.line } };
      cell.border = border;
    }
  }

  // Заморозка ставится по фактическому номеру строки заголовков, а не по формуле
  // от состава шапки: формула жила отдельно от кода, который эти строки пишет, и
  // при добавлении строки «Отбор» заголовки таблицы уехали из закреплённой области.
  ws.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  // Заголовки повторяются на каждой печатной странице — иначе со второго листа
  // непонятно, что в колонках.
  ws.pageSetup.printTitlesRow = `${headerRowIndex}:${headerRowIndex}`;

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
    ['Организация', header?.organization || '—'],
    ['Отчёт', header?.title || code],
    ['Код отчёта', code],
    ['Период', header?.period ? `${fmtDate(header.period.from)} — ${fmtDate(header.period.to)}` : 'не задан'],
    ['Сформирован', fmtDateTime(header?.generatedAt || new Date())],
    ['Пользователь', header?.generatedBy || '—'],
    ['Система', header?.system || 'Alfa-Wiki, складской учёт'],
    ['Строк в отчёте', items.length],
    ['Интеграция с 1С', 'не подключена'],
    // Разобранный отбор, а не сырой query: идентификаторы здесь уже развёрнуты в
    // названия — по ним через месяц видно, какой именно срез был выгружен.
    ...(header?.filterList?.length
      ? header.filterList.map(f => [`Отбор: ${f.label}`, f.value])
      : [['Отбор', 'без дополнительного отбора']]),
  ];
  paramRows.forEach(([k, v], i) => {
    params.getCell(i + 1, 1).value = k;
    params.getCell(i + 1, 1).font = { bold: true };
    params.getCell(i + 1, 1).border = boxBorder();
    params.getCell(i + 1, 2).value = v;
    params.getCell(i + 1, 2).border = boxBorder();
  });

  return wb.xlsx.writeBuffer();
}

/** Чёрная рамка ячейки. Толщина краёв задаётся точечно: шапка, итог, края листа. */
function boxBorder(overrides = {}) {
  const line = style => ({ style, color: { argb: COLORS.line } });
  return {
    top: line(overrides.top || 'thin'),
    left: line(overrides.left || 'thin'),
    bottom: line(overrides.bottom || 'thin'),
    right: line(overrides.right || 'thin'),
  };
}

function numberFormat(type) {
  switch (type) {
    case 'money': return '# ##0.00';
    case 'qty': return '# ##0.000';
    case 'number': return '# ##0';
    case 'percent': return '+0.0%;-0.0%;0.0%';
    // Доля — не изменение: знак «+» перед ней читался бы как рост.
    case 'share': return '0.0%';
    case 'date': return 'dd.mm.yyyy';
    case 'datetime': return 'dd.mm.yyyy hh:mm';
    default: return undefined;
  }
}

function alignOf(type) {
  return ['money', 'qty', 'number', 'percent', 'share', 'deviation'].includes(type) ? 'right'
    : ['date', 'datetime'].includes(type) ? 'center' : 'left';
}

function formatValue(v, type) {
  if (v === null || v === undefined) return null;
  if (type === 'percent' || type === 'share') return Number(v) / 100;
  if (['money', 'qty', 'number', 'deviation'].includes(type)) return Number(v);
  if (type === 'date' || type === 'datetime') return v ? new Date(v) : null;
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

      // ── Шапка по макету раздела 1.0 ТЗ ─────────────────────────────────────
      // Слева юрлицо, название и период; справа — кем, когда и чем сформирован.
      // Обе колонки рисуются от одной базовой ординаты, чтобы строки совпали.
      const left = doc.page.margins.left;
      const half = pageWidth / 2;
      const top = doc.y;

      doc.font('DejaVu').fontSize(8).text(header?.organization || 'Организация не указана', left, top, { width: half });
      doc.font('DejaVu-Bold').fontSize(12)
        .text((header?.title || code).toUpperCase(), left, top + 12, { width: half });
      doc.font('DejaVu').fontSize(8).text(
        header?.period
          ? `за период ${fmtDate(header.period.from)} — ${fmtDate(header.period.to)}`
          : 'на текущую дату',
        left, top + 28, { width: half }
      );

      const rightX = left + half;
      doc.fontSize(8);
      doc.text('Отчёт сформирован:', rightX, top, { width: half, align: 'right' });
      doc.text(fmtDateTime(header?.generatedAt || new Date()), rightX, top + 10, { width: half, align: 'right' });
      doc.text(`Пользователь: ${header?.generatedBy || '—'}`, rightX, top + 20, { width: half, align: 'right' });
      doc.text(`Система: ${header?.system || 'Alfa-Wiki, складской учёт'}`, rightX, top + 30, { width: half, align: 'right' });

      doc.y = top + 46;
      doc.fontSize(8).text(`Отбор: ${header?.filterText || 'без дополнительного отбора'}`, left, doc.y, { width: pageWidth });
      if (header?.oneCNote) doc.fontSize(7).text(header.oneCNote, left, doc.y, { width: pageWidth });
      doc.moveDown(0.8);

      // Заголовок таблицы: без заливки, отбит линиями сверху и снизу.
      const drawHeader = () => {
        const y = doc.y;
        doc.lineWidth(1).strokeColor('#000')
          .moveTo(left, y).lineTo(left + pageWidth, y).stroke();
        doc.font('DejaVu-Bold').fontSize(6.5).fillColor('#000');
        cols.forEach((c, i) => {
          doc.text(String(c.title), left + i * colWidth + 2, y + 4, {
            width: colWidth - 4, height: 12, ellipsis: true,
          });
        });
        doc.lineWidth(1).moveTo(left, y + 17).lineTo(left + pageWidth, y + 17).stroke();
        doc.font('DejaVu').fontSize(6.5);
        doc.y = y + 20;
      };

      // Разлиновка ячеек — тонкими чёрными линиями: строгий документ держится на
      // сетке, а не на чередующихся фонах.
      const drawRowGrid = (y, height) => {
        doc.lineWidth(0.3).strokeColor('#000');
        doc.moveTo(left, y + height).lineTo(left + pageWidth, y + height).stroke();
        for (let i = 0; i <= cols.length; i++) {
          const x = left + i * colWidth;
          doc.moveTo(x, y).lineTo(x, y + height).stroke();
        }
      };

      drawHeader();

      for (const item of items) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        // Единственная заливка — критическое отклонение: просрочка и остаток ниже
        // минимума. Остальные зоны различаются словом в колонке «Статус».
        const zone = item.zone || item.status || item.stockStatus;
        if (!item.__isGroup && (zone === 'red' || zone === 'below')) {
          doc.rect(left, y - 1, pageWidth, 12).fill('#f2dcdb');
        }
        doc.fillColor('#000');
        if (item.__isGroup) doc.font('DejaVu-Bold');

        cols.forEach((c, i) => {
          const raw = item[c.key];
          const text = pdfCell(raw, c.type);
          doc.text(text, left + i * colWidth + 2, y + 1, {
            width: colWidth - 4, height: 10, ellipsis: true,
            align: alignOf(c.type) === 'right' ? 'right' : 'left',
          });
        });
        if (item.__isGroup) doc.font('DejaVu');
        drawRowGrid(y - 1, 12);
        doc.y = y + 12;
      }

      if (totals && Object.keys(totals).length) {
        const y = doc.y + 2;
        // Двойная линия над итогом — как в бухгалтерских формах.
        doc.lineWidth(0.8).strokeColor('#000')
          .moveTo(left, y).lineTo(left + pageWidth, y).stroke()
          .moveTo(left, y + 2).lineTo(left + pageWidth, y + 2).stroke();
        doc.fillColor('#000').font('DejaVu-Bold').fontSize(7);
        doc.text('ИТОГО', left + 2, y + 5, { width: colWidth - 4 });
        cols.forEach((c, i) => {
          if (totals[c.key] === undefined || i === 0) return;
          doc.text(pdfCell(totals[c.key], c.type), left + i * colWidth + 2, y + 5, {
            width: colWidth - 4, align: 'right', ellipsis: true,
          });
        });
        doc.lineWidth(1).moveTo(left, y + 16).lineTo(left + pageWidth, y + 16).stroke();
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

function pdfCell(v, type) {
  if (v === null || v === undefined) return '—';
  if (type === 'money') return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'qty') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (type === 'number' || type === 'deviation') return Number(v).toLocaleString('ru-RU');
  if (type === 'percent') return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)} %`;
  if (type === 'share') return `${Number(v).toFixed(1)} %`;
  if (type === 'date') return fmtDate(v);
  if (type === 'datetime') return v ? new Date(v).toLocaleString('ru-RU') : '—';
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
