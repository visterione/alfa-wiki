'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTO_NAME_THRESHOLD,
  ownServiceKey,
  hasSemanticConflict,
  canAutoConfirm
} = require('../services/competitorMatching');

test('same MIS service has one key on different comparison sheets', () => {
  assert.equal(
    ownServiceKey({ misServiceId: ' 123 ', serviceCode: 'different', serviceName: 'One' }),
    ownServiceKey({ misServiceId: '123', serviceCode: 'other', serviceName: 'Two' })
  );
});

test('service key falls back to article and normalized name', () => {
  assert.equal(ownServiceKey({ serviceCode: ' A-10 ' }), 'code:a-10');
  assert.equal(
    ownServiceKey({ serviceName: '  Приём врача-терапевта! ' }),
    'name:прием врача терапевта'
  );
});

test('804n and exact names are accepted automatically', () => {
  const item = { serviceName: 'Общий анализ крови' };
  assert.equal(canAutoConfirm(item, { method: 'code804', name: 'Другое', score: 1 }), true);
  assert.equal(canAutoConfirm(item, { method: 'name', name: 'Общий анализ крови', score: 0.5 }), true);
});

test('best candidates above the matching threshold are accepted automatically', () => {
  const item = { serviceName: 'Приём врача-терапевта первичный' };
  assert.equal(
    canAutoConfirm(item, { method: 'name', name: 'Прием терапевта первичный', score: AUTO_NAME_THRESHOLD }),
    true
  );
  assert.equal(
    canAutoConfirm(item, { method: 'name', name: 'Приём врача повторный', score: AUTO_NAME_THRESHOLD - 0.001 }),
    false
  );
});

test('meaning-changing words are left for review', () => {
  assert.equal(
    hasSemanticConflict('Приём врача первичный', 'Прием врача повторный'),
    true
  );
  assert.equal(
    canAutoConfirm(
      { serviceName: 'КТ органов грудной клетки без контраста' },
      { method: 'name', name: 'КТ органов грудной клетки с контрастом', score: 0.95 }
    ),
    false
  );
});
