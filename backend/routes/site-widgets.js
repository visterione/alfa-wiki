'use strict';

/**
 * Настройка виджетов связи — администратору (ver. 8.06).
 *
 * Сам виджет и его настройку отдаёт другой роутер, routes/widget/index.js: он
 * публичный, без авторизации и только на чтение. Здесь — обратная сторона:
 * заведение, правка и выключение, всё под требованием прав администратора.
 *
 * Разделение не косметическое. Публичный контур смонтирован до express.json()
 * и не знает ни про JWT, ни про пользователей; всё, что умеет менять данные,
 * живёт тут и до улицы не достаёт.
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { SiteWidget, MedCenter, MessengerBot } = require('../models');
const widget = require('../services/siteWidget');

const router = express.Router();

/** Адрес, который вписывают в чужой сайт. Совпадает с монтированием в server.js. */
function embedSnippet(row) {
  const base = (process.env.BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');
  return `<script src="${base}/api/widget/v1/embed.js" data-widget="${row.key}" async></script>`;
}

function view(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    medCenterId: row.medCenterId,
    medCenter: row.medCenter ? row.medCenter.name : null,
    channels: row.channels || [],
    appearance: { ...widget.DEFAULT_APPEARANCE, ...(row.appearance || {}) },
    allowedOrigins: row.allowedOrigins || [],
    isActive: row.isActive,
    snippet: embedSnippet(row),
    updatedAt: row.updatedAt
  };
}

function fail(res, err, where) {
  if (err instanceof widget.WidgetError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(`[site-widgets] ${where}:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Разбирает тело один раз для создания и правки: правила у них общие. */
function draftFrom(body) {
  const patch = {};

  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 150);
    if (!name) throw new widget.WidgetError('Нужно название — по нему виджет находят в списке');
    patch.name = name;
  }
  if (body.medCenterId !== undefined) patch.medCenterId = body.medCenterId || null;
  if (body.channels !== undefined) patch.channels = widget.normalizeChannels(body.channels);
  if (body.appearance !== undefined) patch.appearance = widget.normalizeAppearance(body.appearance);
  if (body.allowedOrigins !== undefined) patch.allowedOrigins = widget.normalizeOrigins(body.allowedOrigins);
  if (body.isActive !== undefined) patch.isActive = !!body.isActive;

  return patch;
}

router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await SiteWidget.findAll({
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }],
      order: [['name', 'ASC']]
    });
    res.json({ widgets: rows.map(view) });
  } catch (err) {
    fail(res, err, 'GET /');
  }
});

/**
 * Из чего собирать каналы: филиалы и заведённые в них боты. Нужно, чтобы ссылку
 * на бота не переписывали руками с бумажки — @имя уже известно системе.
 *
 * Список ботов лёгкий, без похода к платформе за состоянием вебхука: здесь
 * важно имя, а не здоровье бота (это видно на вкладке «Рассылка»).
 */
router.get('/sources', authenticate, requireAdmin, async (req, res) => {
  try {
    const [medCenters, bots] = await Promise.all([
      MedCenter.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      MessengerBot.findAll({
        attributes: ['id', 'platform', 'username', 'title', 'medCenterId', 'isActive'],
        order: [['platform', 'ASC']]
      })
    ]);

    res.json({
      medCenters: medCenters.map(m => ({ id: m.id, name: m.name })),
      bots: bots.map(b => ({
        id: b.id,
        platform: b.platform,
        username: b.username,
        title: b.title,
        medCenterId: b.medCenterId,
        isActive: b.isActive,
        // Догадка, а не справочник: у Telegram адрес бота известен точно, у MAX
        // мы его живьём не проверяли. Поэтому это подстановка в поле, которое
        // администратор видит и правит, а не значение, вшитое в виджет.
        suggestedUrl: b.username
          ? (b.platform === 'max' ? `https://max.ru/${b.username}` : `https://t.me/${b.username}`)
          : null
      }))
    });
  } catch (err) {
    fail(res, err, 'GET /sources');
  }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const patch = draftFrom(req.body || {});
    if (!patch.name) throw new widget.WidgetError('Нужно название — по нему виджет находят в списке');

    const row = await SiteWidget.create({
      ...patch,
      key: widget.generateKey(),
      channels: patch.channels || [],
      appearance: patch.appearance || widget.DEFAULT_APPEARANCE,
      allowedOrigins: patch.allowedOrigins || [],
      createdBy: req.user.id,
      updatedBy: req.user.id
    });

    const created = await SiteWidget.findByPk(row.id, {
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }]
    });
    res.status(201).json(view(created));
  } catch (err) {
    fail(res, err, 'POST /');
  }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const row = await SiteWidget.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Виджет не найден' });

    await row.update({ ...draftFrom(req.body || {}), updatedBy: req.user.id });

    const updated = await SiteWidget.findByPk(row.id, {
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }]
    });
    res.json(view(updated));
  } catch (err) {
    fail(res, err, 'PUT /:id');
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const row = await SiteWidget.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Виджет не найден' });

    // Удаление ломает чужую страницу молча: тег на сайте остаётся, а настройки
    // по ключу больше нет. Поэтому в интерфейсе это последнее действие, а
    // выключение виджета — отдельная галка.
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'DELETE /:id');
  }
});

module.exports = router;
