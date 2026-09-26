'use strict';

/**
 * Приём отзывов от Альфа Парсера (ver. 8.80).
 *
 * Парсер присылает отзывы одного места пачкой. Для каждого по порядку:
 *
 *   1. карточка с этим sourceKey уже есть — обновляем ответ и не более;
 *   2. есть карточка GetLoyalty, которая оказалась тем же отзывом
 *      (match.js), — дописываем ей sourceKey, новую не заводим;
 *   3. иначе в режиме live заводим карточку, а в shadow только считаем
 *      отзыв несовпавшим и кладём образец в отчёт места.
 *
 * Пункт 2 нужен и после отключения GetLoyalty (ver. 8.84): его архив остаётся
 * на досках, и отзыв, который он когда-то завёл, парсер не должен завести
 * второй раз — он только дописывает карточке свой ключ.
 */

const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const {
  Review, ReviewPlatform, ReviewBoard, MedCenter, ReviewPlatformPlace,
} = require('../../models');
const platforms = require('./platforms');
const { pickCounterpart, DATE_WINDOW_DAYS } = require('./match');
const { enqueueDraft, clearDrafts } = require('./drafts');

// Сколько несовпавших отзывов держать в отчёте места. Отчёт нужен, чтобы
// глазами понять, чего GetLoyalty не видел (или что сопоставление упустило),
// а не чтобы хранить их — сами отзывы придут снова при следующем сборе.
const UNMATCHED_SAMPLES = 20;

// Карточку парсер заводит только свежему отзыву. Первый проход по месту
// забирает всю историю (у одной Альфы на ПроДокторов почти две тысячи), и
// без этого предела каждый старый отзыв, которого не оказалось в архиве
// GetLoyalty, стал бы новой карточкой со сценарием доски — назначением и
// уведомлением. Старое остаётся в отчёте места, а связывание с уже
// существующими карточками работает на любой глубине.
const LIVE_MAX_AGE_DAYS = 14;

function isFresh(date) {
  const cutoff = Date.now() - LIVE_MAX_AGE_DAYS * 86400000;
  return new Date(`${String(date).slice(0, 10)}T00:00:00Z`).getTime() >= cutoff;
}

const platformIdCache = new Map();

async function platformId(name) {
  if (platformIdCache.has(name)) return platformIdCache.get(name);
  const [row] = await ReviewPlatform.findOrCreate({
    where: { name },
    defaults: { name, isActive: true, sortOrder: 99 },
  });
  platformIdCache.set(name, row.id);
  return row.id;
}

function sourceKeyOf(platformKey, externalId) {
  return `${platformKey}:${externalId}`;
}

function shiftDate(date, days) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clampRating(rating) {
  if (rating == null || Number.isNaN(Number(rating))) return null;
  return Math.max(1, Math.min(5, Math.round(Number(rating))));
}

/**
 * Ответ с площадки → поля syncMeta, которые уже понимает карточка
 * (replyText, isAnswered, replyPending…). Поля те же, что писал GetLoyalty, —
 * интерфейс не должен знать, откуда пришёл ответ.
 */
function replyMeta(answer) {
  if (!answer || !answer.text) {
    return { isAnswered: false };
  }
  return {
    replyText: answer.text,
    replyDate: answer.date || null,
    isAnswered: true,
    // Ответ на модерации площадки (ПроДокторов) — ещё не виден пациентам.
    replyPending: answer.state === 'moderation',
    replyRejected: answer.state === 'rejected',
    replyRejectReason: answer.state === 'rejected' ? (answer.rejectReason || null) : null,
    replyUnverified: false,
    replyFailed: false,
  };
}

/**
 * Обновление ответа у существующей карточки. Площадка — источник правды, но
 * с одной оговоркой: пока наш собственный ответ в очереди или только ушёл,
 * площадка его ещё не показывает, и «ответа нет» от неё не значит, что его
 * удалили.
 */
function mergeReply(meta, answer) {
  const next = { ...meta };
  if (answer?.text) {
    Object.assign(next, replyMeta(answer), { replySending: false });
    // Ответили — хоть из вики, хоть прямо на площадке: черновики больше не
    // нужны (ver. 8.90).
    return clearDrafts(next);
  }
  if (meta.replySending) return next;
  if (meta.isAnswered || meta.replyText) {
    delete next.replyText;
    delete next.replyDate;
    next.isAnswered = false;
    next.replyPending = false;
    next.replyRejected = false;
  }
  return next;
}

function directMeta(place, raw) {
  return {
    placeId: place.id,
    platform: place.account.platform,
    url: raw.url || null,
    // Площадки, которые не отдают имени (ПроДокторов, НаПоправку), присылают
    // замаскированный телефон. В «ФИО пациента» он не кладётся — оттуда он
    // расходился по отчётам и уведомлениям (см. память о patientName).
    patientPhone: raw.patientPhone || null,
    extra: raw.extra || null,
  };
}

async function findGetLoyaltyCounterpart(board, place, raw) {
  const names = platforms.reviewPlatformNames(place.account.platform);
  const ids = await Promise.all(names.map(platformId));

  const candidates = await Review.findAll({
    where: {
      boardId: board.id,
      platformId: { [Op.in]: ids },
      importSource: 'getloyalty',
      sourceKey: null,
      reviewDate: {
        [Op.between]: [shiftDate(raw.date, -DATE_WINDOW_DAYS), shiftDate(raw.date, DATE_WINDOW_DAYS)],
      },
    },
    attributes: ['id', 'reviewDate', 'reviewText', 'rating', 'doctorName', 'externalUrl', 'syncMeta'],
    paranoid: false,
  });

  return pickCounterpart({
    date: raw.date,
    text: raw.text,
    rating: clampRating(raw.rating),
    doctor: raw.doctor,
    urlFragment: raw.hints?.urlFragment,
  }, candidates);
}

async function createCard(board, place, raw, key) {
  const pid = await platformId(platforms.reviewPlatformName(place.account.platform, raw.subPlatform));
  const now = new Date();

  const review = await Review.create({
    id: uuidv4(),
    boardId: board.id,
    platformId: pid,
    patientName: raw.author || 'Аноним',
    reviewDate: String(raw.date).slice(0, 10),
    rating: clampRating(raw.rating) || 3,
    // Отзыв из одной оценки (частый на ПроДокторов и НаПоправку) остаётся
    // без текста: заглушка «(текст отсутствует)» читалась как текст отзыва
    // и попадала в отчёты и уведомления (ver. 8.84).
    reviewText: raw.text || '',
    doctorName: raw.doctor || null,
    status: 'new',
    externalUrl: raw.url || null,
    isAutoImported: true,
    syncedAt: now,
    importSource: 'collector',
    sourceKey: key,
    sortOrder: 0,
    archived: false,
    attachments: [],
    assigneeIds: [],
    syncMeta: { ...replyMeta(raw.answer), direct: directMeta(place, raw) },
  });

  // Свежему неотвеченному отзыву — сразу черновики ответа (ver. 8.90):
  // к тому, как человек откроет карточку, варианты обычно уже готовы.
  if (!raw.answer?.text) {
    try {
      await enqueueDraft(review, null, { auto: true });
    } catch (err) {
      console.error('[ReviewCollector] черновики не поставлены:', err.message);
    }
  }

  // Карточка, пришедшая от парсера, проходит тот же сценарий доски, что и
  // заведённая GetLoyalty: уведомления, назначения, негатив.
  try {
    const workflowEngine = require('../workflowEngine');
    const notificationService = require('../notificationService');
    await workflowEngine.executeWorkflow(board, 'review_created', review, notificationService);
  } catch (err) {
    console.error('[ReviewCollector] review_created hook error:', err.message);
  }

  return review;
}

/**
 * @param {string} placeId
 * @param {Array} rawReviews отзывы в формате парсера:
 *   { id, date, author, patientPhone, rating, text, doctor, url, subPlatform,
 *     hints: { urlFragment }, answer: { text, date, state, rejectReason }, extra }
 * @param {object} [opts]
 * @param {string} [opts.passId] проход парсера. Отзывы места приходят
 *   несколькими пачками (у публичного API предел тела 100 КБ), и отчёт
 *   сверки складывается по всем пачкам одного прохода.
 * @returns {object} счёт по исходам этой пачки
 */
async function ingestPlace(placeId, rawReviews, opts = {}) {
  const place = await ReviewPlatformPlace.findByPk(placeId, { include: ['account'] });
  if (!place) throw Object.assign(new Error('Место не найдено'), { status: 404 });

  const counts = { updated: 0, matched: 0, created: 0, unmatched: 0, skipped: 0 };
  const unmatchedSamples = [];

  const board = place.boardId
    ? await ReviewBoard.findByPk(place.boardId, { include: [{ model: MedCenter, as: 'medCenter' }] })
    : null;

  for (const raw of rawReviews || []) {
    if (!raw || !raw.id || !raw.date) { counts.skipped++; continue; }
    const key = sourceKeyOf(place.account.platform, raw.id);

    const existing = await Review.findOne({ where: { sourceKey: key }, paranoid: false });
    if (existing) {
      const meta = mergeReply(existing.syncMeta || {}, raw.answer);
      meta.direct = { ...(meta.direct || {}), ...directMeta(place, raw) };
      await existing.update({ syncMeta: meta, syncedAt: new Date() });
      counts.updated++;
      continue;
    }

    // Место не привязано к доске или выключено — отзыв некуда положить.
    if (!board || place.mode === 'off') { counts.skipped++; continue; }

    const counterpart = await findGetLoyaltyCounterpart(board, place, raw);
    if (counterpart) {
      const meta = mergeReply(counterpart.syncMeta || {}, raw.answer);
      meta.direct = directMeta(place, raw);
      await Review.update(
        { sourceKey: key, syncMeta: meta, syncedAt: new Date() },
        { where: { id: counterpart.id }, paranoid: false },
      );
      counts.matched++;
      continue;
    }

    if (place.mode === 'live' && isFresh(raw.date)) {
      await createCard(board, place, raw, key);
      counts.created++;
    } else {
      counts.unmatched++;
      if (unmatchedSamples.length < UNMATCHED_SAMPLES) {
        unmatchedSamples.push({
          id: raw.id,
          date: String(raw.date).slice(0, 10),
          rating: clampRating(raw.rating),
          doctor: raw.doctor || null,
          text: String(raw.text || '').slice(0, 200),
          url: raw.url || null,
        });
      }
    }
  }

  // Отчёт места — итог последнего прохода, а не накопленный за всё время
  // счёт: парсер присылает одни и те же отзывы раз за разом, и сумма ничего
  // бы не значила. Пачки одного прохода складываются.
  const prev = place.stats || {};
  const samePass = opts.passId && prev.passId === opts.passId;
  const total = { ...counts };
  let samples = unmatchedSamples;
  if (samePass) {
    for (const k of Object.keys(counts)) total[k] += prev[k] || 0;
    samples = [...(prev.unmatchedSamples || []), ...unmatchedSamples].slice(0, UNMATCHED_SAMPLES);
  }

  const linked = place.boardId
    ? await Review.count({
      where: { boardId: place.boardId, sourceKey: { [Op.like]: `${place.account.platform}:%` } },
      paranoid: false,
    })
    : 0;

  await place.update({
    lastSeenAt: new Date(),
    stats: {
      ...total, linked, unmatchedSamples: samples,
      passId: opts.passId || null, at: new Date().toISOString(),
    },
  });

  return counts;
}

module.exports = { ingestPlace, sourceKeyOf, replyMeta, mergeReply, platformId, isFresh, LIVE_MAX_AGE_DAYS };
