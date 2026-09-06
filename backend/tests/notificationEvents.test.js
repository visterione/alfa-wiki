'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { eventFor, dedupKey, parseMisDate } = require('../services/notifications/detector');
const { render, valuesFor, firstName, shortDoctor } = require('../services/notifications/templates');

const at = (iso) => new Date(iso);

// ── Какие изменения визита становятся уведомлением ────────────────────────

test('визита не было — это запись', () => {
  const now = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  assert.deepEqual(eventFor(null, now), { event: 'created' });
});

test('сменилось время — это перенос, старое время сохраняется', () => {
  const before = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  const now = { statusId: 1, timeStart: at('2026-09-11T14:30:00') };

  const found = eventFor(before, now);
  assert.equal(found.event, 'moved');
  assert.equal(found.previousAt.toISOString(), before.timeStart.toISOString());
});

test('статус 5 — отмена', () => {
  const before = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  const now = { statusId: 5, timeStart: at('2026-09-10T10:00:00') };
  assert.deepEqual(eventFor(before, now), { event: 'cancelled' });
});

test('уже отменённый визит второй раз не уведомляет', () => {
  const before = { statusId: 5, timeStart: at('2026-09-10T10:00:00') };
  const now = { statusId: 5, timeStart: at('2026-09-10T10:00:00') };
  assert.equal(eventFor(before, now), null);
});

test('прочие правки визита пациента не касаются', () => {
  // Тот же визит с другим статусом внутри приёма: ожидает, на приёме, завершён.
  // Уведомлять тут не о чем, иначе человек получит четыре сообщения за визит.
  const before = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  for (const statusId of [2, 3, 4]) {
    assert.equal(eventFor(before, { statusId, timeStart: at('2026-09-10T10:00:00') }), null);
  }
});

test('отмена важнее переноса: перенесённый и отменённый визит — отмена', () => {
  const before = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  const now = { statusId: 5, timeStart: at('2026-09-12T09:00:00') };
  assert.equal(eventFor(before, now).event, 'cancelled');
});

// ── Идемпотентность ───────────────────────────────────────────────────────

test('ключ повтора одинаков у одного и того же события', () => {
  const snap = { apptId: 42, timeStart: at('2026-09-10T10:00:00') };
  assert.equal(dedupKey('created', snap), dedupKey('created', snap));
});

test('перенос на другое время — другой ключ', () => {
  const first = { apptId: 42, timeStart: at('2026-09-10T10:00:00') };
  const second = { apptId: 42, timeStart: at('2026-09-11T10:00:00') };
  assert.notEqual(dedupKey('moved', first), dedupKey('moved', second));
});

// ── Разбор дат МИС ────────────────────────────────────────────────────────

test('дата МИС читается в обоих форматах', () => {
  assert.equal(parseMisDate('2026-09-10 10:00:00').getHours(), 10);
  assert.equal(parseMisDate('10.09.2026 14:30').getMinutes(), 30);
  assert.equal(parseMisDate(null), null);
});

// ── Шаблоны ───────────────────────────────────────────────────────────────

test('обращаемся по имени, а не по фамилии', () => {
  assert.equal(firstName('Иванов Иван Иванович'), 'Иван');
  assert.equal(firstName('Иван'), 'Иван');
  assert.equal(firstName(''), '');
});

test('врач сокращается до фамилии с инициалами', () => {
  assert.equal(shortDoctor('Петрова Мария Сергеевна'), 'Петрова М.С.');
  assert.equal(shortDoctor('Петрова Мария'), 'Петрова М.');
});

test('подстановки заполняются', () => {
  const values = valuesFor({
    patientName: 'Иванов Иван Иванович',
    doctorName: 'Петрова Мария Сергеевна',
    timeStart: at('2026-09-10T09:05:00')
  }, { clinicName: 'Альфа' });

  const text = render('Здравствуйте, {{имя}}! {{дата}} в {{время}}, врач {{врач}}. {{клиника}}.', values);
  assert.equal(text, 'Здравствуйте, Иван! 10 сентября в 09:05, врач Петрова М.С. Альфа.');
});

test('неизвестная подстановка остаётся видимой', () => {
  // Молча подставленная пустота прячет опечатку в шаблоне, и её замечают уже по
  // жалобе пациента. Видимые скобки замечают на первом же тестовом сообщении.
  assert.equal(render('Привет, {{чтототам}}', valuesFor({})), 'Привет, {{чтототам}}');
});
