/**
 * Онлайн-статусы пользователей.
 *
 * Раньше «онлайн» означало «есть живой socket.io-коннект». Это врало в обе
 * стороны: свёрнутое мобильное приложение держит сокет часами (токен там на
 * 365 дней, реконнект бесконечный) и человек вечно висел «в сети», а рестарт
 * бэка обнулял карту в памяти, никому не записав lastSeen — и тот же человек
 * внезапно оказывался «был(а) 3 дня назад».
 *
 * Теперь статус считается по активности: клиент шлёт `presence:active` раз в
 * PING_INTERVAL, но только пока он реально на переднем плане (AppState=active
 * на мобиле, visibilityState=visible в вебе). Онлайн = последний пинг был не
 * дальше ONLINE_TTL назад. Уход в фон клиент сообщает явно (`presence:away`),
 * а если не успел (убили процесс, оборвалась сеть) — гасит sweeper.
 */

const { User } = require('../models');

// Как часто клиент шлёт пинг. Клиенты обязаны использовать это же значение.
const PING_INTERVAL_MS = 30 * 1000;
// Сколько живёт статус без пинга. Два интервала + запас на дрожание сети:
// одиночный потерянный пинг не должен гасить человека.
const ONLINE_TTL_MS = 75 * 1000;
// Как часто подчищаем протухшие статусы.
const SWEEP_INTERVAL_MS = 15 * 1000;
// Не чаще этого пишем lastSeen в БД для активного пользователя. Нужно, чтобы
// после падения процесса метка была свежей, а не времени последнего дисконнекта.
const PERSIST_INTERVAL_MS = 60 * 1000;

// userId → { lastActiveAt: number, persistedAt: number }
const online = new Map();

let io = null;
let sweepTimer = null;

function persistLastSeen(userId, at) {
  return User.update({ lastSeen: at }, { where: { id: userId } }).catch(() => {});
}

function emitStatus(userId, isOnline, lastSeen) {
  if (!io) return;
  io.emit('user_status_changed', {
    userId,
    isOnline,
    lastSeen: lastSeen ? lastSeen.toISOString() : undefined,
  });
}

/**
 * Пользователь активен прямо сейчас. Идемпотентно — зовётся на каждый пинг.
 */
function touch(userId) {
  if (!userId) return;
  const now = Date.now();
  const entry = online.get(userId);

  if (!entry) {
    online.set(userId, { lastActiveAt: now, persistedAt: now });
    // lastSeen для онлайн-пользователя тоже держим свежим: если процесс упадёт,
    // клиенты увидят «был(а) только что», а не метку недельной давности.
    persistLastSeen(userId, new Date(now));
    emitStatus(userId, true);
    return;
  }

  entry.lastActiveAt = now;
  if (now - entry.persistedAt >= PERSIST_INTERVAL_MS) {
    entry.persistedAt = now;
    persistLastSeen(userId, new Date(now));
  }
}

/**
 * Пользователь ушёл — свернул приложение, спрятал вкладку, разлогинился.
 * Гасим сразу, не дожидаясь sweeper'а.
 */
function away(userId) {
  if (!userId || !online.has(userId)) return;
  online.delete(userId);
  const at = new Date();
  persistLastSeen(userId, at);
  emitStatus(userId, false, at);
}

function isOnline(userId) {
  const entry = online.get(userId);
  if (!entry) return false;
  return Date.now() - entry.lastActiveAt < ONLINE_TTL_MS;
}

/**
 * Статусы пачкой — для списков чатов и участников, чтобы не звать isOnline в цикле.
 * @param {Array<number|string>} userIds
 * @returns {Map<number|string, boolean>}
 */
function getStatuses(userIds) {
  const result = new Map();
  for (const id of userIds) result.set(id, isOnline(id));
  return result;
}

function sweep() {
  const now = Date.now();
  for (const [userId, entry] of online) {
    if (now - entry.lastActiveAt < ONLINE_TTL_MS) continue;
    online.delete(userId);
    // Метка — момент последнего пинга, а не момент уборки: человек ушёл тогда.
    const at = new Date(entry.lastActiveAt);
    persistLastSeen(userId, at);
    emitStatus(userId, false, at);
  }
}

function init(ioServer) {
  io = ioServer;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

/**
 * Корректный останов: при `pm2 reload` записываем lastSeen всем, кто был онлайн,
 * иначе после рестарта у них останется метка часовой давности.
 */
async function shutdown() {
  if (sweepTimer) clearInterval(sweepTimer);
  const entries = [...online.entries()];
  online.clear();
  await Promise.all(
    entries.map(([userId, entry]) => persistLastSeen(userId, new Date(entry.lastActiveAt)))
  );
}

module.exports = {
  touch,
  away,
  isOnline,
  getStatuses,
  init,
  shutdown,
  PING_INTERVAL_MS,
  ONLINE_TTL_MS,
};
