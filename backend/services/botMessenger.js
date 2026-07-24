'use strict';

/**
 * Отправка сообщения в чат вики от имени бота — по токену бота и ID чата.
 *
 * Общий механизм для внешних систем: АТС Comfortel (routes/notify.js) и публичный
 * API форм (services/public/submissionService.js) шлют сообщения через него.
 *
 * Делает то же, что sendMessage в Telegram Bot API: создаёт Message, регистрирует
 * BotUpdate (он даёт message_id) и рассылает событие всем участникам чата по Socket.IO.
 */

const { BotToken, BotUpdate, Chat, ChatMember, Message, User, IntIdMap } = require('../models');
const botWebhookService = require('./botWebhookService');
const notificationService = require('./notificationService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ошибка отправки с машиночитаемым кодом — вызывающий сам решает, какой HTTP-код вернуть.
 */
class BotMessengerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BotMessengerError';
    this.code = code; // invalid_token | chat_not_found | not_a_member
  }
}

/**
 * Находит чат по UUID или по целочисленному ID (Telegram-совместимому).
 * @param {string|number} chatIdParam
 * @returns {Promise<Object|null>}
 */
async function resolveChat(chatIdParam) {
  const idStr = String(chatIdParam).trim();

  if (UUID_RE.test(idStr)) {
    return Chat.findByPk(idStr);
  }

  const absId = Math.abs(parseInt(idStr, 10));
  if (!isNaN(absId) && absId > 0) {
    const row = await IntIdMap.findByPk(absId);
    if (row) return Chat.findByPk(row.uuid);
  }

  return null;
}

/**
 * Отправляет текстовое сообщение в чат от имени бота.
 *
 * @param {Object}        params
 * @param {string}        params.botToken  Токен бота из bot_tokens
 * @param {string|number} params.chatId    UUID чата или целочисленный ID
 * @param {string}        params.text      Текст сообщения
 * @param {Object}       [params.io]       Socket.IO; если не передан — берётся из notificationService
 * @returns {Promise<{ messageId: number, messageUuid: string, chat: Object }>}
 * @throws {BotMessengerError}
 */
async function sendBotMessage({ botToken, chatId, text, io }) {
  const bot = await BotToken.findOne({ where: { token: botToken, isActive: true } });
  if (!bot) throw new BotMessengerError('invalid_token', 'Unauthorized: invalid api_key');

  const chat = await resolveChat(chatId);
  if (!chat) throw new BotMessengerError('chat_not_found', 'chat not found');

  const membership = await ChatMember.findOne({ where: { chatId: chat.id, userId: bot.userId } });
  if (!membership) throw new BotMessengerError('not_a_member', 'bot is not a member of this chat');

  const message = await Message.create({
    chatId:   chat.id,
    senderId: bot.userId,
    content:  text,
    type:     'text'
  });

  // message_id выдаёт BIGSERIAL таблицы bot_updates — как update_id в Telegram Bot API
  const botUser = await User.findByPk(bot.userId);
  const msgData = await botWebhookService.formatMessage({ ...message.toJSON(), sender: botUser, chat });

  const update = await BotUpdate.create({
    botId:      bot.id,
    updateType: 'message',
    updateData: msgData,
    processed:  true
  });

  msgData.message_id = Number(update.id);
  await update.update({ updateData: msgData });
  await message.update({ telegramMsgId: update.id });

  // Чтобы чат в списке поднялся наверх и показал превью
  await chat.update({ lastMessage: text, lastMessageAt: message.createdAt });

  await emitToChatMembers({ io, chat, messageId: message.id });

  return { messageId: msgData.message_id, messageUuid: message.id, chat };
}

/**
 * Рассылает new_message всем участникам чата. Сбой рассылки не отменяет отправку:
 * сообщение уже в БД и появится у клиента при следующей загрузке чата.
 */
async function emitToChatMembers({ io, chat, messageId }) {
  const socketServer = io || notificationService.getIo();
  if (!socketServer) return;

  try {
    const fullMsg = await Message.findByPk(messageId, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] }]
    });

    const members = await ChatMember.findAll({ where: { chatId: chat.id } });
    members.forEach(m => {
      socketServer.to(`user:${m.userId}`).emit('new_message', {
        message: fullMsg,
        chat: {
          id:          chat.id,
          type:        chat.type,
          displayName: chat.name,
          avatar:      null
        }
      });
    });
  } catch (e) {
    console.error('[botMessenger] socket emit failed:', e.message);
  }
}

module.exports = {
  sendBotMessage,
  resolveChat,
  BotMessengerError
};
