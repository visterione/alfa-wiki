'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequiredDateRange } = require('../utils/dateRange');

test('requires both range boundaries', () => {
  assert.equal(parseRequiredDateRange({}).error, 'date_from и date_to обязательны');
  assert.equal(parseRequiredDateRange({ date_from: '2026-08-01' }).error, 'date_from и date_to обязательны');
});

test('rejects invalid and reversed dates', () => {
  assert.match(parseRequiredDateRange({ date_from: 'bad', date_to: '2026-08-02' }).error, /ISO/);
  assert.match(parseRequiredDateRange({ date_from: '2026-08-03', date_to: '2026-08-02' }).error, /позже/);
});

test('returns parsed dates for a valid range', () => {
  const result = parseRequiredDateRange({
    date_from: '2026-08-01T00:00:00.000Z',
    date_to: '2026-08-02T23:59:59.999Z',
  });

  assert.equal(result.error, undefined);
  assert.equal(result.start.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(result.end.toISOString(), '2026-08-02T23:59:59.999Z');
});

