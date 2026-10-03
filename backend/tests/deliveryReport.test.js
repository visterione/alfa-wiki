'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withReport, statusAfterReport } = require('../services/notifications/deliveryReport');

const path = (...steps) => steps.map(([step, result]) => ({ step, result }));

// ── Статус строки после отчёта (ver. 9.34) ────────────────────────────────

test('отказ единственной переданной ступени — строка не доставлена', () => {
  // Тот самый случай из журнала: боты не прошли, SMS отвергнута провайдером,
  // а строка стояла в «Доставлено» с зелёной галочкой.
  const attempts = withReport(
    path(['telegram', 'failed'], ['max', 'failed'], ['imobis:sms', 'handed']),
    { error: 'Delivery failure (routing is not configured)' },
    'error'
  );
  assert.equal(attempts[2].result, 'undelivered');
  assert.equal(statusAfterReport('sent', attempts, 'error'), 'failed');
});

test('отказ каскада Имобиса без канала гасит все переданные ступени', () => {
  const attempts = withReport(
    path(['telegram', 'failed'], ['imobis:sms', 'handed'], ['imobis:vk', 'handed']),
    { error: 'Delivery failure (routing is not configured)' },
    'error'
  );
  assert.deepEqual(attempts.map(a => a.result), ['failed', 'undelivered', 'undelivered']);
  assert.equal(statusAfterReport('sent', attempts, 'error'), 'failed');
});

test('отказ одной ступени, за которой ещё ждёт следующая, — ход каскада, а не итог', () => {
  const attempts = withReport(
    path(['imobis:vk', 'handed'], ['imobis:sms', 'handed']),
    { channel: 'vk' },
    'undelivered'
  );
  assert.deepEqual(attempts.map(a => a.result), ['undelivered', 'handed']);
  assert.equal(statusAfterReport('sent', attempts, 'undelivered'), 'sent');
});

test('доставка возвращает строку, сочтённую неудачной по промежуточному отчёту', () => {
  assert.equal(statusAfterReport('failed', path(['imobis:sms', 'delivered']), 'delivered'), 'sent');
});

test('отчёт не трогает пропущенные и ждущие строки', () => {
  assert.equal(statusAfterReport('skipped', [], 'error'), 'skipped');
  assert.equal(statusAfterReport('pending', [], 'delivered'), 'pending');
});

test('промежуточный статус провайдера статус строки не меняет', () => {
  assert.equal(statusAfterReport('sent', path(['imobis:sms', 'handed']), 'sent'), 'sent');
});

test('доставка через второй канал помечает первый непрошедшим, остальные — ненужными', () => {
  const attempts = withReport(
    path(['imobis:sms', 'handed'], ['imobis:vk', 'handed'], ['imobis:viber', 'handed']),
    { channel: 'vk' },
    'delivered'
  );
  assert.deepEqual(attempts.map(a => a.result), ['undelivered', 'delivered', 'unused']);
});
