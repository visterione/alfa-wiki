'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isQuiet, nextAllowed, quietFor, minutesOf, DEFAULT_QUIET } = require('../services/notifications/settings');

const at = (h, m = 0) => {
  const d = new Date('2026-09-10T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
};

const night = { enabled: true, from: '21:00', to: '09:00', channels: ['imobis:sms'] };

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
  assert.equal(quietFor(night, 'imobis:sms'), true);
  // Бот по умолчанию не молчит: сообщение в мессенджере не будит так, как SMS.
  assert.equal(quietFor(night, 'bot'), false);
  assert.equal(quietFor(DEFAULT_QUIET, 'bot'), false);
  assert.equal(quietFor(DEFAULT_QUIET, 'imobis:vk'), true);
});

test('время разбирается терпимо к мусору', () => {
  assert.equal(minutesOf('09:30'), 570);
  assert.equal(minutesOf('21:00'), 1260);
  assert.equal(minutesOf(''), 0);
  assert.equal(minutesOf(null), 0);
});

// ── Счёт филиала и источник события (ver. 8.25) ───────────────────────────
//
// Проверяется разбор строки настроек филиала, а не поход за ней в базу: сама
// выборка тривиальна, а вот два решения заказчика из кода не выводятся —
// «счёт у каждого медцентра свой» и «путь выбирается на каждое событие».

const { resolveImobis, resolveEventSources } = require('../services/notifications/settings');

test('счёт у Имобиса берётся у филиала и ни от кого не наследуется', () => {
  // До 8.25 пустое поле филиала означало «взять общий счёт сети», и SMS уходила
  // с лицевого счёта другого юрлица. Обнаруживалось это счётом в конце месяца.
  const empty = resolveImobis(null);
  assert.equal(empty.token, '');
  assert.equal(empty.sender, '');

  const own = resolveImobis({ imobis: { token: 'own-token', sender: 'ALFA-KIDS' } });
  assert.equal(own.token, 'own-token');
  assert.equal(own.sender, 'ALFA-KIDS');
  // Незаполненное у филиала остаётся пустым, а не подтягивается ниоткуда.
  assert.equal(own.vkGroup, null);
  assert.equal(own.sandbox, false);
});

test('лабораторные события по умолчанию ждут вебхука, остальные — забора', () => {
  // Поллер под готовность анализов написать нельзя: getPatientLabResults
  // требует patient_key, выдаваемый только по логину пациента.
  const sources = resolveEventSources(null);
  assert.equal(sources.created, 'poll');
  assert.equal(sources.reminder, 'poll');
  assert.equal(sources.lab_full, 'webhook');
  assert.equal(sources.lab_partial, 'webhook');
});

test('филиал переопределяет путь по одному событию, не трогая остальные', () => {
  const sources = resolveEventSources({ eventSources: { created: 'webhook' } });
  assert.equal(sources.created, 'webhook');
  assert.equal(sources.moved, 'poll', 'соседнее событие остаётся при своём умолчании');
  assert.equal(sources.lab_full, 'webhook');
});

test('мусор в настройке источника не превращается в молчание', () => {
  // Неизвестное значение означало бы событие, которое не берётся ни забором, ни
  // вебхуком, — то есть тишину без следа в журнале.
  const sources = resolveEventSources({ eventSources: { created: 'magic', review: 'webhook' } });
  assert.equal(sources.created, 'poll');
  assert.equal(sources.review, 'webhook');
});
