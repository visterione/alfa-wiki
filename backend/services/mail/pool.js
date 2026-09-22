'use strict';

/**
 * Ограничитель одновременных IMAP-соединений (ver. 8.58).
 *
 * Вынесен из imap.js отдельно, потому что это единственная часть модуля,
 * поведение которой нельзя проверить, не имея живого почтового сервера, — а
 * проверять надо обязательно: ошибка здесь выбивает лимит хостинга и ломает
 * почту всем, включая тех, кто работает через Roundcube.
 *
 * Правило простое: начинаем с малого, поднимаемся медленно и только на череде
 * успехов, опускаемся сразу и с паузой. Нащупывать чужой потолок снизу
 * безопасно — мы упираемся в него одним лишним соединением, а не восемью.
 */

const DEFAULT_COOLDOWN_MS = 60_000;
// Сколько подключений подряд должны пройти гладко, прежде чем поднять потолок.
// Десять — чтобы одиночная удача после отказа не считалась разрешением.
const RAISE_AFTER_OK = 10;

function createPool({ hardMax = 4, start = 2, cooldownMs = DEFAULT_COOLDOWN_MS, now = Date.now } = {}) {
  const state = {
    ceiling: Math.max(1, Math.min(start, hardMax)),
    inUse: 0,
    waiters: [],
    okStreak: 0,
    loweredUntil: 0,
    lastRefusal: null,
  };

  function acquire() {
    if (state.inUse < state.ceiling) {
      state.inUse += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => state.waiters.push(resolve));
  }

  function release() {
    state.inUse = Math.max(0, state.inUse - 1);
    // Потолок мог опуститься, пока слот был занят. Пускаем ждущих только в
    // пределах нового потолка — иначе снижение ничего бы не значило.
    while (state.waiters.length && state.inUse < state.ceiling) {
      state.inUse += 1;
      state.waiters.shift()();
    }
  }

  function noteSuccess() {
    state.okStreak += 1;
    if (state.okStreak >= RAISE_AFTER_OK && now() > state.loweredUntil && state.ceiling < hardMax) {
      state.ceiling += 1;
      state.okStreak = 0;
      return true;
    }
    return false;
  }

  function noteRefusal(reason) {
    state.okStreak = 0;
    state.loweredUntil = now() + cooldownMs;
    state.lastRefusal = reason || null;
    if (state.ceiling > 1) {
      state.ceiling -= 1;
      return true;
    }
    // Ниже одного не опускаемся: совсем перестать ходить за почтой — это не
    // осторожность, а отказ работать.
    return false;
  }

  function stats() {
    return {
      ceiling: state.ceiling,
      hardMax,
      inUse: state.inUse,
      queued: state.waiters.length,
      lastRefusal: state.lastRefusal,
    };
  }

  return { acquire, release, noteSuccess, noteRefusal, stats };
}

/**
 * Отказ от нехватки соединений или ошибка самого ящика? Отличать обязательно:
 * неверный пароль одного ящика — не повод замедлять работу со всеми остальными,
 * а замедлиться из-за него мы могли бы надолго.
 */
function isCapacityRefusal(err) {
  if (!err) return false;
  // Отказ в аутентификации разбираем первым: сообщение о нём иногда содержит
  // слова, которые ниже считаются признаком перегрузки.
  if (err.authenticationFailed || err.serverResponseCode === 'AUTHENTICATIONFAILED') return false;

  const text = `${err.message || ''} ${err.responseText || ''}`.toLowerCase();
  if (/(authentication|invalid credentials|login failed|password)/.test(text)) return false;

  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(err.code)) return true;

  return /too many|maximum number of connections|concurrent|resource temporarily unavailable|try again later/.test(text);
}

module.exports = { createPool, isCapacityRefusal, RAISE_AFTER_OK };
