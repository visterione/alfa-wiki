'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedInteger, parsePagination } = require('../utils/pagination');

test('uses pagination defaults for absent and invalid values', () => {
  assert.deepEqual(parsePagination({}, { defaultLimit: 40, maxLimit: 200 }), { limit: 40, offset: 0 });
  assert.deepEqual(parsePagination({ limit: 'bad', offset: 'bad' }), { limit: 50, offset: 0 });
});

test('clamps pagination to safe bounds', () => {
  assert.deepEqual(parsePagination({ limit: '99999', offset: '-8' }, { maxLimit: 200 }), { limit: 200, offset: 0 });
  assert.deepEqual(parsePagination({ limit: '0', offset: '12' }), { limit: 1, offset: 12 });
  assert.equal(parsePagination({ offset: '999999999' }).offset, 1_000_000);
});

test('boundedInteger parses decimal integer input', () => {
  assert.equal(boundedInteger('25', 10, 1, 100), 25);
});
