'use strict';

/**
 * Отказ пациента от оповещений (ver. 8.08).
 *
 * Пока рассылку вёл движок МИС, отказ соблюдал он. Мы движок выключаем, и
 * проверка переезжает к нам — а вместе с ней и цена ошибки: сообщение, ушедшее
 * вопреки подписанному отказу, разбирается уже не с программистом.
 *
 * Проверяется именно граница «отказ / не отказ»: в боевой базе send_sms бывает
 * true, false и null, и последнее встречается у карточек, которых поле ни разу
 * не касалось.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const consent = require('../services/notifications/consent');

test('отказ — только явное false', () => {
  assert.equal(consent.decide([{ patient_id: 1, send_sms: true }]).allowed, true);
  // null стоит у карточек, которых поле не касалось: в выборке за март 2024
  // таких 14 из 3638. Это не отказ, и молчать для них нельзя.
  assert.equal(consent.decide([{ patient_id: 2, send_sms: null }]).allowed, true);
  assert.equal(consent.decide([{ patient_id: 3 }]).allowed, true);
  assert.equal(consent.decide([{ patient_id: 4, send_sms: false }]).allowed, false);
});

test('карточки нет — значит нет и подписи под отказом', () => {
  assert.equal(consent.decide([]).allowed, true);
  assert.equal(consent.decide(null).allowed, true);
});

test('в семье по одному номеру хватает одного отказа', () => {
  // Кому из них уйдёт сообщение, мы не знаем: телефон общий. Выбираем в пользу
  // того, кто отказ подписал.
  const family = [
    { patient_id: 10, send_sms: true },
    { patient_id: 11, send_sms: false },
    { patient_id: 12, send_sms: true }
  ];

  const verdict = consent.decide(family);
  assert.equal(verdict.allowed, false);
  // Причина попадает в журнал очереди, и по ней должно быть видно, чья именно
  // карточка закрыла отправку.
  assert.match(verdict.reason, /11/);
});

test('известный отказ отвечает сам, без похода в МИС', async () => {
  consent.forget();
  consent.remember(777, false);

  // Сети в тесте нет: если бы check пошёл в МИС, он бы не ответил отказом.
  const verdict = await consent.check({ patientId: 777 });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.unknown, false);
});

test('отказ одного из членов семьи закрывает отправку и по кэшу', async () => {
  consent.forget();
  consent.remember(20, true);
  consent.remember(21, false);

  const verdict = await consent.check({ patientId: [20, 21] });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.unknown, false);
});

test('без карточки и без телефона отправка не запрещается', async () => {
  consent.forget();
  // Так выглядят строки очереди, пришедшие не из визита. Запрет по умолчанию
  // означал бы, что модуль замолчал целиком, — и заметили бы это не сразу.
  const verdict = await consent.check({});
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.unknown, false);
});

test('ответ МИС не считается вечным', () => {
  consent.forget();
  consent.remember(31, true);
  assert.equal(consent.known(31), true);
  assert.equal(consent.known(32), undefined);

  // Отказ подписывают на стойке регистратуры, а напоминание уходит часами
  // позже: кэш, живущий вечно, соблюдал бы отказ со вчерашней задержкой.
  assert.ok(consent.TTL <= 15 * 60 * 1000, 'ответ МИС не должен жить дольше четверти часа');
});

test('кэш не растёт без предела', () => {
  consent.forget();
  // Рассылка на сеть — тысячи адресатов за заход, и каждый оставляет запись.
  for (let i = 0; i < consent.MAX_ENTRIES + 50; i++) consent.remember(i, true);

  // Вытесняется давнее, а не только что записанное.
  assert.equal(consent.known(0), undefined);
  assert.equal(consent.known(consent.MAX_ENTRIES + 49), true);
});
