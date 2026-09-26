const test = require('node:test');
const assert = require('node:assert/strict');
const { accountProblem } = require('../services/reviewCollector/health');

const HOUR = 3600 * 1000;
const now = Date.parse('2026-09-26T12:00:00Z');
const collecting = [{ mode: 'live', boardId: 'board' }];

function account(fields) {
  return { isEnabled: true, status: 'ok', statusAt: new Date(now - HOUR), createdAt: new Date(now - 100 * HOUR), places: collecting, ...fields };
}

test('учётка, от которой парсер отзывается, проблем не имеет', () => {
  assert.equal(accountProblem(account({}), now), null);
});

test('статусы, требующие человека, — проблема', () => {
  assert.equal(accountProblem(account({ status: 'needs_login' }), now), 'needs_login');
  assert.equal(accountProblem(account({ status: 'bad_password' }), now), 'bad_password');
  assert.equal(accountProblem(account({ status: 'error' }), now), 'error');
});

test('молчание парсера дольше трёх часов у собирающей учётки — проблема', () => {
  assert.equal(accountProblem(account({ statusAt: new Date(now - 4 * HOUR) }), now), 'silent');
});

test('учётка без собирающих мест не обязана отчитываться', () => {
  const idle = account({ statusAt: new Date(now - 48 * HOUR), places: [{ mode: 'off', boardId: 'board' }] });
  assert.equal(accountProblem(idle, now), null);
});

test('выключенная учётка проблемой не считается', () => {
  assert.equal(accountProblem(account({ isEnabled: false, status: 'bad_password' }), now), null);
});

test('новая учётка, которую парсер так и не подхватил, — молчание', () => {
  const fresh = account({ status: 'new', statusAt: null, createdAt: new Date(now - 5 * HOUR) });
  assert.equal(accountProblem(fresh, now), 'silent');
});
