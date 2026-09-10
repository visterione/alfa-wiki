'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const blocklist = require('../services/notifications/doctorBlocklist');

test('старый общий список остаётся безопасным значением по умолчанию', () => {
  const state = blocklist.normalizeState({ doctors: [{ id: 10, name: 'Дневной стационар' }] });
  assert.deepEqual(blocklist.doctorsFor(state, 'alpha'), [{ id: '10', name: 'Дневной стационар' }]);
  assert.deepEqual(blocklist.doctorsFor(state, 'kids'), [{ id: '10', name: 'Дневной стационар' }]);
});

test('список врачей выбирается по филиалу', () => {
  const state = blocklist.normalizeState({
    default: [],
    branches: {
      alpha: [{ id: '42', name: 'Кузин' }],
      kids: []
    }
  });
  const visit = { doctorId: '42', doctorName: 'Кузин' };

  assert.equal(blocklist.matchesFor(visit, state, 'alpha'), true);
  assert.equal(blocklist.matchesFor(visit, state, 'kids'), false);
});
