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
  replace(models.WhStock, 'findByPk', async id => ledger.find(x => x.id === id) || null);
  replace(models.WhBatch, 'findOrCreate', async ({ where, defaults }) => {
    const found = [...batches.values()].find(b =>
      b.nomenclatureId === where.nomenclatureId && b.batchNumber === where.batchNumber);
    if (found) return [found, false];
    const value = row({ id: `batch-${batches.size + 1}`, ...where, ...defaults });
    batches.set(value.id, value);
    return [value, true];
  });
  replace(models.WhNomenclature, 'update', async () => [1]);
  // Условие по партии повторяет семантику SQL, а не «истинность значения»:
  // отсутствие ключа — это «любая партия», а batchId: null — это IS NULL, то
  // есть строка остатка без партии. Пока харнесс читал null как «фильтра нет»,
  // он подтверждал проводку, которой на живой базе не было бы.
  replace(models.WhStock, 'findAll', async ({ where }) => ledger
    .filter(x => x.nomenclatureId === where.nomenclatureId && x.storageId === where.storageId && Number(x.quantity) > 0)
    .filter(x => !('batchId' in where) || (x.batchId || null) === (where.batchId || null))
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

test('списание не уводит остаток в минус, в том числе двумя строками сразу', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  await stockService.adjustStock({
    nomenclatureId: 'nom-1', storageId: 'storage-a', delta: 2, unitCost: 10,
    transaction: { LOCK: { UPDATE: 'UPDATE' } },
  });

  // Списание берёт и просроченное (для того и списывают), поэтому проверку
  // остатка оно проходит по другой ветке, чем выдача, — и её нужно закрыть
  // отдельно: в форме именно из списания можно было запросить сто штук из двух.
  await assert.rejects(
    stockService.createDocument({
      type: 'writeoff', user: { id: 'user-1' }, reasonText: 'test',
      lines: [{ nomenclatureId: 'nom-1', quantity: 100, fromStorageId: 'storage-a' }],
    }),
    /Недостаточно годного остатка/,
  );
  assert.equal(h.quantity('storage-a'), 2);

  // Две строки по две штуки: каждая по отдельности остатку не противоречит, а
  // вместе просят четыре из двух — вторая упирается в то, что первая уже забрала.
  //
  // Остаток после этого не проверяем: откат делает транзакция, а в харнессе она
  // подменена сквозным вызовом без отката, и первая строка остаётся применённой.
  // На живой базе обе строки уходят одним sequelize.transaction.
  await assert.rejects(
    stockService.createDocument({
      type: 'writeoff', user: { id: 'user-1' }, reasonText: 'test',
      lines: [
        { nomenclatureId: 'nom-1', quantity: 2, fromStorageId: 'storage-a' },
        { nomenclatureId: 'nom-1', quantity: 2, fromStorageId: 'storage-a' },
      ],
    }),
    /Недостаточно годного остатка/,
  );
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

test('срок годности привязывает партию к лежащему остатку и балансирует журнал', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  h.ledger.push({
    id: 'stock-osv', nomenclatureId: 'nom-1', batchId: null, storageId: 'storage-a',
    quantity: 10, unitCost: 100, async update(patch) { Object.assign(this, patch); },
  });

  const { batch, moved } = await stockService.attachBatchToStock({
    stockId: 'stock-osv', expiryDate: '2027-01-31', user: { id: 'user-1' },
  });

  assert.equal(moved, 10);
  // Номер серии собран из даты: на упаковке его может не быть вовсе.
  assert.equal(batch.batchNumber, 'б/н до 31.01.2027');
  assert.equal(h.quantity('storage-a'), 0);
  assert.equal(h.quantity('storage-a', batch.id), 10);

  // Пара движений сходится в ноль по каждой партии — иначе контрольная сверка
  // объявит, что остаток правили в обход модуля.
  const net = new Map();
  for (const m of h.movements) {
    const key = m.batchId || 'none';
    const sign = m.toStorageId ? 1 : -1;
    net.set(key, (net.get(key) || 0) + sign * Number(m.quantity));
  }
  assert.equal(net.get('none'), -10);
  assert.equal(net.get(batch.id), 10);
  assert.equal(h.movements.every(m => m.reasonCode === stockService.BATCH_ATTACH), true);
});

test('коробка с уже заведённой партией сливается с ней в одну строку остатка', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  h.batches.set('batch-known', {
    id: 'batch-known', nomenclatureId: 'nom-1', batchNumber: 'A-77',
    expiryDate: '2027-01-31', isBlocked: false,
    async update(patch) { Object.assign(this, patch); },
  });
  h.ledger.push({
    id: 'stock-known', nomenclatureId: 'nom-1', batchId: 'batch-known', storageId: 'storage-a',
    quantity: 4, unitCost: 50, async update(patch) { Object.assign(this, patch); },
  });
  h.ledger.push({
    id: 'stock-osv', nomenclatureId: 'nom-1', batchId: null, storageId: 'storage-a',
    quantity: 6, unitCost: 100, async update(patch) { Object.assign(this, patch); },
  });

  await stockService.attachBatchToStock({
    stockId: 'stock-osv', batchNumber: 'A-77', expiryDate: '2027-01-31', user: { id: 'user-1' },
  });

  // Вторая строка по той же партии в том же месте хранения невозможна —
  // количество обязано слиться, а цена стать средневзвешенной.
  assert.equal(h.ledger.filter(x => x.batchId === 'batch-known').length, 1);
  assert.equal(h.quantity('storage-a', 'batch-known'), 10);
  assert.equal(h.quantity('storage-a'), 0);
  assert.equal(Number(h.ledger.find(x => x.id === 'stock-known').unitCost), 80);
});

// ─────────────────────────────────────────────────────────────────────────────
// Операции, невозможные в жизни: ver. 7.07
// ─────────────────────────────────────────────────────────────────────────────

test('строка без партии расходуется сама, а не ближайшей по сроку партией', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const base = { user: { id: 'user-1' }, reasonText: 'test' };

  // На одной полке лежит и непартионный остаток (пришёл по ведомости 1С, срока
  // в файле не было), и коробка с ближним сроком.
  await stockService.createDocument({ ...base, type: 'receipt', lines: [
    { nomenclatureId: 'nom-1', quantity: 10, unitCost: 100, toStorageId: 'storage-a' },
  ] });
  h.batches.set('near', { id: 'near', nomenclatureId: 'nom-1', batchNumber: 'A', expiryDate: '2030-01-01' });
  await stockService.createDocument({ ...base, type: 'receipt', lines: [
    { nomenclatureId: 'nom-1', batchId: 'near', quantity: 5, unitCost: 100, toStorageId: 'storage-a' },
  ] });

  // Так списывает инвентаризация: адрес строки остатка, а не подсказка FEFO.
  // Без exactBatch отсюда уходило пять штук из партии, а фантом на непартионной
  // строке оставался лежать.
  await assert.rejects(
    stockService.createDocument({ ...base, type: 'writeoff', lines: [
      { nomenclatureId: 'nom-1', batchId: null, exactBatch: true, quantity: 12, fromStorageId: 'storage-a' },
    ] }),
    /Недостаточно годного остатка/,
  );
  assert.equal(h.quantity('storage-a', null), 10);
  assert.equal(h.quantity('storage-a', 'near'), 5);

  await stockService.createDocument({ ...base, type: 'writeoff', lines: [
    { nomenclatureId: 'nom-1', batchId: null, exactBatch: true, quantity: 4, fromStorageId: 'storage-a' },
  ] });
  assert.equal(h.quantity('storage-a', null), 6);
  assert.equal(h.quantity('storage-a', 'near'), 5, 'партию расход по непартионной строке не трогает');
});

test('без exactBatch пустая партия остаётся подсказкой «подбери по FEFO»', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const base = { user: { id: 'user-1' }, reasonText: 'test' };
  h.batches.set('near', { id: 'near', nomenclatureId: 'nom-1', batchNumber: 'A', expiryDate: '2030-01-01' });
  await stockService.createDocument({ ...base, type: 'receipt', lines: [
    { nomenclatureId: 'nom-1', batchId: 'near', quantity: 5, unitCost: 100, toStorageId: 'storage-a' },
  ] });

  await stockService.createDocument({ ...base, type: 'issue', lines: [
    { nomenclatureId: 'nom-1', quantity: 2, fromStorageId: 'storage-a' },
  ] });
  assert.equal(h.quantity('storage-a', 'near'), 3, 'форма без выбранной партии по-прежнему берёт FEFO');
});

test('перемещение в то же место хранения не проводится', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const base = { user: { id: 'user-1' }, reasonText: 'test' };
  await stockService.createDocument({ ...base, type: 'receipt', lines: [
    { nomenclatureId: 'nom-1', quantity: 10, unitCost: 100, toStorageId: 'storage-a' },
  ] });
  await assert.rejects(
    stockService.createDocument({ ...base, type: 'transfer', lines: [
      { nomenclatureId: 'nom-1', quantity: 7, fromStorageId: 'storage-a', toStorageId: 'storage-a' },
    ] }),
    /то же место хранения/,
  );
  assert.equal(h.quantity('storage-a'), 10);
});

test('отрицательная цена в приходе не принимается', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  await assert.rejects(
    stockService.createDocument({
      user: { id: 'user-1' }, reasonText: 'test', type: 'receipt',
      lines: [{ nomenclatureId: 'nom-1', quantity: 3, unitCost: -500, toStorageId: 'storage-a' }],
    }),
    /не может быть отрицательной/,
  );
  assert.equal(h.ledger.length, 0);
});

test('дата документа в будущем не принимается', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  await assert.rejects(
    stockService.createDocument({
      user: { id: 'user-1' }, reasonText: 'test', type: 'receipt',
      occurredAt: new Date(Date.now() + 40 * 86400000).toISOString(),
      lines: [{ nomenclatureId: 'nom-1', quantity: 3, unitCost: 10, toStorageId: 'storage-a' }],
    }),
    /не может быть в будущем/,
  );
  assert.equal(h.ledger.length, 0);
});

test('бизнес-правило помечено статусом 400, а не опознаётся по тексту', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const err = await stockService.createDocument({
    user: { id: 'user-1' }, reasonText: 'test', type: 'issue',
    lines: [{ nomenclatureId: 'nom-1', quantity: 1, fromStorageId: 'storage-a' }],
  }).catch(e => e);
  assert.equal(err.status, 400);
});

// ── Операции с оборудованием ────────────────────────────────────────────────

/** Карточка актива в подменённом слое: состояние задаётся тестом. */
function assetHarness(h, patch = {}) {
  const asset = {
    id: 'asset-1', inventoryNumber: 'АХО-0001', name: 'Стул',
    roomId: 'room-a', storageId: 'storage-a', initialCost: 1000,
    status: 'in_use', isArchived: false, responsibleUserId: null,
    async update(p) { Object.assign(this, p); return this; },
    ...patch,
  };
  models.WhAsset.findByPk = async () => asset;
  return asset;
}

test('списанный актив в операции не участвует', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  assetHarness(h, { status: 'written_off', isArchived: true });
  const base = { user: { id: 'user-1' }, reasonText: 'test', lines: [{ assetId: 'asset-1' }] };

  for (const type of ['writeoff', 'transfer', 'repair_out', 'repair_in']) {
    await assert.rejects(
      stockService.createDocument({ ...base, type, lines: [{ assetId: 'asset-1', toRoomId: 'room-b', toStorageId: 'storage-b' }] }),
      /списан/,
      `тип ${type}`,
    );
  }
  assert.equal(h.movements.length, 0);
});

test('из ремонта возвращается только то, что в ремонте', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const asset = assetHarness(h, { status: 'in_use' });

  await assert.rejects(
    stockService.createDocument({
      user: { id: 'user-1' }, reasonText: 'test', type: 'repair_in',
      lines: [{ assetId: 'asset-1' }],
    }),
    /не числится в ремонте/,
  );

  asset.status = 'repair';
  await assert.rejects(
    stockService.createDocument({
      user: { id: 'user-1' }, reasonText: 'test', type: 'repair_out',
      lines: [{ assetId: 'asset-1' }],
    }),
    /уже в ремонте/,
  );

  await stockService.createDocument({
    user: { id: 'user-1' }, reasonText: 'test', type: 'repair_in',
    lines: [{ assetId: 'asset-1' }],
  });
  assert.equal(asset.status, 'in_use');
});

test('перемещение туда, где актив стоит, не проводится — но смена МОЛ на месте проводится', async t => {
  const h = warehouseHarness();
  t.after(() => h.restore());
  const asset = assetHarness(h, { responsibleUserId: 'user-9' });

  await assert.rejects(
    stockService.createDocument({
      user: { id: 'user-1' }, reasonText: 'test', type: 'transfer',
      lines: [{ assetId: 'asset-1', toRoomId: 'room-a', toStorageId: 'storage-a' }],
    }),
    /уже стоит в этом месте/,
  );

  await stockService.createDocument({
    user: { id: 'user-1' }, reasonText: 'test', type: 'transfer',
    lines: [{ assetId: 'asset-1', toRoomId: 'room-a', toStorageId: 'storage-a', toResponsibleId: 'user-7' }],
  });
  assert.equal(asset.responsibleUserId, 'user-7');
});
