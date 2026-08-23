'use strict';

const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const jwt = require('jsonwebtoken');
const { sequelize } = require('../models');

// Вложения чатов лежат в той же папке uploads, что и картинки вики, но по сути
// это переписка сотрудников: направления, выписки, сканы документов. До
// ver. 7.27 их отдавал express.static без единой проверки — кто знал имя файла,
// тот и читал, хоть из интернета.
//
// Заголовок Authorization в <img src>, в <video> и в системный менеджер
// загрузок Android не подставить, поэтому право доступа предъявляется коротким
// подписанным токеном в query. Токен намеренно отдельный от JWT: пересланная
// кому-то ссылка на картинку не должна открывать доступ к API от имени
// отправителя, а живёт она сутки вместо срока сессии.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Отдельный секрет, если задан. Фолбэк на JWT_SECRET — чтобы выкат не требовал
// правки .env на бою: подпись всё равно другая, домен применения разный.
function secret() {
  return process.env.FILE_TOKEN_SECRET || process.env.JWT_SECRET || '';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issueToken(userId, ttlMs = TOKEN_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, exp, providedSig] = parts;
  const expectedSig = sign(`${userId}.${exp}`);

  // timingSafeEqual падает на строках разной длины, поэтому длину сверяем сами
  if (providedSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) return null;
  if (!Number(exp) || Number(exp) < Date.now()) return null;

  return userId;
}

// Один разговор — это десятки картинок подряд, и на каждую браузер шлёт
// отдельный запрос. Без кэша каждый такой запрос стоил бы похода в базу.
const ACCESS_CACHE_TTL_MS = 60 * 1000;
const ACCESS_CACHE_MAX = 5000;
const accessCache = new Map();

function cacheGet(key) {
  const hit = accessCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    accessCache.delete(key);
    return undefined;
  }
  return hit.allowed;
}

function cacheSet(key, allowed) {
  // Простое вытеснение самого старого ключа: Map хранит порядок вставки, а
  // полноценный LRU здесь не окупается — записи и так живут минуту.
  if (accessCache.size >= ACCESS_CACHE_MAX) {
    accessCache.delete(accessCache.keys().next().value);
  }
  accessCache.set(key, { allowed, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS });
}

/**
 * Имеет ли пользователь право читать файл вложения.
 *
 * Разрешаем в двух случаях: файл приложен к сообщению в чате, где пользователь
 * состоит, либо файл загружен им самим и ещё никуда не отправлен (между
 * POST /chat/upload и отправкой сообщения проходит время, а превью рисуется
 * сразу).
 */
async function canAccessFile(userId, filename) {
  if (!userId || !filename) return false;

  const cacheKey = `${userId}:${filename}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  // Превью картинки лежит отдельным файлом thumb-<имя> и в реестр не пишется:
  // право на превью — это право на сам файл.
  const original = filename.startsWith('thumb-') ? filename.slice('thumb-'.length) : filename;

  const rows = await sequelize.query(`
    SELECT 1
    FROM chat_files cf
    LEFT JOIN chat_members cm
      ON cm."chatId" = cf."chatId" AND cm."userId" = $userId
    WHERE cf.filename = ANY($names::varchar[])
      AND (cm.id IS NOT NULL OR (cf."chatId" IS NULL AND cf."uploadedBy" = $userId))
    LIMIT 1
  `, {
    bind: { userId, names: [...new Set([filename, original])] },
    type: QueryTypes.SELECT
  });

  const allowed = rows.length > 0;
  cacheSet(cacheKey, allowed);
  return allowed;
}

// Файл только что привязали к чату или, наоборот, сообщение удалили — прежний
// ответ кэша про него больше не верен.
function invalidateFile(filename) {
  if (!filename) return;
  for (const key of accessCache.keys()) {
    if (key.endsWith(`:${filename}`)) accessCache.delete(key);
  }
}

function userIdFromRequest(req) {
  const fromQuery = verifyToken(req.query?.t);
  if (fromQuery) return fromQuery;

  // Bearer остаётся рабочим вариантом: им ходят те клиенты, которые могут
  // выставить заголовок (скачивание отчётов, служебные запросы).
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET).userId;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Пропускает к файлу вложения только участника соответствующего чата.
 * Вешается на /uploads/chat-attachments перед раздачей статики.
 */
async function chatFileGuard(req, res, next) {
  try {
    const userId = userIdFromRequest(req);
    if (!userId) return res.status(401).send('Unauthorized');

    // req.path внутри примонтированного роутера — это уже путь без префикса
    const filename = decodeURIComponent(req.path).split('/').pop();
    if (!(await canAccessFile(userId, filename))) {
      return res.status(403).send('Forbidden');
    }

    next();
  } catch (error) {
    console.error('Chat file guard error:', error);
    res.status(500).send('Internal error');
  }
}

module.exports = {
  issueToken,
  verifyToken,
  canAccessFile,
  invalidateFile,
  chatFileGuard,
  TOKEN_TTL_MS
};
