'use strict';

/**
 * Отзывы, которых больше нет на площадке (ver. 8.85).
 *
 * После прохода по месту парсер присылает, какие отзывы он видел и с какой
 * даты его проход полон (coveredFrom — дата самого старого увиденного). Всё,
 * что старше, мы не судим: проход мог не дойти до конца истории (Яндекс
 * отдаёт не больше тысячи отзывов, 2ГИС может не понять листания), и без
 * этой границы старые отзывы помечались бы удалёнными просто потому, что до
 * них не долистали.
 *
 * Пропажу подтверждаем двумя проходами подряд: один пропуск бывает из-за
 * того, что отзыв посреди прохода переехал между страницами. А площадка,
 * которая сама сказала, что сняла отзыв (removed), — сразу.
 *
 * Вернулся отзыв — отметка снимается: пациент мог скрыть отзыв и открыть
 * снова, площадка — восстановить после проверки.
 */

const { Op } = require('sequelize');
const { Review, ReviewHistory, ReviewPlatformPlace } = require('../../models');
const { HISTORY_ACTIONS } = require('../../config/reviewStatuses');

// Системные записи в истории отзыва идут от бота отзывов — у ReviewHistory
// автор обязателен, а человека за пропажей отзыва нет.
const REVIEWS_BOT_ID = '00000000-0000-0000-0000-000000000002';
const MISSES_TO_REMOVE = 2;

const REASON_LABELS = {
  moderation: 'снят модерацией площадки',
  hidden: 'скрыт площадкой',
  missing: 'удалён с площадки',
};

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

async function addHistory(reviewId, action, comment) {
  await ReviewHistory.create({ reviewId, userId: REVIEWS_BOT_ID, action, comment });
}

/**
 * @param {string} placeId
 * @param {object} body { coveredFrom: ISO | null, seen: [id], removed: { id: reason } }
 * @returns {object} { removed, restored }
 */
async function applyPass(placeId, body) {
  const place = await ReviewPlatformPlace.findByPk(placeId, { include: ['account'] });
  if (!place) throw Object.assign(new Error('Место не найдено'), { status: 404 });

  const prefix = `${place.account.platform}:`;
  const seen = new Set((body.seen || []).map(String));
  const removedByPlatform = body.removed || {};
  const coveredFrom = dateOnly(body.coveredFrom);

  const cards = await Review.findAll({
    where: {
      sourceKey: { [Op.like]: `${prefix}%` },
      syncMeta: { direct: { placeId: place.id } },
    },
    attributes: ['id', 'sourceKey', 'reviewDate', 'syncMeta', 'platformRemovedAt', 'platformRemovedReason'],
    paranoid: false,
  });

  const result = { removed: 0, restored: 0 };
  const now = new Date();

  for (const card of cards) {
    const externalId = card.sourceKey.slice(prefix.length);
    const meta = card.syncMeta || {};
    const direct = { ...(meta.direct || {}) };

    let reason = removedByPlatform[externalId] || null;
    if (!reason && !seen.has(externalId)) {
      // Судим только внутри полной части прохода, и строго позже её края:
      // отзывы того же дня могли остаться на недолистанной странице.
      const judged = !coveredFrom || dateOnly(card.reviewDate) > coveredFrom;
      if (!judged) continue;
      direct.misses = (direct.misses || 0) + 1;
      if (direct.misses >= MISSES_TO_REMOVE) reason = 'missing';
    } else if (!reason) {
      direct.misses = 0;
    }

    if (reason && !card.platformRemovedAt) {
      await card.update({
        platformRemovedAt: now,
        platformRemovedReason: reason,
        syncMeta: { ...meta, direct: { ...direct, misses: 0 } },
      });
      await addHistory(card.id, HISTORY_ACTIONS.PLATFORM_REMOVED, `Отзыв ${REASON_LABELS[reason] || 'удалён'}`);
      result.removed++;
    } else if (!reason && card.platformRemovedAt && seen.has(externalId)) {
      await card.update({
        platformRemovedAt: null,
        platformRemovedReason: null,
        syncMeta: { ...meta, direct: { ...direct, misses: 0 } },
      });
      await addHistory(card.id, HISTORY_ACTIONS.PLATFORM_RESTORED, 'Отзыв снова опубликован на площадке');
      result.restored++;
    } else if ((meta.direct?.misses || 0) !== (direct.misses || 0)) {
      await card.update({ syncMeta: { ...meta, direct } });
    }
  }

  return result;
}

module.exports = { applyPass, REASON_LABELS, MISSES_TO_REMOVE };
