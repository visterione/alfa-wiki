'use strict';

/**
 * Открытая линия: обращения пациентов из ботов (ver. 7.85).
 *
 * Правила взяты из того, к чему колл-центр привык по Битриксу, и намеренно
 * простые:
 *
 *   • на каждый медцентр своя линия со своим составом сотрудников;
 *   • новые обращения видит только тот, кто начал день. Кнопка одна: сотрудник,
 *     заведённый в нескольких линиях, открывает их все сразу и разбирает общую
 *     очередь;
 *   • закончил день — незакрытые обращения возвращаются в очередь. Иначе взявший
 *     чат и ушедший домой унесёт его с собой;
 *   • у пациента одно открытое обращение: второе сообщение продолжает разговор,
 *     а не заводит вторую карточку;
 *   • если на линии нет никого, бот отвечает сам — один раз за обращение.
 *
 * Доступ определяется составом линии, отдельного права нет: список сотрудников
 * линии и есть право. Два места настройки одного и того же разошлись бы.
 */

const { Op } = require('sequelize');
const {
  OmniLine, OmniLineOperator, OmniConversation, OmniMessage,
  BotSubscriber, MessengerBot, MedCenter, User, sequelize
} = require('../models');
const { getChannel } = require('./messengers');

const DEFAULT_OFFLINE_REPLY =
  'Сейчас все операторы заняты или смена завершена. ' +
  'Мы видим ваше сообщение и ответим, как только линия откроется.';

class OpenLineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OpenLineError';
    this.code = code; // not_operator | not_found | not_yours | already_taken
  }
}

// ── Смена ─────────────────────────────────────────────────────────────────

async function linesOfUser(userId) {
  return OmniLineOperator.findAll({
    where: { userId },
    include: [{ model: OmniLine, as: 'line', where: { isActive: true } }]
  });
}

/**
 * Начать день: открывает сразу все линии сотрудника — очередь у него общая.
 */
async function startDay(userId) {
  const now = new Date();
  await OmniLineOperator.update(
    { onShift: true, shiftStartedAt: now },
    { where: { userId, onShift: false } }
  );
  return { onShift: true, since: now };
}

/**
 * Закончить день. Всё, что человек взял, но не закрыл, возвращается в очередь:
 * иначе обращение уедет домой вместе с ним и пациент останется без ответа.
 */
async function endDay(userId) {
  return sequelize.transaction(async (tx) => {
    await OmniLineOperator.update(
      { onShift: false, shiftStartedAt: null },
      { where: { userId }, transaction: tx }
    );

    const [returned] = await OmniConversation.update(
      { status: 'queued', assigneeUserId: null, assignedAt: null },
      { where: { assigneeUserId: userId, status: 'assigned' }, transaction: tx }
    );

    return { onShift: false, returnedToQueue: returned };
  });
}

async function shiftState(userId) {
  const rows = await linesOfUser(userId);
  const onShift = rows.some(r => r.onShift);
  return {
    isOperator: rows.length > 0,
    onShift,
    since: onShift ? rows.find(r => r.onShift).shiftStartedAt : null,
    lines: rows.map(r => ({ id: r.lineId, name: r.line.name, onShift: r.onShift }))
  };
}

// ── Входящее сообщение ────────────────────────────────────────────────────

/**
 * Кладёт сообщение пациента в обращение: продолжает открытое или заводит новое.
 * Вызывается из разговора с ботом и живёт в процессе забора обновлений, поэтому
 * ничего не знает ни про HTTP, ни про сокеты.
 *
 * @returns {Promise<{conversation, message, isNew}|null>} null — если бот не
 *   привязан к линии (например проверочный): тогда обращению просто некуда лечь.
 */
async function acceptIncoming({ bot, subscriber, text, attachments = [], externalMessageId }) {
  if (!bot.lineId) return null;

  const line = await OmniLine.findByPk(bot.lineId);
  if (!line || !line.isActive) return null;

  const now = new Date();

  const result = await sequelize.transaction(async (tx) => {
    let conversation = await OmniConversation.findOne({
      where: { subscriberId: subscriber.id, status: { [Op.ne]: 'closed' } },
      transaction: tx
    });

    const isNew = !conversation;
    if (isNew) {
      conversation = await OmniConversation.create({
        lineId: line.id,
        subscriberId: subscriber.id,
        botId: bot.id,
        status: 'queued',
        lastMessageAt: now,
        lastIncomingAt: now
      }, { transaction: tx });
    } else {
      await conversation.update({ lastMessageAt: now, lastIncomingAt: now }, { transaction: tx });
    }

    const message = await OmniMessage.create({
      conversationId: conversation.id,
      direction: 'in',
      text: text || '',
      attachments,
      externalMessageId
    }, { transaction: tx });

    return { conversation, message, isNew };
  });

  return { ...result, line };
}

/**
 * Есть ли кому отвечать прямо сейчас. Нужно, чтобы решить, извиняться ли за
 * отсутствие людей.
 */
async function hasOperatorsOnShift(lineId) {
  const count = await OmniLineOperator.count({ where: { lineId, onShift: true } });
  return count > 0;
}

/**
 * Извинение за пустую линию — не чаще одного раза за обращение. Человек,
 * написавший ночью три строки, не должен получить три одинаковых ответа.
 * @returns {Promise<string|null>} текст, который нужно отправить, или null
 */
async function offlineNoticeFor(conversation, line) {
  if (conversation.offlineNoticeAt) return null;
  if (await hasOperatorsOnShift(line.id)) return null;

  await conversation.update({ offlineNoticeAt: new Date() });
  return line.offlineReply || DEFAULT_OFFLINE_REPLY;
}

// ── Работа оператора ──────────────────────────────────────────────────────

async function operatorLineIds(userId) {
  const rows = await OmniLineOperator.findAll({ where: { userId }, attributes: ['lineId', 'onShift'] });
  return {
    all: rows.map(r => r.lineId),
    onShift: rows.filter(r => r.onShift).map(r => r.lineId)
  };
}

const CONVERSATION_INCLUDE = [
  { model: OmniLine, as: 'line', include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }] },
  { model: BotSubscriber, as: 'subscriber', attributes: ['id', 'platform', 'phone', 'firstName', 'lastName', 'username', 'patientIds'] },
  { model: User, as: 'assignee', attributes: ['id', 'username', 'displayName', 'avatar'] }
];

/**
 * Списки для экрана оператора:
 *   queue  — ничьи обращения линий, где человек сейчас на смене
 *   mine   — взятые им
 *   closed — архив по всем его линиям (для разбора спорных ситуаций)
 */
async function listConversations(userId, { scope = 'queue', limit = 50, offset = 0 } = {}) {
  const lines = await operatorLineIds(userId);
  if (!lines.all.length) throw new OpenLineError('not_operator', 'Вы не заведены ни в одну линию');

  const where =
    scope === 'mine'
      ? { assigneeUserId: userId, status: 'assigned' }
      : scope === 'closed'
        ? { lineId: { [Op.in]: lines.all }, status: 'closed' }
        : { lineId: { [Op.in]: lines.onShift }, status: 'queued' };

  return OmniConversation.findAll({
    where,
    include: CONVERSATION_INCLUDE,
    order: [['lastMessageAt', 'DESC']],
    limit,
    offset
  });
}

async function loadForOperator(userId, conversationId) {
  const conversation = await OmniConversation.findByPk(conversationId, { include: CONVERSATION_INCLUDE });
  if (!conversation) throw new OpenLineError('not_found', 'Обращение не найдено');

  const lines = await operatorLineIds(userId);
  if (!lines.all.includes(conversation.lineId)) {
    throw new OpenLineError('not_operator', 'Вы не работаете на этой линии');
  }
  return conversation;
}

async function getConversation(userId, conversationId) {
  const conversation = await loadForOperator(userId, conversationId);
  const messages = await OmniMessage.findAll({
    where: { conversationId },
    include: [{ model: User, as: 'author', attributes: ['id', 'username', 'displayName', 'avatar'] }],
    order: [['createdAt', 'ASC']]
  });
  return { conversation, messages };
}

/**
 * Взять в работу. Пока обращение ничьё, оно видно всем на смене; после — отвечает
 * один человек, иначе на один вопрос прилетит три ответа.
 */
async function assign(userId, conversationId) {
  const conversation = await loadForOperator(userId, conversationId);

  const [changed] = await OmniConversation.update(
    { status: 'assigned', assigneeUserId: userId, assignedAt: new Date() },
    { where: { id: conversationId, status: 'queued' } }
  );

  if (!changed) {
    // Кто-то успел раньше — сообщаем честно, а не молча перехватываем.
    if (conversation.assigneeUserId && conversation.assigneeUserId !== userId) {
      throw new OpenLineError('already_taken', 'Обращение уже взято другим сотрудником');
    }
  }
  return loadForOperator(userId, conversationId);
}

async function close(userId, conversationId) {
  const conversation = await loadForOperator(userId, conversationId);
  if (conversation.status === 'closed') return conversation;

  await conversation.update({ status: 'closed', closedAt: new Date(), closedBy: userId, assigneeUserId: conversation.assigneeUserId || userId });
  return conversation;
}

/**
 * Ответ оператора. Сначала отправляем в мессенджер и только потом сохраняем:
 * сообщение, которое не ушло, не должно висеть в переписке как отправленное.
 */
async function reply(userId, conversationId, text) {
  const conversation = await loadForOperator(userId, conversationId);

  if (conversation.status === 'closed') {
    throw new OpenLineError('not_yours', 'Обращение закрыто — откройте новое или попросите пациента написать ещё раз');
  }
  if (conversation.assigneeUserId && conversation.assigneeUserId !== userId) {
    throw new OpenLineError('not_yours', 'Обращение ведёт другой сотрудник');
  }

  // Ответ без взятия в работу — это и есть взятие: иначе чат остаётся ничьим.
  if (!conversation.assigneeUserId) {
    await conversation.update({ status: 'assigned', assigneeUserId: userId, assignedAt: new Date() });
  }

  const subscriber = await BotSubscriber.findByPk(conversation.subscriberId);
  const bot = await MessengerBot.findByPk(conversation.botId);
  if (!bot) throw new OpenLineError('not_found', 'Бот этого обращения больше не подключён');

  const channel = getChannel(bot.platform);

  let externalMessageId = null;
  let deliveryError = null;
  try {
    const sent = await channel.sendText(bot, subscriber.externalUserId, text);
    externalMessageId = sent.externalMessageId;
  } catch (err) {
    deliveryError = err.message;
    if (err.code === 'blocked') {
      await subscriber.update({ isBlocked: true, blockedAt: new Date() });
      deliveryError = 'Пациент заблокировал бота — сообщение не доставлено';
    }
  }

  const message = await OmniMessage.create({
    conversationId,
    direction: 'out',
    authorUserId: userId,
    text,
    externalMessageId,
    deliveryError
  });

  await conversation.update({ lastMessageAt: new Date() });
  return { message, deliveryError };
}

module.exports = {
  OpenLineError,
  DEFAULT_OFFLINE_REPLY,
  startDay,
  endDay,
  shiftState,
  linesOfUser,
  acceptIncoming,
  offlineNoticeFor,
  hasOperatorsOnShift,
  listConversations,
  getConversation,
  assign,
  close,
  reply
};
