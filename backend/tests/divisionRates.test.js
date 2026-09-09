'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyDivisionRates,
  removeDivisionRates,
  syncDivisionRates,
} = require('../utils/divisionRates');

const rate = (extra = {}) => ({ id: 'rate-1', value: 'Врач', clinic: 'global', rate: 500, overwrite: false, ...extra });
const roleRates = settings => settings.clinicSettings.global.roleRates;

test('новый участник автоматически получает ставки подразделения', () => {
  const result = applyDivisionRates({}, 'division-1', [rate()]);
  assert.equal(result.changed, true);
  assert.equal(roleRates(result.settings)[0].rate, 500);
  assert.equal(roleRates(result.settings)[0].divisionRateSources[0].divisionId, 'division-1');
});

test('ставка конкретной клиники не добавляется сотруднику другой клиники', () => {
  const result = applyDivisionRates({}, 'division-1', [rate({ clinic: '6' })], {
    eligibleClinicIds: new Set(['2']),
  });
  assert.equal(result.changed, false);
  assert.equal(result.settings.clinicSettings['6'], undefined);
});

test('overwrite=false сохраняет существующую личную ставку', () => {
  const source = { clinicSettings: { global: { roleRates: [{ roleTitle: 'Врач', rate: 700 }] } } };
  const result = applyDivisionRates(source, 'division-1', [rate()]);
  assert.deepEqual(roleRates(result.settings), [{ roleTitle: 'Врач', rate: 700 }]);
});

test('после выхода из подразделения восстанавливается перезаписанная личная ставка', () => {
  const source = { clinicSettings: { global: { roleRates: [{ roleTitle: 'Врач', rate: 700 }] } } };
  const applied = applyDivisionRates(source, 'division-1', [rate({ overwrite: true })]);
  assert.equal(roleRates(applied.settings)[0].rate, 500);
  const removed = removeDivisionRates(applied.settings, 'division-1', [rate({ overwrite: true })]);
  assert.deepEqual(roleRates(removed.settings), [{ roleTitle: 'Врач', rate: 700 }]);
});

test('выход из подразделения снимает ставку старого формата при точном совпадении', () => {
  const source = { clinicSettings: { global: { roleRates: [{ roleTitle: 'Врач', rate: 500 }] } } };
  const result = removeDivisionRates(source, 'division-1', [rate()]);
  assert.deepEqual(roleRates(result.settings), []);
});

test('редактирование ставки обновляет сотрудника даже при overwrite=false', () => {
  const source = applyDivisionRates({}, 'division-1', [rate()]).settings;
  const result = syncDivisionRates(source, 'division-1', [rate()], [rate({ rate: 900 })]);
  assert.equal(roleRates(result.settings)[0].rate, 900);
});

test('редактирование ставки с overwrite=false не захватывает чужую личную ставку', () => {
  const personal = { clinicSettings: { global: { roleRates: [{ roleTitle: 'Врач', rate: 700 }] } } };
  const result = syncDivisionRates(personal, 'division-1', [rate()], [rate({ rate: 900 })]);
  assert.equal(result.changed, false);
  assert.deepEqual(roleRates(result.settings), [{ roleTitle: 'Врач', rate: 700 }]);
});

test('неизменённая ставка не захватывает личную ставку сотрудника', () => {
  const source = { clinicSettings: { global: { roleRates: [{ roleTitle: 'Врач', rate: 700 }] } } };
  const result = syncDivisionRates(source, 'division-1', [rate()], [rate()]);
  assert.equal(result.changed, false);
  assert.deepEqual(roleRates(result.settings), [{ roleTitle: 'Врач', rate: 700 }]);
});

test('при нескольких подразделениях удаление восстанавливает предыдущую ставку по цепочке', () => {
  const personal = { clinicSettings: { global: { roleRates: [{ roleTitle: 'Врач', rate: 700 }] } } };
  const first = applyDivisionRates(personal, 'division-1', [rate({ overwrite: true })]).settings;
  const secondRate = rate({ id: 'rate-2', rate: 900, overwrite: true });
  const second = applyDivisionRates(first, 'division-2', [secondRate]).settings;
  assert.equal(roleRates(second)[0].rate, 900);

  const withoutSecond = removeDivisionRates(second, 'division-2', [secondRate]).settings;
  assert.equal(roleRates(withoutSecond)[0].rate, 500);

  const withoutFirst = removeDivisionRates(withoutSecond, 'division-1', [rate({ overwrite: true })]).settings;
  assert.deepEqual(roleRates(withoutFirst), [{ roleTitle: 'Врач', rate: 700 }]);
});
