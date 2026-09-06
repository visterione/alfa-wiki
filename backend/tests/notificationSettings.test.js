'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isQuiet, nextAllowed, quietFor, minutesOf, DEFAULT_QUIET } = require('../services/notifications/settings');

const at = (h, m = 0) => {
  const d = new Date('2026-09-10T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
};

const night = { enabled: true, from: '21:00', to: '09:00', channels: ['sms+webchat'] };

// ── Попадание в тихие часы ────────────────────────────────────────────────

test('интервал через полночь считается в обе стороны', () => {
  // Самая частая ошибка в таком сравнении: «с 21 до 9» разваливается, если
  // сравнивать одним неравенством.
  assert.equal(isQuiet(night, at(22)), true);
  assert.equal(isQuiet(night, at(3)), true);
  assert.equal(isQuiet(night, at(8, 59)), true);
  assert.equal(isQuiet(night, at(9)), false);
  assert.equal(isQuiet(night, at(14)), false);
  assert.equal(isQuiet(night, at(20, 59)), false);
  assert.equal(isQuiet(night, at(21)), true);
});

test('обычный интервал внутри суток тоже работает', () => {
  const lunch = { enabled: true, from: '13:00', to: '14:00', channels: [] };
  assert.equal(isQuiet(lunch, at(13, 30)), true);
  assert.equal(isQuiet(lunch, at(12, 59)), false);
  assert.equal(isQuiet(lunch, at(14)), false);
});

test('выключенные тихие часы никого не молчат', () => {
  assert.equal(isQuiet({ ...night, enabled: false }, at(3)), false);
  assert.equal(isQuiet(null, at(3)), false);
});

// ── Куда откладываем ──────────────────────────────────────────────────────

test('ночное сообщение ждёт того же утра', () => {
  const when = nextAllowed(night, at(3, 20));
  assert.equal(when.getHours(), 9);
  assert.equal(when.getDate(), at(3).getDate());
});

test('вечернее сообщение ждёт утра следующего дня', () => {
  const evening = at(22, 10);
  const when = nextAllowed(night, evening);
  assert.equal(when.getHours(), 9);
  assert.equal(when.getDate(), evening.getDate() + 1);
});

// ── Какие каналы молчат ───────────────────────────────────────────────────

test('молчат только перечисленные каналы', () => {
  assert.equal(quietFor(night, 'sms+webchat'), true);
  // Бот по умолчанию не молчит: сообщение в мессенджере не будит так, как SMS.
  assert.equal(quietFor(night, 'bot'), false);
  assert.equal(quietFor(DEFAULT_QUIET, 'bot'), false);
  assert.equal(quietFor(DEFAULT_QUIET, 'notify+vk'), true);
});

test('время разбирается терпимо к мусору', () => {
  assert.equal(minutesOf('09:30'), 570);
  assert.equal(minutesOf('21:00'), 1260);
  assert.equal(minutesOf(''), 0);
  assert.equal(minutesOf(null), 0);
});
