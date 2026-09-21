'use strict';

/**
 * Догоняющий ИИ-звонок молчунам (ver. 8.52).
 *
 * Проверяется то, из-за чего звонок может прийти не тому и не тогда: кого мы
 * считаем ответившим, когда звонить уже поздно и что именно уезжает в CRM.
 * Ошибка здесь — не строка в журнале, а звонок живому человеку, и ловить её
 * надо тестом, а не на бою.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isAnswered, reasonToSkip, buildLead, DEFAULT_MIN_LEAD } =
  require('../services/notifications/aiCall');
const { callFields } = require('../services/notifications/templates');

const at = (iso) => new Date(iso);

// Заявка в том виде, в каком её читает разбор: обычная строка модели, без
// поведения — ничего, кроме полей, эти функции от неё не требуют.
const request = (patch = {}) => ({
  id: 'req-1',
  apptId: 555,
  outboxId: 'out-1',
  medCenterId: 'mc-1',
  patientId: 42,
  phone: '+7 (900) 123-45-67',
  patientName: 'Иванов Иван Иванович',
  doctorName: 'Петрова Мария Сергеевна',
  visitAt: at('2026-09-22T10:00:00'),
  plannedAt: at('2026-09-21T12:00:00'),
  minLeadMinutes: 120,
  ...patch
});

// ── Кого считаем ответившим ───────────────────────────────────────────────

test('отметка подтверждения в МИС означает ответ', () => {
  assert.equal(isAnswered({ confirmStatus: 1 }), true);
});

test('нулевой confirm_status ответом не считается', () => {
  assert.equal(isAnswered({ confirmStatus: 0 }), false);
});

test('пустой confirm_status — не отказ и не согласие, а молчание', () => {
  // МИС отдаёт null у визитов, которых подтверждение ни разу не касалось.
  // Считать его ответом значило бы не звонить никому.
  assert.equal(isAnswered({ confirmStatus: null }), false);
  assert.equal(isAnswered({}), false);
});

test('снимка визита нет — ответа не было', () => {
  assert.equal(isAnswered(null), false);
});

// ── Когда звонить уже незачем ─────────────────────────────────────────────

test('подтверждённый визит гасит заявку, даже если срок подошёл', () => {
  const why = reasonToSkip(request(), { confirmStatus: 1, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-21T12:00:00'));
  assert.match(why, /подтверждён/);
});

test('отменённый визит гасит заявку', () => {
  const why = reasonToSkip(request(), { statusId: 5, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-21T12:00:00'));
  assert.equal(why, 'визит отменён');
});

test('состоявшийся приём гасит заявку', () => {
  const why = reasonToSkip(request(), { statusId: 4, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-22T11:00:00'));
  assert.equal(why, 'приём уже состоялся');
});

test('до визита больше порога — звоним', () => {
  const why = reasonToSkip(request({ minLeadMinutes: 120 }),
    { statusId: 1, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-22T07:00:00'));
  assert.equal(why, null);
});

test('до визита меньше порога — поздно, и причина названа', () => {
  // Ровно тот случай, ради которого порог и заведён: напоминание ушло за два
  // часа до приёма, срок звонка — три часа, и без порога звонок пришёлся бы на
  // время, когда человек уже у кабинета.
  const why = reasonToSkip(request({ minLeadMinutes: 120 }),
    { statusId: 1, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-22T09:00:00'));
  assert.match(why, /меньше 120 мин/);
});

test('порог считается по свежему времени визита, а не по снятому при заведении', () => {
  // Визит переехали на час раньше после того, как заявку завели. Перенос обычно
  // гасит заявку сам, но если она дожила — считать надо по новому времени.
  const why = reasonToSkip(
    request({ visitAt: at('2026-09-22T18:00:00'), minLeadMinutes: 120 }),
    { statusId: 1, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-22T09:00:00')
  );
  assert.match(why, /звонить поздно/);
});

test('заявка без порога пользуется умолчанием, а не звонит впритык', () => {
  const why = reasonToSkip(
    request({ minLeadMinutes: null }),
    { statusId: 1, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-22T09:30:00')
  );
  assert.match(why, new RegExp(`меньше ${DEFAULT_MIN_LEAD} мин`));
});

test('нулевой порог исполняется как ноль, а не подменяется умолчанием', () => {
  // Через интерфейс ноль не завести: пустое поле там означает «не звонить», и
  // в базу уезжает NULL. Но правило «ноль — это ноль» должно быть одно и при
  // заведении заявки, и при её разборе, иначе заявка заводится с одним порогом,
  // а гаснет по другому.
  const why = reasonToSkip(
    request({ minLeadMinutes: 0 }),
    { statusId: 1, timeStart: at('2026-09-22T10:00:00') },
    at('2026-09-22T09:59:00')
  );
  assert.equal(why, null);
});

test('снимка визита уже нет — идём по тому, что записано в заявке', () => {
  assert.equal(reasonToSkip(request(), null, at('2026-09-22T07:00:00')), null);
  assert.match(reasonToSkip(request(), null, at('2026-09-22T09:00:00')), /звонить поздно/);
});

// ── Что уезжает в CRM ─────────────────────────────────────────────────────

test('в лиде есть всё, ради чего он заводился', () => {
  const snap = {
    clinicId: 4,
    clinicName: 'Альфа Линия',
    patientNumber: 'A-1024',
    doctorId: '77',
    room: '12',
    reserveSpecialty: 'Терапевт'
  };
  const lead = buildLead(request(), snap, { id: 'mc-1', name: 'Линия' });

  assert.equal(lead.patient.name, 'Иванов Иван Иванович');
  assert.equal(lead.clinic.misId, 4);
  assert.equal(lead.clinic.id, 'mc-1');
  assert.equal(lead.visit.misId, 555);
  assert.equal(lead.doctor.name, 'Петрова Мария Сергеевна');
});

test('телефон уезжает в одном виде, а не в том, как его записали в МИС', () => {
  const lead = buildLead(request({ phone: '8 (900) 123-45-67' }), null, null);
  assert.equal(lead.patient.phone, '79001234567');
});

test('время визита идёт и машинным, и человеческим', () => {
  // ISO приезжает в UTC, и разница с местным временем — ровно та ошибка, из-за
  // которой человеку называют чужой час приёма.
  const lead = buildLead(request({ visitAt: at('2026-09-22T10:00:00') }), null, null);
  assert.equal(lead.visit.atText, '22.09.2026 10:00');
  assert.ok(lead.visit.at.startsWith('2026-09-'));
});

test('название филиала берётся из справочника портала, а не из МИС', () => {
  // В МИС клиника зовётся «Альфа Линия», в справочнике — «Линия». Партнёру
  // нужно то имя, под которым филиал заведён у нас.
  const lead = buildLead(request(), { clinicName: 'Альфа Линия' }, { id: 'mc-1', name: 'Линия' });
  assert.equal(lead.clinic.name, 'Линия');
});

test('филиал не нашёлся — имя из МИС лучше, чем пусто', () => {
  const lead = buildLead(request(), { clinicName: 'Альфа Линия' }, null);
  assert.equal(lead.clinic.name, 'Альфа Линия');
});

// ── Какому событию звонок вообще положен ──────────────────────────────────

test('звонок положен напоминанию с кнопкой', () => {
  assert.deepEqual(
    callFields({ event: 'reminder', withConfirm: true, callAfterMinutes: 180, callMinLeadMinutes: 120 }),
    { callAfterMinutes: 180, callMinLeadMinutes: 120 }
  );
});

test('у записи на визит звонка не бывает, даже если поля заполнены', () => {
  // Человек минуту назад говорил с администратором — переспрашивать роботом
  // «придёте ли вы» значит показать, что мы его не услышали.
  assert.deepEqual(
    callFields({ event: 'created', withConfirm: true, callAfterMinutes: 180, callMinLeadMinutes: 120 }),
    { callAfterMinutes: null, callMinLeadMinutes: null }
  );
});

test('снятая кнопка «Подтверждаю» уносит и звонок', () => {
  assert.deepEqual(
    callFields({ event: 'reminder', withConfirm: false, callAfterMinutes: 180, callMinLeadMinutes: 120 }),
    { callAfterMinutes: null, callMinLeadMinutes: null }
  );
});

test('срок не задан — напоминание уходит, но заявки не будет', () => {
  assert.deepEqual(
    callFields({ event: 'reminder', withConfirm: true, callAfterMinutes: null, callMinLeadMinutes: 120 }),
    { callAfterMinutes: null, callMinLeadMinutes: 120 }
  );
});
