'use strict';

/**
 * Приёмник событий от МИС: разбор тела и ключ повтора (ver. 8.25).
 *
 * Настоящего события от Renovatio не приходило ещё ни одного, и формат тела нам
 * неизвестен. Именно поэтому разбор терпимый — и именно поэтому его надо
 * закрепить тестом: правки «на глазок» по первому реальному запросу легко
 * ломают разбор всех остальных написаний, а заметить это будет некому.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { toSnapshot, eventKey, dedupKeyFor } = require('../routes/mis-events');

// ── Имя события ───────────────────────────────────────────────────────────

test('имя события узнаётся в любом принятом написании', () => {
  assert.equal(eventKey('lab_full'), 'lab_full');
  assert.equal(eventKey('LAB-FULL'), 'lab_full');
  assert.equal(eventKey('lab_partial'), 'lab_partial');
  assert.equal(eventKey('lab-part'), 'lab_partial');
  // Настройку в МИС заводит человек, наших ключей не видевший, поэтому
  // синонимы есть. Но выдумывать за него мы не должны: неизвестное имя обязано
  // остаться неизвестным и попасть в журнал с причиной.
  assert.equal(eventKey('готовность'), null);
  assert.equal(eventKey(''), null);
});

// ── Разбор тела ───────────────────────────────────────────────────────────

test('поля находятся независимо от разделителей и регистра', () => {
  const snap = toSnapshot({
    Patient_Phone: '+7 918 000-00-00',
    patientName: 'Иванов Иван Иванович',
    'clinic-id': '12',
    document_name: 'Общий анализ крови'
  });

  assert.equal(snap.phone, '+7 918 000-00-00');
  assert.equal(snap.patientName, 'Иванов Иван Иванович');
  assert.equal(snap.clinicId, 12);
  assert.equal(snap.documentName, 'Общий анализ крови');
});

test('вложенное тело разбирается, но верхний уровень сильнее', () => {
  const snap = toSnapshot({
    clinic: 'Альфа Линия',
    patient: { phone: '79180000000', name: 'Петров Пётр', id: 4242 },
    // Одноимённое поле внутри вложенного объекта не должно побеждать: у
    // события клиника своя, а у пациента — та, где он заведён.
    data: { clinic: 'Альфа Дети' }
  });

  assert.equal(snap.clinicName, 'Альфа Линия');
  assert.equal(snap.phone, '79180000000');
  assert.equal(snap.patientName, 'Петров Пётр');
});

test('дата понимается и в ISO, и в том виде, в каком её пишет МИС', () => {
  assert.equal(toSnapshot({ date_ready: '12.09.2026 14:30' }).documentAt.getHours(), 14);
  assert.equal(toSnapshot({ date_ready: '2026-09-12T14:30:00' }).documentAt.getHours(), 14);
  assert.equal(toSnapshot({}).documentAt, null);
});

// ── Ключ повтора ──────────────────────────────────────────────────────────

test('повтор того же толчка отсекается, а новая порция проходит', () => {
  const body = { patient_id: 7, phone: '79180000000', ready: 3 };
  assert.equal(
    dedupKeyFor('lab_partial', toSnapshot(body), body),
    dedupKeyFor('lab_partial', toSnapshot(body), body)
  );

  const next = { ...body, ready: 5 };
  assert.notEqual(
    dedupKeyFor('lab_partial', toSnapshot(next), next),
    dedupKeyFor('lab_partial', toSnapshot(body), body)
  );
});

test('номер заказа становится ключом, а голое id — нет', () => {
  const withOrder = { order_id: 'A-77', phone: '79180000000' };
  assert.equal(dedupKeyFor('lab_full', toSnapshot(withOrder), withOrder), 'mis:lab_full:A-77');

  // Голое «id» есть у чего угодно. Стань оно ключом повтора, и стоит ему
  // оказаться идентификатором клиники, как все лабораторные события филиала
  // схлопнутся в одну строку и замолчат разом.
  const withId = { id: 12, phone: '79180000000' };
  assert.notEqual(dedupKeyFor('lab_full', toSnapshot(withId), withId), 'mis:lab_full:12');
});

test('событие одного типа не сталкивается с событием другого', () => {
  const body = { order_id: 'A-77' };
  assert.notEqual(
    dedupKeyFor('lab_full', toSnapshot(body), body),
    dedupKeyFor('lab_partial', toSnapshot(body), body)
  );
});
