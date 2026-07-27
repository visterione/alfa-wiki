'use strict';

/**
 * Управление ключами публичного API из интерфейса.
 *
 *   GET    /api/api-clients                  список ключей
 *   POST   /api/api-clients                  выдать ключ (показывается один раз)
 *   PATCH  /api/api-clients/:id              изменить права, origins, IP, лимит
 *   POST   /api/api-clients/:id/rotate       перевыпустить ключ
 *   DELETE /api/api-clients/:id              отозвать
 *   GET    /api/api-clients/meta             формы и подписки — для чекбоксов и реестра
 *   GET    /api/api-clients/:id/logs         последние обращения этого ключа
 *   GET    /api/api-clients/submissions      заявки со статусом доставки
 *   POST   /api/api-clients/submissions/:id/redeliver  переотправить заявку
 *
 * Главное здесь — PATCH: раньше права задавались один раз при создании через
 * scripts/createApiClient.js, и добавить форму существующему клиенту было нельзя.
 * Приходилось выпускать новый ключ и передавать его разработчику сайта заново.
 * Права — обычный JSONB-массив, менять их можно без смены ключа.
 */

const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');

const {
  ApiClient, ApiRequestLog, Submission, SubmissionDelivery,
  FormSubscription, BotToken, Chat, User
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { hashKey, KEY_PREFIX_LENGTH } = require('../middleware/publicApi');
const formRegistry = require('../services/public/formRegistry');
const submissionService = require('../services/public/submissionService');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/** wk_live_ + 32 hex: первые 16 символов служат префиксом для поиска строки */
function generateKey() {
  return 'wk_live_' + crypto.randomBytes(16).toString('hex');
}

/**
 * Оставляет только существующие права. Раньше скоуп был произвольной строкой из
 * командной строки, и опечатка молча создавала ключ, который потом отдавал 403.
 */
function sanitizeScopes(scopes) {
  const known = new Set(formRegistry.listFormTypes().map(t => formRegistry.scopeFor(t)));
  return [...new Set((scopes || []).filter(s => known.has(s)))];
}

function toArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return [];
}

// ── Справочник для интерфейса ─────────────────────────────────────────────

router.get('/meta', authenticate, requireAdmin, async (req, res) => {
  try {
    const subscriptions = await FormSubscription.findAll({
      where: { isActive: true },
      include: [
        { model: Chat, as: 'chat', attributes: ['id', 'name', 'type'] },
        { model: BotToken, as: 'bot', attributes: ['id', 'name', 'username'] }
      ],
      order: [['createdAt', 'ASC']]
    });

    res.json({
      forms: formRegistry.listForms().map(f => ({ ...f, scope: formRegistry.scopeFor(f.formType) })),
      // Реестр подписок: конфигурация размазана по чатам, и без общего списка
      // никто не сможет ответить, куда уходят заявки, не обойдя все чаты руками
      subscriptions: subscriptions.map(s => ({
        id:       s.id,
        formType: s.formType,
        chat:     s.chat ? { id: s.chat.id, name: s.chat.name } : null,
        bot:      s.bot  ? { id: s.bot.id, name: s.bot.name, username: s.bot.username } : null,
        filters:  s.filters,
        createdAt: s.createdAt
      }))
    });
  } catch (error) {
    console.error('GET /api/api-clients/meta error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Заявки ────────────────────────────────────────────────────────────────

router.get('/submissions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { formType, status, limit = 50 } = req.query;

    const where = {};
    if (formType) where.formType = formType;
    if (status) where.deliveryStatus = status;

    const submissions = await Submission.findAll({
      where,
      include: [{ model: SubmissionDelivery, as: 'deliveries' }],
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(limit) || 50, 200)
    });

    const chatIds = [...new Set(submissions.flatMap(s => s.deliveries.map(d => d.chatId)))];
    const chats = await Chat.findAll({ where: { id: chatIds }, attributes: ['id', 'name'] });
    const chatById = new Map(chats.map(c => [c.id, c.name]));

    res.json(submissions.map(s => ({
      id:        s.id,
      formType:  s.formType,
      status:    s.status,
      deliveryStatus: s.deliveryStatus,
      createdAt: s.createdAt,
      // payload не отдаём: там персональные данные, а страница нужна для контроля
      // доставки, а не для чтения заявок — их читают в чате
      deliveries: s.deliveries.map(d => ({
        chatId:   d.chatId,
        chatName: chatById.get(d.chatId) || null,
        status:   d.status,
        attempts: d.attempts,
        error:    d.error
      }))
    })));
  } catch (error) {
    console.error('GET /api/api-clients/submissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/submissions/:id/redeliver', authenticate, requireAdmin, async (req, res) => {
  try {
    const submission = await Submission.findByPk(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Заявка не найдена' });

    // Счётчик попыток сбрасываем: ручная переотправка не должна упираться в лимит,
    // который заявка уже исчерпала автоматическими повторами
    await SubmissionDelivery.update(
      { attempts: 0, status: 'pending' },
      { where: { submissionId: submission.id, status: { [Op.ne]: 'sent' } } }
    );

    const result = await submissionService.deliverSubmission(submission, req.app.get('io'));
    res.json(result);
  } catch (error) {
    console.error('POST /api/api-clients/submissions/:id/redeliver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Ключи ─────────────────────────────────────────────────────────────────

router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const clients = await ApiClient.findAll({
      attributes: { exclude: ['keyHash'] },
      order: [['createdAt', 'DESC']]
    });

    // Сколько заявок пришло от каждого ключа — чтобы отличать живые от забытых
    const counts = await Submission.findAll({
      attributes: ['clientId', [Submission.sequelize.fn('COUNT', '*'), 'count']],
      group: ['clientId'],
      raw: true
    });
    const countByClient = new Map(counts.map(c => [c.clientId, Number(c.count)]));

    res.json(clients.map(c => ({
      ...c.toJSON(),
      submissionCount: countByClient.get(c.id) || 0
    })));
  } catch (error) {
    console.error('GET /api/api-clients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, keyType = 'secret', scopes, allowedOrigins, allowedIps, rateLimitPerMin } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название системы' });
    }

    const origins = toArray(allowedOrigins);
    // Публичный ключ лежит в открытом виде на странице сайта — без белого списка
    // Origin им сможет пользоваться кто угодно
    if (keyType === 'public' && origins.length === 0) {
      return res.status(400).json({ error: 'Для ключа, вызываемого из браузера, обязателен хотя бы один Origin' });
    }

    const key = generateKey();

    const client = await ApiClient.create({
      name: String(name).trim(),
      keyType: keyType === 'public' ? 'public' : 'secret',
      keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
      keyHash: hashKey(key),
      scopes: sanitizeScopes(scopes),
      allowedOrigins: origins,
      allowedIps: toArray(allowedIps),
      rateLimitPerMin: Number(rateLimitPerMin) || 60,
      createdBy: req.user.id
    });

    const json = client.toJSON();
    delete json.keyHash;

    // Ключ показывается один раз — в базе только хеш
    res.status(201).json({ ...json, key });
  } catch (error) {
    console.error('POST /api/api-clients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = await ApiClient.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Ключ не найден' });

    const { name, scopes, allowedOrigins, allowedIps, rateLimitPerMin, isActive } = req.body;
    const updates = { updatedBy: req.user.id };

    if (name !== undefined) updates.name = String(name).trim();
    if (scopes !== undefined) updates.scopes = sanitizeScopes(scopes);
    if (allowedIps !== undefined) updates.allowedIps = toArray(allowedIps);
    if (rateLimitPerMin !== undefined) updates.rateLimitPerMin = Number(rateLimitPerMin) || 60;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    if (allowedOrigins !== undefined) {
      const origins = toArray(allowedOrigins);
      const keyType = client.keyType;
      if (keyType === 'public' && origins.length === 0) {
        return res.status(400).json({ error: 'У ключа для браузера нельзя убрать все Origin' });
      }
      updates.allowedOrigins = origins;
    }

    await client.update(updates);

    const json = client.toJSON();
    delete json.keyHash;
    res.json(json);
  } catch (error) {
    console.error('PATCH /api/api-clients/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/rotate', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = await ApiClient.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Ключ не найден' });

    const key = generateKey();
    await client.update({
      keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
      keyHash: hashKey(key),
      updatedBy: req.user.id
    });

    res.json({ key });
  } catch (error) {
    console.error('POST /api/api-clients/:id/rotate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = await ApiClient.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Ключ не найден' });

    // Не удаляем строку: на неё ссылаются принятые заявки и журнал обращений
    await client.update({ isActive: false, updatedBy: req.user.id });
    res.json({ message: 'Ключ отозван' });
  } catch (error) {
    console.error('DELETE /api/api-clients/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const logs = await ApiRequestLog.findAll({
      where: { clientId: req.params.id },
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 100, 500)
    });
    res.json(logs);
  } catch (error) {
    console.error('GET /api/api-clients/:id/logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
