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
    chatBackground: 'dots',
    notificationSound: 'luna',
    taskDefaultVisibility: 'busy'
  }), {
    theme: 'dark',
    chatBackground: 'dots',
    notificationSound: 'luna',
    taskDefaultVisibility: 'busy'
  });
});

test('preferences reject unknown keys and values', () => {
  assert.throws(() => normalizePreferences({ chatBackground: 'grid' }), /chatBackground/);
  assert.throws(() => normalizePreferences({ taskDefaultVisibility: 'shared' }), /taskDefaultVisibility/);
  assert.throws(() => normalizePreferences({ admin: true }), /Неизвестные/);
});

test('preferences merge without overwriting other account settings', () => {
  assert.deepEqual(
    mergePreferences(
      { calendar: { showVehicles: true }, appearance: { theme: 'light' } },
      { fontScale: 'large' }
    ),
    {
      calendar: { showVehicles: true },
      appearance: { theme: 'light', fontScale: 'large' },
      mobile: { theme: 'light', fontScale: 'large' }
    }
  );
});

// Выбор акцентного цвета убран в ver. 7.84, но установленные сборки мобилки
// продолжают его присылать. Ошибка на такой запрос стоила бы человеку всех
// настроек разом, поэтому значение принимается и выбрасывается — а заодно
// вычищается из базы при первом же сохранении.
test('preferences swallow the retired accent instead of failing', () => {
  assert.deepEqual(normalizePreferences({ theme: 'dark', accent: 'green' }), { theme: 'dark' });
  assert.deepEqual(normalizePreferences({ accent: 'rainbow' }), {});

  assert.deepEqual(readPreferences({ appearance: { theme: 'dark', accent: 'purple' } }), { theme: 'dark' });

  assert.deepEqual(
    mergePreferences({ appearance: { theme: 'dark', accent: 'purple' } }, { fontScale: 'large' }).appearance,
    { theme: 'dark', fontScale: 'large' }
  );
});

// Аккаунты, не заходившие в веб после переезда, хранят выбор только в старом
// ключе. Он должен пережить первое же сохранение из веба, а не обнулиться.
test('preferences pick up the legacy mobile namespace', () => {
  assert.deepEqual(
    readPreferences({ mobile: { theme: 'dark', chatBackground: 'dots' } }),
    { theme: 'dark', chatBackground: 'dots' }
  );

  assert.deepEqual(
    mergePreferences({ mobile: { theme: 'dark', chatBackground: 'dots' } }, { fontScale: 'large' }).appearance,
    { theme: 'dark', chatBackground: 'dots', fontScale: 'large' }
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
