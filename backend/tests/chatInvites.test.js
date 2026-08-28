'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Базовый адрес задаём до require: сервис читает переменную при сборке ссылки,
// и без неё тесты проверяли бы боевой домен по умолчанию.
process.env.PUBLIC_BASE_URL = 'https://portal.example/';

const invites = require('../services/chatInvites');

/**
 * Заглушка вместо записи Sequelize.
 *
 * update() у настоящей модели правит и базу, и сам объект в памяти — сервис на
 * это рассчитывает: сразу после update он собирает ответ из полей записи.
 * Заглушка обязана вести себя так же, иначе тест проверял бы не то поведение,
 * которое будет на бою.
 */
function fakeChat(fields = {}) {
  return {
    id: 'chat-1',
    type: 'group',
    inviteToken: null,
    inviteEnabled: false,
    inviteCreatedBy: null,
    inviteCreatedAt: null,
    ...fields,
    async update(patch) { Object.assign(this, patch); return this; }
  };
}

test('лишний слэш в PUBLIC_BASE_URL не удваивается в ссылке', () => {
  assert.equal(invites.inviteUrl('abc'), 'https://portal.example/chat/join/abc');
});

test('без токена ссылки нет', () => {
  assert.equal(invites.inviteUrl(null), null);
});

test('токен — 32 символа base64url и каждый раз новый', () => {
  const a = invites.newToken();
  const b = invites.newToken();

  assert.equal(a.length, 32);
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'символы вне base64url ломают адрес');
  assert.notEqual(a, b);
});

test('первое включение заводит токен и автора', async () => {
  const chat = fakeChat();
  const state = await invites.enable(chat, 'user-1');

  assert.equal(state.enabled, true);
  assert.ok(chat.inviteToken, 'токен обязан появиться');
  assert.equal(chat.inviteCreatedBy, 'user-1');
  assert.ok(chat.inviteCreatedAt instanceof Date);
  assert.equal(state.url, `https://portal.example/chat/join/${chat.inviteToken}`);
});

// Главное свойство пары «выключить — включить»: адрес обязан остаться прежним.
// Иначе админ, погасивший приём на время совещания, молча ломал бы все уже
// разосланные ссылки — и узнал бы об этом от тех, кто не смог вступить.
test('повторное включение не меняет уже выданный адрес', async () => {
  const chat = fakeChat();
  const first = await invites.enable(chat, 'user-1');

  await invites.disable(chat);
  const again = await invites.enable(chat, 'user-2');

  assert.equal(again.url, first.url);
  assert.equal(chat.inviteCreatedBy, 'user-1', 'автор ссылки остаётся прежним');
});

test('выключение гасит приём, но токен не отзывает', async () => {
  const chat = fakeChat();
  await invites.enable(chat, 'user-1');
  const token = chat.inviteToken;

  const state = await invites.disable(chat);

  assert.equal(state.enabled, false);
  assert.equal(chat.inviteToken, token, 'отзыв — это rotate, а не disable');
  assert.ok(state.url, 'адрес показываем и у выключенной ссылки: админ должен видеть, что гасит');
});

// Перевыпуск — единственный способ отобрать доступ у того, кому ссылку
// переслали дальше, чем предполагалось.
test('перевыпуск меняет токен и сразу включает приём', async () => {
  const chat = fakeChat();
  await invites.enable(chat, 'user-1');
  const old = chat.inviteToken;

  await invites.disable(chat);
  const state = await invites.rotate(chat, 'user-2');

  assert.notEqual(chat.inviteToken, old, 'старая ссылка обязана перестать работать');
  assert.equal(state.enabled, true, 'перевыпуск без включения оставил бы группу без ссылки вовсе');
  assert.equal(chat.inviteCreatedBy, 'user-2');
});

test('состояние выключенной ссылки не притворяется включённым', () => {
  const state = invites.describe(fakeChat({ inviteToken: 'tok', inviteEnabled: false }));

  assert.equal(state.enabled, false);
  assert.equal(state.url, 'https://portal.example/chat/join/tok');
});
