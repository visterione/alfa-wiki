'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const vkGroup = require('../services/notifications/vkGroup');

test('числовой id из ссылки достаётся во всех её видах', () => {
  for (const raw of [
    'https://vk.com/club123456789',
    'http://vk.com/public123456789',
    'vk.com/event123456789',
    'https://m.vk.com/club123456789/',
    'https://vk.com/club123456789?from=groups',
    'https://vk.com/club123456789/posts'
  ]) {
    assert.equal(vkGroup.forImobis(raw), 123456789, raw);
  }
});

test('короткий адрес остаётся адресом — превратить его в id нам нечем', () => {
  assert.equal(vkGroup.forImobis('https://vk.com/3k_anapa'), '3k_anapa');
  assert.equal(vkGroup.forImobis('vk.com/alfa_smile'), 'alfa_smile');
  assert.equal(vkGroup.forImobis('@alfa_smile'), 'alfa_smile');
  assert.equal(vkGroup.forImobis('alfa_smile'), 'alfa_smile');
});

test('значения, записанные числом до 8.51, продолжают работать', () => {
  // Поле было числовым, и в базе у филиалов лежат именно числа. Миграции под
  // это не делали — значит разбор обязан их понимать.
  assert.equal(vkGroup.forImobis(123456789), 123456789);
  assert.equal(vkGroup.forImobis('123456789'), 123456789);
});

test('пустое поле не превращается в группу', () => {
  for (const raw of ['', '   ', null, undefined, 'https://vk.com/', 'vk.com']) {
    assert.equal(vkGroup.forImobis(raw), null, JSON.stringify(raw));
  }
});

test('разбор различает известный id и адрес, который проверит только Имобис', () => {
  assert.deepEqual(vkGroup.parse('https://vk.com/club42'), { id: 42, screenName: null });
  assert.deepEqual(vkGroup.parse('https://vk.com/3k_anapa'), { id: null, screenName: '3k_anapa' });
});
