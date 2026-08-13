const test = require('node:test');
const assert = require('node:assert/strict');

const models = require('../models');
const stockService = require('../services/warehouse/stock');

/**
 * Интеграционный тест сервиса проводок без внешней PostgreSQL. Здесь подменён
 * только persistence-слой Sequelize; createDocument, FEFO, проверки и изменение
 * остатков выполняются настоящим production-кодом как один сквозной сценарий.
 */
function warehouseHarness() {
  const originals = new Map();
  const replace = (object, key, value) => {
    originals.set(`${object.name || 'sequelize'}.${key}`, [object, key, object[key]]);
    object[key] = value;
  };
  const ledger = [];
  const movements = [];
  const documents = [];
  const storages = new Map([['storage-a', 'room-a'], ['storage-b', 'room-b']]);
  const batches = new Map();
  let sequence = 0;

  const row = data => ({
    ...data,
    async update(patch) { Object.assign(this, patch); return this; },
  });

  replace(models.sequelize, 'transaction', async callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  replace(models.sequelize, 'query', async sql => {
    if (String(sql).includes('pg_advisory_xact_lock')) return [[], null];
    if (String(sql).includes('warehouse_doc_counters')) return [[{ lastValue: ++sequence }]];
    throw new Error(`Unexpected SQL in warehouse test: ${String(sql).slice(0, 80)}`);
  });
  replace(models.WhDocument, 'create', async data => {
    const value = row({ id: `doc-${documents.length + 1}`, ...data });
    documents.push(value); return value;
  });
  replace(models.WhMovement, 'create', async data => {
    const value = row({ id: `move-${movements.length + 1}`, ...data });
    movements.push(value); return value;
  });
  replace(models.WhNomenclature, 'findByPk', async id => ({ id, name: 'Перчатки' }));
  replace(models.WhStorage, 'findByPk', async id => storages.has(id) ? ({ id, roomId: storages.get(id) }) : null);
  replace(models.WhAsset, 'findByPk', async () => null);
  replace(models.WhStock, 'findOne', async ({ where }) => ledger.find(x =>
    x.nomenclatureId === where.nomenclatureId && x.storageId === where.storageId &&
    (x.batchId || null) === (where.batchId || null)
  ) || null);
  replace(models.WhStock, 'create', async data => {
    const value = row({ id: `stock-${ledger.length + 1}`, unitCost: 0, ...data });
    ledger.push(value); return value;
  });
  replace(models.WhStock, 'findAll', async ({ where }) => ledger
    .filter(x => x.nomenclatureId === where.nomenclatureId && x.storageId === where.storageId && Number(x.quantity) > 0)
    .filter(x => !where.batchId || x.batchId === where.batchId)
    .map(x => Object.assign(x, { batch: x.batchId ? batches.get(x.batchId) : null })));

  return {
    ledger, movements, documents, batches,
    quantity(storageId, batchId = null) {
      return Number(ledger.find(x => x.storageId === storageId && (x.batchId || null) === batchId)?.quantity || 0);
    },
    restore() {
      for (const [, [object, key, value]] of originals) object[key] = value;
    },
  };
}

test('сквозная проводка: приход → перемещение → выдача → возврат → списание', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const user = { id: 'user-1' };
  const base = { user, reasonText: 'Интеграционный тест', sign: true };

  await stockService.createDocument({ ...base, type: 'receipt', lines: [
    { nomenclatureId: 'nom-1', quantity: 10, unitCost: 100, toStorageId: 'storage-a' },
  ] });
  await stockService.createDocument({ ...base, type: 'transfer', lines: [
    { nomenclatureId: 'nom-1', quantity: 6, fromStorageId: 'storage-a', toStorageId: 'storage-b' },
  ] });
  await stockService.createDocument({ ...base, type: 'issue', lines: [
    { nomenclatureId: 'nom-1', quantity: 4, fromStorageId: 'storage-b', doctorUserId: 'doctor-1' },
  ] });
  await stockService.createDocument({ ...base, type: 'return', lines: [
    { nomenclatureId: 'nom-1', quantity: 2, unitCost: 100, toStorageId: 'storage-b' },
  ] });
  await stockService.createDocument({ ...base, type: 'writeoff', lines: [
    { nomenclatureId: 'nom-1', quantity: 1, fromStorageId: 'storage-b' },
  ] });

  assert.equal(h.quantity('storage-a'), 4);
  assert.equal(h.quantity('storage-b'), 3);
  assert.deepEqual(h.documents.map(d => d.type), ['receipt', 'transfer', 'issue', 'return', 'writeoff']);
  assert.equal(h.documents.every(d => d.status === 'signed' && d.signedBy === user.id), true);
  assert.equal(h.movements.find(m => m.type === 'issue').doctorUserId, 'doctor-1');
});

test('выдача не допускает отрицательный остаток', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  await stockService.adjustStock({
    nomenclatureId: 'nom-1', storageId: 'storage-a', delta: 2, unitCost: 10,
    transaction: { LOCK: { UPDATE: 'UPDATE' } },
  });
  await assert.rejects(
    stockService.createDocument({
      type: 'issue', user: { id: 'user-1' }, reasonText: 'test',
      lines: [{ nomenclatureId: 'nom-1', quantity: 3, fromStorageId: 'storage-a' }],
    }),
    /Недостаточно годного остатка/,
  );
  assert.equal(h.quantity('storage-a'), 2);
});

test('явно выбранная просроченная партия запрещена к выдаче', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  h.batches.set('expired', { id: 'expired', expiryDate: '2020-01-01', isBlocked: false });
  h.ledger.push({
    id: 'stock-expired', nomenclatureId: 'nom-1', batchId: 'expired', storageId: 'storage-a',
    quantity: 5, unitCost: 10, async update(patch) { Object.assign(this, patch); },
  });
  await assert.rejects(
    stockService.createDocument({
      type: 'issue', user: { id: 'user-1' }, reasonText: 'test',
      lines: [{ nomenclatureId: 'nom-1', batchId: 'expired', quantity: 1, fromStorageId: 'storage-a' }],
    }),
    /Недостаточно годного остатка.*Просроченные и заблокированные партии/,
  );
  assert.equal(h.quantity('storage-a', 'expired'), 5);
});

test('FEFO выбирает партию с ближайшим сроком первой', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  h.batches.set('late', { id: 'late', expiryDate: '2099-12-31', isBlocked: false });
  h.batches.set('early', { id: 'early', expiryDate: '2098-12-31', isBlocked: false });
  for (const batchId of ['late', 'early']) h.ledger.push({
    id: `stock-${batchId}`, nomenclatureId: 'nom-1', batchId, storageId: 'storage-a',
    quantity: 5, unitCost: 10, async update(patch) { Object.assign(this, patch); },
  });
  const picks = await stockService.pickBatchesFefo({
    nomenclatureId: 'nom-1', storageId: 'storage-a', quantity: 6,
    transaction: { LOCK: { UPDATE: 'UPDATE' } },
  });
  assert.deepEqual(picks.map(p => [p.batchId, p.quantity]), [['early', 5], ['late', 1]]);
});
