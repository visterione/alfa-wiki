'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTO_NAME_THRESHOLD,
  ownServiceKey,
  hasSemanticConflict,
  canAutoConfirm
} = require('../services/competitorMatching');
const {
  readBindings,
  boundSourceIds,
  columnsForRow,
  pruneBindings
} = require('../services/comparisonBindings');

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

const SHEET = {
  competitors: ['Екатерининская — Сормовская', 'Екатерининская — вся сеть', 'Наш медцентр'],
  competitorBindings: {
    'Екатерининская — Сормовская': { parserSourceId: 7, filialId: 1 },
    'Екатерининская — вся сеть': { parserSourceId: 7, filialId: null },
    // Колонку удалили со страницы, привязка от неё осталась
    'Инвитро (Анапа)': { parserSourceId: 9, filialId: null }
  }
};

test('branch price goes to its own column and to the whole-clinic one', () => {
  const bySource = readBindings(SHEET);
  assert.deepEqual(
    columnsForRow(bySource, { parserSourceId: 7, filialId: 1 }),
    ['Екатерининская — Сормовская', 'Екатерининская — вся сеть']
  );
  assert.deepEqual(
    columnsForRow(bySource, { parserSourceId: 7, filialId: 2 }),
    ['Екатерининская — вся сеть']
  );
});

test('binding without a column is ignored', () => {
  assert.deepEqual(boundSourceIds(SHEET), [7]);
  assert.deepEqual(columnsForRow(readBindings(SHEET), { parserSourceId: 9, filialId: null }), []);
});

test('deleting a column drops its binding', () => {
  const kept = pruneBindings(SHEET.competitorBindings, ['Екатерининская — вся сеть']);
  assert.deepEqual(Object.keys(kept), ['Екатерининская — вся сеть']);
});

test('column name is not what binds a clinic', () => {
  // Ту же колонку переименовали — привязка переезжает вместе с ключом,
  // и цены продолжают попадать в неё
  const renamed = {
    competitors: ['Ек-ская, Сормовская'],
    competitorBindings: { 'Ек-ская, Сормовская': { parserSourceId: 7, filialId: 1 } }
  };
  assert.deepEqual(
    columnsForRow(readBindings(renamed), { parserSourceId: 7, filialId: 1 }),
    ['Ек-ская, Сормовская']
  );
});
