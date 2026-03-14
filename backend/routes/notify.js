'use strict';

/**
 * Simple notification endpoint for external systems (Comfortel ATC, etc.)
 *
 * POST /api/notify
 * Body (JSON or form-encoded):
 *   api_key  — bot token (created via /api/bots)
 *   chat_id  — chat UUID or integer ID
 *   text     — message text
 *   parse_mode — optional: "HTML" | "Markdown" (stored but not rendered)
 *
 * Response:
 *   { ok: true,  message_id: 12345 }
 *   { ok: false, description: "..." }
 *
 * curl example:
 *   curl -X POST https://your-wiki/api/notify \
 *        -d "api_key=123:TOKEN&chat_id=-100456&text=Missed call from 79991234567"
 */

const express = require('express');
const router = express.Router();
const { BotToken, BotUpdate, Chat, ChatMember, Message, User, IntIdMap } = require('../models');
const botWebhookService = require('../services/botWebhookService');

router.post('/', async (req, res) => {
  try {
    // Support both JSON and form-encoded bodies
    const body = req.body || {};
    const api_key  = body.api_key  || body.token;
    const chat_id  = body.chat_id;
    const text     = body.text     || body.message;

    if (!api_key)  return res.status(400).json({ ok: false, description: 'api_key is required' });
    if (!chat_id)  return res.status(400).json({ ok: false, description: 'chat_id is required' });
    if (!text)     return res.status(400).json({ ok: false, description: 'text is required' });

    // Validate bot token
    const bot = await BotToken.findOne({ where: { token: api_key, isActive: true } });
    if (!bot) return res.status(401).json({ ok: false, description: 'Unauthorized: invalid api_key' });

    // Resolve chat
    const chat = await resolveChat(chat_id);
    if (!chat) return res.status(400).json({ ok: false, description: 'chat not found' });

    // Verify the bot is a member of this chat
    const membership = await ChatMember.findOne({ where: { chatId: chat.id, userId: bot.userId } });
    if (!membership) return res.status(403).json({ ok: false, description: 'bot is not a member of this chat' });

    // Create the message
    const message = await Message.create({
      chatId:   chat.id,
      senderId: bot.userId,
      content:  text,
      type:     'text'
    });

    // Assign a message_id via BotUpdate BIGSERIAL
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

    // Emit via Socket.IO so chat participants see it in real time
    const io = req.app.get('io');
    if (io) {
      const fullMsg = await Message.findByPk(message.id, {
        include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] }]
      });

      // Notify all members of the chat
      const members = await ChatMember.findAll({ where: { chatId: chat.id } });
      members.forEach(m => {
        io.to(`user:${m.userId}`).emit('new_message', {
          message: fullMsg,
          chat: {
            id:          chat.id,
            type:        chat.type,
            displayName: chat.name,
            avatar:      null
          }
        });
      });
    }

    return res.json({ ok: true, message_id: msgData.message_id });
  } catch (error) {
    console.error('[notify] error:', error);
    return res.status(500).json({ ok: false, description: 'internal server error' });
  }
});

// GET /api/notify/chat-id?api_key=...&chat_uuid=...
// Helper: returns the integer chat_id for a given chat UUID
// Useful for Comfortel setup — run once to get the numeric ID to use in curl
router.get('/chat-id', async (req, res) => {
  try {
    const { api_key, chat_uuid } = req.query;

    if (!api_key)   return res.status(400).json({ ok: false, description: 'api_key is required' });
    if (!chat_uuid) return res.status(400).json({ ok: false, description: 'chat_uuid is required' });

    const bot = await BotToken.findOne({ where: { token: api_key, isActive: true } });
    if (!bot) return res.status(401).json({ ok: false, description: 'Unauthorized' });

    const chat = await Chat.findByPk(chat_uuid);
    if (!chat) return res.status(404).json({ ok: false, description: 'chat not found' });

    const intId = await botWebhookService.getChatIntId(chat.id, chat.type);

    res.json({
      ok: true,
      chat_uuid:    chat.id,
      chat_id:      intId,
      chat_name:    chat.name,
      chat_type:    chat.type
    });
  } catch (error) {
    console.error('[notify/chat-id] error:', error);
    res.status(500).json({ ok: false, description: 'internal server error' });
  }
});

// ── Internal helper ────────────────────────────────────────────────────────

async function resolveChat(chatIdParam) {
  const idStr = String(chatIdParam).trim();

  // UUID — direct lookup
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr)) {
    return Chat.findByPk(idStr);
  }

  // Integer — lookup via IntIdMap
  const absId = Math.abs(parseInt(idStr, 10));
  if (!isNaN(absId) && absId > 0) {
    const row = await IntIdMap.findByPk(absId);
    if (row) return Chat.findByPk(row.uuid);
  }

  return null;
}

module.exports = router;
