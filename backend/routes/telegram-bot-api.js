'use strict';

/**
 * Telegram Bot API compatibility layer
 *
 * URL format:  /bot{token}/{method}
 * File URL:    /file/bot{token}/{file_path}   (served from a separate static handler in server.js)
 *
 * Response format:
 *   { ok: true, result: ... }
 *   { ok: false, error_code: N, description: "..." }
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { BotToken, BotUpdate, Chat, ChatMember, Message, User } = require('../models');
const botWebhookService = require('../services/botWebhookService');

const router = express.Router({ mergeParams: true });

// ── File upload storage ───────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'bot-files');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const fileUpload = upload.fields([
  { name: 'photo',     maxCount: 1 },
  { name: 'document',  maxCount: 1 },
  { name: 'audio',     maxCount: 1 },
  { name: 'video',     maxCount: 1 },
  { name: 'animation', maxCount: 1 },
  { name: 'voice',     maxCount: 1 }
]);

// ── Response helpers ──────────────────────────────────────────────────────

function ok(res, result) {
  return res.json({ ok: true, result });
}

function fail(res, code, description) {
  return res.status(code === 401 ? 401 : 400).json({ ok: false, error_code: code, description });
}

// ── Bot resolution ────────────────────────────────────────────────────────

async function resolveBot(token) {
  if (!token) return null;
  return BotToken.findOne({ where: { token, isActive: true } });
}

// ── Chat resolution by Telegram chat_id (integer or UUID) ─────────────────

async function resolveChat(chatIdParam) {
  if (!chatIdParam) return null;
  const idStr = String(chatIdParam);

  // UUID format — direct lookup
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(idStr)) {
    return Chat.findByPk(idStr);
  }

  const absId = Math.abs(parseInt(idStr, 10));

  // Resolve via IntIdMap
  const uuid = await botWebhookService.uuidFromIntId(absId);
  if (uuid) return Chat.findByPk(uuid);

  return null;
}

// ── Middleware: validate token, attach req.bot ─────────────────────────────

router.use(async (req, res, next) => {
  const bot = await resolveBot(req.params.token).catch(() => null);
  if (!bot) return fail(res, 401, 'Unauthorized');
  req.bot = bot;
  next();
});

// ── Helper: create a sent message and return Telegram message object ───────

async function persistBotMessage(req, { chat, content, type = 'text', attachments = [], replyToId = null, replyMarkup = null }) {
  const { bot } = req;

  const message = await Message.create({
    chatId: chat.id,
    senderId: bot.userId,
    content,
    type,
    attachments,
    replyToId
  });

  const botUser = await User.findByPk(bot.userId);
  const msgData = await botWebhookService.formatMessage({
    ...message.toJSON(),
    sender: botUser,
    chat,
    replyMarkup
  });

  // Create BotUpdate to claim the BIGSERIAL update_id, then use it as message_id
  const update = await BotUpdate.create({
    botId: bot.id,
    updateType: 'message',
    updateData: msgData,
    processed: true
  });

  msgData.message_id = Number(update.id);
  if (replyMarkup) msgData.reply_markup = replyMarkup;
  await update.update({ updateData: msgData });
  await message.update({ telegramMsgId: update.id });

  // Emit via Socket.IO
  const io = req.app.get('io');
  if (io) {
    const fullMsg = await Message.findByPk(message.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] }]
    });
    io.to(`chat:${chat.id}`).emit('new_message', fullMsg);
  }

  return msgData;
}

// ═══════════════════════════════════════════════════════════════
// getMe
// ═══════════════════════════════════════════════════════════════

async function getMeHandler(req, res) {
  const { bot } = req;
  const id = await botWebhookService.getUserIntId(bot.userId);
  ok(res, {
    id,
    is_bot: true,
    first_name: bot.name,
    username: bot.username,
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false
  });
}

router.get('/getMe',  getMeHandler);
router.post('/getMe', getMeHandler);

// ═══════════════════════════════════════════════════════════════
// Webhook management
// ═══════════════════════════════════════════════════════════════

router.post('/setWebhook', async (req, res) => {
  const { bot } = req;
  const { url, secret_token, allowed_updates, max_connections, drop_pending_updates } = req.body;

  const upd = { webhookUrl: url || null };
  if (secret_token      !== undefined) upd.webhookSecretToken = secret_token;
  if (allowed_updates   !== undefined) upd.allowedUpdates     = allowed_updates;
  if (max_connections   !== undefined) upd.maxConnections      = max_connections;

  if (drop_pending_updates) {
    await BotUpdate.destroy({ where: { botId: bot.id, processed: false } });
  }

  await bot.update(upd);
  ok(res, true);
});

router.post('/deleteWebhook', async (req, res) => {
  const { bot } = req;
  if (req.body?.drop_pending_updates) {
    await BotUpdate.destroy({ where: { botId: bot.id, processed: false } });
  }
  await bot.update({ webhookUrl: null, webhookSecretToken: null });
  ok(res, true);
});

async function getWebhookInfoHandler(req, res) {
  const { bot } = req;
  const pending = await BotUpdate.count({ where: { botId: bot.id, processed: false } });
  ok(res, {
    url: bot.webhookUrl || '',
    has_custom_certificate: false,
    pending_update_count: pending,
    max_connections: bot.maxConnections,
    allowed_updates: bot.allowedUpdates
  });
}

router.get('/getWebhookInfo',  getWebhookInfoHandler);
router.post('/getWebhookInfo', getWebhookInfoHandler);

// ═══════════════════════════════════════════════════════════════
// getUpdates  (long-polling)
// ═══════════════════════════════════════════════════════════════

router.post('/getUpdates', async (req, res) => {
  const { bot } = req;
  const { offset = 0, limit = 100, timeout = 0, allowed_updates } = req.body || {};

  const clampedLimit   = Math.min(Math.max(1, parseInt(limit,   10) || 100), 100);
  const pollTimeoutSec = Math.min(Math.max(0, parseInt(timeout, 10) || 0),   50);
  const deadlineMs     = Date.now() + pollTimeoutSec * 1000;

  const where = {
    botId: bot.id,
    id:    { [Op.gte]: parseInt(offset, 10) || 0 }
  };
  if (allowed_updates?.length) where.updateType = { [Op.in]: allowed_updates };

  const fetch = () => BotUpdate.findAll({ where, order: [['id', 'ASC']], limit: clampedLimit });

  let updates = await fetch();

  while (!updates.length && Date.now() < deadlineMs) {
    await new Promise(r => setTimeout(r, 400));
    updates = await fetch();
  }

  if (updates.length) {
    await BotUpdate.update({ processed: true }, { where: { id: updates.map(u => u.id) } });
  }

  ok(res, updates.map(u => ({ update_id: Number(u.id), [u.updateType]: u.updateData })));
});

router.get('/getUpdates', async (req, res) => {
  const { bot } = req;
  const { offset = 0, limit = 100 } = req.query;

  const where = {
    botId: bot.id,
    id:    { [Op.gte]: parseInt(offset, 10) || 0 }
  };
  const updates = await BotUpdate.findAll({
    where, order: [['id', 'ASC']], limit: Math.min(parseInt(limit, 10) || 100, 100)
  });

  if (updates.length) {
    await BotUpdate.update({ processed: true }, { where: { id: updates.map(u => u.id) } });
  }

  ok(res, updates.map(u => ({ update_id: Number(u.id), [u.updateType]: u.updateData })));
});

// ═══════════════════════════════════════════════════════════════
// sendMessage
// ═══════════════════════════════════════════════════════════════

router.post('/sendMessage', async (req, res) => {
  const { chat_id, text, reply_to_message_id, reply_markup } = req.body;

  if (!chat_id || !text) return fail(res, 400, 'Bad Request: chat_id and text are required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  let replyToId = null;
  if (reply_to_message_id) {
    const r = await Message.findOne({ where: { chatId: chat.id, telegramMsgId: reply_to_message_id } });
    if (r) replyToId = r.id;
  }

  // Parse reply_markup
  const parsedMarkup = reply_markup
    ? (typeof reply_markup === 'string' ? JSON.parse(reply_markup) : reply_markup)
    : null;

  const msgData = await persistBotMessage(req, {
    chat, content: text, replyToId, replyMarkup: parsedMarkup
  });

  ok(res, msgData);
});

// ═══════════════════════════════════════════════════════════════
// forwardMessage
// ═══════════════════════════════════════════════════════════════

router.post('/forwardMessage', async (req, res) => {
  const { chat_id, from_chat_id, message_id } = req.body;

  if (!chat_id || !from_chat_id || !message_id) {
    return fail(res, 400, 'Bad Request: chat_id, from_chat_id and message_id are required');
  }

  const targetChat = await resolveChat(chat_id);
  if (!targetChat) return fail(res, 400, 'Bad Request: target chat not found');

  const sourceMsg = await Message.findOne({
    where: { telegramMsgId: message_id },
    include: [{ model: User, as: 'sender' }]
  });
  if (!sourceMsg) return fail(res, 400, 'Bad Request: message not found');

  const msgData = await persistBotMessage(req, {
    chat: targetChat,
    content: sourceMsg.content,
    type: sourceMsg.type,
    attachments: sourceMsg.attachments
  });

  ok(res, msgData);
});

// ═══════════════════════════════════════════════════════════════
// copyMessage
// ═══════════════════════════════════════════════════════════════

router.post('/copyMessage', async (req, res) => {
  const { chat_id, from_chat_id, message_id, caption } = req.body;

  if (!chat_id || !from_chat_id || !message_id) {
    return fail(res, 400, 'Bad Request: chat_id, from_chat_id and message_id are required');
  }

  const targetChat = await resolveChat(chat_id);
  if (!targetChat) return fail(res, 400, 'Bad Request: target chat not found');

  const sourceMsg = await Message.findOne({ where: { telegramMsgId: message_id } });
  if (!sourceMsg) return fail(res, 400, 'Bad Request: message not found');

  const msgData = await persistBotMessage(req, {
    chat: targetChat,
    content: caption || sourceMsg.content,
    type: sourceMsg.type,
    attachments: sourceMsg.attachments
  });

  ok(res, { message_id: msgData.message_id });
});

// ═══════════════════════════════════════════════════════════════
// sendPhoto / sendDocument / sendAudio / sendVideo / sendAnimation / sendVoice
// ═══════════════════════════════════════════════════════════════

async function handleSendFile(req, res, fileField, msgType) {
  const { chat_id, caption, reply_to_message_id, reply_markup } = req.body;

  if (!chat_id) return fail(res, 400, 'Bad Request: chat_id is required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  let attachment = null;
  const file = req.files?.[fileField]?.[0];
  if (file) {
    attachment = {
      filename: file.originalname,
      url:      `/uploads/bot-files/${file.filename}`,
      // file_path relative to uploads/ — used by /file/bot{token}/ endpoint
      file_path: `bot-files/${file.filename}`,
      size:     file.size,
      mimeType: file.mimetype
    };
  } else if (req.body[fileField]) {
    attachment = { file_id: req.body[fileField] };
  }

  let replyToId = null;
  if (reply_to_message_id) {
    const r = await Message.findOne({ where: { telegramMsgId: reply_to_message_id } });
    if (r) replyToId = r.id;
  }

  const parsedMarkup = reply_markup
    ? (typeof reply_markup === 'string' ? JSON.parse(reply_markup) : reply_markup)
    : null;

  const msgData = await persistBotMessage(req, {
    chat,
    content: caption || '',
    type: msgType === 'photo' ? 'image' : 'file',
    attachments: attachment ? [attachment] : [],
    replyToId,
    replyMarkup: parsedMarkup
  });

  ok(res, msgData);
}

router.post('/sendPhoto',     fileUpload, (req, res) => handleSendFile(req, res, 'photo',     'photo'));
router.post('/sendDocument',  fileUpload, (req, res) => handleSendFile(req, res, 'document',  'document'));
router.post('/sendAudio',     fileUpload, (req, res) => handleSendFile(req, res, 'audio',     'audio'));
router.post('/sendVideo',     fileUpload, (req, res) => handleSendFile(req, res, 'video',     'video'));
router.post('/sendAnimation', fileUpload, (req, res) => handleSendFile(req, res, 'animation', 'animation'));
router.post('/sendVoice',     fileUpload, (req, res) => handleSendFile(req, res, 'voice',     'voice'));

// ═══════════════════════════════════════════════════════════════
// sendMediaGroup
// ═══════════════════════════════════════════════════════════════

router.post('/sendMediaGroup', fileUpload, async (req, res) => {
  const { chat_id, media } = req.body;

  if (!chat_id || !media) return fail(res, 400, 'Bad Request: chat_id and media are required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  const mediaArr = typeof media === 'string' ? JSON.parse(media) : media;
  const attachments = mediaArr.map(item => ({ file_id: item.media, type: item.type, caption: item.caption }));

  const msgData = await persistBotMessage(req, {
    chat,
    content: mediaArr[0]?.caption || '',
    type: 'file',
    attachments
  });

  ok(res, [msgData]);
});

// ═══════════════════════════════════════════════════════════════
// sendLocation
// ═══════════════════════════════════════════════════════════════

router.post('/sendLocation', async (req, res) => {
  const { chat_id, latitude, longitude, reply_markup } = req.body;

  if (!chat_id || latitude == null || longitude == null) {
    return fail(res, 400, 'Bad Request: chat_id, latitude and longitude are required');
  }

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  const parsedMarkup = reply_markup
    ? (typeof reply_markup === 'string' ? JSON.parse(reply_markup) : reply_markup)
    : null;

  const msgData = await persistBotMessage(req, {
    chat,
    content: `📍 ${latitude}, ${longitude}`,
    replyMarkup: parsedMarkup
  });

  msgData.location = { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };
  delete msgData.text;

  ok(res, msgData);
});

// ═══════════════════════════════════════════════════════════════
// sendChatAction  (no-op, just confirm)
// ═══════════════════════════════════════════════════════════════

router.post('/sendChatAction', (req, res) => ok(res, true));

// ═══════════════════════════════════════════════════════════════
// editMessageText / editMessageCaption
// ═══════════════════════════════════════════════════════════════

router.post('/editMessageText', async (req, res) => {
  const { chat_id, message_id, text, reply_markup } = req.body;

  if (!chat_id || !message_id || !text) {
    return fail(res, 400, 'Bad Request: chat_id, message_id and text are required');
  }

  const message = await Message.findOne({
    where: { telegramMsgId: message_id },
    include: [{ model: Chat, as: 'chat' }, { model: User, as: 'sender' }]
  });
  if (!message) return fail(res, 400, 'Bad Request: message not found');

  await message.update({ content: text, isEdited: true });

  const msgData = await botWebhookService.formatMessage(message);
  msgData.text = text;

  if (reply_markup) {
    const parsed = typeof reply_markup === 'string' ? JSON.parse(reply_markup) : reply_markup;
    msgData.reply_markup = parsed;
    // Persist updated markup in the bot_update row
    await BotUpdate.update(
      { updateData: msgData },
      { where: { botId: req.bot.id, id: message.telegramMsgId } }
    );
  }

  const io = req.app.get('io');
  if (io) io.to(`chat:${message.chatId}`).emit('message_updated', message);

  ok(res, msgData);
});

router.post('/editMessageCaption', async (req, res) => {
  const { chat_id, message_id, caption, reply_markup } = req.body;

  if (!chat_id || !message_id) {
    return fail(res, 400, 'Bad Request: chat_id and message_id are required');
  }

  const message = await Message.findOne({
    where: { telegramMsgId: message_id },
    include: [{ model: Chat, as: 'chat' }, { model: User, as: 'sender' }]
  });
  if (!message) return fail(res, 400, 'Bad Request: message not found');

  await message.update({ content: caption || '', isEdited: true });

  const msgData = await botWebhookService.formatMessage(message);
  if (reply_markup) {
    msgData.reply_markup = typeof reply_markup === 'string' ? JSON.parse(reply_markup) : reply_markup;
  }

  const io = req.app.get('io');
  if (io) io.to(`chat:${message.chatId}`).emit('message_updated', message);

  ok(res, msgData);
});

// ═══════════════════════════════════════════════════════════════
// editMessageReplyMarkup  — только обновить кнопки
// ═══════════════════════════════════════════════════════════════

router.post('/editMessageReplyMarkup', async (req, res) => {
  const { chat_id, message_id, reply_markup } = req.body;

  if (!chat_id || !message_id) {
    return fail(res, 400, 'Bad Request: chat_id and message_id are required');
  }

  const message = await Message.findOne({ where: { telegramMsgId: message_id } });
  if (!message) return fail(res, 400, 'Bad Request: message not found');

  const parsed = reply_markup
    ? (typeof reply_markup === 'string' ? JSON.parse(reply_markup) : reply_markup)
    : null;

  // Update the stored update record
  if (message.telegramMsgId) {
    const updateRow = await BotUpdate.findByPk(message.telegramMsgId);
    if (updateRow) {
      const data = { ...updateRow.updateData, reply_markup: parsed };
      await updateRow.update({ updateData: data });
      ok(res, data);
      return;
    }
  }

  ok(res, { message_id: Number(message.telegramMsgId) });
});

// ═══════════════════════════════════════════════════════════════
// deleteMessage
// ═══════════════════════════════════════════════════════════════

router.post('/deleteMessage', async (req, res) => {
  const { chat_id, message_id } = req.body;
  if (!chat_id || !message_id) return fail(res, 400, 'Bad Request: chat_id and message_id are required');

  const message = await Message.findOne({ where: { telegramMsgId: message_id } });
  if (!message) return fail(res, 400, 'Bad Request: message not found');

  const chatId = message.chatId;
  await message.destroy();

  // Событие переехало на общий для всех удалений формат (ver. 7.29): имя
  // messages_deleted, список id и рассылка по личным комнатам участников —
  // в комнату chat: клиент входит только пока чат открыт, поэтому у
  // остальных сообщение оставалось на экране до перезагрузки.
  const io = req.app.get('io');
  if (io) {
    const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
    const rooms = members.map(m => `user:${m.userId}`);
    if (rooms.length) {
      io.to(rooms).emit('messages_deleted', { chatId, messageIds: [message.id], scope: 'all' });
    }
  }

  ok(res, true);
});

// ═══════════════════════════════════════════════════════════════
// answerCallbackQuery  — с реальным состоянием
// ═══════════════════════════════════════════════════════════════

router.post('/answerCallbackQuery', async (req, res) => {
  const { bot } = req;
  const { callback_query_id, text, show_alert = false, url, cache_time = 0 } = req.body;

  if (!callback_query_id) return fail(res, 400, 'Bad Request: callback_query_id is required');

  // Find the callback_query update by its id
  const updateRow = await BotUpdate.findOne({
    where: {
      botId:      bot.id,
      updateType: 'callback_query',
      id:         callback_query_id
    }
  });

  if (!updateRow) return fail(res, 400, 'Bad Request: query not found or already answered');

  // Store the answer in updateData and mark as processed
  const answeredData = {
    ...updateRow.updateData,
    _answer: { text: text || null, show_alert, url: url || null, cache_time, answeredAt: new Date().toISOString() }
  };
  await updateRow.update({ updateData: answeredData, processed: true });

  // Optionally emit a notification via Socket.IO so the frontend can show a toast
  const io = req.app.get('io');
  if (io && text) {
    const callbackData = updateRow.updateData;
    const targetUserId = callbackData?.from?._uuid; // stored internally by sendMessage with inline keyboard
    if (targetUserId) {
      io.to(`user:${targetUserId}`).emit('callback_answer', {
        text,
        show_alert,
        url: url || null
      });
    }
  }

  ok(res, true);
});

// ═══════════════════════════════════════════════════════════════
// getChat / getChatMembersCount / getChatMemberCount
// ═══════════════════════════════════════════════════════════════

async function getChatHandler(req, res) {
  const chat_id = req.body.chat_id ?? req.query.chat_id;
  if (!chat_id) return fail(res, 400, 'Bad Request: chat_id is required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  ok(res, await botWebhookService.formatChat(chat));
}

router.get('/getChat',  getChatHandler);
router.post('/getChat', getChatHandler);

async function getChatMemberCountHandler(req, res) {
  const chat_id = req.body.chat_id ?? req.query.chat_id;
  if (!chat_id) return fail(res, 400, 'Bad Request: chat_id is required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  const count = await ChatMember.count({ where: { chatId: chat.id } });
  ok(res, count);
}

router.get('/getChatMembersCount',  getChatMemberCountHandler);
router.post('/getChatMembersCount', getChatMemberCountHandler);
router.get('/getChatMemberCount',   getChatMemberCountHandler);
router.post('/getChatMemberCount',  getChatMemberCountHandler);

// ═══════════════════════════════════════════════════════════════
// getChatAdministrators
// ═══════════════════════════════════════════════════════════════

router.post('/getChatAdministrators', async (req, res) => {
  const { chat_id } = req.body;
  if (!chat_id) return fail(res, 400, 'Bad Request: chat_id is required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  const members = await ChatMember.findAll({
    where: { chatId: chat.id, role: 'admin' },
    include: [{ model: User, as: 'user' }]
  });

  const admins = await Promise.all(members.map(async m => ({
    status: 'administrator',
    user:   await botWebhookService.formatUser(m.user),
    can_be_edited: false,
    can_manage_chat: true,
    can_delete_messages: true,
    can_invite_users: true,
    can_restrict_members: true,
    can_pin_messages: true,
    can_promote_members: false,
    is_anonymous: false
  })));

  ok(res, admins);
});

// ═══════════════════════════════════════════════════════════════
// getChatMember
// ═══════════════════════════════════════════════════════════════

router.post('/getChatMember', async (req, res) => {
  const { chat_id, user_id } = req.body;
  if (!chat_id || !user_id) return fail(res, 400, 'Bad Request: chat_id and user_id are required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  // Resolve user UUID from integer id
  const userUuid = await botWebhookService.uuidFromIntId(Math.abs(parseInt(user_id, 10)));
  if (!userUuid) return fail(res, 400, 'Bad Request: user not found');

  const member = await ChatMember.findOne({
    where: { chatId: chat.id, userId: userUuid },
    include: [{ model: User, as: 'user' }]
  });
  if (!member) return fail(res, 400, 'Bad Request: user not a member');

  ok(res, {
    status: member.role === 'admin' ? 'administrator' : 'member',
    user:   await botWebhookService.formatUser(member.user)
  });
});

// ═══════════════════════════════════════════════════════════════
// leaveChat / banChatMember / kickChatMember
// ═══════════════════════════════════════════════════════════════

router.post('/leaveChat', async (req, res) => {
  const { bot } = req;
  const { chat_id } = req.body;
  if (!chat_id) return fail(res, 400, 'Bad Request: chat_id is required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  await ChatMember.destroy({ where: { chatId: chat.id, userId: bot.userId } });
  ok(res, true);
});

async function removeMember(req, res) {
  const { chat_id, user_id } = req.body;
  if (!chat_id || !user_id) return fail(res, 400, 'Bad Request: chat_id and user_id are required');

  const chat = await resolveChat(chat_id);
  if (!chat) return fail(res, 400, 'Bad Request: chat not found');

  const userUuid = await botWebhookService.uuidFromIntId(Math.abs(parseInt(user_id, 10)));
  if (!userUuid) return fail(res, 400, 'Bad Request: user not found');

  await ChatMember.destroy({ where: { chatId: chat.id, userId: userUuid } });
  ok(res, true);
}

router.post('/banChatMember',  removeMember);
router.post('/kickChatMember', removeMember);

// ═══════════════════════════════════════════════════════════════
// pinChatMessage  (no-op — pin not in chat model)
// ═══════════════════════════════════════════════════════════════

router.post('/pinChatMessage', (req, res) => ok(res, true));

// ═══════════════════════════════════════════════════════════════
// setMyCommands / getMyCommands / setMyName / setMyDescription
// ═══════════════════════════════════════════════════════════════

router.post('/setMyCommands', async (req, res) => {
  const { commands } = req.body;
  if (!Array.isArray(commands)) return fail(res, 400, 'Bad Request: commands must be an array');
  await req.bot.update({ commands });
  ok(res, true);
});

async function getMyCommandsHandler(req, res) {
  ok(res, req.bot.commands || []);
}
router.get('/getMyCommands',  getMyCommandsHandler);
router.post('/getMyCommands', getMyCommandsHandler);

router.post('/setMyName', async (req, res) => {
  const { name } = req.body;
  if (name) await req.bot.update({ name });
  ok(res, true);
});

router.post('/setMyDescription', async (req, res) => {
  const { description } = req.body;
  if (description !== undefined) await req.bot.update({ description });
  ok(res, true);
});

// ═══════════════════════════════════════════════════════════════
// getFile  — returns file_path usable with /file/bot{token}/ endpoint
// ═══════════════════════════════════════════════════════════════

async function getFileHandler(req, res) {
  const file_id = req.body.file_id ?? req.query.file_id;
  if (!file_id) return fail(res, 400, 'Bad Request: file_id is required');

  // file_id can be:
  //   1. A relative URL like "/uploads/bot-files/xxx.jpg"
  //   2. A raw file_path like "bot-files/xxx.jpg"
  const rawPath = file_id.replace(/^\/uploads\//, '');
  const absPath = path.join(__dirname, '..', 'uploads', rawPath);

  let fileSize = 0;
  try { fileSize = fs.statSync(absPath).size; } catch { /* not found — size stays 0 */ }

  ok(res, {
    file_id,
    file_unique_id: rawPath,
    file_size:      fileSize,
    file_path:      rawPath   // clients use this with /file/bot{token}/{file_path}
  });
}

router.get('/getFile',  getFileHandler);
router.post('/getFile', getFileHandler);

// ═══════════════════════════════════════════════════════════════
// getUserProfilePhotos
// ═══════════════════════════════════════════════════════════════

router.post('/getUserProfilePhotos', (req, res) => {
  ok(res, { total_count: 0, photos: [] });
});

// ═══════════════════════════════════════════════════════════════
// Catch-all
// ═══════════════════════════════════════════════════════════════

router.all('/:method', (req, res) => {
  fail(res, 400, `Bad Request: method ${req.params.method} is not implemented`);
});

module.exports = router;
