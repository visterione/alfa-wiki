const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../services/tasks/schedule');

const sample = {
  days: {
    mon: { enabled: true, start: '09:00', end: '18:00' },
    tue: { enabled: true, start: '09:00', end: '18:00' },
    wed: { enabled: true, start: '09:00', end: '18:00' },
    thu: { enabled: true, start: '09:00', end: '18:00' },
    fri: { enabled: true, start: '09:00', end: '18:00' },
    sat: { enabled: true, start: '10:00', end: '15:00' },
    sun: { enabled: false },
  },
};

test('часы недели складываются из фактической длины рабочих смен', () => {
  assert.equal(schedule.weeklyHours(sample), 50);
});

test('сокращённая суббота имеет собственную норму, воскресенье остаётся выходным', () => {
  assert.deepEqual(schedule.forDate(sample, '2026-08-15'), { isWorking: true, start: '10:00', end: '15:00', norm: 5 });
  assert.deepEqual(schedule.forDate(sample, '2026-08-16'), { isWorking: false, start: null, end: null, norm: 0 });
});

test('старое поле ёмкости не влияет на часы смены и удаляется при сохранении', () => {
  const legacy = structuredClone(sample);
  legacy.days.sat.capacityHours = 1;
  assert.equal(schedule.forDate(legacy, '2026-08-15').norm, 5);
  assert.equal(schedule.normalizeSchedule(legacy).days.sat.capacityHours, undefined);
});

test('конец смены должен быть позже начала', () => {
  const invalid = structuredClone(sample);
  invalid.days.sat.end = '09:00';
  assert.throws(() => schedule.normalizeSchedule(invalid), /корректное начало и конец/);
});

test('старая дневная норма превращается только в Пн–Пт', () => {
  const migrated = schedule.fromDailyNorm(6);
  assert.equal(schedule.weeklyHours(migrated), 30);
  assert.equal(migrated.days.sat.enabled, false);
  assert.equal(migrated.days.sun.enabled, false);
});
