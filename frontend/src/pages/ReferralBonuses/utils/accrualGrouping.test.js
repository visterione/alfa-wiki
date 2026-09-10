import { groupClinicReportsByAccrual } from './accrualGrouping';
import { buildSingleWorkbook } from './reportExport';

const clinicNames = { 2: 'Альфа', 3: '3К', 4: 'Сукко', aup: 'АУП' };
const options = {
  getClinicName: id => clinicNames[id] || id,
  getClinicColor: id => `color-${id}`,
};

function report(clinicId, finalSalary, extra = {}) {
  return {
    clinicId: String(clinicId),
    clinicLabel: clinicNames[clinicId],
    clinicColor: `source-${clinicId}`,
    salary: {
      finalSalary,
      finalDeductionsTotal: extra.deductions || 0,
      finalMaterialsTotal: extra.materials || 0,
      svcMatFinalTotal: 0,
      ndflTotal: extra.ndfl || 0,
      advance: extra.advance || 0,
      mainPayment: extra.mainPayment || 0,
      normPremiumAmount: 0,
      extraPayments: [],
      paymentMethod: extra.paymentMethod || 'card',
      mainPaymentMethod: extra.paymentMethod || 'card',
      referralSections: [],
      performedSections: [],
    },
  };
}

test('оставляет обычные отчёты раздельными без привязки', () => {
  const source = [report('2', 100), report('3', 200)];
  const result = groupClinicReportsByAccrual(source, {}, new Set(['2', '3']), options);

  expect(result).toEqual(source);
});

test('объединяет готовые расчёты в выбранный центр начисления', () => {
  const source = [
    report('2', 100, { deductions: 10, ndfl: 5, advance: 20, paymentMethod: 'card' }),
    report('3', 200, { materials: 15, ndfl: 10, mainPayment: 30, paymentMethod: 'cash' }),
    report('4', 300),
  ];
  const settings = { clinicSettings: {
    2: { accrualClinicId: '2' },
    3: { accrualClinicId: '2' },
    4: { accrualClinicId: '2' },
  } };

  const [result] = groupClinicReportsByAccrual(source, settings, ['2', '3', '4'], options);

  expect(result.clinicId).toBe('2');
  expect(result.clinicLabel).toBe('Альфа');
  expect(result.sourceClinics.map(item => item.clinicId)).toEqual(['2', '3', '4']);
  expect(result.salary.finalSalary).toBe(600);
  expect(result.salary.finalDeductionsTotal).toBe(10);
  expect(result.salary.finalMaterialsTotal).toBe(15);
  expect(result.salary.paymentMethod).toBe('mixed');
  expect(result.salary.sourceClinicSummaries).toEqual([
    expect.objectContaining({ clinicId: '2', accrued: 110, withheld: 15, paid: 20, remainder: 75 }),
    expect.objectContaining({ clinicId: '3', accrued: 215, withheld: 25, paid: 30, remainder: 160 }),
    expect.objectContaining({ clinicId: '4', accrued: 300, withheld: 0, paid: 0, remainder: 300 }),
  ]);
});

test('экспорт создаёт один альфовский лист с разбивкой источников', () => {
  const source = [report('2', 100), report('3', 200), report('4', 300)];
  const settings = { clinicSettings: {
    2: { accrualClinicId: '2' },
    3: { accrualClinicId: '2' },
    4: { accrualClinicId: '2' },
  } };
  const grouped = groupClinicReportsByAccrual(source, settings, ['2', '3', '4'], options);

  const workbook = buildSingleWorkbook({ doctor: { name: 'Тестовый Сотрудник' }, clinicReports: grouped });
  const sheet = workbook.worksheets[0];
  const cellValues = [];
  sheet.eachRow(row => row.eachCell(cell => cellValues.push(String(cell.value || ''))));

  expect(workbook.worksheets).toHaveLength(1);
  expect(sheet.name).toBe('Альфа');
  expect(cellValues).toEqual(expect.arrayContaining(['Состав начисления', '3К', 'Сукко']));
});

test('не возвращает в сумму клинику, которую глазик отсеял до группировки', () => {
  const enabledReports = [report('2', 100), report('4', 300)];
  const settings = { clinicSettings: {
    2: { accrualClinicId: '2' },
    3: { accrualClinicId: '2' },
    4: { accrualClinicId: '2' },
  } };

  const [result] = groupClinicReportsByAccrual(enabledReports, settings, ['2', '3', '4'], options);

  expect(result.salary.finalSalary).toBe(400);
  expect(result.sourceClinics.map(item => item.clinicId)).toEqual(['2', '4']);
});

test('не направляет обычную клинику в АУП и не смешивает сам АУП', () => {
  const source = [report('2', 100), report('aup', 900)];
  const settings = { clinicSettings: {
    2: { accrualClinicId: 'aup' },
    aup: { accrualClinicId: '2' },
  } };

  const result = groupClinicReportsByAccrual(source, settings, ['2', 'aup'], options);

  expect(result).toHaveLength(2);
  expect(result.map(item => item.clinicId)).toEqual(['2', 'aup']);
  expect(result[0].salary.finalSalary).toBe(100);
  expect(result[1].salary.finalSalary).toBe(900);
});
