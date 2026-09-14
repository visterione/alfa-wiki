'use strict';

/**
 * Когда закрытие обращения требует темы (ver. 8.29).
 *
 * Правило неочевидное, и ошибка в нём дорогая в обе стороны: слишком мягкое —
 * и половина потока уходит в отчёт без темы, слишком жёсткое — и линия
 * запирается, потому что закрыть обращение нечем.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { topicRequired } = require('../services/openLine');

test('тема нужна, когда справочник заполнен, а выбора не сделали', () => {
  assert.equal(topicRequired({ hasSession: true, hasTopic: false, activeTopics: 10 }), true);
});

test('тема выбрана — требовать больше нечего', () => {
  assert.equal(topicRequired({ hasSession: true, hasTopic: true, activeTopics: 10 }), false);
});

test('пустой справочник не запирает линию', () => {
  // Главное здесь. Старший оператор может выключить темы до последней, и
  // обращения в этот момент не должны перестать закрываться.
  assert.equal(topicRequired({ hasSession: true, hasTopic: false, activeTopics: 0 }), false);
});

test('у переписки без открытого обращения темы не спрашивают', () => {
  // Тема относится к обращению, а не к чату: закрывать в такой переписке нечего,
  // и требование выбрать тему было бы вопросом ни о чём.
  assert.equal(topicRequired({ hasSession: false, hasTopic: false, activeTopics: 10 }), false);
});
