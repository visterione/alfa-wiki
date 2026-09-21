'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const visitRatings = require('../services/notifications/visitRatings');

// Разбор строки кнопки повторяет handleButton: тот же split, та же тройка.
// Дублирование здесь осознанное — оно и проверяется: стоит формату кнопки
// разойтись с разбором, и нажатие молча перестанет что-либо значить.
const parse = (data) => {
  const [action, value, extra] = String(data).split(':');
  return { action, value, extra };
};

test('кнопка несёт id строки очереди и оценку, разбор возвращает их обратно', () => {
  const outboxId = '4d1f2a9c-77b8-4f2e-9a01-2b3c4d5e6f70';
  const row = visitRatings.buttonRow(outboxId);

  assert.equal(row.length, 5);
  assert.deepEqual(row.map(b => b.text), ['1', '2', '3', '4', '5']);

  for (const [i, button] of row.entries()) {
    const { action, value, extra } = parse(button.data);
    assert.equal(action, 'vrate');
    assert.equal(value, outboxId);
    assert.equal(Number(extra), i + 1);
  }
});

test('строка кнопки умещается в 64 байта callback_data Telegram', () => {
  // UUID плюс «vrate:» и «:5» — 44 байта. Запас нужен: превысив предел, Telegram
  // отказывает всему сообщению целиком, а не одной кнопке.
  const longest = visitRatings.buttonRow('4d1f2a9c-77b8-4f2e-9a01-2b3c4d5e6f70')
    .map(b => Buffer.byteLength(b.data, 'utf8'))
    .reduce((a, b) => Math.max(a, b), 0);

  assert.ok(longest <= 64, `callback_data ${longest} байт`);
});

test('причину спрашиваем у тройки и ниже, у четвёрки и пятёрки — нет', () => {
  assert.equal(visitRatings.isLow(1), true);
  assert.equal(visitRatings.isLow(3), true);
  assert.equal(visitRatings.isLow(4), false);
  assert.equal(visitRatings.isLow(5), false);
});

test('оценка вне шкалы отбрасывается до обращения к базе', async () => {
  const subscriber = { id: 'sub-1', platform: 'telegram' };

  for (const score of [0, 6, -1, 2.5, 'три', null, undefined]) {
    const result = await visitRatings.record({ outboxId: 'any', score, subscriber });
    assert.equal(result, null, `оценка ${String(score)} не должна приниматься`);
  }
});

test('без подписчика ожидание причины не ищется', async () => {
  assert.equal(await visitRatings.awaitingComment(null), null);
  assert.equal(await visitRatings.awaitingComment(undefined), null);
});

test('пустая причина не заводит карточку и не трогает оценку', async () => {
  let touched = false;
  const rating = { update: async () => { touched = true; } };

  for (const text of ['', '   ', null, undefined]) {
    const { review } = await visitRatings.attachComment(rating, text);
    assert.equal(review, null);
  }
  assert.equal(touched, false);
});
