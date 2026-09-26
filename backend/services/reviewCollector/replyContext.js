'use strict';

/**
 * Материал для черновиков ответов на отзывы, которые пишет модель Альфа
 * Парсера (ver. 8.88).
 *
 * Модель пишет только тело ответа, а голос клиники берёт из наших же
 * прошлых ответов: парсер получает отсюда образцы на похожие отзывы (та же
 * площадка, та же тональность) и подражает им. Это надёжнее любых правил в
 * промпте — в архиве больше тысячи ответов, написанных людьми.
 *
 * Подпись («медицинский центр «Альфа Проф»») тоже берётся из архива доски, а
 * не из справочника: ни name («Проф»), ни displayName («МЦ Проф») не
 * совпадают с тем, как клиника подписывается, а заводить для этого ещё одно
 * поле значило бы однажды забыть его заполнить. Контакты для ответа на
 * негатив — из карточки медцентра.
 */

const { Op, literal } = require('sequelize');
const { Review, ReviewBoard, ReviewPlatform, MedCenter } = require('../../models');
const platforms = require('./platforms');

const MIN_REPLY_LENGTH = 200;
const SIGNATURE_RE = /С уважением[^,\n]*,\s*((?:[а-яё]+\s){0,3}(?:медицинский|стоматологический|детский)[^«"\n]*[«"][^»"\n]+[»"])/i;

// Имя площадки в справочнике → ключ площадки у парсера
function platformKeyByName(name) {
  const hit = platforms.list().find(p => platforms.reviewPlatformNames(p.key).includes(name));
  return hit?.key || null;
}

function replyOf(review) {
  const text = review.syncMeta?.replyText;
  return typeof text === 'string' && text.trim().length >= MIN_REPLY_LENGTH ? text.trim() : null;
}

function normalizeSignature(raw) {
  return raw.trim()
    .replace(/"([^"]+)"/, '«$1»')
    .replace(/\.$/, '')
    // В архиве 3К годами подписывался «ЗК» — буквой З вместо цифры 3: опечатку
    // копировали из ответа в ответ. В новые ответы она не переходит.
    .replace(/«З([КK])»/, '«3К»');
}

/** Как клиника подписывается: самая частая подпись в ответах доски. */
async function signatureOf(boardId, medCenter) {
  const rows = await Review.findAll({
    where: { boardId, [Op.and]: [literal(`"syncMeta"->>'replyText' IS NOT NULL`)] },
    attributes: ['syncMeta'],
    order: [['reviewDate', 'DESC']],
    limit: 200,
  });
  const counts = new Map();
  for (const r of rows) {
    const m = SIGNATURE_RE.exec(r.syncMeta.replyText || '');
    if (!m) continue;
    const sig = normalizeSignature(m[1]);
    counts.set(sig, (counts.get(sig) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  // Своих ответов у доски нет — собираем подпись из справочника, без
  // служебной приставки «МЦ» из displayName.
  const title = (medCenter?.displayName || medCenter?.name || 'Альфа').replace(/^МЦ\s+/, '');
  return `медицинский центр «${title}»`;
}

function contactsOf(medCenter) {
  const phones = (medCenter?.phones || [])
    .map(p => (typeof p === 'string' ? p : p?.value))
    .filter(Boolean);
  return { phone: phones[0] || null, email: medCenter?.email || null };
}

/**
 * Контекст для одного отзыва: подпись, контакты и образцы наших ответов.
 *
 * @param {object} q { boardId, platform (ключ парсера), negative, exclude (id карточки) }
 */
async function replyContext({ boardId, platform, negative, exclude, limit = 40 }) {
  const board = await ReviewBoard.findByPk(boardId, { include: [{ model: MedCenter, as: 'medCenter' }] });
  if (!board) throw Object.assign(new Error('Доска не найдена'), { status: 404 });

  const names = platforms.reviewPlatformNames(platform);
  const platformRows = names.length
    ? await ReviewPlatform.findAll({ where: { name: { [Op.in]: names } }, attributes: ['id'] })
    : [];

  // Образцы — со всей сети, не только с этой доски: голос у клиник один, а
  // у маленькой доски своих ответов на негатив может не быть вовсе. Своя
  // площадка в приоритете — у ПроДокторов и Яндекса разный жанр отзыва.
  const where = {
    rating: negative ? { [Op.lte]: 3 } : { [Op.gte]: 4 },
    reviewText: { [Op.ne]: '' },
    [Op.and]: [literal(`length("syncMeta"->>'replyText') >= ${MIN_REPLY_LENGTH}`)],
  };
  if (exclude) where.id = { [Op.ne]: exclude };

  const own = platformRows.length
    ? await Review.findAll({
      where: { ...where, platformId: { [Op.in]: platformRows.map(p => p.id) } },
      attributes: ['id', 'reviewText', 'rating', 'doctorName', 'syncMeta'],
      order: [['reviewDate', 'DESC']],
      limit,
    })
    : [];
  const rest = own.length < limit
    ? await Review.findAll({
      where: { ...where, ...(own.length ? { id: { [Op.notIn]: [...own.map(r => r.id), exclude].filter(Boolean) } } : {}) },
      attributes: ['id', 'reviewText', 'rating', 'doctorName', 'syncMeta'],
      order: [['reviewDate', 'DESC']],
      limit: limit - own.length,
    })
    : [];

  return {
    signature: await signatureOf(board.id, board.medCenter),
    ...contactsOf(board.medCenter),
    examples: [...own, ...rest]
      .map(r => ({ text: r.reviewText, rating: r.rating, doctor: r.doctorName || null, reply: replyOf(r) }))
      .filter(e => e.reply),
  };
}

/**
 * Выборка для проверки качества: отзывы, на которые мы уже отвечали, —
 * модель пишет свои варианты, человек сравнивает с нашим ответом.
 * Негатива — не меньше трети: на нём модель ошибается дороже.
 */
async function replySample(n = 30) {
  const pick = async (negative, count) => Review.findAll({
    where: {
      rating: negative ? { [Op.lte]: 3 } : { [Op.gte]: 4 },
      reviewText: { [Op.ne]: '' },
      [Op.and]: [literal(`length("syncMeta"->>'replyText') >= ${MIN_REPLY_LENGTH}`)],
    },
    include: [{ model: ReviewPlatform, as: 'platform', attributes: ['name'] }],
    attributes: ['id', 'boardId', 'reviewText', 'rating', 'doctorName', 'patientName', 'syncMeta'],
    order: literal('random()'),
    limit: count,
  });
  const negatives = await pick(true, Math.ceil(n / 3));
  const positives = await pick(false, n - negatives.length);
  return [...negatives, ...positives]
    .map(r => ({
      id: r.id,
      boardId: r.boardId,
      platform: platformKeyByName(r.platform?.name),
      rating: r.rating,
      text: r.reviewText,
      doctor: r.doctorName || null,
      author: r.patientName || null,
      reply: replyOf(r),
    }))
    .filter(r => r.platform && r.reply);
}

module.exports = { replyContext, replySample, platformKeyByName, normalizeSignature, SIGNATURE_RE };
