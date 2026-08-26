const test = require('node:test');
const assert = require('node:assert/strict');

const { MIRROR, NOT_REVERSIBLE, mirrorLines } = require('../services/warehouse/reversal');

/**
 * Сторно — отмена операции встречным документом (ver. 7.50).
 *
 * Проверяется сборка встречных строк. Ошибка здесь не видна глазом и стоит
 * дорого: перепутанные «откуда» и «куда» у материала означают, что вместо
 * возврата на полку произойдёт второй расход, и остаток разойдётся с полкой
 * молча — как раз в тот момент, когда человек думает, что исправил ошибку.
 */

const assetMove = {
  assetId: 'a-1',
  fromRoomId: 'room-305', fromStorageId: 'shelf-305', fromResponsibleId: 'user-1',
  toRoomId: 'room-307', toStorageId: 'shelf-307',
};

const materialMove = {
  nomenclatureId: 'n-1', batchId: 'b-1', quantity: 30, unitCost: 10,
  fromStorageId: 'shelf-305', toStorageId: 'shelf-307',
};

test('актив едет обратно вместе с прежним МОЛ', () => {
  const [line] = mirrorLines([assetMove], 'transfer');
  assert.deepEqual(line, {
    assetId: 'a-1',
    toRoomId: 'room-305',
    toStorageId: 'shelf-305',
    toResponsibleId: 'user-1',
  });
});

test('перемещение материала разворачивается обоими концами', () => {
  const [line] = mirrorLines([materialMove], 'transfer');
  assert.equal(line.fromStorageId, 'shelf-307');
  assert.equal(line.toStorageId, 'shelf-305');
  assert.equal(line.quantity, 30);
});

test('отмена выдачи кладёт обратно на ту же полку', () => {
  // Выдача сняла с shelf-305; встречный возврат обязан положить туда же.
  const [line] = mirrorLines([{ ...materialMove, toStorageId: null }], MIRROR.issue);
  assert.equal(MIRROR.issue, 'return');
  assert.equal(line.toStorageId, 'shelf-305');
  assert.equal(line.fromStorageId, undefined);
});

test('отмена возврата снимает с той полки, куда положили', () => {
  const [line] = mirrorLines([{ ...materialMove, fromStorageId: null }], MIRROR.return);
  assert.equal(MIRROR.return, 'issue');
  assert.equal(line.fromStorageId, 'shelf-307');
  assert.equal(line.toStorageId, undefined);
});

test('ремонт зеркалится направлением, а не названием', () => {
  // repair_in — приходный тип: строка обязана нести «куда», иначе движение
  // ляжет не в ту сторону и остаток уедет в минус.
  assert.equal(MIRROR.repair_out, 'repair_in');
  const [line] = mirrorLines([materialMove], MIRROR.repair_out);
  assert.equal(line.toStorageId, 'shelf-305');
  assert.equal(line.fromStorageId, undefined);
});

test('партия возвращается та же самая, а не подобранная по FEFO', () => {
  const [line] = mirrorLines([materialMove], 'transfer');
  assert.equal(line.batchId, 'b-1');
  // Без exactBatch расход ушёл бы в коробку с ближайшим сроком, а на строке,
  // которую отменяли, остался бы фантом.
  assert.equal(line.exactBatch, true);
});

test('приход и списание кнопкой не отменяются', () => {
  assert.ok(!MIRROR.receipt);
  assert.ok(!MIRROR.writeoff);
  assert.ok(NOT_REVERSIBLE.receipt);
  assert.ok(NOT_REVERSIBLE.writeoff);
  assert.ok(NOT_REVERSIBLE.surplus);
});
