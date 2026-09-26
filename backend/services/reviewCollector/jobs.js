'use strict';

/**
 * Очередь задач Альфа Парсера и учётные записи площадок (ver. 8.80).
 *
 * Вики к парсеру не обращается: он сам раз в минуту забирает задачи
 * (takeJobs) и сообщает результат (finishJob). Задачи две — ответить на
 * отзыв и проверить учётку.
 *
 * Пароли шифруются тем же ключом и тем же кодом, что у почтовых ящиков
 * (services/mail/crypto.js). Второй ключ означал бы второе место, где его
 * можно забыть при переезде сервера, а выигрыша не дал бы: оба набора
 * паролей лежат в одной базе.
 */

const { Op, QueryTypes } = require('sequelize');
const {
  sequelize, Review, ReviewPlatformAccount, ReviewPlatformPlace, ReviewCollectorJob, ReviewBoard, MedCenter,
} = require('../../models');
const { encryptPassword, decryptPassword } = require('../mail/crypto');
const platforms = require('./platforms');
const { replyMeta } = require('./ingest');

// Задача, взятая парсером и не закрытая за это время, считается потерянной
// (парсер перезапустился на середине) и выдаётся снова.
const TAKEN_TIMEOUT_MIN = 15;
// Ответ, который площадка трижды не приняла, дальше не повторяем: скорее
// всего причина не сетевая, и человеку надо её увидеть.
const MAX_ATTEMPTS = 3;

class CollectorError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── Учётные записи ────────────────────────────────────────────────────────

async function createAccount({ platform, label, login, password }, userId) {
  if (!platforms.get(platform)) throw new CollectorError('Неизвестная площадка');
  if (!login?.trim()) throw new CollectorError('Логин обязателен');
  if (!password) throw new CollectorError('Пароль обязателен');

  const account = await ReviewPlatformAccount.create({
    platform,
    label: label?.trim() || null,
    login: login.trim(),
    ...encryptPassword(password),
    createdBy: userId,
  });
  await enqueueCheck(account.id, userId);
  return account;
}

async function updateAccount(id, { label, login, password, isEnabled }, userId) {
  const account = await ReviewPlatformAccount.findByPk(id);
  if (!account) throw new CollectorError('Учётная запись не найдена', 404);

  const patch = {};
  if (label !== undefined) patch.label = label?.trim() || null;
  if (isEnabled !== undefined) patch.isEnabled = !!isEnabled;

  const loginChanged = login !== undefined && login.trim() && login.trim() !== account.login;
  if (loginChanged) patch.login = login.trim();
  if (password) Object.assign(patch, encryptPassword(password));

  // Новые данные входа — старая сессия парсера больше не про эту учётку.
  // Статус сбрасываем сразу, чтобы в интерфейсе не висело «работает» до
  // первой проверки.
  if (loginChanged || password) {
    patch.credentialsVersion = account.credentialsVersion + 1;
    patch.status = 'new';
    patch.statusMessage = null;
    patch.challenge = null;
  }

  await account.update(patch);
  if (loginChanged || password) await enqueueCheck(account.id, userId);
  return account;
}

/** Всё, что парсеру нужно для работы: включённые учётки с паролями и местами. */
async function accountsForCollector() {
  const accounts = await ReviewPlatformAccount.scope('withSecret').findAll({
    where: { isEnabled: true },
    include: [{
      model: ReviewPlatformPlace, as: 'places',
      include: [{ model: ReviewBoard, as: 'board', include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }] }],
    }],
    order: [['createdAt', 'ASC']],
  });

  return accounts.map(a => ({
    id: a.id,
    platform: a.platform,
    login: a.login,
    password: decryptPassword(a),
    credentialsVersion: a.credentialsVersion,
    status: a.status,
    places: (a.places || []).map(p => ({
      id: p.id,
      externalId: p.externalId,
      name: p.name,
      mode: p.mode,
      // Парсеру не нужно знать про доски; ему достаточно понять, собирать ли
      // отзывы места. Имя медцентра — для его собственных логов.
      collect: p.mode !== 'off' && !!p.boardId,
      medCenter: p.board?.medCenter?.name || null,
    })),
  }));
}

/**
 * Парсер сообщает, чем кончился вход, и какие места нашёл в кабинете.
 * Места только добавляются и обновляются: пропавшее из списка площадки место
 * не удаляем, потому что к нему привязана доска, и человек должен сам решить,
 * что с этим делать.
 */
async function reportAccountStatus(accountId, { status, message, challenge, places, collectedAt }) {
  const account = await ReviewPlatformAccount.findByPk(accountId);
  if (!account) throw new CollectorError('Учётная запись не найдена', 404);

  const allowed = ['ok', 'needs_login', 'bad_password', 'error'];
  const patch = { statusAt: new Date() };
  if (status) {
    if (!allowed.includes(status)) throw new CollectorError(`Неизвестный статус: ${status}`);
    patch.status = status;
    patch.statusMessage = message || null;
    patch.challenge = status === 'needs_login' ? (challenge || null) : null;
  }
  if (collectedAt) patch.lastCollectedAt = new Date(collectedAt);
  await account.update(patch);

  for (const p of places || []) {
    if (!p?.externalId) continue;
    const [place] = await ReviewPlatformPlace.findOrCreate({
      where: { accountId, externalId: String(p.externalId) },
      defaults: { name: p.name || null, address: p.address || null, lastSeenAt: new Date() },
    });
    await place.update({
      name: p.name || place.name,
      address: p.address || place.address,
      lastSeenAt: new Date(),
    });
  }
  return account;
}

// ── Задачи ────────────────────────────────────────────────────────────────

async function enqueueCheck(accountId, userId) {
  const pending = await ReviewCollectorJob.findOne({
    where: { accountId, kind: 'check', status: { [Op.in]: ['queued', 'taken'] } },
  });
  if (pending) return pending;
  return ReviewCollectorJob.create({ kind: 'check', accountId, createdBy: userId || null });
}

/**
 * Можно ли ответить на отзыв через парсер. Возвращает место или объясняет,
 * почему нет, — объяснение уходит человеку в интерфейс.
 */
async function replyTarget(review) {
  const placeId = review.syncMeta?.direct?.placeId;
  if (!review.sourceKey || !placeId) return { ok: false, reason: 'Отзыв не связан с площадкой напрямую' };

  const place = await ReviewPlatformPlace.findByPk(placeId, { include: ['account'] });
  if (!place?.account) return { ok: false, reason: 'Место на площадке больше не найдено' };

  const platform = platforms.get(place.account.platform);
  if (!platform?.canReply) return { ok: false, reason: `${platform?.label || 'Площадка'} не принимает ответы` };
  if (place.mode !== 'live') return { ok: false, reason: 'Место на площадке ещё в режиме сверки' };
  if (!place.account.isEnabled) return { ok: false, reason: 'Учётная запись площадки выключена' };

  return { ok: true, place };
}

async function enqueueReply(review, text, userId) {
  const target = await replyTarget(review);
  if (!target.ok) throw new CollectorError(target.reason);

  const busy = await ReviewCollectorJob.findOne({
    where: { reviewId: review.id, kind: 'reply', status: { [Op.in]: ['queued', 'taken'] } },
  });
  if (busy) throw new CollectorError('Предыдущий ответ ещё не отправлен');

  const externalId = review.sourceKey.slice(review.sourceKey.indexOf(':') + 1);
  const job = await ReviewCollectorJob.create({
    kind: 'reply',
    accountId: target.place.accountId,
    placeId: target.place.id,
    reviewId: review.id,
    payload: { text, externalId, placeExternalId: target.place.externalId },
    createdBy: userId,
  });

  // replySending держит «отправляется» в карточке, пока парсер не ответил:
  // сбор отзывов в это время может прийти без нашего ответа, и это не
  // означает, что его удалили (см. mergeReply).
  await Review.update({
    syncMeta: {
      ...(review.syncMeta || {}),
      replyText: text,
      replyDate: new Date().toISOString(),
      replyAttemptAt: new Date().toISOString(),
      replyVia: 'collector',
      replySending: true,
      replyPending: false,
      replyFailed: false,
      replyRejected: false,
      replyError: null,
      replyJobId: job.id,
    },
  }, { where: { id: review.id } });

  return job;
}

/**
 * Выдать парсеру задачи. Строки блокируются с SKIP LOCKED: даже если когда-
 * нибудь парсеров станет два, одну задачу они не возьмут вдвоём.
 */
async function takeJobs(limit = 20) {
  const rows = await sequelize.query(`
    UPDATE review_collector_jobs
       SET status = 'taken', "takenAt" = NOW(), attempts = attempts + 1, "updatedAt" = NOW()
     WHERE id IN (
       SELECT id FROM review_collector_jobs
        WHERE status = 'queued'
           OR (status = 'taken' AND "takenAt" < NOW() - INTERVAL '${TAKEN_TIMEOUT_MIN} minutes')
        ORDER BY "createdAt"
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, kind, "accountId", "placeId", "reviewId", payload, attempts`,
  { replacements: { limit }, type: QueryTypes.SELECT });

  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    accountId: r.accountId,
    placeId: r.placeId,
    attempts: r.attempts,
    ...r.payload,
  }));
}

/**
 * Итог задачи от парсера.
 *
 * @param {object} body
 *   ok      — получилось ли;
 *   retry   — неудача временная (сеть, площадка легла), можно повторить;
 *   message — текст ошибки для человека;
 *   answer  — для ответа: как его теперь видит площадка
 *             { text, date, state: 'published' | 'moderation' }.
 */
async function finishJob(jobId, body) {
  const job = await ReviewCollectorJob.findByPk(jobId);
  if (!job) throw new CollectorError('Задача не найдена', 404);
  if (job.status === 'done' || job.status === 'failed') return job;

  const ok = !!body.ok;
  const giveUp = !ok && (!body.retry || job.attempts >= MAX_ATTEMPTS);

  if (!ok && !giveUp) {
    await job.update({ status: 'queued', error: body.message || null });
    return job;
  }

  await job.update({
    status: ok ? 'done' : 'failed',
    result: body.answer || body.data || null,
    error: ok ? null : (body.message || 'Неизвестная ошибка'),
    finishedAt: new Date(),
  });

  if (job.kind === 'reply' && job.reviewId) {
    const review = await Review.findByPk(job.reviewId, { paranoid: false });
    if (review) {
      const meta = { ...(review.syncMeta || {}), replySending: false };
      if (ok) {
        Object.assign(meta, replyMeta({
          text: body.answer?.text || job.payload.text,
          date: body.answer?.date || new Date().toISOString(),
          state: body.answer?.state || 'published',
        }));
      } else {
        meta.replyFailed = true;
        meta.replyError = body.message || 'Площадка не приняла ответ';
      }
      await review.update({ syncMeta: meta });
    }
  }
  return job;
}

module.exports = {
  CollectorError,
  createAccount,
  updateAccount,
  accountsForCollector,
  reportAccountStatus,
  enqueueCheck,
  enqueueReply,
  replyTarget,
  takeJobs,
  finishJob,
};
