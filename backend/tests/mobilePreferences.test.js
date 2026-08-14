'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMobilePreferences,
  mergeMobilePreferences
} = require('../services/mobilePreferences');

test('mobile preferences accept supported values', () => {
  assert.deepEqual(normalizeMobilePreferences({
    theme: 'dark',
    accent: 'green',
    notificationSound: 'luna',
    taskDefaultVisibility: 'busy'
  }), {
    theme: 'dark',
    accent: 'green',
    notificationSound: 'luna',
    taskDefaultVisibility: 'busy'
  });
});

test('mobile preferences reject unknown keys and values', () => {
  assert.throws(() => normalizeMobilePreferences({ accent: 'rainbow' }), /accent/);
  assert.throws(() => normalizeMobilePreferences({ chatBackground: 'grid' }), /chatBackground/);
  assert.throws(() => normalizeMobilePreferences({ taskDefaultVisibility: 'shared' }), /taskDefaultVisibility/);
  assert.throws(() => normalizeMobilePreferences({ admin: true }), /Неизвестные/);
});

test('mobile preferences merge without overwriting other account settings', () => {
  assert.deepEqual(
    mergeMobilePreferences(
      { calendar: { showVehicles: true }, mobile: { theme: 'light', accent: 'blue' } },
      { accent: 'green' }
    ),
    {
      calendar: { showVehicles: true },
      mobile: { theme: 'light', accent: 'green' }
    }
  );
});
