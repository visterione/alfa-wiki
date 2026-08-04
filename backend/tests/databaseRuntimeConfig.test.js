'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDatabaseRuntimeConfig, getPoolStats } = require('../utils/databaseRuntimeConfig');

test('database pool keeps safe defaults', () => {
  const config = buildDatabaseRuntimeConfig({ NODE_ENV: 'test' });
  assert.deepEqual(config.pool, { max: 10, min: 0, acquire: 30000, idle: 10000, evict: 1000 });
  assert.equal(config.dialectOptions.application_name, 'alfa-wiki-test');
  assert.equal(config.dialectOptions.statement_timeout, undefined);
});

test('database pool environment values are bounded', () => {
  const config = buildDatabaseRuntimeConfig({
    DB_POOL_MAX: '500',
    DB_POOL_MIN: '300',
    DB_POOL_ACQUIRE_MS: '10',
    DB_STATEMENT_TIMEOUT_MS: '900000',
  });
  assert.equal(config.pool.max, 200);
  assert.equal(config.pool.min, 200);
  assert.equal(config.pool.acquire, 1000);
  assert.equal(config.dialectOptions.statement_timeout, 600000);
});

test('pool stats support sequelize-pool public counters', () => {
  assert.deepEqual(getPoolStats(
    { size: 8, available: 3, using: 5, waiting: 2 },
    { max: 10, min: 0 },
  ), { size: 8, available: 3, using: 5, waiting: 2, max: 10, min: 0 });
});
