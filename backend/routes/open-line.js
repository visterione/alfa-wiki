'use strict';

/**
 * Открытая линия: API оператора и настройка линий (ver. 7.85).
 *
 * Доступ к работе даёт состав линии, а не отдельное право: кто заведён в линию,
 * тот и отвечает. Настройка самих линий — за администратором.
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { OmniLine, OmniLineOperator, MessengerBot, MedCenter, User } = require('../models');
const openLine = require('../services/openLine');
const fileAccess = require('../services/fileAccess');

const router = express.Router();

// Коды ошибок логики → коды HTTP. Держим в одном месте, чтобы маршруты не
// повторяли одну и ту же лесенку if-ов.
const STATUS_BY_CODE = {
  not_operator: 403,
  not_yours: 403,
  already_taken: 409,
  not_found: 404
};

function fail(res, err, where) {
  if (err.name === 'OpenLineError') {
    return res.status(STATUS_BY_CODE[err.code] || 400).json({ error: err.message, code: err.code });
  }
  console.error(`[open-line] ${where}:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

// ── Смена ─────────────────────────────────────────────────────────────────

// Состояние сотрудника: заведён ли в линии, начат ли день.
router.get('/state', authenticate, async (req, res) => {
  try {
    const state = await openLine.shiftState(req.user.id);
    // Короткоживущий токен для ссылок на вложения: картинку в <img> заголовком
    // не подписать, поэтому он подставляется в ?t= — как в чатах и онбординге.
    res.json({ ...state, fileToken: fileAccess.issueToken(req.user.id) });
  } catch (err) {
    fail(res, err, 'GET /state');
  }
});

// Начать или закончить день. Кнопка одна: открывает все линии сотрудника —
// очередь у него общая.
router.post('/shift', authenticate, async (req, res) => {
  try {
    const on = req.body && req.body.on !== false;
    const result = on ? await openLine.startDay(req.user.id) : await openLine.endDay(req.user.id);
    res.json({ ...result, ...(await openLine.shiftState(req.user.id)) });
  } catch (err) {
    fail(res, err, 'POST /shift');
  }
});

// ── Обращения ─────────────────────────────────────────────────────────────

router.get('/conversations', authenticate, async (req, res) => {
  try {
    const scope = ['queue', 'mine', 'closed'].includes(req.query.scope) ? req.query.scope : 'queue';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json(await openLine.listConversations(req.user.id, { scope, limit, offset }));
  } catch (err) {
    fail(res, err, 'GET /conversations');
  }
});

router.get('/conversations/:id', authenticate, async (req, res) => {
  try {
    res.json(await openLine.getConversation(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'GET /conversations/:id');
  }
});

router.post('/conversations/:id/assign', authenticate, async (req, res) => {
  try {
    res.json(await openLine.assign(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'POST /assign');
  }
});

router.post('/conversations/:id/close', authenticate, async (req, res) => {
  try {
    res.json(await openLine.close(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'POST /close');
  }
});

router.post('/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

    const result = await openLine.reply(req.user.id, req.params.id, text);
    // Недоставленное сообщение — не ошибка запроса: оно сохранено в переписке с
    // пометкой, и оператор должен это увидеть, а не получить пустой отказ.
    res.json(result);
  } catch (err) {
    fail(res, err, 'POST /messages');
  }
});

// ── Настройка линий (администратор) ───────────────────────────────────────

router.get('/lines', authenticate, requireAdmin, async (req, res) => {
  try {
    const lines = await OmniLine.findAll({
      include: [
        { model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] },
        {
          model: OmniLineOperator,
          as: 'operators',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        }
      ],
      order: [['name', 'ASC']]
    });

    const bots = await MessengerBot.findAll({ attributes: ['id', 'platform', 'username', 'organization', 'lineId'] });
    // Справочник медцентров — для выбора при создании линии.
    const medCenters = await MedCenter.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });
    res.json({ lines, bots, medCenters });
  } catch (err) {
    fail(res, err, 'GET /lines');
  }
});

router.post('/lines', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, medCenterId, offlineReply } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Нужно название линии' });

    const line = await OmniLine.create({ name, medCenterId: medCenterId || null, offlineReply: offlineReply || null });
    res.status(201).json(line);
  } catch (err) {
    fail(res, err, 'POST /lines');
  }
});

router.put('/lines/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const line = await OmniLine.findByPk(req.params.id);
    if (!line) return res.status(404).json({ error: 'Линия не найдена' });

    const { name, medCenterId, offlineReply, isActive } = req.body || {};
    await line.update({
      name: name !== undefined ? name : line.name,
      medCenterId: medCenterId !== undefined ? medCenterId : line.medCenterId,
      offlineReply: offlineReply !== undefined ? offlineReply : line.offlineReply,
      isActive: isActive !== undefined ? isActive : line.isActive
    });
    res.json(line);
  } catch (err) {
    fail(res, err, 'PUT /lines/:id');
  }
});

// Состав линии
router.post('/lines/:id/operators', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Нужен userId' });

    const [row] = await OmniLineOperator.findOrCreate({
      where: { lineId: req.params.id, userId },
      defaults: { lineId: req.params.id, userId }
    });
    res.status(201).json(row);
  } catch (err) {
    fail(res, err, 'POST /operators');
  }
});

router.delete('/lines/:id/operators/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    await OmniLineOperator.destroy({ where: { lineId: req.params.id, userId: req.params.userId } });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'DELETE /operators');
  }
});

// Какой бот кормит линию. Ботов у медцентра два (Telegram и MAX), и оба обычно
// смотрят в одну линию.
router.put('/lines/:id/bots/:botId', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await MessengerBot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Бот не найден' });

    await bot.update({ lineId: req.params.id === 'none' ? null : req.params.id });
    res.json(bot);
  } catch (err) {
    fail(res, err, 'PUT /bots');
  }
});

module.exports = router;
