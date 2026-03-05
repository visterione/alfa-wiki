const express = require('express');
const { ServiceConsumable } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/service-consumables?misUserId=xxx
// Возвращает все расходники для врача, сгруппированные по услугам
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    const items = await ServiceConsumable.findAll({
      where: { misUserId },
      order: [['serviceName', 'ASC'], ['name', 'ASC']]
    });
    res.json(items);
  } catch (err) {
    console.error('Get consumables error:', err);
    res.status(500).json({ error: 'Ошибка получения расходников' });
  }
});

// POST /api/service-consumables
// Тело: { misUserId, doctorName, serviceCode, serviceName, name, quantity, costPerUnit }
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, serviceCode, serviceName, name, quantity, costPerUnit } = req.body;
    if (!misUserId || !serviceCode || !name) {
      return res.status(400).json({ error: 'misUserId, serviceCode, name обязательны' });
    }
    const item = await ServiceConsumable.create({
      misUserId: String(misUserId).trim(),
      doctorName: String(doctorName || '').trim().substring(0, 255),
      serviceCode: String(serviceCode).trim().substring(0, 100),
      serviceName: String(serviceName || '').trim().substring(0, 500),
      name: String(name).trim().substring(0, 255),
      quantity: parseFloat(quantity) > 0 ? parseFloat(quantity) : 1,
      costPerUnit: parseFloat(costPerUnit) >= 0 ? parseFloat(costPerUnit) : 0,
      createdBy: req.user?.id || null
    });
    res.json(item);
  } catch (err) {
    console.error('Create consumable error:', err);
    res.status(500).json({ error: 'Ошибка создания расходника' });
  }
});

// PUT /api/service-consumables/:id
// Обновить расходник: { name, quantity, costPerUnit }
router.put('/:id', authenticate, async (req, res) => {
  try {
    const item = await ServiceConsumable.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Запись не найдена' });
    const { name, quantity, costPerUnit } = req.body;
    await item.update({
      name: name != null ? String(name).trim().substring(0, 255) : item.name,
      quantity: quantity != null && parseFloat(quantity) > 0 ? parseFloat(quantity) : item.quantity,
      costPerUnit: costPerUnit != null && parseFloat(costPerUnit) >= 0 ? parseFloat(costPerUnit) : item.costPerUnit
    });
    res.json(item);
  } catch (err) {
    console.error('Update consumable error:', err);
    res.status(500).json({ error: 'Ошибка обновления расходника' });
  }
});

// DELETE /api/service-consumables/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const deleted = await ServiceConsumable.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ error: 'Запись не найдена' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete consumable error:', err);
    res.status(500).json({ error: 'Ошибка удаления расходника' });
  }
});

module.exports = router;
