'use strict';

/**
 * Настройки рассылки: порядок каскада и тихие часы (ver. 7.94).
 *
 * Лежат в settings одной строкой на сеть: заводить таблицу под два значения не
 * за чем, а править их должен администратор, а не программист в .env.
 */

const { Setting } = require('../../models');

const CASCADE_KEY = 'notif_cascade';
const QUIET_KEY = 'notif_quiet_hours';

// «bot» — наши Telegram и MAX, остальные имена — ступени Fromni, как они
// называются в её API. Порядок массива и есть порядок отправки.
const DEFAULT_CASCADE = ['bot', 'notify+vk', 'sms+webchat'];

const DEFAULT_QUIET = {
  enabled: true,
  from: '21:00',
  to: '09:00',
  // Бот по умолчанию не молчит: сообщение в мессенджере не будит так, как SMS,
  // а человек, записавшийся поздно вечером, ждёт подтверждения сразу.
  channels: ['notify+vk', 'sms+webchat']
};

// Настройки читаются на каждое сообщение — держим их в памяти минуту, чтобы не
// ходить в базу на каждую строку очереди.
const cache = new Map();
const TTL = 60000;

async function read(key, fallback) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const row = await Setting.findByPk(key);
  const value = row && row.value != null ? row.value : fallback;
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function write(key, value, description) {
  await Setting.upsert({ key, value, description });
  cache.delete(key);
  return value;
}

const cascade = () => read(CASCADE_KEY, DEFAULT_CASCADE);
const quietHours = () => read(QUIET_KEY, DEFAULT_QUIET);

// ── Тихие часы ────────────────────────────────────────────────────────────

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Попадает ли момент в запрещённое время. Интервал почти всегда переходит через
 * полночь (с 21:00 до 09:00), поэтому сравнение двустороннее.
 */
function isQuiet(quiet, date) {
  if (!quiet || !quiet.enabled) return false;

  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);

  return from <= to ? (now >= from && now < to) : (now >= from || now < to);
}

/**
 * Ближайший момент, когда писать снова можно.
 */
function nextAllowed(quiet, date) {
  const [h, m] = String(quiet.to || '09:00').split(':').map(Number);

  const at = new Date(date);
  at.setHours(h || 0, m || 0, 0, 0);
  // Если утро сегодняшнего дня уже прошло, ждать до завтрашнего.
  if (at <= date) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * Молчит ли канал в тихие часы. Список каналов в настройке — это имена ступеней
 * каскада; «bot» туда обычно не входит.
 */
function quietFor(quiet, channel) {
  if (!quiet || !quiet.enabled) return false;
  const list = Array.isArray(quiet.channels) ? quiet.channels : [];
  return list.includes(channel);
}

module.exports = {
  CASCADE_KEY, QUIET_KEY, DEFAULT_CASCADE, DEFAULT_QUIET,
  cascade, quietHours, read, write,
  isQuiet, nextAllowed, quietFor, minutesOf
};
