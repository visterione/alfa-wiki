'use strict';

/**
 * Bot Management API
 * Admin endpoints for creating and managing Telegram-compatible bots
 *
 * All routes require authentication and admin privileges.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { BotToken, BotUpdate, User, Chat, ChatMember } = require('../models');
const { authenticate } = require('../middleware/auth');
const formRegistry = require('../services/public/formRegistry');

const router = express.Router();

// Only admins can manage bots
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Generate a Telegram-style token: {numericId}:{randomAlpha}
function generateToken(numericId) {
  const random = crypto.randomBytes(20).toString('base64url').substring(0, 35);
  return `${numericId}:${random}`;
}

// ── List all bots ─────────────────────────────────────────────────────────

router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const bots = await BotToken.findAll({
      include: [{ model: User, as: 'botUser', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(bots);
  } catch (error) {
    console.error('GET /api/bots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get single bot ────────────────────────────────────────────────────────

router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id, {
      include: [{ model: User, as: 'botUser', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot'] }]
    });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json(bot);
  } catch (error) {
    console.error('GET /api/bots/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create a new bot ──────────────────────────────────────────────────────

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, username, description } = req.body;

    if (!name || !username) {
      return res.status(400).json({ error: 'name and username are required' });
    }

    // Validate username format (alphanumeric + underscore, ends with _bot)
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
      return res.status(400).json({ error: 'username must be 5–32 chars, alphanumeric and underscores only' });
    }

    // Check uniqueness
    const existing = await BotToken.findOne({ where: { username } });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Create a bot User record
    const botPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const botUser = await User.create({
      username: `bot_${username}`,
      password: botPassword,
      displayName: name,
      isBot: true,
      isActive: true
    });

    // Generate token using the numeric portion of the user's UUID hash
    const { uuidToInt } = require('../services/botWebhookService');
    const numericId = uuidToInt(botUser.id);
    const token = generateToken(numericId);

    const bot = await BotToken.create({
      token,
      name,
      username,
      description: description || '',
      userId: botUser.id
    });

    const result = await BotToken.findByPk(bot.id, {
      include: [{ model: User, as: 'botUser', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot'] }]
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('POST /api/bots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update a bot ──────────────────────────────────────────────────────────

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const { name, description, isActive, commands, webhookUrl, webhookSecretToken, allowedUpdates, maxConnections, servesForms } = req.body;

    const update = {};
    if (name !== undefined) update.name = name;
    // Какие формы публичного API доставляет бот. Заменяет PUBLIC_FORMS_BOT_TOKEN
    // в .env: связка «форма → бот» теперь настраивается здесь.
    if (servesForms !== undefined) {
      const known = new Set(formRegistry.listFormTypes());
      update.servesForms = [...new Set((servesForms || []).filter(t => known.has(t)))];
    }
    if (description !== undefined) update.description = description;
    if (isActive !== undefined) update.isActive = isActive;
    if (commands !== undefined) update.commands = commands;
    if (webhookUrl !== undefined) update.webhookUrl = webhookUrl;
    if (webhookSecretToken !== undefined) update.webhookSecretToken = webhookSecretToken;
    if (allowedUpdates !== undefined) update.allowedUpdates = allowedUpdates;
    if (maxConnections !== undefined) update.maxConnections = maxConnections;

    await bot.update(update);

    // Галочка формы должна срабатывать сразу в тех чатах, где бот уже состоит
    if (update.servesForms !== undefined) {
      const subscriptionService = require('../services/public/subscriptionService');
      await subscriptionService.onServedFormsChanged(bot, req.user.id);
    }

    // Sync displayName on User record if name changed
    if (name) {
      await User.update({ displayName: name }, { where: { id: bot.userId } });
    }

    const result = await BotToken.findByPk(bot.id, {
      include: [{ model: User, as: 'botUser', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot'] }]
    });

    res.json(result);
  } catch (error) {
    console.error('PUT /api/bots/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Regenerate bot token ──────────────────────────────────────────────────

router.post('/:id/regenerate-token', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const { uuidToInt } = require('../services/botWebhookService');
    const numericId = uuidToInt(bot.userId);
    const newToken = generateToken(numericId);

    await bot.update({ token: newToken });
    res.json({ token: newToken });
  } catch (error) {
    console.error('POST /api/bots/:id/regenerate-token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete a bot ──────────────────────────────────────────────────────────

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const botUserId = bot.userId;

    // Remove from all chats
    await ChatMember.destroy({ where: { userId: botUserId } });

    // Delete all updates
    await BotUpdate.destroy({ where: { botId: bot.id } });

    // Delete bot token record
    await bot.destroy();

    // Deactivate the bot User record (don't delete to preserve message history)
    await User.update({ isActive: false }, { where: { id: botUserId } });

    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/bots/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get bot updates (admin view) ──────────────────────────────────────────

router.get('/:id/updates', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const { limit = 50, offset = 0, processed } = req.query;
    const where = { botId: bot.id };
    if (processed !== undefined) where.processed = processed === 'true';

    const updates = await BotUpdate.findAll({
      where,
      order: [['id', 'DESC']],
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0
    });

    res.json(updates);
  } catch (error) {
    console.error('GET /api/bots/:id/updates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Add bot to a chat ─────────────────────────────────────────────────────

router.post('/:id/chats', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: 'chatId is required' });

    const existing = await ChatMember.findOne({ where: { chatId, userId: bot.userId } });
    if (existing) return res.status(409).json({ error: 'Bot is already a member of this chat' });

    await ChatMember.create({ chatId, userId: bot.userId, role: 'member' });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('POST /api/bots/:id/chats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Remove bot from a chat ────────────────────────────────────────────────

router.delete('/:id/chats/:chatId', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    await ChatMember.destroy({ where: { chatId: req.params.chatId, userId: bot.userId } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/bots/:id/chats/:chatId error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get chats bot belongs to ──────────────────────────────────────────────

router.get('/:id/chats', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await BotToken.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const memberships = await ChatMember.findAll({
      where: { userId: bot.userId },
      include: [{ model: Chat, as: 'chat' }]
    });

    res.json(memberships.map(m => m.chat));
  } catch (error) {
    console.error('GET /api/bots/:id/chats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
