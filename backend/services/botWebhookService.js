'use strict';

const axios = require('axios');
const { BotToken, BotUpdate, IntIdMap, Chat, ChatMember, Message, User } = require('../models');

// ── Stable integer ID helpers ──────────────────────────────────────────────

/**
 * Returns a stable integer ID for a UUID.
 * The first call inserts a row into int_id_map and returns the BIGSERIAL id.
 * Subsequent calls return the same value from cache or DB.
 *
 * Chat IDs are returned as negative numbers (Telegram convention for groups).
 * User IDs are positive.
 */
const _intIdCache = new Map(); // uuid → Number

async function getIntId(uuid, entityType) {
  if (_intIdCache.has(uuid)) return _intIdCache.get(uuid);

  let row = await IntIdMap.findOne({ where: { uuid } });
  if (!row) {
    try {
      row = await IntIdMap.create({ uuid, entityType });
    } catch (e) {
      // Race condition — another process inserted first
      row = await IntIdMap.findOne({ where: { uuid } });
    }
  }

  const intId = Number(row.id);
  _intIdCache.set(uuid, intId);
  return intId;
}

async function getUserIntId(uuid) {
  return getIntId(uuid, 'user');
}

async function getChatIntId(uuid, chatType) {
  const id = await getIntId(uuid, 'chat');
  // Telegram uses negative IDs for groups/supergroups
  return chatType === 'direct' ? id : -id;
}

/**
 * Reverse lookup: integer ID → UUID.
 * Accepts both positive and negative (group chat) IDs.
 */
async function uuidFromIntId(intId) {
  const absId = Math.abs(intId);
  const row = await IntIdMap.findByPk(absId);
  return row ? row.uuid : null;
}

// Keep a sync fallback for cases where async is inconvenient (token generation etc.)
// Uses first-7-hex-chars hashing — only used in bot-management.js for token numeric prefix
function uuidToInt(uuid) {
  const hex = uuid.replace(/-/g, '').substring(0, 7);
  return parseInt(hex, 16) & 0x7fffffff;
}

// ── Telegram object formatters ─────────────────────────────────────────────

async function formatUser(user) {
  const id = await getUserIntId(user.id);
  return {
    id,
    is_bot: user.isBot || false,
    first_name: user.displayName || user.username,
    username: user.username,
    language_code: 'ru'
  };
}

async function formatChat(chat) {
  const id = await getChatIntId(chat.id, chat.type);
  return {
    id,
    type: chat.type === 'direct' ? 'private' : 'group',
    title: chat.name || null,
    username: null
  };
}

async function formatMessage(message) {
  let sender = message.sender;
  if (!sender && message.senderId) {
    sender = await User.findByPk(message.senderId);
  }
  let chat = message.chat;
  if (!chat && message.chatId) {
    chat = await Chat.findByPk(message.chatId);
  }

  const from = sender ? await formatUser(sender) : null;
  const chatFormatted = chat ? await formatChat(chat) : null;

  const msg = {
    message_id: Number(message.telegramMsgId) || (await getIntId(message.id, 'message')),
    from,
    chat: chatFormatted,
    date: Math.floor(new Date(message.createdAt).getTime() / 1000),
    text: message.content || undefined
  };

  // Inline keyboard passthrough
  if (message.replyMarkup) {
    msg.reply_markup = message.replyMarkup;
  }

  if (message.replyToId) {
    const replyMsg = message.replyTo || await Message.findByPk(message.replyToId);
    if (replyMsg) {
      msg.reply_to_message = {
        message_id: Number(replyMsg.telegramMsgId) || (await getIntId(replyMsg.id, 'message')),
        date: Math.floor(new Date(replyMsg.createdAt).getTime() / 1000),
        text: replyMsg.content,
        chat: chatFormatted
      };
    }
  }

  return msg;
}

// ── Update creation & webhook delivery ────────────────────────────────────

async function createUpdate(bot, updateType, updateData) {
  const update = await BotUpdate.create({ botId: bot.id, updateType, updateData });

  const fullUpdate = {
    update_id: Number(update.id),
    [updateType]: updateData
  };

  if (bot.webhookUrl) {
    deliverWebhook(bot, fullUpdate, update.id).catch(() => {});
  }

  return update;
}

async function deliverWebhook(bot, update, updateDbId) {
  const headers = { 'Content-Type': 'application/json' };
  if (bot.webhookSecretToken) {
    headers['X-Telegram-Bot-Api-Secret-Token'] = bot.webhookSecretToken;
  }

  try {
    await axios.post(bot.webhookUrl, update, { headers, timeout: 10000 });
    await BotUpdate.update({ processed: true }, { where: { id: updateDbId } });
  } catch {
    // Delivery failure — update stays unprocessed, available via getUpdates
  }
}

// ── Chat message hooks ────────────────────────────────────────────────────

async function onNewMessage(message) {
  try {
    const members = await ChatMember.findAll({
      where: { chatId: message.chatId },
      include: [{ model: User, as: 'user', where: { isBot: true }, required: true }]
    });
    if (!members.length) return;

    const botUserIds = members.map(m => m.userId);
    const bots = await BotToken.findAll({ where: { userId: botUserIds, isActive: true } });
    if (!bots.length) return;

    const msgData = await formatMessage(message);

    for (const bot of bots) {
      if (bot.userId === message.senderId) continue;
      await createUpdate(bot, 'message', msgData);
    }
  } catch (err) {
    console.error('[botWebhookService] onNewMessage error:', err);
  }
}

async function onEditedMessage(message) {
  try {
    const members = await ChatMember.findAll({
      where: { chatId: message.chatId },
      include: [{ model: User, as: 'user', where: { isBot: true }, required: true }]
    });
    if (!members.length) return;

    const botUserIds = members.map(m => m.userId);
    const bots = await BotToken.findAll({ where: { userId: botUserIds, isActive: true } });
    if (!bots.length) return;

    const msgData = await formatMessage(message);

    for (const bot of bots) {
      if (bot.userId === message.senderId) continue;
      await createUpdate(bot, 'edited_message', msgData);
    }
  } catch (err) {
    console.error('[botWebhookService] onEditedMessage error:', err);
  }
}

module.exports = {
  uuidToInt,
  getUserIntId,
  getChatIntId,
  uuidFromIntId,
  formatUser,
  formatChat,
  formatMessage,
  createUpdate,
  deliverWebhook,
  onNewMessage,
  onEditedMessage
};
