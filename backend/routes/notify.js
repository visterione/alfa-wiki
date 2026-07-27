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
const { BotToken, Chat } = require('../models');
const botWebhookService = require('../services/botWebhookService');
const { sendBotMessage, BotMessengerError } = require('../services/botMessenger');
const { rateLimitByIp, auditLog } = require('../middleware/publicApi');

// Точка принимает токен бота и была смонтирована голой: перебирать токены по ней
// можно было бесконечно и бесследно. Те же ограничения, что у публичного API форм.
router.use(rateLimitByIp(60));
router.use(auditLog());

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

    const { messageId } = await sendBotMessage({
      botToken: api_key,
      chatId:   chat_id,
      text,
      io: req.app.get('io')
    });

    return res.json({ ok: true, message_id: messageId });
  } catch (error) {
    if (error instanceof BotMessengerError) {
      const status = { invalid_token: 401, chat_not_found: 400, not_a_member: 403 }[error.code] || 400;
      return res.status(status).json({ ok: false, description: error.message });
    }
    console.error('[notify] error:', error);
    return res.status(500).json({ ok: false, description: 'internal server error' });
  }
});

// POST /api/notify/chat-id   { api_key, chat_uuid }
// Helper: returns the integer chat_id for a given chat UUID
// Useful for Comfortel setup — run once to get the numeric ID to use in curl
//
// Раньше был GET с токеном в query-строке: тот попадал в access-логи nginx
// открытым текстом и оставался там в ротации. Токен принимается только в теле.
router.post('/chat-id', async (req, res) => {
  try {
    const { api_key, chat_uuid } = req.body || {};

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

module.exports = router;
