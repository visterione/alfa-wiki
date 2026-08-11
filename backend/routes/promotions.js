const express = require('express');
const { Promotion } = require('../models');
const { authenticate } = require('../middleware/auth');
const medCenters = require('../services/medCenters');

const router = express.Router();

// Акцию заводят филиалу, поэтому служебные группировки не подходят. Раньше здесь
// лежала копия списка названий, которую правили руками при каждом изменении.
async function isValidMedCenter(name) {
  const mc = await medCenters.byName(name);
  return !!mc && !mc.isVirtual;
}



// GET /api/promotions — получить все акции (сгруппированные по медцентру)
router.get('/', authenticate, async (_req, res) => {
  try {
    const promotions = await Promotion.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(promotions);
  } catch (err) {
    console.error('GET /api/promotions error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/promotions — создать акцию
router.post('/', authenticate, async (req, res) => {
  if (!req.user.canManagePromotions && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Нет прав на управление акциями' });
  }
  const { title, description, medCenter, dateFrom, deadline } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Заголовок обязателен' });
  }
  if (!(await isValidMedCenter(medCenter))) {
    return res.status(400).json({ error: 'Неверный медцентр' });
  }
  try {
    const promotion = await Promotion.create({
      title: title.trim(),
      description: description ? description.trim() : null,
      medCenter,
      dateFrom: dateFrom || null,
      deadline: deadline || null,
      createdBy: req.user.id
    });
    res.status(201).json(promotion);
  } catch (err) {
    console.error('POST /api/promotions error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PUT /api/promotions/:id — обновить акцию
router.put('/:id', authenticate, async (req, res) => {
  if (!req.user.canManagePromotions && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Нет прав на управление акциями' });
  }
  const { title, description, medCenter, dateFrom, deadline } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Заголовок обязателен' });
  }
  if (!(await isValidMedCenter(medCenter))) {
    return res.status(400).json({ error: 'Неверный медцентр' });
  }
  try {
    const promotion = await Promotion.findByPk(req.params.id);
    if (!promotion) return res.status(404).json({ error: 'Акция не найдена' });
    await promotion.update({
      title: title.trim(),
      description: description ? description.trim() : null,
      medCenter,
      dateFrom: dateFrom || null,
      deadline: deadline || null
    });
    res.json(promotion);
  } catch (err) {
    console.error('PUT /api/promotions/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/promotions/:id — удалить акцию
router.delete('/:id', authenticate, async (req, res) => {
  if (!req.user.canManagePromotions && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Нет прав на управление акциями' });
  }
  try {
    const promotion = await Promotion.findByPk(req.params.id);
    if (!promotion) return res.status(404).json({ error: 'Акция не найдена' });
    await promotion.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/promotions/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
