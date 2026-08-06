'use strict';

const ALLOWED_VALUES = {
  theme: new Set(['system', 'light', 'dark']),
  accent: new Set(['blue', 'pink', 'orange', 'sand', 'lavender', 'graphite', 'purple', 'green']),
  fontScale: new Set(['normal', 'large', 'huge']),
  chatBackground: new Set([
    'plain', 'dots', 'hex', 'waves', 'confetti', 'pulse', 'care',
    'crosses', 'pills'
  ]),
  notificationSound: new Set(['default', 'sol', 'luna', 'terra'])
};

function normalizeMobilePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Настройки должны быть объектом');
  }

  const unknown = Object.keys(value).filter(key => !ALLOWED_VALUES[key]);
  if (unknown.length) {
    throw new TypeError(`Неизвестные настройки: ${unknown.join(', ')}`);
  }

  const normalized = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!ALLOWED_VALUES[key].has(candidate)) {
      throw new TypeError(`Недопустимое значение настройки ${key}`);
    }
    normalized[key] = candidate;
  }
  return normalized;
}

function mergeMobilePreferences(userSettings, patch) {
  const settings = userSettings && typeof userSettings === 'object' && !Array.isArray(userSettings)
    ? userSettings
    : {};
  const mobile = settings.mobile && typeof settings.mobile === 'object' && !Array.isArray(settings.mobile)
    ? settings.mobile
    : {};

  return {
    ...settings,
    mobile: {...mobile, ...normalizeMobilePreferences(patch)}
  };
}

module.exports = { normalizeMobilePreferences, mergeMobilePreferences };
