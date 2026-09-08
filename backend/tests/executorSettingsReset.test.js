const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResetPreview, resetClinicData } = require('../services/executorSettingsReset');

test('preview contains only real unlocked values from selected clinics', () => {
  const records = [{
    misUserId: 17,
    doctorName: 'Иванов И.И.',
    settings: {
      clinicSettings: {
        2: {
          mainPayment: 50000,
          advance: 10000,
          lockedAdvance: true,
          deductions: [
            { name: 'НДФЛ', amount: 6500 },
            { name: 'Алименты', amount: 1000, locked: true },
          ],
        },
        4: { mainPayment: 70000 },
      },
    },
  }];

  const preview = buildResetPreview(records, ['4']);
  assert.equal(preview.employeeCount, 1);
  assert.equal(preview.changeCount, 1);
  assert.equal(preview.employees[0].clinics[0].clinicId, '4');
  assert.deepEqual(preview.employees[0].clinics[0].changes.map(c => c.label), ['Основная ЗП']);
});

test('reset preserves locked data and does not mutate the source clinic', () => {
  const clinic = {
    mainPayment: 50000,
    advance: 10000,
    lockedAdvance: true,
    deductions: [
      { name: 'НДФЛ', amount: 6500 },
      { name: 'Алименты', amount: 1000, locked: true },
    ],
    materials: [{ name: 'Расходники' }],
  };

  const result = resetClinicData('2', clinic);
  assert.equal(result.mainPayment, 0);
  assert.equal(result.advance, 10000);
  assert.deepEqual(result.deductions, [{ name: 'Алименты', amount: 1000, locked: true }]);
  assert.deepEqual(result.materials, []);
  assert.equal(clinic.mainPayment, 50000);
  assert.equal(clinic.deductions.length, 2);
});

test('global reset removes only unlocked cabinets', () => {
  const result = resetClinicData('global', {
    cabinets: ['101', '102'],
    lockedCabinets: ['102'],
  });
  assert.deepEqual(result.cabinets, ['102']);
});

test('locked norm stays while its unlocked rate and hours are reset', () => {
  const clinic = {
    normServices: [
      { name: 'Приём', rate: 1200, hours: 2 },
      { name: 'Операция', rate: 5000, hours: 3, locked: true, lockedRate: true },
    ],
  };
  const preview = buildResetPreview([{ misUserId: 1, doctorName: 'Врач', settings: { clinicSettings: { 4: clinic } } }], ['4']);
  const changes = preview.employees[0].clinics[0].changes;
  assert.deepEqual(changes.map(change => change.key), ['normServices', 'normServiceHours']);

  const result = resetClinicData('4', clinic);
  assert.deepEqual(result.normServices, [
    { name: 'Операция', rate: 5000, hours: 0, locked: true, lockedRate: true },
  ]);
});

test('role rates survive the reset while their period hours are zeroed', () => {
  const clinic = {
    hourlyRate: 700,
    hoursWorked: 120,
    roleRates: [
      { roleTitle: 'Врач УЗД', rate: 900, hoursWorked: 40 },
      { roleTitle: 'Терапевт', rate: 750 },
    ],
  };
  const preview = buildResetPreview([{ misUserId: 1, doctorName: 'Врач', settings: { clinicSettings: { 4: clinic } } }], ['4']);
  const changes = preview.employees[0].clinics[0].changes;
  assert.deepEqual(changes.map(change => change.key), ['roleRateHours', 'hoursWorked']);

  const result = resetClinicData('4', clinic);
  assert.equal(result.hourlyRate, 700);
  assert.deepEqual(result.roleRates, [
    { roleTitle: 'Врач УЗД', rate: 900, hoursWorked: 0 },
    { roleTitle: 'Терапевт', rate: 750 },
  ]);
  assert.equal(result.hoursWorked, 0);
  assert.equal(clinic.roleRates[0].hoursWorked, 40);
});

test('carried-over bonus survives one reset and loses its lock', () => {
  const clinic = {
    extras: [
      { name: 'Дежурство', amount: 3000 },
      { name: 'Премия за 2026-08', amount: 4200, hours: 0, locked: true, carryOnce: true },
      { name: 'Доплата', amount: 1000, locked: true },
    ],
  };

  const afterFirst = resetClinicData('4', clinic);
  assert.deepEqual(afterFirst.extras, [
    { name: 'Премия за 2026-08', amount: 4200, hours: 0, locked: false },
    { name: 'Доплата', amount: 1000, locked: true },
  ]);
  assert.equal(clinic.extras.length, 3);

  // Второй сброс перенос уже удаляет: премия ушла в зарплату прошедшего месяца.
  const afterSecond = resetClinicData('4', afterFirst);
  assert.deepEqual(afterSecond.extras, [{ name: 'Доплата', amount: 1000, locked: true }]);
});

test('preview shows carried-over items separately from what is deleted', () => {
  const clinic = {
    deductions: [
      { name: 'Штраф', value: 500 },
      { name: 'Переплата за 2026-08', value: 1200, locked: true, carryOnce: true },
    ],
  };
  const preview = buildResetPreview([{ misUserId: 1, doctorName: 'Врач', settings: { clinicSettings: { 4: clinic } } }], ['4']);
  const changes = preview.employees[0].clinics[0].changes;
  assert.deepEqual(changes.map(change => change.key), ['deductions', 'deductions:carry']);
  assert.deepEqual(changes[0].items, ['Штраф: 500']);
  assert.deepEqual(changes[1].items, ['Переплата за 2026-08: 1200']);
});
