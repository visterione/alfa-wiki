'use strict';

/**
 * Персональные настройки пользователя: тема, акцент, фон переписки, звук.
 *
 * Раньше их знала только мобилка, и лежали они в users.settings.mobile. С
 * ver. 7.60 те же настройки применяет и веб — «мобильными» они быть перестали,
 * поэтому переехали в namespace `appearance`. Старый ключ читается как
 * запасной: установленные на телефонах сборки продолжают писать в него, пока
 * люди не обновятся.
 */

const NAMESPACE = 'appearance';
const LEGACY_NAMESPACE = 'mobile';

const ALLOWED_VALUES = {
  // 'system' клиенты больше не предлагают: тёмная тема включается только явным
  // выбором, иначе в день выкатки интерфейс сменился бы сам у всех, у кого
  // тёмная тема в телефоне или в системе. Значение остаётся допустимым, потому
  // что его продолжают присылать установленные сборки мобилки до 7.60 —
  // отвечать им ошибкой значило бы сломать у них сохранение настроек.
  // Клиенты с 7.60 читают сохранённое 'system' как светлую.
  theme: new Set(['system', 'light', 'dark']),
  accent: new Set(['blue', 'pink', 'orange', 'sand', 'lavender', 'graphite', 'purple', 'green']),
  fontScale: new Set(['normal', 'large', 'huge']),
  chatBackground: new Set([
    'plain', 'dots', 'hex', 'waves', 'confetti', 'pulse', 'care',
    'crosses', 'pills'
  ]),
  notificationSound: new Set(['default', 'sol', 'luna', 'terra']),
  taskDefaultVisibility: new Set(['private', 'busy', 'team', 'public'])
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePreferences(value) {
  if (!isPlainObject(value)) {
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

/**
 * Действующие настройки аккаунта.
 *
 * Пока человек не обновил мобильное приложение, свежий выбор может прийти в
 * старый namespace, поэтому он не просто запасной, а накладывается снизу:
 * ключ, которого ещё нет в `appearance`, берётся из `mobile`.
 */
function readPreferences(userSettings) {
  const settings = isPlainObject(userSettings) ? userSettings : {};
  const legacy = isPlainObject(settings[LEGACY_NAMESPACE]) ? settings[LEGACY_NAMESPACE] : {};
  const current = isPlainObject(settings[NAMESPACE]) ? settings[NAMESPACE] : {};
  return { ...legacy, ...current };
}

/**
 * Настройки лежат в своём namespace, чтобы частичное обновление темы или звука
 * не затёрло настройки календаря и другие данные из users.settings.
 *
 * Старый ключ обновляется тем же патчем: пока на телефонах есть сборки, которые
 * читают только его, разъехавшиеся копии дали бы возврат темы после перезапуска.
 */
function mergePreferences(userSettings, patch) {
  const settings = isPlainObject(userSettings) ? userSettings : {};
  const normalized = normalizePreferences(patch);
  const current = readPreferences(settings);
  const next = { ...current, ...normalized };

  return {
    ...settings,
    [NAMESPACE]: next,
    [LEGACY_NAMESPACE]: next
  };
}

module.exports = {
  NAMESPACE,
  LEGACY_NAMESPACE,
  normalizePreferences,
  mergePreferences,
  readPreferences
};
