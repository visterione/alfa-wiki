import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

const MONTHS_UPPER = ['ЯНВАРЬ','ФЕВРАЛЬ','МАРТ','АПРЕЛЬ','МАЙ','ИЮНЬ','ИЮЛЬ','АВГУСТ','СЕНТЯБРЬ','ОКТЯБРЬ','НОЯБРЬ','ДЕКАБРЬ'];
const MONTHS_TITLE = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

// ── Clinic ID → юридическое лицо ──────────────────────────────────────────────
// 2=Альфа, 3=Кидс/Kids, 6=Линия → АЛЬФА ПРЕСТИЖ ООО
// 1=Проф                         → АЛЬФА ПРОФ ООО
// 4=3К, 7=Смайл                  → ЛАБ ГРУПП ООО
function getOrgName(clinicId) {
  const id = String(clinicId);
  if (['2', '3', '6'].includes(id)) return 'АЛЬФА ПРЕСТИЖ ООО';
  if (id === '1')                   return 'АЛЬФА ПРОФ ООО';
  if (['4', '7'].includes(id))      return 'ЛАБ ГРУПП ООО';
  return '';
}

function fmt2(n) {
  return (parseFloat(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodTitleUpper(dateFrom) {
  if (!dateFrom) return '';
  const d = new Date(dateFrom + 'T00:00:00');
  return `${MONTHS_UPPER[d.getMonth()]} ${d.getFullYear()}`;
}

function periodCellText(dateFrom) {
  if (!dateFrom) return '';
  const d = new Date(dateFrom + 'T00:00:00');
  return `${MONTHS_TITLE[d.getMonth()]} ${d.getFullYear()}`;
}

function getDoctorRoles(doctor) {
  if (Array.isArray(doctor.roles) && doctor.roles.length)
    return doctor.roles.join(', ');
  if (doctor.role_titles)
    return String(doctor.role_titles).split(',').map(s => s.trim()).filter(Boolean).join(', ');
  if (Array.isArray(doctor.role_names) && doctor.role_names.length)
    return doctor.role_names.join(', ');
  if (Array.isArray(doctor.professions) && doctor.professions.length)
    return doctor.professions.map(p => typeof p === 'object' ? (p.title || '') : String(p || '')).filter(Boolean).join(', ');
  if (doctor.role) return String(doctor.role);
  return '';
}

function getTariffText(salary) {
  const pt = salary.payType || 'salary';
  if (pt === 'hourly' && salary.hourlyRate)
    return `${fmt2(salary.hourlyRate)} ₽/ч`;
  if (pt === 'salary' && salary.basePay)
    return `${fmt2(salary.basePay)} ₽`;
  if (pt === 'normed' && salary.fixedSalary)
    return `${fmt2(salary.fixedSalary)} ₽`;
  return '';
}

// ── Левая сторона: начисления ──────────────────────────────────────────────────
function buildLeftRows(salary, periodCell) {
  const rows = [];
  const pt           = salary.payType || 'salary';
  const breakdown    = salary.hourlyRatesBreakdown || [];
  const premiumByRole = salary.normPremiumByRole  || [];

  const rawHours =
    pt === 'hourly' ? (parseFloat(salary.hoursWorked)    || 0) :
    pt === 'normed' ? (parseFloat(salary.normTotalHours) || 0) : 0;
  const rawDays  = parseFloat(salary.daysWorked) || 0;
  const hoursStr = rawHours > 0 ? String(parseFloat(rawHours.toFixed(1))) : '';
  const daysStr  = rawDays  > 0 ? String(rawDays) : '';

  if (pt === 'hourly' && breakdown.length > 0) {
    const premiumShown = new Set();
    let firstEntry = true;
    for (const entry of breakdown) {
      if ((entry.hours || 0) <= 0) continue;
      const eLabel   = entry.label || 'Без указания';
      const eHours   = String(parseFloat((entry.hours).toFixed(1)));
      const premEntry = premiumByRole.find(p => (p.roleTitle || p.label || '') === eLabel);
      const premAmt   = premEntry ? (parseFloat(premEntry.premiumAmount) || 0) : 0;
      const baseAmt   = Math.max(0, (parseFloat(entry.pay) || 0) - premAmt);

      rows.push({ label: eLabel, period: '', days: '', hours: '', paid: '', sum: null, isHeader: true });
      // show total days on the first entry row only (no per-category day breakdown available)
      rows.push({ label: 'Оплата по часовому тарифу', period: periodCell, days: firstEntry ? daysStr : '', hours: eHours, paid: eHours, sum: baseAmt || (parseFloat(entry.pay) || 0) });
      firstEntry = false;
      if (premAmt > 0) {
        const overHours = premEntry?.premiumHours != null
          ? premEntry.premiumHours
          : Math.max(0, (premEntry?.workedHours || 0) - 2 * (premEntry?.norm || 0));
        const overStr = overHours > 0 ? String(parseFloat(overHours.toFixed(1))) : '';
        rows.push({ label: 'Премия', period: periodCell, days: '', hours: overStr, paid: overStr, sum: premAmt });
        if (premEntry) premiumShown.add(premEntry);
      }
    }
    for (const p of premiumByRole) {
      if (!premiumShown.has(p) && (p.premiumAmount || 0) > 0) {
        const overHours = p.premiumHours != null
          ? p.premiumHours
          : Math.max(0, (p.workedHours || 0) - 2 * (p.norm || 0));
        const overStr = overHours > 0 ? String(parseFloat(overHours.toFixed(1))) : '';
        rows.push({ label: 'Премия', period: periodCell, days: '', hours: overStr, paid: overStr, sum: p.premiumAmount });
      }
    }
  } else if (salary.basePay) {
    const premAmt    = parseFloat(salary.normPremiumAmount) || 0;
    const displayBase = premAmt > 0 ? salary.basePay - premAmt : salary.basePay;
    rows.push({ label: salary.basePayLabel || 'Оклад', period: periodCell, days: daysStr, hours: hoursStr, paid: hoursStr, sum: displayBase });
    if (premAmt > 0) {
      const premEntries = salary.normPremiumByRole || [];
      const totalOverHours = premEntries.reduce((s, p) => {
        const oh = p.premiumHours != null ? p.premiumHours : Math.max(0, (p.workedHours || 0) - 2 * (p.norm || 0));
        return s + oh;
      }, 0);
      const overStr = totalOverHours > 0 ? String(parseFloat(totalOverHours.toFixed(1))) : '';
      rows.push({ label: 'Премия', period: periodCell, days: '', hours: overStr, paid: overStr, sum: premAmt });
    }
  }

  if ((salary.harmfulnessDeduction || 0) > 0)
    rows.push({ label: 'Надбавка за вредные условия труда', period: periodCell, days: daysStr, hours: hoursStr, paid: hoursStr, sum: salary.harmfulnessDeduction });

  const holBreakdown = salary.holidaySurchargeBreakdown || [];
  if (holBreakdown.length > 0) {
    for (const hRow of holBreakdown) {
      const hHours = (hRow.hours || 0) > 0 ? String(parseFloat((hRow.hours).toFixed(1))) : '';
      rows.push({ label: `Доплата за работу в праздничные дни${hRow.label ? ` (${hRow.label})` : ''}`, period: periodCell, days: '', hours: hHours, paid: hHours, sum: hRow.amount });
    }
  } else if ((salary.holidaySurchargeTotal || 0) > 0) {
    rows.push({ label: 'Доплата за работу в праздничные дни', period: periodCell, days: '', hours: '', paid: '', sum: salary.holidaySurchargeTotal });
  }

  if ((salary.referralBonuses || 0) > 0)
    rows.push({ label: 'Бонусы за направления', period: periodCell, days: '', hours: '', paid: '', sum: salary.referralBonuses });
  if ((salary.performedBonusTotal || 0) > 0)
    rows.push({ label: 'Выполненные услуги', period: periodCell, days: '', hours: '', paid: '', sum: salary.performedBonusTotal });
  if ((salary.assistanceIncomeTotal || 0) > 0)
    rows.push({ label: 'Доход ассистента', period: periodCell, days: '', hours: '', paid: '', sum: salary.assistanceIncomeTotal });
  if ((salary.anesthesiologistIncomeTotal || 0) > 0)
    rows.push({ label: 'Доход анестезиолога', period: periodCell, days: '', hours: '', paid: '', sum: salary.anesthesiologistIncomeTotal });
  if ((salary.nurseIncomeTotal || 0) > 0)
    rows.push({ label: 'Доход медсестры', period: periodCell, days: '', hours: '', paid: '', sum: salary.nurseIncomeTotal });
  if ((salary.extrasTotal || 0) > 0)
    rows.push({ label: 'Дополнительно', period: periodCell, days: '', hours: '', paid: '', sum: salary.extrasTotal });
  return rows;
}

// ── Правая сторона: удержания + выплаченные ───────────────────────────────────
function buildRightRows(salary, periodCell) {
  const rows = [];

  // ── Взыскания: individual final-deduction items ──
  const harmAmt   = parseFloat(salary.harmfulnessDeduction) || 0;
  const finalDeds = (salary.deductions || []).filter(d => d.deductionType === 'final');
  if (finalDeds.length > 0) {
    // preFinalSalary needed to resolve percent-based deductions
    const preFinalSalary = (parseFloat(salary.finalSalary) || 0)
      + (parseFloat(salary.finalDeductionsTotal) || 0)
      + (parseFloat(salary.materialsTotal) || 0);
    for (const d of finalDeds) {
      const v   = parseFloat(d.value) || 0;
      const rub = d.valueType === 'percent' ? preFinalSalary * v / 100 : v;
      if (rub > 0) rows.push({ label: d.name || 'Взыскание', period: periodCell, sum: rub });
    }
  } else {
    const deductionsAmt = Math.max(0, (parseFloat(salary.finalDeductionsTotal) || 0) - harmAmt);
    if (deductionsAmt > 0)
      rows.push({ label: 'Взыскания', period: periodCell, sum: deductionsAmt });
  }

  if ((salary.materialsTotal || 0) > 0)
    rows.push({ label: 'Расходные материалы', period: periodCell, sum: salary.materialsTotal });
  if ((salary.referralCostTotal || 0) > 0)
    rows.push({ label: 'Бонусы направителям', period: periodCell, sum: salary.referralCostTotal });

  // ── Выплачено: salary payments ──
  const payments = [];
  if ((salary.advance || 0) > 0)
    payments.push({ label: 'За первую половину месяца', period: periodCell, sum: salary.advance, isPayment: true });
  if ((salary.mainPayment || 0) > 0)
    payments.push({ label: 'Зарплата за месяц', period: periodCell, sum: salary.mainPayment, isPayment: true });
  (salary.extraPayments || []).forEach(ep => {
    const amt = parseFloat(ep.amount) || 0;
    if (amt > 0) payments.push({ label: ep.label || 'Доп. выплата', period: periodCell, sum: amt, isPayment: true });
  });
  if (payments.length > 0) {
    const payTotal = payments.reduce((s, r) => s + (parseFloat(r.sum) || 0), 0);
    rows.push({ label: 'Выплачено:', period: '', sum: payTotal, isPayHeader: true });
    rows.push(...payments);
  }

  return rows;
}

// ── Стиль таблицы: равномерная чёрная сетка ──────────────────────────────────
const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#000000',
  vLineColor: () => '#000000',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

// ── Пунктирный разделитель между листками ─────────────────────────────────────
function dashedSeparator() {
  return {
    canvas: [{
      type: 'line',
      x1: 0, y1: 0, x2: 515, y2: 0,
      lineWidth: 0.6,
      dash: { length: 5, space: 4 },
      lineColor: '#AAAAAA',
    }],
    margin: [0, 14, 0, 14],
  };
}

// ── Сборка содержимого одного расчётного листка ───────────────────────────────
function buildPayslipContent({ clinicId, clinicLabel, salary, doctorName, tabelNumber, titlePeriod, periodCell, roleStr }) {
  const TH = (text, opts = {}) => ({ text, style: 'th', alignment: 'center', ...opts });

  const orgName    = getOrgName(clinicId);
  const tariffText = getTariffText(salary);

  const leftRows  = buildLeftRows(salary, periodCell);
  const rightRows = buildRightRows(salary, periodCell);
  const maxLen    = Math.max(leftRows.length, rightRows.length, 1);

  const header1 = [
    TH('Вид',      { rowSpan: 2 }),
    TH('Период',   { rowSpan: 2 }),
    TH('Рабочие',  { colSpan: 2 }), {},
    TH('Оплачено', { rowSpan: 2 }),
    TH('Сумма',    { rowSpan: 2 }),
    TH('Вид',      { rowSpan: 2 }),
    TH('Период',   { rowSpan: 2 }),
    TH('Сумма',    { rowSpan: 2 }),
  ];
  const header2 = [
    {}, {},
    TH('Дни'), TH('Часы'),
    {}, {}, {}, {}, {},
  ];

  const totalLeft       = leftRows.reduce((s, r) => s + (parseFloat(r.sum) || 0), 0);
  const totalDeductions = rightRows.filter(r => !r.isPayHeader && !r.isPayment).reduce((s, r) => s + (parseFloat(r.sum) || 0), 0);

  const summaryRow = [
    { text: 'Начислено:', style: 'tdBold', colSpan: 5 }, {}, {}, {}, {},
    { text: fmt2(totalLeft),       style: 'tdBoldR' },
    { text: 'Удержано:', style: 'tdBold', colSpan: 2 }, {},
    { text: fmt2(totalDeductions), style: 'tdBoldR' },
  ];

  const dataRows = Array.from({ length: maxLen }, (_, i) => {
    const l = leftRows[i]  || { label: '', period: '', days: '', hours: '', paid: '', sum: null };
    const r = rightRows[i] || { label: '', period: '', sum: null };
    const isH  = !!l.isHeader;
    const isPH = !!r.isPayHeader;
    const rightCells = isPH
      ? [{ text: r.label, style: 'tdBold', colSpan: 2 }, {}, { text: fmt2(r.sum || 0), style: 'tdBoldR' }]
      : [{ text: r.label, style: 'td' }, { text: r.period, style: 'tdSm' }, { text: r.sum != null ? fmt2(r.sum) : '', style: 'tdR' }];

    if (isH) {
      return [
        { text: l.label, style: 'tdBold', colSpan: 6 }, {}, {}, {}, {}, {},
        ...rightCells,
      ];
    }
    return [
      { text: l.label,  style: 'td' },
      { text: l.period, style: 'tdSm' },
      { text: l.days,   style: 'tdC' },
      { text: l.hours,  style: 'tdC' },
      { text: l.paid,   style: 'tdC' },
      { text: l.sum == null ? '' : fmt2(l.sum), style: 'tdR' },
      ...rightCells,
    ];
  });


  return [
    // Заголовок: слева, мельче, не жирный
    { text: `РАСЧЕТНЫЙ ЛИСТОК ЗА ${titlePeriod}`, style: 'docTitle', margin: [0, 0, 0, 8] },

    // Инфо-шапка: 2 колонки × 3 строки
    {
      table: {
        widths: ['58%', '42%'],
        body: [
          [
            { text: `${doctorName}${tabelNumber ? ` (${tabelNumber})` : ''}`, style: 'hdrName' },
            { text: `К выплате: ${fmt2(salary.finalSalary || 0)} ₽`, style: 'hdrPay' },
          ],
          [
            { text: orgName ? `Организация: ${orgName}` : 'Организация:', style: 'hdrInfo' },
            { text: roleStr ? `Должность: ${roleStr}` : 'Должность:', style: 'hdrInfo' },
          ],
          [
            { text: `Подразделение: ${clinicLabel}`, style: 'hdrInfo' },
            { text: `Оклад (тариф): ${tariffText}`, style: 'hdrInfo' },
          ],
        ],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    },

    // Таблица начислений/удержаний
    {
      table: {
        headerRows: 2,
        widths: ['*', 52, 22, 25, 32, 52, 80, 48, 52],
        body: [header1, header2, summaryRow, ...dataRows],
      },
      layout: tableLayout,
    },
  ];
}

// ── Общие стили и параметры документа ────────────────────────────────────────
function makeDocDef(content) {
  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 40, 40, 40],
    content,
    styles: {
      docTitle: { fontSize: 11, bold: false, alignment: 'left' },
      hdrName:  { fontSize: 11, bold: true },
      hdrPay:   { fontSize: 12, bold: true },
      hdrInfo:  { fontSize: 10 },
      th:       { fontSize: 8.5, bold: true },
      td:       { fontSize: 9 },
      tdSm:     { fontSize: 8 },
      tdC:      { fontSize: 9, alignment: 'center' },
      tdR:      { fontSize: 9, alignment: 'right' },
      tdBold:   { fontSize: 9, bold: true },
      tdBoldR:  { fontSize: 9, bold: true, alignment: 'right' },
    },
    defaultStyle: { font: 'Roboto' },
  };
}

// ── Экспорт одного отчёта (один врач, возможно несколько клиник) ──────────────
export function exportReportPdf(reportData, tabelNumber = '') {
  const { clinicReports, doctor, dateFrom } = reportData;
  const doctorName  = doctor?.name || '';
  const titlePeriod = periodTitleUpper(dateFrom);
  const periodCell  = periodCellText(dateFrom);
  const roleStr     = getDoctorRoles(doctor);

  const content = [];

  clinicReports.forEach((cr, idx) => {
    if (idx > 0) content.push(dashedSeparator());

    const items = buildPayslipContent({
      ...cr,
      doctorName, tabelNumber, titlePeriod, periodCell, roleStr,
    });
    // Если листок не помещается на текущей странице — перенести целиком
    content.push({ stack: items, unbreakable: true });
  });

  const lastName = doctorName.split(' ')[0] || 'Листок';
  pdfMake.createPdf(makeDocDef(content)).download(
    `Расчётный_листок_${lastName}_${dateFrom || 'б.д.'}.pdf`
  );
}

// ── Сводный экспорт (несколько врачей) ────────────────────────────────────────
// tabelNumbers: { [misUserId]: tabelNumber }
export function exportBulkReportPdf(bulkResults, tabelNumbers = {}) {
  const valid = bulkResults.filter(r => !r.error && r.clinicReports?.length > 0);
  if (!valid.length) return;

  const content = [];
  let first = true;

  valid.forEach(result => {
    const { doctor, clinicReports, dateFrom } = result;
    const doctorName  = doctor?.name || '';
    const tabelNumber = tabelNumbers[doctor.id] || '';
    const titlePeriod = periodTitleUpper(dateFrom);
    const periodCell  = periodCellText(dateFrom);
    const roleStr     = getDoctorRoles(doctor);

    clinicReports.forEach(cr => {
      if (!first) content.push(dashedSeparator());
      first = false;

      const items = buildPayslipContent({
        ...cr,
        doctorName, tabelNumber, titlePeriod, periodCell, roleStr,
      });
      content.push({ stack: items, unbreakable: true });
    });
  });

  const today = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
  pdfMake.createPdf(makeDocDef(content)).download(`Сводный_листок_${today}.pdf`);
}
