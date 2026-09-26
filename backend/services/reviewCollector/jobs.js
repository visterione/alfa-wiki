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
  sequelize, Review, ReviewHistory, ReviewPlatformAccount, ReviewPlatformPlace, ReviewCollectorJob, ReviewBoard, MedCenter,
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
  if (!password && !platforms.get(platform).passwordless) throw new CollectorError('Пароль обязателен');

  const account = await ReviewPlatformAccount.create({
    platform,
    label: label?.trim() || null,
    login: login.trim(),
    ...(password ? encryptPassword(password) : {}),
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
    // Учётка без пароля (Яндекс, вход по письму) получает пустую строку —
    // адаптер по ней понимает, что надо выбирать вход по ссылке.
    password: a.passwordEnc ? decryptPassword(a) : '',
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
      // Доска — для черновиков ответа: по ней вики отдаёт подпись и контакты
      boardId: p.boardId || null,
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

  // Вход больше не ждёт человека — невзятые клики по старому снимку капчи
  // гасим, чтобы следующий удалённый вход не начал с чужих нажатий.
  if (status && status !== 'needs_login') {
    await ReviewCollectorJob.update(
      { status: 'failed', error: 'вход уже завершён', finishedAt: new Date() },
      { where: { accountId, kind: 'input', status: { [Op.in]: ['queued', 'taken'] } } },
    );
  }

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
async function linkedPlace(review) {
  const placeId = review.syncMeta?.direct?.placeId;
  if (!review.sourceKey || !placeId) return { ok: false, reason: 'Отзыв не связан с площадкой напрямую' };

  const place = await ReviewPlatformPlace.findByPk(placeId, { include: ['account'] });
  if (!place?.account) return { ok: false, reason: 'Место на площадке больше не найдено' };
  if (place.mode !== 'live') return { ok: false, reason: 'Место на площадке ещё в режиме сверки' };
  if (!place.account.isEnabled) return { ok: false, reason: 'Учётная запись площадки выключена' };
  if (review.platformRemovedAt) return { ok: false, reason: 'Отзыва уже нет на площадке' };
  return { ok: true, place, platform: platforms.get(place.account.platform) };
}

async function replyTarget(review) {
  const target = await linkedPlace(review);
  if (!target.ok) return target;
  if (!target.platform?.canReply) {
    return { ok: false, reason: `${target.platform?.label || 'Площадка'} не принимает ответы` };
  }
  return target;
}

/** Куда и с какими причинами можно пожаловаться на отзыв (ver. 8.85). */
async function complaintTarget(review) {
  const target = await linkedPlace(review);
  if (!target.ok) return target;
  const config = platforms.complaintConfig(target.place.account.platform);
  if (!config) {
    return { ok: false, reason: `На ${target.platform?.label || 'этой площадке'} жалобу из вики пока не отправить` };
  }
  return { ...target, config };
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

async function enqueueComplaint(review, { reason, text }, userId) {
  const target = await complaintTarget(review);
  if (!target.ok) throw new CollectorError(target.reason);

  const cause = target.config.reasons.find(r => r.id === reason) || null;
  if (target.config.reasons.length && !cause) throw new CollectorError('Выберите причину жалобы');
  if (!text?.trim()) throw new CollectorError('Опишите, почему отзыв нарушает правила');

  const busy = await ReviewCollectorJob.findOne({
    where: { reviewId: review.id, kind: 'complaint', status: { [Op.in]: ['queued', 'taken'] } },
  });
  if (busy) throw new CollectorError('Предыдущая жалоба ещё не отправлена');

  const externalId = review.sourceKey.slice(review.sourceKey.indexOf(':') + 1);
  const job = await ReviewCollectorJob.create({
    kind: 'complaint',
    accountId: target.place.accountId,
    placeId: target.place.id,
    reviewId: review.id,
    payload: {
      externalId,
      placeExternalId: target.place.externalId,
      reason: cause?.id || null,
      reasonLabel: cause?.label || null,
      text: text.trim(),
    },
    createdBy: userId,
  });

  await Review.update({
    syncMeta: {
      ...(review.syncMeta || {}),
      complaint: {
        state: 'sending',
        reason: cause?.label || null,
        text: text.trim(),
        at: new Date().toISOString(),
        by: userId,
        jobId: job.id,
      },
    },
  }, { where: { id: review.id } });
  return job;
}

/**
 * Ввод человека в удалённый вход: клик по снимку капчи, текст, клавиша.
 * Парсер во время входа опрашивает такие задачи раз в секунду.
 */
async function enqueueInput(accountId, input, userId) {
  const account = await ReviewPlatformAccount.findByPk(accountId);
  if (!account) throw new CollectorError('Учётная запись не найдена', 404);
  if (account.challenge?.kind !== 'screen') throw new CollectorError('Вход уже не ждёт ввода');
  const allowed = ['click', 'text', 'key'];
  if (!allowed.includes(input?.type)) throw new CollectorError('Неизвестный ввод');
  return ReviewCollectorJob.create({
    kind: 'input', accountId, payload: { input, seq: account.challenge.seq || 0 }, createdBy: userId,
  });
}

/**
 * Выдать парсеру задачи. Строки блокируются с SKIP LOCKED: даже если когда-
 * нибудь парсеров станет два, одну задачу они не возьмут вдвоём.
 */
async function takeJobs(limit = 20, { kind = null, accountId = null } = {}) {
  // Удалённый вход забирает только ввод своей учётки и раз в секунду; общий
  // цикл — всё, кроме ввода: клики, пришедшие после входа, никому не нужны.
  const filter = kind === 'input'
    ? `AND kind = 'input' AND "accountId" = :accountId`
    : `AND kind <> 'input'`;
  const rows = await sequelize.query(`
    UPDATE review_collector_jobs
       SET status = 'taken', "takenAt" = NOW(), attempts = attempts + 1, "updatedAt" = NOW()
     WHERE id IN (
       SELECT id FROM review_collector_jobs
        WHERE (status = 'queued'
           OR (status = 'taken' AND "takenAt" < NOW() - INTERVAL '${TAKEN_TIMEOUT_MIN} minutes'))
          ${filter}
        ORDER BY "createdAt"
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, kind, "accountId", "placeId", "reviewId", payload, attempts`,
  { replacements: { limit, accountId }, type: QueryTypes.SELECT });

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

  if (job.kind === 'complaint' && job.reviewId) {
    const review = await Review.findByPk(job.reviewId, { paranoid: false });
    if (review) {
      const meta = review.syncMeta || {};
      await review.update({
        syncMeta: {
          ...meta,
          complaint: {
            ...(meta.complaint || {}),
            state: ok ? 'sent' : 'failed',
            error: ok ? null : (body.message || 'Площадка не приняла жалобу'),
            sentAt: ok ? new Date().toISOString() : null,
          },
        },
      });
      if (ok) {
        await ReviewHistory.create({
          reviewId: review.id,
          userId: job.createdBy || '00000000-0000-0000-0000-000000000002',
          action: 'complained',
          comment: [job.payload.reasonLabel, job.payload.text].filter(Boolean).join('. '),
        });
      }
    }
  }

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
  complaintTarget,
  enqueueComplaint,
  enqueueInput,
  takeJobs,
  finishJob,
};
