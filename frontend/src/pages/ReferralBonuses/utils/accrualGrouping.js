const AUP_CLINIC_ID = 'aup';

const SUM_FIELDS = [
  'basePay', 'holidaySurchargeTotal', 'referralBonuses', 'performedBonusTotal',
  'extrasTotal', 'deductionsTotal', 'finalDeductionsTotal', 'materialsTotal',
  'finalMaterialsTotal', 'svcMatFinalTotal', 'turnoverDeductionsTotal',
  'turnoverMaterialsTotal', 'performedServicesSum', 'deductionPerService',
  'totalServiceCount', 'referralCostTotal', 'assistancePaidTotal',
  'assistanceIncomeTotal', 'anesthesiologistPaidTotal',
  'anesthesiologistIncomeTotal', 'nursePaidTotal', 'nurseIncomeTotal',
  'finalSalary', 'advance', 'mainPayment', 'ndflTotal', 'normPremiumAmount',
  'proratedOvertimeAmount', 'harmfulnessDeduction',
];

const CONCAT_FIELDS = [
  'referralSections', 'performedSections', 'basePerformedSections',
  'executorSections', 'assistanceSections', 'assistanceIncomeSections',
  'anesthesiologistSections', 'anesthesiologistIncomeSections',
  'nurseSections', 'nurseIncomeSections', 'svcMatBreakdown',
  'svcMatTurnoverBreakdown', 'holidaySurchargeBreakdown',
  'hourlyRatesBreakdown', 'normPremiumByRole',
];

function number(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentTotal(salary = {}) {
  return number(salary.advance)
    + number(salary.mainPayment)
    + number(salary.normPremiumAmount)
    + (salary.extraPayments || []).reduce((sum, item) => sum + number(item?.amount), 0);
}

function sourceSummary(report) {
  const salary = report.salary || {};
  const deductions = number(salary.finalDeductionsTotal)
    + number(salary.finalMaterialsTotal)
    + number(salary.svcMatFinalTotal);
  const ndfl = number(salary.ndflTotal);
  const accrued = number(salary.finalSalary) + deductions;
  const paid = paymentTotal(salary);
  return {
    clinicId: String(report.clinicId),
    clinicLabel: report.clinicLabel,
    clinicColor: report.clinicColor,
    accrued,
    withheld: deductions + ndfl,
    paid,
    remainder: number(salary.finalSalary) - ndfl - paid,
  };
}

function commonMethod(reports, field) {
  const values = [...new Set(reports.map(report => report.salary?.[field]).filter(Boolean))];
  return values.length === 1 ? values[0] : (values.length > 1 ? 'mixed' : 'card');
}

function combineSalaries(reports) {
  const salaries = reports.map(report => report.salary || {});
  const combined = {
    ...salaries[0],
    payType: 'combined',
    basePayLabel: 'Начисления по медцентрам',
    hasClinicSettings: true,
    paymentMethod: commonMethod(reports, 'paymentMethod'),
    mainPaymentMethod: commonMethod(reports, 'mainPaymentMethod'),
    sourceClinicSummaries: reports.map(sourceSummary),
    extraPayments: reports.flatMap(report => (report.salary?.extraPayments || []).map(item => ({
      ...item,
      sourceClinicId: String(report.clinicId),
      sourceClinicLabel: report.clinicLabel,
    }))),
    // Процентные удержания каждой клиники уже рассчитаны от своей базы. Сырые правила
    // нельзя повторно применять к общей сумме — в объединённом листке показываем их
    // верный денежный итог и разбивку по клиникам.
    deductions: [],
    materials: [],
    extras: [],
    serviceMaterials: [],
    normServices: [],
  };

  SUM_FIELDS.forEach(field => {
    combined[field] = salaries.reduce((sum, salary) => sum + number(salary[field]), 0);
  });
  CONCAT_FIELDS.forEach(field => {
    combined[field] = salaries.flatMap(salary => Array.isArray(salary[field]) ? salary[field] : []);
  });

  return combined;
}

/**
 * Перекладывает уже рассчитанные клиники в центры начисления. Формулы остаются
 * независимыми; объединяются только готовые денежные результаты. Отключённые
 * «глазиком» клиники сюда не попадают — их раньше отсекает reportEngine.
 */
export function groupClinicReportsByAccrual(
  clinicReports,
  execSettings,
  validClinicIds,
  { getClinicName, getClinicColor }
) {
  const validTargets = new Set(Array.from(validClinicIds || []).map(String).filter(id => id !== AUP_CLINIC_ID));
  const groups = new Map();

  (clinicReports || []).forEach(report => {
    const sourceId = String(report.clinicId);
    const requested = execSettings?.clinicSettings?.[sourceId]?.accrualClinicId;
    // АУП нельзя объединять с обычной клиникой: иначе секретная сумма окажется внутри
    // несекретного clinicReport и серверный фильтр уже не сможет её вырезать.
    const targetId = sourceId === AUP_CLINIC_ID
      ? sourceId
      : (requested != null && validTargets.has(String(requested)) ? String(requested) : sourceId);
    if (!groups.has(targetId)) groups.set(targetId, []);
    groups.get(targetId).push(report);
  });

  return [...groups.entries()].map(([targetId, reports]) => {
    const unchanged = reports.length === 1 && String(reports[0].clinicId) === targetId;
    if (unchanged) return reports[0];

    const targetSettings = execSettings?.clinicSettings?.[targetId] || {};
    const targetReport = reports.find(report => String(report.clinicId) === targetId);
    const salary = reports.length === 1
      ? { ...reports[0].salary, sourceClinicSummaries: reports.map(sourceSummary) }
      : combineSalaries(reports);

    return {
      clinicId: targetId,
      clinicLabel: getClinicName(targetId),
      clinicColor: getClinicColor(targetId),
      pdfSubdivision: targetReport?.pdfSubdivision || targetSettings.pdfSubdivision || null,
      sourceClinics: reports.map(report => ({
        clinicId: String(report.clinicId),
        clinicLabel: report.clinicLabel,
        clinicColor: report.clinicColor,
      })),
      referralSections: reports.flatMap(report => report.referralSections || []),
      executorSections: reports.flatMap(report => report.executorSections || []),
      performedSections: reports.flatMap(report => report.performedSections || []),
      salary,
    };
  });
}
