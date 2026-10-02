import { buildReport, clearExecCache } from './reportEngine';
import { executorSettings } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  referralBonuses: {}, hourNorms: {}, roleNorms: {}, categoryNorms: {}, rbScheduleDicts: {},
  executorSettings: { get: jest.fn() },
}));

// Счёт из спорного случая: две области КТ и одна строка болюсного контрастирования.
// По договору это два исследования с контрастом по 550, то есть 500 + 500 + 2 × 50.
const colMap = {
  executor: 'ФИО исполнителя', anesthesiologist: 'Анестезиолог', serviceCode: 'Код услуги',
  serviceName: 'Услуга', totalCost: 'Итоговая стоимость', clinic: 'Клиника счета',
  invoiceNum: '№ счета', date: 'Дата',
};
const row = (invoice, code, cost) => ({
  'ФИО исполнителя': 'Рентгенов Иван Иванович', 'Анестезиолог': 'Лаборантова Анна Петровна',
  'Код услуги': code, 'Услуга': code, 'Итоговая стоимость': String(cost),
  'Клиника счета': 'Альфа', '№ счета': invoice, 'Дата': '10.09.2026',
});
const rows = [
  row('1001', 'КТ01-011', 6000),
  row('1001', 'КТ05-003', 3000),
  row('1001', 'КТ01-001', 5000),
  // Второй счёт: одна область, контраст не заведён — 500 без доплаты
  row('1002', 'КТ01-001', 5000),
];

function anestSettings(perInvoice) {
  const svc = (serviceCode, value) => ({ serviceCode, value, valueType: 'rub' });
  return {
    clinicSettings: { global: { payType: 'percent', executorPercent: 0 } },
    roleServices: { anesthesiologist: { '2': [
      svc('КТ01-011', 500), svc('КТ01-001', 500),
      { ...svc('КТ05-003', 50), ...(perInvoice ? { perInvoice: true } : {}) },
    ] } },
  };
}

async function anestIncome(perInvoice) {
  clearExecCache();
  executorSettings.get.mockResolvedValue({ data: { clinicSettings: { global: { payType: 'percent' } } } });
  const report = await buildReport({
    rows, colMap,
    doctor: { id: '7', name: 'Лаборантова Анна Петровна', clinics: ['2'] },
    referralBonuses: [], performedDbBonuses: [],
    execSettings: anestSettings(perInvoice),
    dateFrom: '2026-09-01', dateTo: '2026-09-30',
    allDoctors: [{ id: '5', name: 'Рентгенов Иван Иванович' }],
  });
  const sections = report.clinicReports.flatMap(c => c.salary?.anesthesiologistIncomeSections || []);
  const services = sections.flatMap(s => s.services);
  return {
    total: sections.reduce((s, x) => s + x.total, 0),
    contrast: services.find(s => s.code === 'КТ05-003'),
  };
}

test('без признака контраст оплачивается один раз', async () => {
  const { total, contrast } = await anestIncome(false);
  expect(total).toBe(500 * 3 + 50);
  expect(contrast.count).toBe(1);
});

test('с признаком контраст оплачивается за каждую другую услугу счёта', async () => {
  const { total, contrast } = await anestIncome(true);
  expect(total).toBe(500 * 3 + 50 * 2);
  expect(contrast.count).toBe(2);
  expect(contrast.income).toBe(100);
});

test('исполнитель с процентом отдаёт анестезиологу ровно умноженную сумму', async () => {
  clearExecCache();
  executorSettings.get.mockResolvedValue({ data: anestSettings(true) });
  const report = await buildReport({
    rows, colMap,
    doctor: { id: '5', name: 'Рентгенов Иван Иванович', clinics: ['2'] },
    referralBonuses: [],
    performedDbBonuses: [{ serviceCode: 'КТ05-003', clinicId: '', cabinetId: '', bonusPercent: 10 }],
    execSettings: { clinicSettings: { global: { payType: 'percent', plusPercent: true } } },
    dateFrom: '2026-09-01', dateTo: '2026-09-30',
    allDoctors: [{ id: '7', name: 'Лаборантова Анна Петровна' }],
  });
  const paid = report.clinicReports.flatMap(c => c.salary?.anesthesiologistSections || [])
    .flatMap(s => s.services).find(s => s.code === 'КТ05-003');
  expect(paid.income).toBe(100);
  expect(paid.count).toBe(2);
});
