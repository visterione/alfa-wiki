'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePreferences,
  mergePreferences,
  readPreferences
} = require('../services/userPreferences');

test('preferences accept supported values', () => {
  assert.deepEqual(normalizePreferences({
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

test('preferences reject unknown keys and values', () => {
  assert.throws(() => normalizePreferences({ accent: 'rainbow' }), /accent/);
  assert.throws(() => normalizePreferences({ chatBackground: 'grid' }), /chatBackground/);
  assert.throws(() => normalizePreferences({ taskDefaultVisibility: 'shared' }), /taskDefaultVisibility/);
  assert.throws(() => normalizePreferences({ admin: true }), /Неизвестные/);
});

test('preferences merge without overwriting other account settings', () => {
  assert.deepEqual(
    mergePreferences(
      { calendar: { showVehicles: true }, appearance: { theme: 'light', accent: 'blue' } },
      { accent: 'green' }
    ),
    {
      calendar: { showVehicles: true },
      appearance: { theme: 'light', accent: 'green' },
      mobile: { theme: 'light', accent: 'green' }
    }
  );
});

// Аккаунты, не заходившие в веб после переезда, хранят выбор только в старом
// ключе. Он должен пережить первое же сохранение из веба, а не обнулиться.
test('preferences pick up the legacy mobile namespace', () => {
  assert.deepEqual(
    readPreferences({ mobile: { theme: 'dark', accent: 'purple' } }),
    { theme: 'dark', accent: 'purple' }
  );

  assert.deepEqual(
    mergePreferences({ mobile: { theme: 'dark', accent: 'purple' } }, { fontScale: 'large' }).appearance,
    { theme: 'dark', accent: 'purple', fontScale: 'large' }
  );
});

// Старая сборка на телефоне пишет в mobile, веб — в appearance. Побеждает тот
// namespace, где значение новее; из старого доезжают только ключи, которых в
// новом ещё нет.
test('preferences prefer the current namespace over the legacy one', () => {
  assert.equal(
    readPreferences({ mobile: { theme: 'dark' }, appearance: { theme: 'light' } }).theme,
    'light'
  );
});

// Сборки мобилки до 7.60 продолжают присылать 'system'. Приняли решение больше
// не предлагать этот вариант, но отказ на сохранение сломал бы им настройки
// целиком — не только тему.
test('preferences still accept the retired system theme from older builds', () => {
  assert.deepEqual(normalizePreferences({ theme: 'system' }), { theme: 'system' });
});
