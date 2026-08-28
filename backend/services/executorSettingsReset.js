const RESET_COLLECTIONS = [
  ['deductions', 'Удержания'],
  ['materials', 'Материалы'],
  ['serviceMaterials', 'Выполненные услуги'],
  ['extras', 'Дополнительно'],
  ['roleNormOverrides', 'Нормы по ролям'],
  ['extraPayments', 'Дополнительные выплаты'],
];

const RESET_FIELDS = [
  ['advance', 'Аванс', 'lockedAdvance'],
  ['mainPayment', 'Основная ЗП', 'lockedMainPayment'],
  ['fixedSalary', 'Фиксированный оклад', 'lockedFixedSalary'],
  ['hoursWorked', 'Отработанные часы', 'lockedHoursWorked'],
];

function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  const normalized = String(value).trim().replace(',', '.');
  const numeric = Number(normalized);
  return normalized !== '' && (!Number.isFinite(numeric) || numeric !== 0);
}

function itemTitle(item) {
  if (!item || typeof item !== 'object') return String(item || 'Запись');
  const title = item.name || item.title || item.serviceName || item.label || item.description || item.code;
  const value = item.amount ?? item.value ?? item.sum ?? item.price;
  if (title && hasValue(value)) return `${title}: ${value}`;
  return String(title || (hasValue(value) ? value : 'Запись'));
}

// Ставки по ролям сброс не трогает вовсе: суммы там из месяца в месяц одни и те
// же, а после каждого сброса их приходилось заново раскатывать по всем
// подразделениям вручную. Обнуляются только часы — они у каждого периода свои,
// и оставленные с прошлого раза дали бы неверную зарплату.
function roleRateTitle(item) {
  return String(item?.roleTitle || 'Ставка');
}

function getClinicChanges(clinicId, clinicData = {}) {
  const changes = [];

  for (const [key, label] of RESET_COLLECTIONS) {
    const items = (Array.isArray(clinicData[key]) ? clinicData[key] : [])
      .filter(item => item?.locked !== true);
    if (items.length) {
      changes.push({ key, label, count: items.length, items: items.map(itemTitle) });
    }
  }

  const normServices = Array.isArray(clinicData.normServices) ? clinicData.normServices : [];
  const unlockedNorms = normServices.filter(item => item?.locked !== true);
  if (unlockedNorms.length) {
    changes.push({ key: 'normServices', label: 'Нормы услуг', count: unlockedNorms.length, items: unlockedNorms.map(itemTitle) });
  }
  const unlockedRates = normServices.filter(item => item?.locked === true && item.lockedRate !== true && hasValue(item.rate));
  if (unlockedRates.length) {
    changes.push({ key: 'normServiceRates', label: 'Ставки норм', count: unlockedRates.length, items: unlockedRates.map(item => `${itemTitle(item)}: ${item.rate}`) });
  }
  const unlockedHours = normServices.filter(item => item?.locked === true && item.lockedHours !== true && hasValue(item.hours));
  if (unlockedHours.length) {
    changes.push({ key: 'normServiceHours', label: 'Часы норм', count: unlockedHours.length, items: unlockedHours.map(item => `${itemTitle(item)}: ${item.hours}`) });
  }

  const roleRateHours = (Array.isArray(clinicData.roleRates) ? clinicData.roleRates : [])
    .filter(item => hasValue(item?.hoursWorked));
  if (roleRateHours.length) {
    changes.push({
      key: 'roleRateHours',
      label: 'Часы ставок по ролям',
      count: roleRateHours.length,
      items: roleRateHours.map(item => `${roleRateTitle(item)}: ${item.hoursWorked} ч`),
    });
  }

  for (const [key, label, lockKey] of RESET_FIELDS) {
    if (clinicData[lockKey] !== true && hasValue(clinicData[key])) {
      changes.push({ key, label, count: 1, value: clinicData[key] });
    }
  }

  if (String(clinicId) === 'global') {
    const locked = new Set(Array.isArray(clinicData.lockedCabinets) ? clinicData.lockedCabinets : []);
    const cabinets = (Array.isArray(clinicData.cabinets) ? clinicData.cabinets : [])
      .filter(cabinet => !locked.has(cabinet));
    if (cabinets.length) {
      changes.push({ key: 'cabinets', label: 'Кабинеты', count: cabinets.length, items: cabinets.map(String) });
    }
  }

  return changes;
}

function resetClinicData(clinicId, clinicData = {}) {
  const result = { ...clinicData };

  for (const [key] of RESET_COLLECTIONS) {
    if (Array.isArray(clinicData[key])) {
      result[key] = clinicData[key].filter(item => item?.locked === true);
    }
  }

  if (Array.isArray(clinicData.normServices)) {
    result.normServices = clinicData.normServices
      .filter(item => item?.locked === true)
      .map(item => ({
        ...item,
        ...(item.lockedRate === true || !hasValue(item.rate) ? {} : { rate: 0 }),
        ...(item.lockedHours === true || !hasValue(item.hours) ? {} : { hours: 0 }),
      }));
  }

  if (Array.isArray(clinicData.roleRates)) {
    result.roleRates = clinicData.roleRates.map(item => (
      hasValue(item?.hoursWorked) ? { ...item, hoursWorked: 0 } : item
    ));
  }

  for (const [key, , lockKey] of RESET_FIELDS) {
    if (clinicData[lockKey] !== true && hasValue(clinicData[key])) result[key] = 0;
  }

  if (String(clinicId) === 'global' && Array.isArray(clinicData.cabinets)) {
    const locked = new Set(Array.isArray(clinicData.lockedCabinets) ? clinicData.lockedCabinets : []);
    result.cabinets = (Array.isArray(clinicData.cabinets) ? clinicData.cabinets : [])
      .filter(cabinet => locked.has(cabinet));
  }

  return result;
}

/**
 * Настройки сотрудника после сброса по выбранным клиникам. Вынесено из маршрута,
 * чтобы сброс и его тест шли по одному и тому же коду: снимок-бекап проверяется
 * ровно против той логики, которая данные и переписывает.
 */
function resetSettings(settings, clinicIds) {
  const source = settings || {};
  const clinicSettings = source.clinicSettings || {};
  const updated = { ...clinicSettings };

  for (const clinicId of clinicIds) {
    if (Object.prototype.hasOwnProperty.call(clinicSettings, clinicId) && clinicSettings[clinicId]) {
      updated[clinicId] = resetClinicData(clinicId, clinicSettings[clinicId]);
    }
  }

  return { ...source, clinicSettings: updated };
}

function buildResetPreview(records, clinicIds) {
  const selected = new Set((clinicIds || []).map(String));
  const employees = [];

  for (const record of records) {
    const clinicSettings = record.settings?.clinicSettings || {};
    const clinics = [];
    for (const clinicId of selected) {
      if (!Object.prototype.hasOwnProperty.call(clinicSettings, clinicId) || !clinicSettings[clinicId]) continue;
      const changes = getClinicChanges(clinicId, clinicSettings[clinicId]);
      if (changes.length) clinics.push({ clinicId, changes });
    }
    if (clinics.length) {
      employees.push({
        misUserId: String(record.misUserId),
        doctorName: record.doctorName || String(record.misUserId),
        clinics,
      });
    }
  }

  return {
    clinicIds: [...selected],
    employeeCount: employees.length,
    changeCount: employees.reduce((sum, employee) => sum + employee.clinics.reduce(
      (clinicSum, clinic) => clinicSum + clinic.changes.reduce((n, change) => n + change.count, 0), 0
    ), 0),
    employees,
  };
}

module.exports = { buildResetPreview, resetClinicData, resetSettings };
