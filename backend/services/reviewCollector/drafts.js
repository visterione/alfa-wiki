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
 *
 * С 9.22 копия каждого набора и отправленный ответ остаются в
 * review_reply_drafts: карточке они после ответа не нужны, а для оценки
 * черновиков и для отбора образцов — нужны (см. recordReply).
 */

const { Op, literal } = require('sequelize');
const { Review, ReviewCollectorJob, ReviewPlatformPlace, ReviewReplyDraft } = require('../../models');

const DRAFT_TTL_DAYS = 30;
// Наборов на отзыв в истории: «Ещё варианты» жмут два-три раза, больше —
// уже не про выбор, а про то, что модель не справилась
const MAX_BATCHES = 10;
// Ответ, взятый из черновика больше чем на эту долю, — текст модели, а не
// человека: в образцы для неё он не идёт (см. replyContext.js)
const DRAFT_ORIGIN_SHARE = 0.6;

/** syncMeta без черновиков — после ответа они больше не нужны. */
function clearDrafts(meta) {
  if (!meta || (!meta.drafts && !meta.draftsPending)) return meta;
  const next = { ...meta };
  delete next.drafts;
  delete next.draftsPending;
  return next;
}

/**
 * Вариант от парсера: до 0.50 — строка, с 0.50 — { text, notes }, где notes —
 * что проверить перед отправкой («обещает скидку», «нет контактов
 * медцентра»). Вариант с пометками парсер больше не выбрасывает: человек его
 * всё равно читает, а поправить готовый быстрее, чем писать с нуля.
 */
function normalizeDraft(item) {
  if (typeof item === 'string') return item.trim() ? { text: item, notes: [] } : null;
  if (!item || typeof item.text !== 'string' || !item.text.trim()) return null;
  const notes = Array.isArray(item.notes)
    ? item.notes.filter(n => typeof n === 'string' && n.trim()).slice(0, 8).map(n => n.slice(0, 200))
    : [];
  return { text: item.text, notes };
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
    ? result.drafts.map(normalizeDraft).filter(Boolean).slice(0, 3)
    : [];
  // Пока модель писала, на отзыв могли ответить — тогда черновики лишние.
  if (items.length && !isAnswered(meta)) {
    meta.drafts = { items, at: new Date().toISOString(), model: result.model || null };
    await recordBatch(review.id, meta.drafts);
  }
  await review.update({ syncMeta: meta });
}

// ── История черновиков (ver. 9.22) ──────────────────────────────────────

function trigrams(text) {
  const words = String(text || '').toLowerCase().match(/[а-яёa-z0-9]+/g) || [];
  const out = new Set();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/**
 * Какая доля ответа взята из черновика: доля трёхсловий ответа, которые
 * есть в варианте. Мерим со стороны ответа, а не симметрично: короткий
 * ответ, целиком вырезанный из длинного варианта, — это всё равно текст
 * модели. Исправленный падеж рвёт два-три трёхсловия из сотни, переписанный
 * своими словами ответ даёт около нуля.
 */
function draftShare(reply, draft) {
  const r = trigrams(reply);
  if (!r.size) return 0;
  const d = trigrams(draft);
  let common = 0;
  for (const g of r) if (d.has(g)) common++;
  return common / r.size;
}

/** Самый близкий к ответу вариант из всех показанных наборов. */
function closestDraft(reply, batches) {
  let best = { fromDraft: 0, bestBatch: null, bestIndex: null };
  (batches || []).forEach((batch, b) => (batch.items || []).forEach((item, i) => {
    const share = draftShare(reply, item.text);
    if (share > best.fromDraft) best = { fromDraft: share, bestBatch: b, bestIndex: i };
  }));
  return best;
}

/*
 * Обе записи — попутные: сбой здесь не должен ронять ни сохранение
 * черновиков, ни отправку ответа. Поэтому ошибки только в лог.
 */

async function recordBatch(reviewId, drafts) {
  try {
    const row = await ReviewReplyDraft.findByPk(reviewId);
    const batch = { at: drafts.at, model: drafts.model, items: drafts.items };
    if (!row) {
      await ReviewReplyDraft.create({ reviewId, batches: [batch] });
    } else if (!row.replyText) {
      await row.update({ batches: [...row.batches, batch].slice(-MAX_BATCHES) });
    }
  } catch (err) {
    console.error('review_reply_drafts: набор не записан —', err.message);
  }
}

/**
 * Ответ на отзыв, к которому были черновики. source — wiki (отправили из
 * карточки) или platform (ответили прямо на площадке, мимо вики). Без
 * черновиков строки нет и не заводится: такой ответ целиком человеческий.
 */
async function recordReply(reviewId, text, source) {
  try {
    const row = await ReviewReplyDraft.findByPk(reviewId);
    if (!row || !text) return;
    await row.update({
      replyText: text,
      replySource: source,
      repliedAt: new Date(),
      ...closestDraft(text, row.batches),
    });
  } catch (err) {
    console.error('review_reply_drafts: ответ не записан —', err.message);
  }
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

module.exports = {
  enqueueDraft, storeDrafts, cleanupDrafts, clearDrafts, normalizeDraft, DRAFT_TTL_DAYS,
  recordReply, draftShare, closestDraft, DRAFT_ORIGIN_SHARE,
};
