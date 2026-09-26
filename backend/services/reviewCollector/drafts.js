'use strict';

/**
 * Черновики ответов на отзывы (ver. 8.90).
 *
 * Пишет их Альфа Парсер локальной моделью: вики ставит задачу «draft», парсер
 * забирает её, пишет два-три варианта и возвращает. Ничего не отправляется
 * само — варианты лишь подставляются в поле ответа по клику человека.
 *
 * Хранятся в reviews."syncMeta".drafts и нужны только до ответа:
 *
 *   ответили из вики или прямо на площадке → удаляются сразу (clearDrafts);
 *   отзыв в архиве, решение принято, отзыв снят с площадки, черновики
 *   пролежали больше DRAFT_TTL_DAYS → ночная уборка (cleanupDrafts).
 *
 * Отдельной таблицы нет: объём ничтожный (три варианта — пара килобайт),
 * живут недолго, и читаются всегда вместе с карточкой.
 */

const { Op, literal } = require('sequelize');
const { Review, ReviewCollectorJob, ReviewPlatformPlace } = require('../../models');

const DRAFT_TTL_DAYS = 30;

/** syncMeta без черновиков — после ответа они больше не нужны. */
function clearDrafts(meta) {
  if (!meta || (!meta.drafts && !meta.draftsPending)) return meta;
  const next = { ...meta };
  delete next.drafts;
  delete next.draftsPending;
  return next;
}

function isAnswered(meta) {
  return !!(meta?.replyText || meta?.isAnswered || meta?.replySending);
}

/**
 * Поставить задачу на черновики. auto — при появлении карточки: тихо
 * пропускаем, если писать нечего; по кнопке — объясняем почему.
 */
async function enqueueDraft(review, userId = null, { auto = false } = {}) {
  const meta = review.syncMeta || {};
  const fail = (message) => {
    if (auto) return null;
    throw Object.assign(new Error(message), { status: 400 });
  };

  if (isAnswered(meta)) return fail('На отзыв уже ответили');
  if (review.platformRemovedAt) return fail('Отзыва уже нет на площадке');
  const placeId = meta.direct?.placeId;
  if (!review.sourceKey || !placeId) return fail('Отзыв не связан с площадкой');

  const place = await ReviewPlatformPlace.findByPk(placeId, { include: ['account'] });
  if (!place?.account) return fail('Место на площадке больше не найдено');

  const busy = await ReviewCollectorJob.findOne({
    where: { reviewId: review.id, kind: 'draft', status: { [Op.in]: ['queued', 'taken'] } },
  });
  if (busy) return busy;

  const job = await ReviewCollectorJob.create({
    kind: 'draft',
    accountId: place.accountId,
    placeId: place.id,
    reviewId: review.id,
    payload: {
      reviewId: review.id,
      boardId: review.boardId,
      platform: place.account.platform,
      text: review.reviewText || '',
      rating: review.rating,
      doctor: review.doctorName || null,
      author: review.patientName || null,
    },
    createdBy: userId,
  });
  await Review.update(
    { syncMeta: { ...meta, draftsPending: true } },
    { where: { id: review.id }, paranoid: false },
  );
  return job;
}

/** Итог задачи от парсера: сохранить варианты, если ответа ещё нет. */
async function storeDrafts(job, ok, result) {
  const review = await Review.findByPk(job.reviewId, { paranoid: false });
  if (!review) return;
  const meta = { ...(review.syncMeta || {}) };
  delete meta.draftsPending;

  const items = ok && Array.isArray(result?.drafts)
    ? result.drafts.filter(t => typeof t === 'string' && t.trim()).slice(0, 3)
    : [];
  // Пока модель писала, на отзыв могли ответить — тогда черновики лишние.
  if (items.length && !isAnswered(meta)) {
    meta.drafts = { items, at: new Date().toISOString(), model: result.model || null };
  }
  await review.update({ syncMeta: meta });
}

/**
 * Ночная уборка: черновики, которые уже не понадобятся. Один запрос на
 * выборку — отзывов с черновиками единицы-десятки, а не тысячи.
 */
async function cleanupDrafts() {
  const cutoff = new Date(Date.now() - DRAFT_TTL_DAYS * 86400000).toISOString();
  const rows = await Review.findAll({
    where: {
      [Op.and]: [literal(`("syncMeta" ? 'drafts' OR "syncMeta" ? 'draftsPending')`)],
      [Op.or]: [
        { archived: true },
        { status: 'final' },
        { platformRemovedAt: { [Op.ne]: null } },
        literal(`"syncMeta"->>'replyText' IS NOT NULL`),
        literal(`("syncMeta"->'drafts'->>'at') < '${cutoff}'`),
      ],
    },
    attributes: ['id', 'syncMeta'],
    paranoid: false,
  });
  for (const r of rows) {
    await Review.update({ syncMeta: clearDrafts(r.syncMeta) }, { where: { id: r.id }, paranoid: false });
  }
  return rows.length;
}

module.exports = { enqueueDraft, storeDrafts, cleanupDrafts, clearDrafts, DRAFT_TTL_DAYS };
