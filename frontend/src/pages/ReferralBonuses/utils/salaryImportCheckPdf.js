import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

// Столбцы сумм — порядок совпадает с таблицей предпросмотра
export const NUM_FIELDS = [
  { key: 'mainPayment', label: 'Осн. ЗП' },
  { key: 'advance',     label: 'Аванс' },
  { key: 'vacation',    label: 'Отпускные' },
  { key: 'ndfl',        label: 'НДФЛ' },
];

const round2 = (n) => Math.round(n * 100) / 100;

function parseEditVal(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/**
 * Приводит строки предпросмотра к тому виду, в котором они реально запишутся:
 * подставляет введённые вручную значения разделения, добивает пустые поля
 * остатком и обнуляет отключённые столбцы.
 *
 * @param {Array}  matched            строки из pdfPreviewModal.matched
 * @param {Object} splitEditValues    { [индекс в matched]: { mainPayment, ... } }
 * @param {Set}    selectedDoctorIds  null → берём всех
 * @param {Object} enabledCols        null → берём все столбцы
 */
export function resolveImportRows({ matched, splitEditValues = {}, selectedDoctorIds = null, enabledCols = null }) {
  const rows = matched
    .map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => !selectedDoctorIds || selectedDoctorIds.has(entry.doctor.id))
    .map(({ entry, idx }) => {
      if (!entry.needsSplit) return { ...entry };
      const sv = splitEditValues[idx] || {};
      return {
        ...entry,
        mainPayment: parseEditVal(sv.mainPayment),
        advance:     parseEditVal(sv.advance),
        ndfl:        parseEditVal(sv.ndfl),
        vacation:    parseEditVal(sv.vacation),
      };
    });

  // Пустые поля разделения добиваются остатком: (итого − сумма заполненных) / кол-во пустых
  const splitGroups = {};
  rows.forEach((entry, i) => {
    if (!entry.needsSplit) return;
    if (!splitGroups[entry.doctor.id]) splitGroups[entry.doctor.id] = [];
    splitGroups[entry.doctor.id].push(i);
  });
  for (const indices of Object.values(splitGroups)) {
    for (const { key: field } of NUM_FIELDS) {
      const refField = 'ref' + field.charAt(0).toUpperCase() + field.slice(1);
      const refVal = rows[indices[0]][refField];
      if (refVal == null) continue;
      const emptyIdx = indices.filter(i => rows[i][field] == null);
      if (emptyIdx.length === 0) continue;
      const filledSum = indices
        .filter(i => rows[i][field] != null)
        .reduce((s, i) => s + rows[i][field], 0);
      const perEntry = round2(round2(refVal - filledSum) / emptyIdx.length);
      emptyIdx.forEach(i => { rows[i] = { ...rows[i], [field]: perEntry }; });
    }
  }

  if (!enabledCols) return rows;
  return rows.map(entry => {
    const out = { ...entry };
    NUM_FIELDS.forEach(({ key }) => { if (!enabledCols[key]) out[key] = null; });
    return out;
  });
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const fmt2 = (v) => v == null
  ? '—'
  : (parseFloat(v) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#c9ced6',
  vLineColor: () => '#c9ced6',
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 4,
  paddingRight: () => 4,
};

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Проверочная ведомость импорта расчётных листков — для печати и подписи.
 *
 * @param {Array}    matched            pdfPreviewModal.matched
 * @param {Object}   splitEditValues    введённые вручную значения разделения
 * @param {Set}      selectedDoctorIds  выбранные к импорту сотрудники
 * @param {Object}   enabledCols        включённые столбцы сумм
 * @param {Array}    unmatchedNames     ФИО из PDF без совпадения в списке сотрудников
 * @param {Array}    noSubdivision      [{ name, subdivision }] — подразделение 1С не настроено
 * @param {Function} getClinicName      (clinicId) => название клиники
 * @param {string}   fileName           имя исходного PDF
 */
export function exportSalaryImportCheckPdf({
  matched,
  splitEditValues = {},
  selectedDoctorIds = null,
  enabledCols = null,
  unmatchedNames = [],
  noSubdivision = [],
  getClinicName = () => '',
  fileName = '',
}) {
  const rows = resolveImportRows({ matched, splitEditValues, selectedDoctorIds, enabledCols });
  if (!rows.length) return false;

  const cols = NUM_FIELDS.filter(({ key }) => !enabledCols || enabledCols[key]);
  const skipped = NUM_FIELDS.filter(({ key }) => enabledCols && !enabledCols[key]);

  // Индексы строк разделения по сотруднику — чтобы вывести строку «итого» перед группой
  const groupIdx = {};
  rows.forEach((entry, i) => {
    if (!entry.needsSplit) return;
    if (!groupIdx[entry.doctor.id]) groupIdx[entry.doctor.id] = [];
    groupIdx[entry.doctor.id].push(i);
  });

  const body = [];
  body.push([
    { text: '№',              style: 'th' },
    { text: 'Сотрудник',      style: 'th' },
    { text: 'Подразд. (1С)',  style: 'th' },
    { text: 'Клиника',        style: 'th' },
    ...cols.map(c => ({ text: c.label, style: 'thR' })),
    { text: 'Отметка',        style: 'thC' },
  ]);

  const totals = {};
  cols.forEach(c => { totals[c.key] = 0; });
  let rowNo = 0;

  rows.forEach((entry, i) => {
    const { doctor, clinicId, subdivisionResolved, pdfSubdivision, needsSplit } = entry;
    const clinicName = clinicId ? getClinicName(clinicId) : (subdivisionResolved ? 'Общий' : '—');
    const warn = !subdivisionResolved && pdfSubdivision;

    // Строка «итого по сотруднику» перед первой строкой группы разделения
    if (needsSplit && groupIdx[doctor.id][0] === i) {
      body.push([
        { text: '',                                    style: 'td', fillColor: '#eef0f3' },
        { text: `${doctor.name} — итого`,              style: 'tdBold', fillColor: '#eef0f3' },
        { text: pdfSubdivision || '',                  style: 'tdSm', fillColor: '#eef0f3' },
        { text: 'разделено',                           style: 'tdSm', fillColor: '#eef0f3' },
        ...cols.map(c => ({
          text: fmt2(entry['ref' + c.key.charAt(0).toUpperCase() + c.key.slice(1)]),
          style: 'tdBoldR',
          fillColor: '#eef0f3',
        })),
        { text: '', style: 'td', fillColor: '#eef0f3' },
      ]);
    }

    rowNo += 1;
    cols.forEach(c => { totals[c.key] += parseFloat(entry[c.key]) || 0; });

    body.push([
      { text: String(rowNo), style: 'tdC' },
      { text: needsSplit ? `    ↳ ${doctor.name}` : doctor.name, style: 'td' },
      { text: (pdfSubdivision || '—') + (warn ? '  ⚠' : ''), style: warn ? 'tdWarn' : 'tdSm' },
      { text: clinicName, style: 'tdSm' },
      ...cols.map(c => ({ text: fmt2(entry[c.key]), style: 'tdR' })),
      { text: '', style: 'td' },
    ]);
  });

  body.push([
    { text: '', style: 'td' },
    { text: `ИТОГО (${rowNo} стр.)`, style: 'tdBold' },
    { text: '', style: 'td' },
    { text: '', style: 'td' },
    ...cols.map(c => ({ text: fmt2(totals[c.key]), style: 'tdBoldR' })),
    { text: '', style: 'td' },
  ]);

  const doctorCount = new Set(rows.map(r => r.doctor.id)).size;

  const content = [
    { text: 'ПРОВЕРОЧНАЯ ВЕДОМОСТЬ — ИМПОРТ РАСЧЁТНЫХ ЛИСТКОВ', style: 'docTitle' },
    {
      text: [
        fileName ? `Файл: ${fileName}   •   ` : '',
        `Сформировано: ${nowStamp()}`,
      ].join(''),
      style: 'sub',
      margin: [0, 2, 0, 0],
    },
    {
      text: `Сотрудников: ${doctorCount}   •   Строк: ${rowNo}` +
            (unmatchedNames.length ? `   •   Не найдено в списке: ${unmatchedNames.length}` : '') +
            (noSubdivision.length ? `   •   Без подразделения: ${noSubdivision.length}` : '') +
            (skipped.length ? `   •   Не импортируются: ${skipped.map(c => c.label).join(', ')}` : ''),
      style: 'sub',
      margin: [0, 2, 0, 8],
    },
    {
      table: {
        headerRows: 1,
        widths: ['auto', '*', 130, 62, ...cols.map(() => 62), 44],
        body,
      },
      layout: tableLayout,
    },
  ];

  if (unmatchedNames.length) {
    content.push({ text: `Не найдено в списке сотрудников (${unmatchedNames.length}):`, style: 'noteTitle', margin: [0, 10, 0, 2] });
    content.push({ text: unmatchedNames.join(', '), style: 'note' });
  }
  if (noSubdivision.length) {
    content.push({ text: `Подразделение (1С) не настроено (${noSubdivision.length}) — данные пойдут в «Общий» тариф:`, style: 'noteTitle', margin: [0, 8, 0, 2] });
    content.push({ text: noSubdivision.map(r => `${r.name} (${r.subdivision})`).join(', '), style: 'note' });
  }

  content.push({
    margin: [0, 18, 0, 0],
    table: {
      widths: ['*', '*', '*'],
      body: [[
        { text: 'Проверил (ФИО): ______________________', style: 'sign' },
        { text: 'Подпись: ______________', style: 'sign' },
        { text: 'Дата: ____ . ____ . 20___', style: 'sign' },
      ]],
    },
    layout: 'noBorders',
  });

  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 30],
    content,
    footer: (currentPage, pageCount) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: 7,
      color: '#6b7280',
      margin: [0, 8, 0, 0],
    }),
    styles: {
      docTitle:  { fontSize: 12, bold: true },
      sub:       { fontSize: 8, color: '#4b5563' },
      th:        { fontSize: 7.5, bold: true, fillColor: '#e5e7eb' },
      thR:       { fontSize: 7.5, bold: true, fillColor: '#e5e7eb', alignment: 'right' },
      thC:       { fontSize: 7.5, bold: true, fillColor: '#e5e7eb', alignment: 'center' },
      td:        { fontSize: 8 },
      tdSm:      { fontSize: 7, color: '#374151' },
      tdWarn:    { fontSize: 7, color: '#92400e' },
      tdC:       { fontSize: 8, alignment: 'center' },
      tdR:       { fontSize: 8, alignment: 'right' },
      tdBold:    { fontSize: 8, bold: true },
      tdBoldR:   { fontSize: 8, bold: true, alignment: 'right' },
      noteTitle: { fontSize: 8, bold: true, color: '#374151' },
      note:      { fontSize: 7.5, color: '#4b5563' },
      sign:      { fontSize: 9 },
    },
    defaultStyle: { font: 'Roboto' },
  };

  const today = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
  pdfMake.createPdf(docDef).download(`Проверочная_ведомость_${today}.pdf`);
  return true;
}
