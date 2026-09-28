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

const { isAnswered, reasonToSkip, visitFields, leadName, normalizeResult,
        TO_MIS, FIELD_NAMES, REQUIRED_FIELDS, DEFAULT_MIN_LEAD } =
  require('../services/notifications/aiCall');
const { customFor } = require('../services/notifications/lptracker');
const { callFields, callRangeError } = require('../services/notifications/templates');

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
//
// С 8.95 состав не наш, а партнёра: поля в его проекте уже заведены под выгрузку
// из МИС, и сценарий робота читает именно их имена.

const snapshot = {
  clinicId: 4,
  clinicName: 'Альфа Линия',
  patientNumber: 'A-1024',
  doctorId: '77',
  room: '12',
  reserveSpecialty: 'Терапевт',
  timeEnd: at('2026-09-22T10:30:00')
};

test('в лиде есть всё, ради чего он заводился', () => {
  const fields = visitFields(request(), snapshot, { id: 'mc-1', name: 'Линия' });

  assert.equal(fields.appointment_id, '555');
  assert.equal(fields.patient_name, 'Иванов Иван Иванович');
  assert.equal(fields.clinic_title, 'Линия');
  assert.equal(fields.clinic_id, '4');
  assert.equal(fields.doctor_name, 'Петрова Мария Сергеевна');
});

test('четыре обязательных поля заполнены всегда, даже без снимка визита', () => {
  // Снимок теряется, если визит удалили из МИС между заведением заявки и сроком.
  // Заявка при этом остаётся, и звонок по ней должен быть осмысленным.
  const fields = visitFields(request(), null, { id: 'mc-1', name: 'Линия' });
  for (const name of REQUIRED_FIELDS) {
    assert.ok(fields[name], `поле ${name} осталось пустым`);
  }
});

test('телефон уезжает в одном виде, а не в том, как его записали в МИС', () => {
  assert.equal(visitFields(request({ phone: '8 (900) 123-45-67' }), null, null).mobile, '79001234567');
});

test('время визита уходит словом МИС, а не в UTC', () => {
  // ISO с зоной сместил бы приём на три часа, и робот назвал бы чужой час.
  const fields = visitFields(request({ visitAt: at('2026-09-22T10:00:00') }), null, null);
  assert.equal(fields.time_start, '2026-09-22 10:00:00');
});

test('в названии лида видно, кто, когда и куда записан', () => {
  const name = leadName(request(), snapshot, { id: 'mc-1', name: 'Линия' });
  assert.equal(name, 'Напоминание о визите · Иванов Иван Иванович · 22.09.2026 10:00 · Линия');
});

test('название филиала берётся из справочника портала, а не из МИС', () => {
  // В МИС клиника зовётся «Альфа Линия», в справочнике — «Линия». Партнёру
  // нужно то имя, под которым филиал заведён у нас.
  const fields = visitFields(request(), { clinicName: 'Альфа Линия' }, { id: 'mc-1', name: 'Линия' });
  assert.equal(fields.clinic_title, 'Линия');
});

test('филиал не нашёлся — имя из МИС лучше, чем пусто', () => {
  const fields = visitFields(request(), { clinicName: 'Альфа Линия' }, null);
  assert.equal(fields.clinic_title, 'Альфа Линия');
});

// ── Сопоставление полей проекта ───────────────────────────────────────────

test('поля сопоставляются по имени и попадают под свои id', () => {
  const map = new Map([
    ['appointment_id', { id: 2837744, type: 'text' }],
    ['patient_name', { id: 3860024, type: 'text' }]
  ]);
  const { custom, missing } = customFor(map, { appointment_id: '555', patient_name: 'Иванов' });

  assert.deepEqual(custom, { 2837744: '555', 3860024: 'Иванов' });
  assert.deepEqual(missing, []);
});

test('поля, которого в проекте нет, называем вслух, а не подставляем в чужое', () => {
  const map = new Map([['appointment_id', { id: 1, type: 'text' }]]);
  const { custom, missing } = customFor(map, { appointment_id: '555', clinic_title: 'Линия' });

  assert.deepEqual(custom, { 1: '555' });
  assert.deepEqual(missing, ['clinic_title']);
});

test('пустое значение не занимает поле', () => {
  // Пустая строка в кастомном поле у партнёра выглядит как заполненное поле, и
  // «дата визита: (пусто)» хуже отсутствующей даты: её видно только в карточке.
  const map = new Map([['room', { id: 9, type: 'text' }]]);
  assert.deepEqual(customFor(map, { room: null }).custom, {});
  assert.deepEqual(customFor(map, { room: '' }).custom, {});
});

test('имя поля сверяется без учёта регистра и пробелов по краям', () => {
  const map = new Map([['patient_name', { id: 7, type: 'text' }]]);
  assert.deepEqual(customFor(map, { ' Patient_Name ': 'Иванов' }).custom, { 7: 'Иванов' });
});

// ── Итог звонка ───────────────────────────────────────────────────────────

test('исход приезжает нашим кодом или их словом — понимаем оба', () => {
  assert.equal(normalizeResult('confirmed'), 'confirmed');
  assert.equal(normalizeResult('Подтвердил'), 'confirmed');
  assert.equal(normalizeResult('ОТМЕНИЛ'), 'cancelled');
  assert.equal(normalizeResult('AI · Не дозвонились'), 'no_answer');
});

test('в МИС уходят ровно два исхода из девяти', () => {
  assert.equal(TO_MIS.confirmed, 'confirm');
  assert.equal(TO_MIS.cancelled, 'cancel');
  for (const code of ['no_answer', 'voicemail', 'hangup', 'callback', 'operator', 'unclear', 'other']) {
    assert.equal(TO_MIS[code], undefined, `исход ${code} не должен менять визит`);
  }
});

test('незнакомый исход не теряется, а становится other', () => {
  // Партнёр добавит шаг воронки, не спросив нас; потерять такой итог хуже, чем
  // не понять его — по нему хотя бы видно, что звонок состоялся.
  assert.equal(normalizeResult('AI · какой-то новый шаг'), 'other');
});

test('пустой исход — не исход', () => {
  assert.equal(normalizeResult(''), null);
  assert.equal(normalizeResult(null), null);
  assert.equal(normalizeResult(undefined), null);
});

test('список полей и обязательных среди них не расходятся', () => {
  for (const name of REQUIRED_FIELDS) {
    assert.ok(FIELD_NAMES.includes(name), `обязательное поле ${name} не заполняется`);
  }
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

// ── Сроки звонка против срока напоминания ─────────────────────────────────
//
// Правило заказчика (ver. 8.95): «позвонить через» и «не звонить позже чем за» не
// могут быть больше, чем «напомнить за». Иначе получается настройка, которая
// выглядит заполненной и не звонит никогда: напоминание уходит за сутки, а звонок
// назначен через трое.

test('обычные сроки под напоминанием за сутки противоречий не имеют', () => {
  assert.equal(callRangeError(1440, { callAfterMinutes: 120, callMinLeadMinutes: 120 }), null);
});

test('срок звонка больше срока напоминания — звонок пришёлся бы после приёма', () => {
  const why = callRangeError(1440, { callAfterMinutes: 4320, callMinLeadMinutes: 120 });
  assert.match(why, /после приёма/);
  // В сообщении обе величины словами: сравнивать «4320» и «1440» глазами неудобно.
  assert.match(why, /3 сут\./);
  assert.match(why, /1 сут\./);
});

test('равенство тоже запрещено: звонок ровно в час приёма никому не нужен', () => {
  assert.match(callRangeError(120, { callAfterMinutes: 120 }), /после приёма/);
});

test('порог больше срока напоминания — заявка погасла бы, не дождавшись срока', () => {
  assert.match(
    callRangeError(1440, { callAfterMinutes: 60, callMinLeadMinutes: 2880 }),
    /не дождавшись срока/
  );
});

test('выключенный звонок не проверяется: сравнивать нечего', () => {
  assert.equal(callRangeError(1440, { callAfterMinutes: null, callMinLeadMinutes: 120 }), null);
  assert.equal(callRangeError(1440, {}), null);
});

test('напоминание без срока проверку не запирает', () => {
  // beforeMinutes у шаблона может быть пустым — тогда время напоминания задаёт
  // не он, и запрещать звонок из-за этого не за что.
  assert.equal(callRangeError(null, { callAfterMinutes: 180 }), null);
});

test('сумма срока и порога, съедающая окно, не запрещена', () => {
  // Это осознанный выбор «звони только в первый час», а не противоречие.
  // Интерфейс о нём предупреждает, сервер пропускает.
  assert.equal(callRangeError(180, { callAfterMinutes: 120, callMinLeadMinutes: 60 }), null);
});
