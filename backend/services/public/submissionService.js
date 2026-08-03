'use strict';

/**
 * Приём и доставка заявок публичного API.
 *
 * Порядок принципиальный: сначала сохранить в БД, потом доставить в чаты.
 * Ответ клиенту означает «заявка принята и записана», а не «доставлена» — если
 * доставка упала, строка в submission_deliveries остаётся failed и её добивает
 * cron/submissionsRetryCron.js. Сообщение в чате не является единственной копией данных.
 *
 * Доставка 1:N: одна заявка уходит во все подписанные чаты, у каждого свой статус и
 * свои попытки. Иначе сбой в одном чате либо терялся бы, либо при повторе плодил дубли
 * в остальных. Набор адресатов фиксируется в момент приёма — отписка задним числом
 * не должна ломать ретрай, а новая подписка не должна получать вчерашние заявки.
 */

const { Submission, SubmissionDelivery } = require('../../models');
const { sendBotMessage } = require('../botMessenger');
const formRegistry = require('./formRegistry');
const subscriptionService = require('./subscriptionService');

const MAX_DELIVERY_ATTEMPTS = 10;

/**
 * Сохраняет заявку и пытается сразу доставить её во все подписанные чаты.
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

  // Адресатов фиксируем сразу: дальше доставка работает только по этим строкам
  const targets = await subscriptionService.resolveTargets(formType, client.id);

  if (targets.length === 0) {
    await submission.update({
      deliveryStatus: 'failed',
      deliveryError:  'нет чатов, подписанных на эту форму — добавьте бота в нужный чат'
    });
    console.error(`[submissions] ${submission.id}: некуда доставлять «${formType}»`);
    return { submission, duplicate: false };
  }

  await SubmissionDelivery.bulkCreate(
    targets.map(t => ({ submissionId: submission.id, chatId: t.chatId, botId: t.botId }))
  );

  // Доставку не ждём как условие успеха: провал уйдёт в ретрай
  await deliverSubmission(submission, io).catch(err => {
    console.error(`[submissions] доставка ${submission.id} не удалась:`, err.message);
  });

  return { submission, duplicate: false };
}

/**
 * Отправляет заявку во все её недоставленные адреса.
 *
 * @param {Object} submission Запись Submission
 * @param {Object} [io]
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function deliverSubmission(submission, io) {
  const deliveries = await SubmissionDelivery.findAll({
    where: { submissionId: submission.id, status: ['pending', 'failed'] }
  });

  let sent = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    const ok = await deliverOne(submission, delivery, io);
    if (ok) sent++; else failed++;
  }

  await syncSubmissionStatus(submission);
  return { sent, failed };
}

/**
 * Доставка в один чат.
 * @returns {Promise<boolean>} true, если доставлено
 */
async function deliverOne(submission, delivery, io) {
  const form = formRegistry.getForm(submission.formType);
  if (!form) {
    await markFailed(delivery, `неизвестный тип формы: ${submission.formType}`);
    return false;
  }

  try {
    const text = form.formatMessage(submission.payload, submission);
    // Файлы заявки уходят вложениями к тому же сообщению
    const attachments = Object.values(submission.payload.attachments || {}).flat();
    // Кнопки под сообщением: создать пациента в МИС, открыть реестр справок.
    // Форма может их не объявлять — тогда сообщение просто без кнопок
    const actions = form.buildActions ? form.buildActions(submission.payload, submission) : [];

    const { messageId } = await sendBotMessage({
      botId:  delivery.botId,
      chatId: delivery.chatId,
      text,
      attachments,
      actions,
      io
    });

    await delivery.update({
      status:      'sent',
      attempts:    delivery.attempts + 1,
      error:       null,
      messageId,
      deliveredAt: new Date()
    });
    return true;
  } catch (error) {
    await markFailed(delivery, error.message);
    return false;
  }
}

async function markFailed(delivery, reason) {
  await delivery.update({
    status:   'failed',
    attempts: delivery.attempts + 1,
    error:    reason
  });
  console.error(`[submissions] ${delivery.submissionId} → чат ${delivery.chatId} (попытка ${delivery.attempts}): ${reason}`);
}

/**
 * Сводный статус заявки по её доставкам: sent — дошло везде, pending — часть в работе.
 * Старые колонки submissions.delivery* остаются заполненными, чтобы не ломать то,
 * что на них смотрит; источник правды теперь submission_deliveries.
 */
async function syncSubmissionStatus(submission) {
  const deliveries = await SubmissionDelivery.findAll({ where: { submissionId: submission.id } });
  if (deliveries.length === 0) return;

  const allSent  = deliveries.every(d => d.status === 'sent');
  const anyOpen  = deliveries.some(d => d.status !== 'sent' && d.attempts < MAX_DELIVERY_ATTEMPTS);
  const firstSent = deliveries.find(d => d.status === 'sent');

  await submission.update({
    deliveryStatus:   allSent ? 'sent' : (anyOpen ? 'pending' : 'failed'),
    deliveryAttempts: Math.max(...deliveries.map(d => d.attempts)),
    deliveryError:    allSent ? null : (deliveries.find(d => d.error)?.error || null),
    deliveredMsgId:   firstSent?.messageId || null,
    deliveredAt:      firstSent?.deliveredAt || null
  });
}

/**
 * Повторная доставка недоставленного. Вызывается кроном раз в минуту.
 * Адреса, исчерпавшие лимит попыток, пропускаются — их разбирают руками.
 *
 * @returns {Promise<{ delivered: number, failed: number }>}
 */
async function retryFailedDeliveries() {
  const { Op } = require('sequelize');

  const pending = await SubmissionDelivery.findAll({
    where: {
      status:   { [Op.in]: ['pending', 'failed'] },
      attempts: { [Op.lt]: MAX_DELIVERY_ATTEMPTS }
    },
    order: [['createdAt', 'ASC']],
    limit: 50
  });

  let delivered = 0;
  let failed = 0;
  const touched = new Map();

  for (const delivery of pending) {
    let submission = touched.get(delivery.submissionId);
    if (!submission) {
      submission = await Submission.findByPk(delivery.submissionId);
      if (!submission) continue;
      touched.set(delivery.submissionId, submission);
    }

    const ok = await deliverOne(submission, delivery);
    if (ok) delivered++; else failed++;
  }

  // Сводный статус пересчитываем один раз на заявку, а не на каждую доставку
  for (const submission of touched.values()) {
    await syncSubmissionStatus(submission);
  }

  return { delivered, failed };
}

module.exports = {
  acceptSubmission,
  deliverSubmission,
  retryFailedDeliveries,
  MAX_DELIVERY_ATTEMPTS
};
