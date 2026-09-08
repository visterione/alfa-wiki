'use strict';

/**
 * Рекламные рассылки подписчикам ботов (ver. 8.07).
 *
 * Проверяется здесь не механика отправки, а решения, которые из кода не
 * выводятся и которые дорого потерять при следующей правке: кого рассылка не
 * видит, куда она не имеет права уйти и что кнопка отписки есть под каждым
 * сообщением.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const broadcasts = require('../services/broadcasts');
const telegram = require('../services/messengers/telegram');
const max = require('../services/messengers/max');

// ── Аудитория ─────────────────────────────────────────────────────────────

test('рассылка не видит заблокировавших, отписавшихся и выгрузку из Fromni', () => {
  const filter = broadcasts.subscriberFilter({ platform: 'telegram', organization: 'alfa' });

  assert.equal(filter.isBlocked, false);
  assert.equal(filter.marketingOptOut, false);
  // source='bot' — это и есть отсечение выгрузки из Fromni (source='import'),
  // у которой пуст botId. Включение отложено решением заказчика.
  assert.equal(filter.source, 'bot');

  // Подписчик привязан к паре «платформа + организация», а медцентр знает о
  // себе только бот — поэтому оба поля берутся у него.
  assert.equal(filter.platform, 'telegram');
  assert.equal(filter.organization, 'alfa');
});

// ── Текст ─────────────────────────────────────────────────────────────────

test('текст длиннее подписи под картинкой не принимается', () => {
  // 1024 — предел caption у Telegram. Держим его и для рассылки без картинки:
  // иначе добавленная в последний момент картинка молча обрезала бы текст.
  assert.equal(broadcasts.TEXT_LIMIT, 1024);

  assert.throws(
    () => broadcasts.validate({ title: 'Акция', text: 'я'.repeat(1025) }),
    /1024/
  );
  assert.doesNotThrow(() => broadcasts.validate({ title: 'Акция', text: 'я'.repeat(1024) }));
});

test('черновик может быть пустым, а отправляемое сообщение — нет', () => {
  // Черновик заводят до того, как придумали текст: запрет на пустоту здесь
  // означал бы обязанность сразу сочинить рассылку.
  assert.doesNotThrow(() => broadcasts.validate({ title: 'Акция', text: '' }));
  assert.throws(() => broadcasts.validate({ title: '  ', text: 'текст' }), /название/);

  // А вот уйти людям пустое сообщение не может — как и рассылка в никуда.
  assert.throws(
    () => broadcasts.validateSendable({ text: '   ', medCenterIds: ['id'] }),
    /Пустую/
  );
  assert.throws(
    () => broadcasts.validateSendable({ text: 'Акция', medCenterIds: [] }),
    /медцентр/
  );
  assert.doesNotThrow(() => broadcasts.validateSendable({ text: 'Акция', medCenterIds: ['id'] }));
});

// ── Отправка одного сообщения ─────────────────────────────────────────────

function fakeChannel() {
  const calls = [];
  return {
    calls,
    async sendText(bot, chatId, text, options) {
      calls.push({ method: 'sendText', chatId, text, options });
      return { externalMessageId: 'text-1' };
    },
    async sendPhoto(bot, chatId, photo, caption, options) {
      calls.push({ method: 'sendPhoto', chatId, photo, caption, options });
      return { externalMessageId: 'photo-1', fileId: 'FILE-ID' };
    }
  };
}

const subscriber = { externalUserId: '5551' };

test('под рекламным сообщением всегда есть кнопка отписки', async () => {
  // Без неё единственный доступный человеку способ прекратить рекламу —
  // заблокировать бота, а вместе с ней он унесёт напоминания о визитах.
  for (const broadcast of [
    { text: 'Акция', imagePath: null },
    { text: 'Акция', imagePath: 'broadcasts/a.jpg' }
  ]) {
    const channel = fakeChannel();
    const buffer = broadcast.imagePath ? Buffer.from('картинка') : null;
    await broadcasts.deliver(channel, {}, subscriber, broadcast, buffer, null);

    const button = channel.calls[0].options.buttons[0][0];
    assert.equal(button.data, 'unsub');
    assert.match(button.text, /рассылк/i);
  }
});

test('картинка уходит файлом один раз, дальше — идентификатором', async () => {
  const broadcast = { text: 'Акция', imagePath: 'broadcasts/a.jpg' };
  const buffer = Buffer.from('картинка');

  const first = fakeChannel();
  const result = await broadcasts.deliver(first, {}, subscriber, broadcast, buffer, null);
  assert.equal(first.calls[0].method, 'sendPhoto');
  assert.equal(first.calls[0].photo.fileId, null);
  assert.ok(first.calls[0].photo.buffer, 'первому адресату картинка уходит телом запроса');
  assert.equal(result.fileId, 'FILE-ID');

  const next = fakeChannel();
  await broadcasts.deliver(next, {}, subscriber, broadcast, buffer, 'FILE-ID');
  assert.equal(next.calls[0].photo.fileId, 'FILE-ID');
});

test('рассылка без картинки уходит обычным текстом', async () => {
  const channel = fakeChannel();
  await broadcasts.deliver(channel, {}, subscriber, { text: 'Акция', imagePath: null }, null, null);
  assert.equal(channel.calls[0].method, 'sendText');
  assert.equal(channel.calls[0].text, 'Акция');
});

// ── Каналы ────────────────────────────────────────────────────────────────

test('картинку умеют отправлять оба канала', () => {
  // Рассылка не знает, чей код исполняется, — как и остальная отправка.
  assert.equal(typeof telegram.sendPhoto, 'function');
  assert.equal(typeof max.sendPhoto, 'function');
});

// ── Запрет на платные каналы ──────────────────────────────────────────────

test('рассылка не имеет доступа к платным провайдерам', () => {
  // Проверка по исходнику намеренно. Реклама, ушедшая SMS-кой через Fromni или
  // Имобис, — это не оплошность, а нарушение 38-ФЗ ст. 18 с готовым заявителем
  // на другом конце, и заметить такое по журналу можно только постфактум.
  // Отсутствие каскада — свойство модуля, а не аккуратность вызывающего, и
  // единственный способ его удержать — не давать движку этих модулей вовсе.
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcasts.js'), 'utf8');

  for (const forbidden of ['messengers/fromni', 'messengers/imobis', 'notifications/sender']) {
    assert.ok(!source.includes(forbidden), `движок рассылок не должен знать про ${forbidden}`);
  }
});
