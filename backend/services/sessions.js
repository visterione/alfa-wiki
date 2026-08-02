/**
 * Реестр сессий: выдача, проверка и отзыв токенов.
 *
 * До этого при входе выдавался голый JWT { userId }, и отозвать его было
 * невозможно — только сменить JWT_SECRET сразу всем. На мобиле токен живёт
 * 365 дней, так что потерянный телефон означал год доступа.
 *
 * Теперь в payload есть `sid` — идентификатор строки в user_sessions. Проверка
 * идёт через кэш в памяти (CACHE_TTL_MS), поэтому на горячем пути обычно нет
 * похода в БД, а отзыв гасит запись в кэше явно и действует немедленно.
 */

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { UserSession } = require('../models');

// Насколько доверяем закэшированной сессии. Отзыв инвалидирует кэш сам, так что
// TTL нужен лишь на случай, когда снятие произошло в обход этого процесса
// (например, вручную в БД).
const CACHE_TTL_MS = 60 * 1000;
// Не чаще этого обновляем lastActivityAt: это чисто информационное поле для
// списка «мои устройства», писать его на каждый запрос незачем.
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;

// sid → { session: {id, userId, revokedAt, expiresAt} | null, cachedAt, activityAt }
const cache = new Map();

// Устанавливается из server.js: рвёт живые сокеты отозванной сессии.
let onRevoked = () => {};

function setRevocationListener(fn) {
  onRevoked = typeof fn === 'function' ? fn : () => {};
}

function platformFromRequest(req) {
  const clientType = req.headers['x-client-type'];
  if (clientType === 'mobile') return 'mobile';
  if (clientType === 'desktop') return 'desktop';
  return 'web';
}

function tokenTtlFor(platform) {
  return platform === 'mobile' ? '365d' : (process.env.JWT_EXPIRES_IN || '7d');
}

// Грубый разбор UA — ровно настолько, чтобы человек узнал своё устройство в
// списке сессий. Мобильное приложение присылает готовое имя в x-device-name.
function deviceNameFromRequest(req) {
  const explicit = req.headers['x-device-name'];
  if (explicit) return String(explicit).slice(0, 200);

  const ua = req.headers['user-agent'] || '';
  const os =
    /Windows/i.test(ua) ? 'Windows' :
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad|iOS/i.test(ua) ? 'iOS' :
    /Mac OS X/i.test(ua) ? 'macOS' :
    /Linux/i.test(ua) ? 'Linux' : null;
  const browser =
    /Edg\//i.test(ua) ? 'Edge' :
    /OPR\//i.test(ua) ? 'Opera' :
    /Firefox\//i.test(ua) ? 'Firefox' :
    /Chrome\//i.test(ua) ? 'Chrome' :
    /Safari\//i.test(ua) ? 'Safari' : null;

  if (os && browser) return `${browser} · ${os}`;
  return os || browser || null;
}

function ipFromRequest(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = forwarded ? String(forwarded).split(',')[0].trim() : req.ip;
  return raw ? String(raw).slice(0, 64) : null;
}

/**
 * Создаёт сессию и подписывает токен с её `sid`.
 * @returns {Promise<{token: string, session: object}>}
 */
async function issueToken(user, req) {
  const platform = platformFromRequest(req);
  const ttl = tokenTtlFor(platform);

  // Сначала подписываем — из exp токена берём expiresAt сессии, чтобы они не
  // разъехались при смене JWT_EXPIRES_IN.
  const sessionId = randomUUID();
  const token = jwt.sign(
    { userId: user.id, sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: ttl }
  );
  const { exp } = jwt.decode(token);

  const session = await UserSession.create({
    id: sessionId,
    userId: user.id,
    platform,
    deviceName: deviceNameFromRequest(req),
    ip: ipFromRequest(req),
    userAgent: (req.headers['user-agent'] || '').slice(0, 512) || null,
    lastActivityAt: new Date(),
    expiresAt: new Date(exp * 1000),
  });

  cache.set(sessionId, { session: session.toJSON(), cachedAt: Date.now(), activityAt: Date.now() });
  return { token, session };
}

/**
 * Жива ли сессия. `null` — нет такой, отозвана или протухла.
 */
async function getActiveSession(sid) {
  if (!sid) return null;

  const cached = cache.get(sid);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    if (!cached.session) return null;
    if (cached.session.revokedAt) return null;
    if (new Date(cached.session.expiresAt) <= new Date()) return null;
    return cached.session;
  }

  const row = await UserSession.findByPk(sid);
  const session = row ? row.toJSON() : null;
  cache.set(sid, { session, cachedAt: Date.now(), activityAt: cached?.activityAt || 0 });

  if (!session || session.revokedAt) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;
  return session;
}

/**
 * Отметка активности — троттлингом, fire-and-forget.
 */
function touchActivity(sid) {
  if (!sid) return;
  const entry = cache.get(sid);
  const now = Date.now();
  if (entry && now - (entry.activityAt || 0) < ACTIVITY_THROTTLE_MS) return;
  if (entry) entry.activityAt = now;
  UserSession.update({ lastActivityAt: new Date(now) }, { where: { id: sid } }).catch(() => {});
}

async function revoke(sid, reason = 'logout') {
  if (!sid) return;
  await UserSession.update(
    { revokedAt: new Date(), revokedReason: reason },
    { where: { id: sid, revokedAt: null } }
  );
  cache.delete(sid);
  onRevoked([sid]);
}

/**
 * Снимает все сессии пользователя, кроме указанной.
 * @returns {Promise<number>} сколько сняли
 */
async function revokeAllForUser(userId, exceptSid = null, reason = 'logout_all') {
  const where = { userId, revokedAt: null };
  const rows = await UserSession.findAll({ where, attributes: ['id'] });
  const ids = rows.map(r => r.id).filter(id => id !== exceptSid);
  if (ids.length === 0) return 0;

  await UserSession.update(
    { revokedAt: new Date(), revokedReason: reason },
    { where: { id: ids } }
  );
  ids.forEach(id => cache.delete(id));
  onRevoked(ids);
  return ids.length;
}

async function listForUser(userId) {
  const rows = await UserSession.findAll({ where: { userId, revokedAt: null } });
  // Сортируем в памяти: сессий у человека единицы, а `NULLS LAST` в order
  // Sequelize пишет по-разному в зависимости от версии.
  return rows
    .filter(r => new Date(r.expiresAt) > new Date())
    .sort((a, b) => new Date(b.lastActivityAt || b.createdAt) - new Date(a.lastActivityAt || a.createdAt));
}

module.exports = {
  issueToken,
  getActiveSession,
  touchActivity,
  revoke,
  revokeAllForUser,
  listForUser,
  setRevocationListener,
};
