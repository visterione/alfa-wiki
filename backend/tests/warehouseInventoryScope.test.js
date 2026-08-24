const test = require('node:test');
const assert = require('node:assert/strict');

const { inventoryScopeOf, sessionRoomIds } = require('../services/warehouse/inventory');

/**
 * Область инвентаризации (ver. 7.36).
 *
 * Проверяется главное утверждение этой части: «какие кабинеты накрыты» читается
 * одним способом независимо от того, как опись заведена. От этого зависит
 * заморозка операций — а ошибка здесь означает либо пересчёт по кабинету, где
 * в это же время выдают материалы (разница спишется вторым разом), либо
 * замороженный кабинет, которого в описи нет вовсе.
 */

test('один кабинет остаётся областью room, но попадает и в список', () => {
  const scope = inventoryScopeOf(['room-305'], null);
  assert.equal(scope.scope, 'room');
  assert.equal(scope.roomId, 'room-305');
  assert.deepEqual(scope.roomIds, ['room-305']);
  assert.equal(scope.departmentId, null);
});

test('несколько кабинетов — область rooms без одиночного roomId', () => {
  const scope = inventoryScopeOf(['room-305', 'room-307', 'room-310'], null);
  assert.equal(scope.scope, 'rooms');
  assert.equal(scope.roomId, null);
  assert.equal(scope.roomIds.length, 3);
});

test('дубли кабинетов не задваивают область', () => {
  const scope = inventoryScopeOf(['room-305', 'room-305'], null);
  assert.equal(scope.scope, 'room');
  assert.deepEqual(scope.roomIds, ['room-305']);
});

test('у описи по отделению список кабинетов пуст: он должен считаться на ходу', () => {
  const scope = inventoryScopeOf(['room-305'], 'dep-1');
  assert.equal(scope.scope, 'department');
  assert.equal(scope.departmentId, 'dep-1');
  assert.deepEqual(scope.roomIds, []);
  assert.equal(scope.roomId, null);
});

test('описи, заведённые до миграции, отвечают через roomId', () => {
  assert.deepEqual(sessionRoomIds({ scope: 'room', roomId: 'room-1', roomIds: [] }), ['room-1']);
  assert.deepEqual(sessionRoomIds({ scope: 'rooms', roomId: null, roomIds: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(sessionRoomIds({ scope: 'department', departmentId: 'd1', roomIds: [] }), []);
});
