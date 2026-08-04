'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRequestedCodes,
  filterBonusesByCodes,
  bonusesByServiceCode,
} = require('../utils/referralBonusLookup');

test('normalizes requested code list without changing code case', () => {
  assert.deepEqual(normalizeRequestedCodes([' A 01 ', 'A 01', '', null]), ['A 01']);
});

test('doctor lookup preserves the previous whitespace and case matching', () => {
  const rows = [
    { id: '1', serviceCode: ' A   01 ' },
    { id: '2', serviceCode: 'B02' },
  ];
  assert.deepEqual(filterBonusesByCodes(rows, ['a 01']).map(row => row.id), ['1']);
});

test('groups service lookup by code and doctor', () => {
  const result = bonusesByServiceCode(['A01'], [
    { id: '1', serviceCode: 'A01', misUserId: 'doctor-1', bonusPercent: '5', bonusRub: null },
  ]);
  assert.deepEqual(result.A01['doctor-1'], { id: '1', bonusPercent: '5', bonusRub: null });
});
