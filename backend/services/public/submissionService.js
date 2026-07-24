'use strict';

/**
 * Приём и доставка заявок публичного API.
 *
 * Порядок принципиальный: сначала сохранить в БД, потом доставить в чат.
 * Ответ клиенту означает «заявка принята и записана», а не «доставлена» — если
 * доставка упала, заявка остаётся с deliveryStatus='failed' и её добивает
 * cron/submissionsRetryCron.js. Сообщение в чате не является единственной копией данных.
 */

const { Submission } = require('../../models');
const { sendBotMessage } = require('../botMessenger');
const formRegistry = require('./formRegistry');

const MAX_DELIVERY_ATTEMPTS = 10;

/**
 * Сохраняет заявку и пытается сразу доставить её в чат.
 *
 * @param {Object} params
 * @param {string} params.formType
 * @param {Object} params.payload         Уже провалидированные и нормализованные поля
 * @param {Object} params.client          Запись ApiClient
 * @param {string} [params.idempotencyKey]
 * @param {string} [params.sourceIp]
 * @param {string} [params.userAgent]
 * @param {Object} [params.io]
 * @returns {Promise<{ submission: Object, duplicate: boolean }>}
 */
async function acceptSubmission({ formType, payload, client, idempotencyKey, sourceIp, userAgent, io }) {
  // Повторная отправка с тем же ключом не создаёт вторую заявку
  if (idempotencyKey) {
    const existing = await Submission.findOne({
      where: { clientId: client.id, idempotencyKey }
    });
    if (existing) return { submission: existing, duplicate: true };
  }

  const submission = await Submission.create({
    formType,
    clientId: client.id,
    payload,
    idempotencyKey: idempotencyKey || null,
    sourceIp: sourceIp || null,
    userAgent: userAgent || null
  });

  // Доставку не ждём как условие успеха: провал уйдёт в ретрай
  await deliver(submission, io).catch(err => {
    console.error(`[submissions] доставка ${submission.id} не удалась:`, err.message);
  });

  return { submission, duplicate: false };
}

/**
 * Отправляет заявку в целевой чат и проставляет статус доставки.
 *
 * @param {Object} submission Запись Submission
 * @param {Object} [io]
 * @returns {Promise<boolean>} true, если доставлено
 */
async function deliver(submission, io) {
  const form = formRegistry.getForm(submission.formType);
  if (!form) {
    await markFailed(submission, `неизвестный тип формы: ${submission.formType}`);
    return false;
  }

  const { botToken, chatId } = formRegistry.getDeliveryTarget(submission.formType);
  if (!botToken || !chatId) {
    await markFailed(submission, 'не настроены PUBLIC_FORMS_BOT_TOKEN / *_CHAT_ID в .env');
    return false;
  }

  try {
    const text = form.formatMessage(submission.payload, submission);
    // Файлы заявки уходят вложениями к тому же сообщению
    const attachments = Object.values(submission.payload.attachments || {}).flat();
    const { messageId } = await sendBotMessage({ botToken, chatId, text, attachments, io });

    await submission.update({
      deliveryStatus:   'sent',
      deliveryAttempts: submission.deliveryAttempts + 1,
      deliveryError:    null,
      deliveredMsgId:   messageId,
      deliveredAt:      new Date()
    });
    return true;
  } catch (error) {
    await markFailed(submission, error.message);
    return false;
  }
}

async function markFailed(submission, reason) {
  await submission.update({
    deliveryStatus:   'failed',
    deliveryAttempts: submission.deliveryAttempts + 1,
    deliveryError:    reason
  });
  console.error(`[submissions] ${submission.id} → failed (попытка ${submission.deliveryAttempts}): ${reason}`);
}

/**
 * Повторная доставка недоставленных заявок. Вызывается кроном раз в минуту.
 * Заявки, исчерпавшие лимит попыток, пропускаются — их разбирают руками.
 *
 * @returns {Promise<{ delivered: number, failed: number }>}
 */
async function retryFailedDeliveries() {
  const { Op } = require('sequelize');

  const pending = await Submission.findAll({
    where: {
      deliveryStatus:   { [Op.in]: ['pending', 'failed'] },
      deliveryAttempts: { [Op.lt]: MAX_DELIVERY_ATTEMPTS }
    },
    order: [['createdAt', 'ASC']],
    limit: 50
  });

  let delivered = 0;
  let failed = 0;

  for (const submission of pending) {
    const ok = await deliver(submission);
    if (ok) delivered++; else failed++;
  }

  return { delivered, failed };
}

module.exports = {
  acceptSubmission,
  deliver,
  retryFailedDeliveries,
  MAX_DELIVERY_ATTEMPTS
};
