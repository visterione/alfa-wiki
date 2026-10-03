'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { operatorOf, OTHER } = require('../services/notifications/mobileOperators');

test('оператор по номеру в любой записи телефона', () => {
  assert.equal(operatorOf('+7 (910) 123-45-67'), 'МТС');
  assert.equal(operatorOf('89031234567'), 'Билайн');
  assert.equal(operatorOf('9001234567'), 'Т2');
});

test('Yota, СберМобайл, Т-Мобайл и Ростелеком — по диапазону внутри кода', () => {
  // Ради этого справочник и стал диапазонами: по коду эти номера
  // неотличимы от номеров большой четвёрки.
  assert.equal(operatorOf('79585370350'), 'Yota');
  assert.equal(operatorOf('79011515000'), 'СберМобайл');
  assert.equal(operatorOf('79950050000'), 'Т-Мобайл');
  assert.equal(operatorOf('79011105555'), 'Ростелеком');
});

test('номер вне брендов справочника — «Прочие»', () => {
  assert.equal(operatorOf('79981234567'), OTHER);
});

test('городской и чужой номер оператора не получают', () => {
  // На диаграмме операторов SMS им не место: «Прочие» — это мобильный номер.
  assert.equal(operatorOf('78612345678'), null);
  assert.equal(operatorOf('380501234567'), null);
  assert.equal(operatorOf(''), null);
});
