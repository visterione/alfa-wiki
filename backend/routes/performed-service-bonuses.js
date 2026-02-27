const express = require('express');
const { PerformedServiceBonus } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/performed-service-bonuses?misUserId=xxx
// Возвращает все бонусы за выполненные услуги для врача
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    const bonuses = await PerformedServiceBonus.findAll({
      where: { misUserId },
      order: [['serviceName', 'ASC']]
    });
    res.json(bonuses);
  } catch (err) {
    console.error('Get performed bonuses error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов' });
  }
});

// POST /api/performed-service-bonuses
// Один бонус: { misUserId, doctorName, serviceCode, serviceName, bonusPercent, bonusRub }
// Или массовое сохранение: { misUserId, items: [{ serviceCode, bonusPercent, bonusRub }] }
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, serviceCode, serviceName, bonusPercent, bonusRub, items } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });

    // Bulk mode
    if (Array.isArray(items)) {
      await PerformedServiceBonus.destroy({ where: { misUserId } });
      const created = [];
      for (const item of items) {
        if (!item.serviceCode) continue;
        const [bonus] = await PerformedServiceBonus.upsert({
          misUserId,
          doctorName: doctorName || '',
          serviceCode: item.serviceCode,
          serviceName: item.serviceName || item.serviceCode,
          bonusPercent: item.bonusPercent != null ? parseFloat(item.bonusPercent) : null,
          bonusRub: item.bonusRub != null ? parseFloat(item.bonusRub) : null,
          createdBy: req.user?.id || null,
        }, { conflictFields: ['misUserId', 'serviceCode'] });
        created.push(bonus);
      }
      return res.json(created);
    }

    // Single mode
    if (!serviceCode || !serviceName) {
      return res.status(400).json({ error: 'serviceCode, serviceName обязательны' });
    }
    if (bonusPercent == null && bonusRub == null) {
      return res.status(400).json({ error: 'Укажите bonusPercent или bonusRub' });
    }
    const [bonus] = await PerformedServiceBonus.upsert({
      misUserId,
      doctorName: doctorName || '',
      serviceCode,
      serviceName,
      bonusPercent: bonusPercent != null ? parseFloat(bonusPercent) : null,
      bonusRub: bonusRub != null ? parseFloat(bonusRub) : null,
      createdBy: req.user?.id || null,
    }, { conflictFields: ['misUserId', 'serviceCode'] });
    res.json(bonus);
  } catch (err) {
    console.error('Save performed bonus error:', err);
    res.status(500).json({ error: 'Ошибка сохранения бонуса' });
  }
});

// DELETE /api/performed-service-bonuses/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const deleted = await PerformedServiceBonus.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ error: 'Запись не найдена' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete performed bonus error:', err);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// DELETE /api/performed-service-bonuses/by-doctor/:misUserId/:serviceCode
// Удалить по misUserId + serviceCode (для очистки из таблицы)
router.delete('/by-service/:misUserId/:serviceCode', authenticate, async (req, res) => {
  try {
    const { misUserId, serviceCode } = req.params;
    await PerformedServiceBonus.destroy({ where: { misUserId, serviceCode } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete performed bonus by service error:', err);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
