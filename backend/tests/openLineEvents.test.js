const test = require('node:test');
const assert = require('node:assert/strict');

const { OmniLineOperator, sequelize } = require('../models');
const events = require('../services/openLineEvents');

/**
 * Сигналы открытой линии (ver. 8.27).
 *
 * Проверяется доставка, а не содержимое: в какие комнаты уходит, каким путём
 * при отсутствии сокета и то, что сигнал не может уронить приём сообщения от
 * пациента. Текст полезной нагрузки — дело интерфейса.
 */

function fakeIo() {
  const sent = [];
  return {
    sent,
    to(room) {
      return { emit: (event, payload) => sent.push({ room, event, payload }) };
    },
  };
}

test('с сокетом сигнал уходит каждому получателю в его комнату', async () => {
  const io = fakeIo();

  await events.publish(io, ['u1', 'u2'], 'openline:changed', { conversationId: 'c1' });

  assert.deepEqual(io.sent.map(s => s.room), ['user:u1', 'user:u2']);
  assert.deepEqual(io.sent.map(s => s.event), ['openline:changed', 'openline:changed']);
  assert.equal(io.sent[0].payload.conversationId, 'c1');
});

test('без сокета сигнал уходит через NOTIFY — это процесс забора обновлений', async () => {
  const calls = [];
  const original = sequelize.query;
  sequelize.query = async (sql, options) => { calls.push({ sql, options }); };

  try {
    await events.publish(null, ['u1'], 'openline:incoming', { conversationId: 'c1', isNew: true });
  } finally {
    sequelize.query = original;
  }

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pg_notify/);
  assert.equal(calls[0].options.bind[0], events.CHANNEL);

  const payload = JSON.parse(calls[0].options.bind[1]);
  assert.deepEqual(payload.userIds, ['u1']);
  assert.equal(payload.event, 'openline:incoming');
  assert.equal(payload.payload.isNew, true);
});

test('отказ транспорта не выходит наружу: сигнал — удобство поверх опроса', async () => {
  const io = {
    to() {
      return { emit: () => { throw new Error('сокет закрыт'); } };
    },
  };

  await events.publish(io, ['u1'], 'openline:changed', {});
});

test('пустой список получателей не превращается в поход в базу', async () => {
  const original = sequelize.query;
  let called = false;
  sequelize.query = async () => { called = true; };

  try {
    await events.publish(null, [], 'openline:changed', {});
  } finally {
    sequelize.query = original;
  }

  assert.equal(called, false);
});

test('получатели — смена линии и исполнитель, без повторов', async () => {
  const original = OmniLineOperator.findAll;
  OmniLineOperator.findAll = async () => [{ userId: 'u1' }, { userId: 'u2' }];

  try {
    // Исполнитель уже в смене — вторым разом появиться не должен.
    assert.deepEqual(
      await events.recipients({ lineId: 'l1', assigneeUserId: 'u2' }),
      ['u1', 'u2'],
    );

    // А вот исполнитель, закончивший день, в составе смены не значится: его
    // обращение вернулось в очередь, но чат у него на экране ещё открыт.
    assert.deepEqual(
      await events.recipients({ lineId: 'l1', assigneeUserId: 'u9' }),
      ['u1', 'u2', 'u9'],
    );

    // Передавший чат оповещается отдельно — он мог быть уже не на смене.
    assert.deepEqual(
      await events.recipients({ lineId: 'l1', assigneeUserId: null }, ['u7']),
      ['u1', 'u2', 'u7'],
    );
  } finally {
    OmniLineOperator.findAll = original;
  }
});
