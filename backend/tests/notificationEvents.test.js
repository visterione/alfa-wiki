'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { eventFor, dedupKey, parseMisDate, toSnapshot, windowFor } = require('../services/notifications/detector');
const {
  render, valuesFor, firstName, shortDoctor, templatesForEvent
} = require('../services/notifications/templates');
const { matches: doctorIsBlocked, normalizeDoctors } = require('../services/notifications/doctorBlocklist');

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

test('движение визита внутри приёма пациента не касается', () => {
  // «Ожидает» и «на приёме» — внутренняя кухня клиники. Уведомлять о них не о
  // чем, иначе человек получит несколько сообщений за один визит. Статуса 4
  // здесь нет намеренно: завершение приёма — повод попросить отзыв, см. ниже.
  const before = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  for (const statusId of [2, 3]) {
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

test('снимок сохраняет данные для расширенных подстановок', () => {
  const snap = toSnapshot({
    id: 42,
    patient_number: 'PAT-17',
    doctor_id: 91,
    doctor: 'Петрова Мария Сергеевна',
    time_start: '10.09.2026 09:05',
    time_end: '10.09.2026 09:45',
    date_created: '01.09.2026 12:30',
    room: '305',
    author_name: 'Сидорова Анна',
    services: [
      { profession_title: 'Терапевт' },
      { profession_title: 'Терапевт' },
      { profession: 'Кардиолог' }
    ]
  });

  assert.equal(snap.patientNumber, 'PAT-17');
  assert.equal(snap.doctorId, '91');
  assert.equal(snap.timeEnd.getMinutes(), 45);
  assert.equal(snap.reservedAt.getDate(), 1);
  assert.equal(snap.reserveSpecialty, 'Терапевт, Кардиолог');
  assert.equal(snap.room, '305');
  assert.equal(snap.reserveAuthorName, 'Сидорова Анна');
});

// ── Окно опроса МИС ───────────────────────────────────────────────────────
//
// Разбирается отдельно, потому что именно здесь однажды встали уведомления по
// всей сети: окно росло от водяного знака до «сейчас», переставало помещаться
// в таймаут МИС, и перезапуск процесса ничего не менял — знак лежит в базе.

test('первый запуск берёт последнюю минуту, а не всю историю', () => {
  const now = at('2026-09-11T12:00:00Z');
  const { from, to, skippedFrom } = windowFor(null, now);

  assert.equal(from.toISOString(), '2026-09-11T11:59:00.000Z');
  assert.equal(to.toISOString(), now.toISOString());
  assert.equal(skippedFrom, null);
});

test('обычный заход начинается с нахлёстом назад и кончается сейчас', () => {
  const now = at('2026-09-11T12:00:00Z');
  const { from, to, skippedFrom } = windowFor(at('2026-09-11T11:59:00Z'), now);

  // Нахлёст — 90 секунд: часы МИС и наши расходятся, повторы отсекает ключ.
  assert.equal(from.toISOString(), '2026-09-11T11:57:30.000Z');
  assert.equal(to.toISOString(), now.toISOString());
  assert.equal(skippedFrom, null);
});

test('отставший детектор идёт шагами, а не просит весь отрезок разом', () => {
  const now = at('2026-09-11T12:00:00Z');
  // Знак отстал на полтора часа — в MAX_GAP_MS это ещё укладывается.
  const { from, to, skippedFrom } = windowFor(at('2026-09-11T10:30:00Z'), now);

  assert.equal(from.toISOString(), '2026-09-11T10:28:30.000Z');
  assert.equal(to.toISOString(), '2026-09-11T10:58:30.000Z');
  assert.ok(to < now, 'верхняя граница не дотягивается до «сейчас» одним шагом');
  assert.equal(skippedFrom, null);
});

test('суточный перерыв не догоняется: знак переносится к текущему моменту', () => {
  const now = at('2026-09-11T12:00:00Z');
  const { from, to, skippedFrom } = windowFor(at('2026-09-10T09:06:11Z'), now);

  assert.ok(skippedFrom, 'о пропуске надо сообщить наружу');
  assert.equal(from.toISOString(), '2026-09-11T11:30:00.000Z');
  assert.equal(to.toISOString(), now.toISOString());
});

test('окно никогда не шире получаса, сколько бы детектор ни стоял', () => {
  const now = at('2026-09-11T12:00:00Z');
  for (const behind of [0, 1, 60, 3600, 86400, 86400 * 30]) {
    const { from, to } = windowFor(new Date(now.getTime() - behind * 1000), now);
    assert.ok(to.getTime() - from.getTime() <= 30 * 60 * 1000,
      `отставание ${behind}с дало окно шире получаса`);
    assert.ok(to > from, `отставание ${behind}с дало пустое окно`);
  }
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

test('расширенные подстановки визита имеют отдельные форматы', () => {
  const values = valuesFor({
    patientNumber: 'PAT-17',
    patientName: 'Иванов Иван Иванович',
    doctorName: 'Петрова Мария Сергеевна',
    timeStart: at('2026-09-10T09:05:00'),
    timeEnd: at('2026-09-10T09:45:00'),
    reservedAt: at('2026-09-01T12:30:00'),
    reserveSpecialty: 'Терапевт',
    room: '305',
    documentName: 'Заключение',
    documentAuthorName: 'Петрова Мария Сергеевна',
    documentAt: at('2026-09-10T09:50:00'),
    documentClinicName: 'Альфа'
  }, {
    clinicName: 'Альфа',
    clinicAddress: 'ул. Ленина, 1',
    clinicPhone: '+7 900 000-00-00',
    organizationName: 'ООО Альфа',
    organizationPhone: '+7 861 000-00-00',
    currentAt: at('2026-09-02T08:00:00')
  });

  assert.equal(values.логин_пациента, 'PAT-17');
  assert.equal(values.имя_пациента, 'Иван');
  assert.equal(values.фамилия_пациента, 'Иванов');
  assert.equal(values.отчество_пациента, 'Иванович');
  assert.equal(values.дата_и_время_начала, '10.09.2026 09:05');
  assert.equal(values.дата_и_время_начала_без_года, '10.09 09:05');
  assert.equal(values.дата_и_время_начала_формат, '10 сентября 2026 в 09:05');
  assert.equal(values.дата_и_время_начала_формат_без_года, '10 сентября в 09:05');
  assert.equal(values.дата_и_время_окончания, '10.09.2026 09:45');
  assert.equal(values.дата_и_время_резерва, '01.09.2026 12:30');
  assert.equal(values.полное_фио_врача, 'Петрова Мария Сергеевна');
  assert.equal(values.фио_врача, 'Петрова М.С.');
  assert.equal(values.название_организации, 'ООО Альфа');
  assert.equal(values.адрес_клиники, 'ул. Ленина, 1');
  assert.equal(values.текущая_дата, '02.09.2026');
  assert.equal(values.дата_документа, '10.09.2026');
});

test('служебный врач блокируется по ID и по имени для старого снимка', () => {
  const list = normalizeDoctors([
    { id: 91, name: 'Дневной стационар' },
    { id: 91, name: 'дубликат' },
    { name: 'Процедурный кабинет' }
  ]);

  assert.equal(list.length, 2);
  assert.equal(doctorIsBlocked({ doctorId: 91, doctorName: 'Другое имя' }, list), true);
  assert.equal(doctorIsBlocked({ doctorName: '  ПРОЦЕДУРНЫЙ   КАБИНЕТ ' }, list), true);
  assert.equal(doctorIsBlocked({ doctorId: 12, doctorName: 'Иванов Иван' }, list), false);
  assert.equal(doctorIsBlocked({ doctorId: 12, doctorName: 'Дневной стационар' }, list), false);
});

test('неизвестная подстановка остаётся видимой', () => {
  // Молча подставленная пустота прячет опечатку в шаблоне, и её замечают уже по
  // жалобе пациента. Видимые скобки замечают на первом же тестовом сообщении.
  assert.equal(render('Привет, {{чтототам}}', valuesFor({})), 'Привет, {{чтототам}}');
});

test('тексты выбираются только для фактического филиала без общего запаса', () => {
  const rows = [
    { id: 'common', event: 'created', medCenterId: null },
    { id: 'alfa', event: 'created', medCenterId: 'alfa-id' },
    { id: '3k', event: 'created', medCenterId: '3k-id' },
    { id: 'alfa-reminder', event: 'reminder', medCenterId: 'alfa-id' }
  ];

  assert.deepEqual(
    templatesForEvent(rows, 'created', 'alfa-id').map(row => row.id),
    ['alfa']
  );
  assert.deepEqual(templatesForEvent(rows, 'created', null), []);
  assert.deepEqual(templatesForEvent(rows, 'created', 'unknown-id'), []);
});

// ── Просьба об отзыве ─────────────────────────────────────────────────────

test('приём состоялся — просим отзыв', () => {
  const before = { statusId: 1, timeStart: at('2026-09-10T10:00:00') };
  const now = {
    statusId: 4,
    timeStart: at('2026-09-10T10:00:00'),
    dateCompleted: at('2026-09-10T10:40:00')
  };

  const found = eventFor(before, now);
  assert.equal(found.event, 'review');
  // Отсчитывать интервал надо от завершения приёма: он мог задержаться.
  assert.equal(found.completedAt.toISOString(), now.dateCompleted.toISOString());
});

test('уже завершённый визит второй раз отзыв не просит', () => {
  // Завершённым визит остаётся навсегда, и без сравнения с прошлым состоянием
  // просьба уходила бы при каждой последующей правке визита.
  const before = { statusId: 4, timeStart: at('2026-09-10T10:00:00') };
  const now = { statusId: 4, timeStart: at('2026-09-10T10:00:00') };
  assert.equal(eventFor(before, now), null);
});
