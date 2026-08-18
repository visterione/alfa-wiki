const test = require('node:test');
const assert = require('node:assert/strict');

const notificationService = require('../services/notificationService');
const pushService = require('../services/pushService');
const notify = require('../services/tasks/notify');

/**
 * Уведомления модуля «Задачи».
 *
 * Проверяется доставка, а не текст: адрес комнаты, имя события и то, что
 * уведомление никогда не роняет действие с задачей.
 *
 * Отправка push подменяется. На машине разработчика ключи FCM могут лежать
 * рядом, и настоящий вызов пошёл бы в базу за токенами устройств — тест стал
 * бы зависеть от того, у кого что настроено.
 */
const pushed = [];
pushService.sendToUsers = async (userIds, payload) => {
  pushed.push({ userIds, payload });
  return { sent: 0, failed: 0, skipped: true };
};

function fakeIo() {
  const sent = [];
  return {
    sent,
    to(room) {
      return { emit: (event, payload) => sent.push({ room, event, payload }) };
    },
  };
}

test('уведомление уходит каждому получателю в его комнату', async () => {
  const io = fakeIo();
  notificationService.init(io);

  await notify.notify(['u1', 'u2'], {
    title: '📌 Новая задача',
    body: 'Стеценко Виталий: «Согласовать смету»',
    taskId: 't1',
    code: 'РЕМ-42',
  });

  assert.deepEqual(io.sent.map(s => s.room), ['user:u1', 'user:u2']);
  assert.deepEqual([...new Set(io.sent.map(s => s.event))], ['task:notify']);

  const payload = io.sent[0].payload;
  assert.equal(payload.kind, 'task');
  assert.equal(payload.title, '📌 Новая задача');
  assert.equal(payload.code, 'РЕМ-42');
  assert.equal(payload.taskId, 't1');
  assert.ok(payload.at, 'время события нужно клиенту для порядка в стопке');

  // Тот же payload уходит в push: телефон собирает уведомление из тех же полей,
  // что и веб, поэтому расходиться форматам нельзя.
  assert.equal(pushed.length, 1);
  assert.deepEqual(pushed[0].userIds, ['u1', 'u2']);
  assert.equal(pushed[0].payload.kind, 'task');
  assert.equal(pushed[0].payload.taskId, 't1');
});

test('дубли и пустые получатели отсеиваются', async () => {
  const io = fakeIo();
  notificationService.init(io);

  await notify.notify(['u1', 'u1', null, undefined, ''], { title: 'т', body: 'т' });

  assert.equal(io.sent.length, 1, 'один человек — одно уведомление');
});

test('без получателей ничего не отправляется', async () => {
  const io = fakeIo();
  notificationService.init(io);

  await notify.notify([], { title: 'т', body: 'т' });
  await notify.notify(null, { title: 'т', body: 'т' });

  assert.equal(io.sent.length, 0);
});

test('падение доставки не выбрасывается наружу', async () => {
  // Действие с задачей уже выполнено и записано в историю. Если сокет отвалился,
  // откатывать из-за этого перенос срока нельзя — уведомление вторично.
  notificationService.init({
    to() { throw new Error('сокет отвалился'); },
  });

  await notify.notify(['u1'], { title: 'т', body: 'т' });
});
