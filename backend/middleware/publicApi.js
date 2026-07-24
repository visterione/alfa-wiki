'use strict';

/**
 * Middleware публичного контура /api/public/*.
 *
 * В отличие от внутреннего API (JWT + пользователь) здесь аутентифицируется
 * не человек, а внешняя система — по ключу из таблицы api_clients.
 *
 *   apiKeyAuth — проверяет X-Api-Key, права (scopes), Origin и IP
 *   rateLimit  — ограничивает частоту запросов
 *   auditLog   — пишет обращение в api_request_logs (без тела: там ПДн)
 */

const crypto = require('crypto');
const { ApiClient, ApiRequestLog } = require('../models');

const KEY_PREFIX_LENGTH = 16;

// ── Ответ об ошибке ───────────────────────────────────────────────────────

function fail(res, status, errorCode, message) {
  res.locals.errorCode = errorCode;
  return res.status(status).json({ ok: false, error: errorCode, message });
}

/**
 * Реальный IP клиента. За nginx оригинальный адрес приезжает в X-Forwarded-For;
 * читаем его напрямую, чтобы не включать trust proxy на всё приложение.
 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

// ── Аутентификация по ключу ───────────────────────────────────────────────

/** Ключ в БД не хранится — сравниваем хеши. */
function hashKey(key) {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Проверяет X-Api-Key и кладёт клиента в req.apiClient.
 *
 * @param {string} [requiredScope] Право, которое должно быть у клиента. Если не
 *   задано — проверяется только валидность ключа (сам scope проверит роут).
 */
function apiKeyAuth(requiredScope) {
  return async (req, res, next) => {
    try {
      const header = req.headers['x-api-key'] || '';
      const bearer = (req.headers.authorization || '').startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : '';
      const key = String(header || bearer).trim();

      if (!key) {
        return fail(res, 401, 'missing_api_key', 'Не передан заголовок X-Api-Key');
      }

      const client = await ApiClient.findOne({
        where: { keyPrefix: key.slice(0, KEY_PREFIX_LENGTH) }
      });

      // Одинаковый ответ на «ключа нет» и «ключ отозван» — чтобы не подсказывать перебором
      if (!client || !client.isActive || !safeEquals(client.keyHash, hashKey(key))) {
        return fail(res, 401, 'invalid_api_key', 'Ключ не найден или отозван');
      }

      if (requiredScope && !(client.scopes || []).includes(requiredScope)) {
        return fail(res, 403, 'scope_denied', `Ключу не разрешено действие «${requiredScope}»`);
      }

      // Публичный ключ лежит в открытом виде на странице сайта — обязателен белый список Origin
      if (client.keyType === 'public') {
        const origin = req.headers.origin || '';
        const allowed = client.allowedOrigins || [];
        if (allowed.length === 0 || !allowed.includes(origin)) {
          return fail(res, 403, 'origin_denied', 'Запрос пришёл с неразрешённого адреса');
        }
      }

      // Для серверных ключей белый список IP необязателен, но если задан — соблюдаем
      const allowedIps = client.allowedIps || [];
      if (allowedIps.length > 0 && !allowedIps.includes(clientIp(req))) {
        return fail(res, 403, 'ip_denied', 'Запрос пришёл с неразрешённого IP-адреса');
      }

      req.apiClient = client;
      // Отметка о последнем использовании не должна задерживать ответ
      client.update({ lastUsedAt: new Date() }).catch(() => {});

      next();
    } catch (error) {
      console.error('[publicApi] ошибка аутентификации:', error);
      return fail(res, 500, 'internal_error', 'Внутренняя ошибка сервера');
    }
  };
}

/** Сравнение хешей за постоянное время. */
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Ограничение частоты ───────────────────────────────────────────────────

// Счётчики в памяти процесса. Бэкенд работает одним процессом (pm2 fork,
// см. ecosystem.config.js), поэтому общего хранилища не требуется.
const buckets = new Map();
const WINDOW_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, WINDOW_MS).unref();

function hit(key, limit) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count++;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Лимит по IP — работает до аутентификации, защищает от перебора ключей.
 * @param {number} limit Запросов в минуту с одного адреса
 */
function rateLimitByIp(limit = 60) {
  return (req, res, next) => {
    const { allowed, retryAfter } = hit(`ip:${clientIp(req)}`, limit);
    if (!allowed) {
      res.set('Retry-After', String(retryAfter));
      return fail(res, 429, 'rate_limited', `Слишком много запросов, повторите через ${retryAfter} с`);
    }
    next();
  };
}

/** Лимит по ключу — ставится после apiKeyAuth, берёт значение из настроек клиента. */
function rateLimitByClient() {
  return (req, res, next) => {
    const limit = req.apiClient?.rateLimitPerMin || 60;
    const { allowed, retryAfter } = hit(`client:${req.apiClient.id}`, limit);
    if (!allowed) {
      res.set('Retry-After', String(retryAfter));
      return fail(res, 429, 'rate_limited', `Слишком много запросов, повторите через ${retryAfter} с`);
    }
    next();
  };
}

// ── Аудит ─────────────────────────────────────────────────────────────────

/**
 * Пишет каждое обращение к публичному API в api_request_logs.
 * Тело запроса не сохраняется — в нём персональные данные.
 */
function auditLog() {
  return (req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', () => {
      ApiRequestLog.create({
        clientId:   req.apiClient?.id || null,
        method:     req.method,
        path:       req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        errorCode:  res.locals.errorCode || null,
        durationMs: Date.now() - startedAt,
        ip:         clientIp(req)
      }).catch(err => console.error('[publicApi] не удалось записать лог:', err.message));
    });

    next();
  };
}

// ── Ограничение размера тела ──────────────────────────────────────────────

/**
 * Отсекает большие тела до разбора JSON. Формы весят единицы килобайт.
 * @param {number} maxBytes
 */
function limitBodySize(maxBytes = 100 * 1024) {
  return (req, res, next) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBytes) {
      return fail(res, 413, 'payload_too_large', `Тело запроса больше ${Math.round(maxBytes / 1024)} КБ`);
    }
    next();
  };
}

module.exports = {
  apiKeyAuth,
  rateLimitByIp,
  rateLimitByClient,
  auditLog,
  limitBodySize,
  hashKey,
  clientIp,
  KEY_PREFIX_LENGTH
};
