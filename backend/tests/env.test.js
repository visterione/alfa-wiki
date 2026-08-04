'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { envFlag } = require('../utils/env');

test('envFlag recognizes common enabled and disabled values', () => {
  assert.equal(envFlag('true'), true);
  assert.equal(envFlag('1'), true);
  assert.equal(envFlag('OFF', true), false);
  assert.equal(envFlag('0', true), false);
});

test('envFlag falls back for absent or unknown values', () => {
  assert.equal(envFlag(undefined, true), true);
  assert.equal(envFlag('unexpected', false), false);
});
