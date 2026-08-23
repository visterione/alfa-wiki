'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canDeleteForAll, DELETE_FOR_ALL_WINDOW_MS } = require('../services/messagePermissions');

const NOW = Date.parse('2026-08-24T12:00:00Z');
const AUTHOR = { id: 'u-author', isAdmin: false };
const STRANGER = { id: 'u-other', isAdmin: false };
const SUPERADMIN = { id: 'u-root', isAdmin: true };

const GROUP = { type: 'group', createdBy: 'u-creator' };
const PRIVATE = { type: 'private', createdBy: null };

function message(overrides = {}) {
  return {
    senderId: AUTHOR.id,
    type: 'text',
    createdAt: new Date(NOW - 60 * 1000).toISOString(),
    ...overrides,
  };
}

test('автор стирает своё сообщение у всех, пока не прошло двое суток', () => {
  assert.equal(canDeleteForAll({
    message: message(), chat: PRIVATE, membership: { role: 'member' }, user: AUTHOR, now: NOW,
  }), true);
});

test('через двое суток автор уже не может стереть у всех', () => {
  const old = message({ createdAt: new Date(NOW - DELETE_FOR_ALL_WINDOW_MS - 1000).toISOString() });
  assert.equal(canDeleteForAll({
    message: old, chat: PRIVATE, membership: { role: 'member' }, user: AUTHOR, now: NOW,
  }), false);
});

test('ровно на границе окна ещё можно', () => {
  const edge = message({ createdAt: new Date(NOW - DELETE_FOR_ALL_WINDOW_MS).toISOString() });
  assert.equal(canDeleteForAll({
    message: edge, chat: PRIVATE, membership: { role: 'member' }, user: AUTHOR, now: NOW,
  }), true);
});

test('чужое сообщение обычный участник не стирает', () => {
  assert.equal(canDeleteForAll({
    message: message(), chat: GROUP, membership: { role: 'member' }, user: STRANGER, now: NOW,
  }), false);
});

test('админ группы стирает чужое без срока', () => {
  const ancient = message({ createdAt: '2020-01-01T00:00:00Z' });
  assert.equal(canDeleteForAll({
    message: ancient, chat: GROUP, membership: { role: 'admin' }, user: STRANGER, now: NOW,
  }), true);
});

test('создатель группы приравнен к её админу', () => {
  const creator = { id: 'u-creator', isAdmin: false };
  assert.equal(canDeleteForAll({
    message: message({ createdAt: '2020-01-01T00:00:00Z' }),
    chat: GROUP, membership: { role: 'member' }, user: creator, now: NOW,
  }), true);
});

test('роль админа в личном чате прав не даёт: там нет админов', () => {
  assert.equal(canDeleteForAll({
    message: message(), chat: PRIVATE, membership: { role: 'admin' }, user: STRANGER, now: NOW,
  }), false);
});

test('суперадминистратор портала стирает что угодно и когда угодно', () => {
  assert.equal(canDeleteForAll({
    message: message({ createdAt: '2020-01-01T00:00:00Z' }),
    chat: PRIVATE, membership: null, user: SUPERADMIN, now: NOW,
  }), true);
});

test('системные сообщения не стирает никто, включая суперадминистратора', () => {
  assert.equal(canDeleteForAll({
    message: message({ type: 'system' }), chat: GROUP, membership: { role: 'admin' }, user: SUPERADMIN, now: NOW,
  }), false);
});
