'use strict';

/**
 * Проверки суточного предела рассылок (ver. 8.57).
 *
 * Здесь щупается чистый расчёт: сколько писем и в какие дни уйдёт. Вся цена
 * ошибки в нём — письма, потерянные между днями, или залп в несколько тысяч,
 * который предел должен был не пустить.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const quota = require('../services/emailQuota');

const total = (plan) => plan.reduce((sum, row) => sum + row.count, 0);

test('рассылка внутри предела остаётся однодневной', () => {
  const { plan, overflow } = quota.buildPlan(800, '2026-09-22', 1000, {});
  assert.equal(plan.length, 1);
  assert.equal(plan[0].count, 800);
  assert.equal(overflow, 0);
});

test('рассылка сверх предела растягивается по дням и не теряет писем', () => {
  const { plan, overflow } = quota.buildPlan(10000, '2026-09-22', 1000, {});
  assert.equal(overflow, 0);
  assert.equal(total(plan), 10000);
  assert.equal(plan.length, 10);
  // Каждый день ровно по пределу — кроме, возможно, последнего.
  plan.slice(0, -1).forEach(row => assert.equal(row.count, 1000));
});

test('день, уже занятый другой рассылкой, отдаёт только остаток', () => {
  const { plan } = quota.buildPlan(1500, '2026-09-22', 1000, { '2026-09-22': 400 });
  assert.equal(plan[0].count, 600);
  assert.equal(plan[0].used, 400);
  assert.equal(plan[1].count, 900);
  assert.equal(total(plan), 1500);
});

test('день, забитый под завязку, пропускается целиком', () => {
  // Такой день не должен появиться в плане нулевой строкой: «22 сентября — 0
  // писем» человек читает как сбой, а не как «сегодня уже нельзя».
  const { plan } = quota.buildPlan(500, '2026-09-22', 1000, { '2026-09-22': 1000 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].date, '2026-09-23');
  assert.equal(plan[0].count, 500);
});

test('снятый предел оставляет рассылку однодневной, каким бы ни был список', () => {
  const { plan, overflow } = quota.buildPlan(100000, '2026-09-22', 0, {});
  assert.equal(plan.length, 1);
  assert.equal(plan[0].count, 100000);
  assert.equal(overflow, 0);
});

test('абсурдно низкий предел честно сообщает об остатке', () => {
  // Год по одному письму в день — 366 писем, остальное уже никуда не влезает.
  const { plan, overflow } = quota.buildPlan(1000, '2026-09-22', 1, {});
  assert.equal(plan.length, 366);
  assert.equal(overflow, 1000 - 366);
});

test('границы месяца и года переходятся правильно', () => {
  assert.equal(quota.nextDay('2026-09-30'), '2026-10-01');
  assert.equal(quota.nextDay('2026-12-31'), '2027-01-01');
  // Високосный год: 2028-й.
  assert.equal(quota.nextDay('2028-02-28'), '2028-02-29');
});

test('порции уходят в тот же час суток по Москве', () => {
  // Рассылка, начатая в 10 утра по Москве, продолжается в 10 утра — в этом и
  // состоит «расписать по дням», которое видит человек. Без пересчёта через
  // московский пояс второй день уезжал бы на 07:00.
  const start = new Date('2026-09-22T07:00:00Z'); // 10:00 МСК
  const next = quota.portionTime('2026-09-23', start);
  assert.equal(next.toISOString(), '2026-09-23T07:00:00.000Z');
});

test('дата плана считается по Москве, а не по UTC', () => {
  // 23 сентября 00:30 МСК — это ещё 22-е по UTC. Рассылка, назначенная на
  // полпервого ночи, должна попасть в тот день, который человек видит в
  // календаре, а не на сутки раньше.
  assert.equal(quota.dayKey(new Date('2026-09-22T21:30:00Z')), '2026-09-23');
});
