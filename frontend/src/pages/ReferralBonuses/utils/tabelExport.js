import ExcelJS from 'exceljs';

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const WORKING_CODES = new Set(['Я','Н','РВ','С','К','ПК','ЛЧ','НС','МО']);

function pad2(n) { return String(n).padStart(2, '0'); }

function abbreviateName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length < 2) return fullName || '';
  const [last, ...rest] = parts;
  return last + ' ' + rest.map(p => p[0] ? p[0].toUpperCase() + '.' : '').join(' ');
}

function resolveRole(doc) {
  const resolveStr = p => typeof p === 'object' ? (p.title || p.name || '') : String(p || '');
  if (Array.isArray(doc.roles) && doc.roles.length > 0)
    return doc.roles.map(resolveStr).filter(Boolean).join(', ');
  if (Array.isArray(doc.professions) && doc.professions.length > 0)
    return doc.professions.map(resolveStr).filter(Boolean).join(', ');
  return '';
}

// ─── Column letter helper ──────────────────────────────────────────────────────
function col(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
// Compact address helper
function addr(r, c) { return `${col(c)}${r}`; }
function range(r1, c1, r2, c2) { return `${addr(r1, c1)}:${addr(r2, c2)}`; }

// ─── Shared styles ─────────────────────────────────────────────────────────────
const TNR     = 'Times New Roman';
const thin    = { style: 'thin' };
const medium  = { style: 'medium' };
const allThin = { top: thin, bottom: thin, left: thin, right: thin };
const allMed  = { top: medium, bottom: medium, left: medium, right: medium };
const noFill  = undefined;
const grayFill= { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBEBEB' } };

function fnt(size, bold = false, italic = false) {
  return { name: TNR, size, bold, italic };
}

function setCell(ws, r, c, value, opts = {}) {
  const cell = ws.getCell(r, c);
  cell.value = value ?? null;
  cell.font  = opts.font  ?? fnt(9);
  cell.alignment = opts.align ?? { vertical: 'middle', horizontal: 'center', wrapText: true };
  if (opts.border !== false) cell.border = opts.border ?? allThin;
  if (opts.fill)  cell.fill  = opts.fill;
  return cell;
}

// Merge + set value on top-left
function mergeSet(ws, r1, c1, r2, c2, value, opts = {}) {
  ws.mergeCells(range(r1, c1, r2, c2));
  return setCell(ws, r1, c1, value, opts);
}

/**
 * Build an ExcelJS Workbook for a tabel record.
 * Structure matches the HTML TabelTable exactly.
 */
export async function buildTabelWorkbook(record, doctorsFilter = null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'alfa-wiki';
  wb.created = new Date();

  const { month, year, orgName, subdivision, docNumber } = record;
  const lastDay  = new Date(year, month, 0).getDate();
  const now      = new Date();
  const docDate  = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`;
  const periodFrom = `01.${pad2(month)}.${year}`;
  const periodTo   = `${pad2(lastDay)}.${pad2(month)}.${year}`;

  // Day layout (mirrors TabelTable exactly)
  const showX      = lastDay % 2 === 1;
  const halfSize   = Math.floor(lastDay / 2);
  const firstHalf  = Array.from({ length: halfSize },                          (_, i) => i + 1);
  const secondHalf = Array.from({ length: halfSize + (showX ? 1 : 0) }, (_, i) => halfSize + 1 + i);
  const dayColCount = secondHalf.length; // shared columns count

  const doctors = doctorsFilter
    ? record.doctors.filter(d => doctorsFilter.includes(d.misUserId))
    : record.doctors;

  if (!doctors.length) return wb;

  // ── Column numbers (1-indexed) ──────────────────────────────────────────────
  const C1 = 1; // №
  const C2 = 2; // ФИО
  const C3 = 3; // Табельный номер
  const CD_START = 4;                    // first shared day column
  const CD_END   = 3 + dayColCount;      // last shared day column
  const C_HALF   = CD_END + 1;           // "половину месяца (I, II)"
  const C_MONTH  = CD_END + 2;           // "месяц"
  const C_KOD1   = CD_END + 3;           // Код вида оплаты (1)
  const C_KOR1   = CD_END + 4;           // Корр. счёт (1)
  const C_HRS1   = CD_END + 5;           // Часы (1)
  const C_KOD2   = CD_END + 6;           // Код вида оплаты (2)
  const C_KOR2   = CD_END + 7;           // Корр. счёт (2)
  const C_HRS2   = CD_END + 8;           // Часы (2)
  const C_AK1    = CD_END + 9;           // Код неявки (1)
  const C_ADH1   = CD_END + 10;          // Дни (часы) неявки (1)
  const C_AK2    = CD_END + 11;          // Код неявки (2)
  const C_ADH2   = CD_END + 12;          // Дни (часы) неявки (2)
  const TOTAL_COLS = C_ADH2;

  const ws = wb.addWorksheet('Табель');

  // ── Column widths ────────────────────────────────────────────────────────────
  ws.getColumn(C1).width = 4;
  ws.getColumn(C2).width = 34;
  ws.getColumn(C3).width = 7;
  for (let c = CD_START; c <= CD_END; c++) ws.getColumn(c).width = 4.5;
  ws.getColumn(C_HALF).width = 7;
  ws.getColumn(C_MONTH).width = 7;
  ws.getColumn(C_KOD1).width = 7; ws.getColumn(C_KOR1).width = 7; ws.getColumn(C_HRS1).width = 6;
  ws.getColumn(C_KOD2).width = 7; ws.getColumn(C_KOR2).width = 7; ws.getColumn(C_HRS2).width = 6;
  ws.getColumn(C_AK1).width = 6;  ws.getColumn(C_ADH1).width = 9;
  ws.getColumn(C_AK2).width = 6;  ws.getColumn(C_ADH2).width = 9;

  let R = 1; // current row counter

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Document header (pre-table)
  // ════════════════════════════════════════════════════════════════════════════

  // Row 1: Form reference (top-right corner area)
  ws.getRow(R).height = 11;
  const formCol = Math.max(1, TOTAL_COLS - 5);
  mergeSet(ws, R, formCol, R, TOTAL_COLS,
    'Унифицированная форма № Т-13',
    { font: fnt(8), align: { horizontal: 'right', vertical: 'middle' }, border: false });
  R++;

  ws.getRow(R).height = 11;
  mergeSet(ws, R, formCol, R, TOTAL_COLS,
    'Утверждена Постановлением Госкомстата',
    { font: fnt(8), align: { horizontal: 'right', vertical: 'middle' }, border: false });
  R++;

  ws.getRow(R).height = 11;
  mergeSet(ws, R, formCol, R, TOTAL_COLS,
    'России от 05.01.2004 № 1',
    { font: fnt(8), align: { horizontal: 'right', vertical: 'middle' }, border: false });
  R++;

  ws.getRow(R).height = 8; // пустая строка-отступ
  R++;

  // ОКУД / ОКПО small table (right-aligned, 2 columns: label | code)
  ws.getRow(R).height = 12;
  const okudLblCol = TOTAL_COLS - 1;
  setCell(ws, R, okudLblCol, 'Форма по ОКУД', { font: fnt(8), align: { horizontal: 'right', vertical: 'middle' }, border: false });
  setCell(ws, R, TOTAL_COLS, '0301008',        { font: fnt(8), align: { horizontal: 'center', vertical: 'middle' }, border: allThin });
  R++;

  ws.getRow(R).height = 12;
  setCell(ws, R, okudLblCol, 'по ОКПО', { font: fnt(8), align: { horizontal: 'right', vertical: 'middle' }, border: false });
  setCell(ws, R, TOTAL_COLS, '',         { font: fnt(8), align: { horizontal: 'center', vertical: 'middle' }, border: allThin });
  R++;

  // Organization name (centered across full width, bottom-bordered)
  ws.getRow(R).height = 20;
  const orgCell = mergeSet(ws, R, 1, R, TOTAL_COLS, orgName || '',
    { font: fnt(12), align: { horizontal: 'center', vertical: 'bottom' }, border: false });
  orgCell.border = { bottom: thin };
  R++;

  ws.getRow(R).height = 11;
  mergeSet(ws, R, 1, R, TOTAL_COLS, '(наименование организации)',
    { font: fnt(8, false, true), align: { horizontal: 'center', vertical: 'middle' }, border: false });
  R++;

  // Structural subdivision (centered, bottom-bordered)
  ws.getRow(R).height = 20;
  const subCell = mergeSet(ws, R, 1, R, TOTAL_COLS, subdivision || '',
    { font: fnt(12), align: { horizontal: 'center', vertical: 'bottom' }, border: false });
  subCell.border = { bottom: thin };
  R++;

  ws.getRow(R).height = 11;
  mergeSet(ws, R, 1, R, TOTAL_COLS, '(структурное подразделение)',
    { font: fnt(8, false, true), align: { horizontal: 'center', vertical: 'middle' }, border: false });
  R++;

  // Meta table (right side): Номер документа | Дата составления | Отчётный период
  // Each field occupies 2 columns (6 total), 2 rows
  ws.getRow(R).height = 13;
  const M1 = TOTAL_COLS - 5;
  const metaHdr = { font: fnt(8, true), align: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: allThin };
  const metaVal = { font: fnt(9), align: { horizontal: 'center', vertical: 'middle' }, border: allThin };
  mergeSet(ws, R, M1,     R, M1 + 1, 'Номер документа',  metaHdr);
  mergeSet(ws, R, M1 + 2, R, M1 + 3, 'Дата составления', metaHdr);
  mergeSet(ws, R, M1 + 4, R, M1 + 5, 'Отчётный период',  metaHdr);
  R++;

  ws.getRow(R).height = 13;
  mergeSet(ws, R, M1,     R, M1 + 1, docNumber || '', metaVal);
  mergeSet(ws, R, M1 + 2, R, M1 + 3, docDate,         metaVal);
  setCell(ws, R, M1 + 4, periodFrom, metaVal);
  setCell(ws, R, M1 + 5, periodTo,   metaVal);
  R++;

  // Title
  ws.getRow(R).height = 22;
  mergeSet(ws, R, 1, R, TOTAL_COLS, 'ТАБЕЛЬ УЧЁТА РАБОЧЕГО ВРЕМЕНИ',
    { font: fnt(14, true), align: { horizontal: 'center', vertical: 'middle' }, border: false });
  R++;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Table header (4 rows: HDR1, HDR2, HDR3, COL_NUMS)
  // Mirrors the thead of TabelTable exactly.
  // ════════════════════════════════════════════════════════════════════════════
  const ROW_H1  = R;
  const ROW_H2  = R + 1;
  const ROW_H3  = R + 2;
  const ROW_HN  = R + 3;  // column numbers

  [ROW_H1, ROW_H2, ROW_H3, ROW_HN].forEach(rr => { ws.getRow(rr).height = 30; });
  ws.getRow(ROW_HN).height = 13;

  const hdrOpts = (extra = {}) => ({
    font: fnt(8, true),
    fill: grayFill,
    align: { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: extra.rot || 0 },
    border: allThin,
  });

  // ── Cols 1, 2, 3 — rowSpan=3 (H1..H3) ──
  mergeSet(ws, ROW_H1, C1, ROW_H3, C1, '№', hdrOpts());
  mergeSet(ws, ROW_H1, C2, ROW_H3, C2,
    'Фамилия, инициалы, должность\n(специальность, профессия)', hdrOpts());
  mergeSet(ws, ROW_H1, C3, ROW_H3, C3, 'Табельный номер', hdrOpts({ rot: 90 }));

  // ── Row H1: group headers ──
  // "Отметки о явках и неявках на работу по числам месяца" colSpan=dayColCount
  mergeSet(ws, ROW_H1, CD_START, ROW_H1, CD_END,
    'Отметки о явках и неявках на работу по числам месяца', hdrOpts());
  // "Отработано за" colSpan=2
  mergeSet(ws, ROW_H1, C_HALF, ROW_H1, C_MONTH, 'Отработано за', hdrOpts());
  // "Данные для начисления заработной платы по видам и направлениям затрат" colSpan=6
  mergeSet(ws, ROW_H1, C_KOD1, ROW_H1, C_HRS2,
    'Данные для начисления заработной платы по видам и направлениям затрат', hdrOpts());
  // "Неявки по причинам" colSpan=4
  mergeSet(ws, ROW_H1, C_AK1, ROW_H1, C_ADH2, 'Неявки по причинам', hdrOpts());

  // ── Row H2: first half day numbers + rowSpan=2 section headers ──
  firstHalf.forEach((day, i) => {
    setCell(ws, ROW_H2, CD_START + i, day, hdrOpts());
  });
  if (showX) {
    setCell(ws, ROW_H2, CD_START + halfSize, 'Х', hdrOpts());
  }
  // "половину месяца\n(I, II)" rowSpan=2
  mergeSet(ws, ROW_H2, C_HALF, ROW_H3, C_HALF,
    'половину\nмесяца\n(I, II)', hdrOpts());
  // "месяц" rowSpan=2
  mergeSet(ws, ROW_H2, C_MONTH, ROW_H3, C_MONTH, 'месяц', hdrOpts());
  // Pay cols — 6 cells, all rowSpan=2
  mergeSet(ws, ROW_H2, C_KOD1, ROW_H3, C_KOD1, 'Код вида\nоплаты', hdrOpts());
  mergeSet(ws, ROW_H2, C_KOR1, ROW_H3, C_KOR1, 'Корр. счёт',        hdrOpts({ rot: 90 }));
  mergeSet(ws, ROW_H2, C_HRS1, ROW_H3, C_HRS1, 'Часы',              hdrOpts());
  mergeSet(ws, ROW_H2, C_KOD2, ROW_H3, C_KOD2, 'Код вида\nоплаты', hdrOpts());
  mergeSet(ws, ROW_H2, C_KOR2, ROW_H3, C_KOR2, 'Корр. счёт',        hdrOpts({ rot: 90 }));
  mergeSet(ws, ROW_H2, C_HRS2, ROW_H3, C_HRS2, 'Часы',              hdrOpts());
  // Absence cols — 4 cells, all rowSpan=2
  mergeSet(ws, ROW_H2, C_AK1,  ROW_H3, C_AK1,  'Код',          hdrOpts());
  mergeSet(ws, ROW_H2, C_ADH1, ROW_H3, C_ADH1, 'Дни\n(часы)', hdrOpts());
  mergeSet(ws, ROW_H2, C_AK2,  ROW_H3, C_AK2,  'Код',          hdrOpts());
  mergeSet(ws, ROW_H2, C_ADH2, ROW_H3, C_ADH2, 'Дни\n(часы)', hdrOpts());

  // ── Row H3: second half day numbers ──
  secondHalf.forEach((day, i) => {
    setCell(ws, ROW_H3, CD_START + i, day, hdrOpts());
  });

  // ── Row column-numbers (4th header row) ──
  // Mirrors: 1, 2, 3, 4(colSpan=dayColCount), 5, 6, 7, 8, 9, 7, 8, 9, 10, 11, 12, 13
  const cnOpts = { font: fnt(8, true), fill: grayFill, align: { horizontal: 'center', vertical: 'middle' }, border: allThin };
  setCell(ws, ROW_HN, C1, '1', cnOpts);
  setCell(ws, ROW_HN, C2, '2', cnOpts);
  setCell(ws, ROW_HN, C3, '3', cnOpts);
  mergeSet(ws, ROW_HN, CD_START, ROW_HN, CD_END, '4', cnOpts);
  setCell(ws, ROW_HN, C_HALF,  '5',  cnOpts);
  setCell(ws, ROW_HN, C_MONTH, '6',  cnOpts);
  setCell(ws, ROW_HN, C_KOD1,  '7',  cnOpts);
  setCell(ws, ROW_HN, C_KOR1,  '8',  cnOpts);
  setCell(ws, ROW_HN, C_HRS1,  '9',  cnOpts);
  setCell(ws, ROW_HN, C_KOD2,  '7',  cnOpts); // intentional repeat per form
  setCell(ws, ROW_HN, C_KOR2,  '8',  cnOpts);
  setCell(ws, ROW_HN, C_HRS2,  '9',  cnOpts);
  setCell(ws, ROW_HN, C_AK1,   '10', cnOpts);
  setCell(ws, ROW_HN, C_ADH1,  '11', cnOpts);
  setCell(ws, ROW_HN, C_AK2,   '12', cnOpts);
  setCell(ws, ROW_HN, C_ADH2,  '13', cnOpts);

  R += 4; // advance past 4 header rows

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 3: Data rows — 4 rows per doctor (A, B, C, D)
  // ════════════════════════════════════════════════════════════════════════════
  const bodyOpts = { font: fnt(9), align: { horizontal: 'center', vertical: 'middle' }, border: allThin };
  const bodyLeft = { font: fnt(9), align: { horizontal: 'left', vertical: 'middle', wrapText: true }, border: allThin };

  doctors.forEach((doc, idx) => {
    const entries = doc.entries || {};
    const payData = doc.payData || {};

    const rowA = R;
    const rowB = R + 1;
    const rowC = R + 2;
    const rowD = R + 3;

    [rowA, rowB, rowC, rowD].forEach(rr => { ws.getRow(rr).height = 13; });

    // ── Fixed cols 1–3: rowSpan=4 ──
    mergeSet(ws, rowA, C1, rowD, C1, idx + 1,                 bodyOpts);
    const docRole = resolveRole(doc);
    const docDisplayName = abbreviateName(doc.doctorName || doc.misUserId)
      + (docRole ? `\n${docRole}` : '')
      + (doc.categoryLabel ? `\n${doc.categoryLabel}` : '');
    mergeSet(ws, rowA, C2, rowD, C2, docDisplayName, bodyLeft);
    mergeSet(ws, rowA, C3, rowD, C3, doc.tabelNumber || '',    bodyOpts);

    // ── Totals ──
    const get = (day) => entries[day] || { code: '', hours: '' };
    const daysI   = firstHalf.filter(d => WORKING_CODES.has(get(d).code)).length;
    const hoursI  = firstHalf.reduce((s, d) => s + (parseFloat(get(d).hours) || 0), 0);
    const daysII  = secondHalf.filter(d => WORKING_CODES.has(get(d).code)).length;
    const hoursII = secondHalf.reduce((s, d) => s + (parseFloat(get(d).hours) || 0), 0);
    const totalDays  = daysI  + daysII;
    const totalHours = hoursI + hoursII;

    // ── Row A: codes for first half ──
    firstHalf.forEach((day, i) => {
      setCell(ws, rowA, CD_START + i, get(day).code || '', bodyOpts);
    });
    if (showX) setCell(ws, rowA, CD_START + halfSize, 'Х', bodyOpts);
    // daysI
    setCell(ws, rowA, C_HALF, daysI || '', bodyOpts);
    // totalDays — rowSpan A+B
    mergeSet(ws, rowA, C_MONTH, rowB, C_MONTH, totalDays || '', bodyOpts);

    // ── Row B: hours for first half ──
    firstHalf.forEach((day, i) => {
      const h = get(day).hours;
      setCell(ws, rowB, CD_START + i, h !== '' ? (parseFloat(h) || '') : '', bodyOpts);
    });
    if (showX) setCell(ws, rowB, CD_START + halfSize, 'Х', bodyOpts);
    // hoursI
    setCell(ws, rowB, C_HALF, hoursI || '', bodyOpts);
    // C_MONTH merged above

    // ── Row C: codes for second half ──
    secondHalf.forEach((day, i) => {
      setCell(ws, rowC, CD_START + i, get(day).code || '', bodyOpts);
    });
    // daysII
    setCell(ws, rowC, C_HALF, daysII || '', bodyOpts);
    // totalHours — rowSpan C+D
    mergeSet(ws, rowC, C_MONTH, rowD, C_MONTH, totalHours || '', bodyOpts);

    // ── Row D: hours for second half ──
    secondHalf.forEach((day, i) => {
      const h = get(day).hours;
      setCell(ws, rowD, CD_START + i, h !== '' ? (parseFloat(h) || '') : '', bodyOpts);
    });
    // hoursII
    setCell(ws, rowD, C_HALF, hoursII || '', bodyOpts);
    // C_MONTH merged above

    // ── Pay data cols (payData[row][col], rows 0-3, cols 0-9) ──
    // Mapping: col 0→C_KOD1, 1→C_KOR1, 2→C_HRS1, 3→C_KOD2, 4→C_KOR2, 5→C_HRS2,
    //          6→C_AK1, 7→C_ADH1, 8→C_AK2, 9→C_ADH2
    const PAY_COL_MAP = [C_KOD1, C_KOR1, C_HRS1, C_KOD2, C_KOR2, C_HRS2, C_AK1, C_ADH1, C_AK2, C_ADH2];
    const DATA_ROWS   = [rowA, rowB, rowC, rowD];
    DATA_ROWS.forEach((rr, ri) => {
      PAY_COL_MAP.forEach((colIdx, ci) => {
        setCell(ws, rr, colIdx, payData[`${ri}_${ci}`] || '', bodyOpts);
      });
    });

    R += 4;
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 4: Signature block
  // Mirrors SigBlock: 3 signature rows
  // Each row: role | "должность" (underline) | "подпись" (underline) | "расшифровка подписи" (underline)
  // ════════════════════════════════════════════════════════════════════════════
  const SIG_ROLES = [
    'Ответственное лицо',
    'Руководитель структурного подразделения',
    'Работник кадровой службы',
  ];

  R++; // spacer row

  // Signature section: role | gap | должность | gap | подпись | gap | расшифровка
  // Each gap = 1 empty column with no border, separating the underlined strips visually.
  const sigW1  = Math.round(TOTAL_COLS * 0.35);  // role ends here
  const sigG1  = sigW1 + 1;                        // gap col
  const sigD1  = sigW1 + 2;                        // должность starts
  const sigD2  = Math.round(TOTAL_COLS * 0.57);   // должность ends
  const sigG2  = sigD2 + 1;                        // gap col
  const sigS1  = sigD2 + 2;                        // подпись starts
  const sigS2  = Math.round(TOTAL_COLS * 0.71);   // подпись ends
  const sigG3  = sigS2 + 1;                        // gap col
  const sigR1  = sigS2 + 2;                        // расшифровка starts

  const noBorder = { border: false };
  const underline = { font: fnt(9), align: { horizontal: 'center', vertical: 'bottom' }, border: { bottom: thin } };
  const labelOpt  = { font: fnt(8, false, true), align: { horizontal: 'center', vertical: 'top' }, border: false };

  SIG_ROLES.forEach((role, ri) => {
    const rowSigVal = R;
    const rowSigLbl = R + 1;

    ws.getRow(rowSigVal).height = 20;
    ws.getRow(rowSigLbl).height = 11;

    // Role title
    mergeSet(ws, rowSigVal, 1,     rowSigVal, sigW1, role,
      { font: fnt(10, true), align: { horizontal: 'left', vertical: 'bottom' }, border: false });
    mergeSet(ws, rowSigLbl, 1,     rowSigLbl, sigW1, '',
      { font: fnt(8), align: { horizontal: 'left', vertical: 'top' }, border: false });

    // Gap 1
    setCell(ws, rowSigVal, sigG1, null, noBorder);
    setCell(ws, rowSigLbl, sigG1, null, noBorder);

    // "должность"
    mergeSet(ws, rowSigVal, sigD1, rowSigVal, sigD2, '', underline);
    mergeSet(ws, rowSigLbl, sigD1, rowSigLbl, sigD2, '(должность)', labelOpt);

    // Gap 2
    setCell(ws, rowSigVal, sigG2, null, noBorder);
    setCell(ws, rowSigLbl, sigG2, null, noBorder);

    // "подпись"
    mergeSet(ws, rowSigVal, sigS1, rowSigVal, sigS2, '', underline);
    mergeSet(ws, rowSigLbl, sigS1, rowSigLbl, sigS2, '(подпись)', labelOpt);

    // Gap 3
    setCell(ws, rowSigVal, sigG3, null, noBorder);
    setCell(ws, rowSigLbl, sigG3, null, noBorder);

    // "расшифровка подписи"
    mergeSet(ws, rowSigVal, sigR1, rowSigVal, TOTAL_COLS, record.userName || '', underline);
    mergeSet(ws, rowSigLbl, sigR1, rowSigLbl, TOTAL_COLS, '(расшифровка подписи)', labelOpt);

    R += 2;
    if (ri < SIG_ROLES.length - 1) {
      ws.getRow(R).height = 12; // visible gap between signature blocks
      R++;
    }
  });

  // Freeze panes: freeze first 3 columns and header rows
  ws.views = [{
    state: 'frozen',
    xSplit: 3,
    ySplit: ROW_HN,
    activeCell: addr(ROW_HN + 1, CD_START),
  }];

  return wb;
}

/**
 * Trigger browser download of the Excel workbook.
 */
export async function downloadTabelExcel(record, doctorsFilter, filename) {
  const wb  = await buildTabelWorkbook(record, doctorsFilter);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename || `Табель_${record.year}_${pad2(record.month)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
