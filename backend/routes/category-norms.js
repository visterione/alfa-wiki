const express = require('express');
const { CategoryNorm, RbScheduleCategory } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

const router = express.Router();

// GET /api/category-norms?year=2026&month=3
router.get('/', authenticate, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year и month обязательны' });
    }
    const norms = await CategoryNorm.findAll({
      where: { year: parseInt(year), month: parseInt(month) },
      include: [{ model: RbScheduleCategory, as: 'category', attributes: ['id', 'name', 'color'] }],
      order: [[{ model: RbScheduleCategory, as: 'category' }, 'name', 'ASC']]
    });
    res.json(norms);
  } catch (err) {
    console.error('category-norms GET error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/category-norms/periods
router.get('/periods', authenticate, async (req, res) => {
  try {
    const rows = await CategoryNorm.findAll({
      attributes: ['year', 'month'],
      group: ['year', 'month'],
      order: [['year', 'DESC'], ['month', 'DESC']]
    });
    res.json(rows.map(r => ({ year: r.year, month: r.month })));
  } catch (err) {
    console.error('category-norms GET /periods error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/category-norms/bulk
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { year, month, norms } = req.body;
    if (!year || !month || !Array.isArray(norms)) {
      return res.status(400).json({ error: 'year, month и norms обязательны' });
    }

    const existing = await CategoryNorm.findAll({
      where: { year: parseInt(year), month: parseInt(month) },
      include: [{ model: RbScheduleCategory, as: 'category', attributes: ['id', 'name'] }],
    });
    const oldMap = Object.fromEntries(existing.map(n => [n.categoryId, { normHours: n.normHours != null ? parseFloat(n.normHours) : null, name: n.category?.name }]));

    const records = norms.map(n => ({
      categoryId: n.categoryId,
      year:  parseInt(year),
      month: parseInt(month),
      normHours: n.normHours != null ? parseFloat(n.normHours) : null,
      createdBy: req.user.id
    })).filter(r => r.categoryId);

    const t = await CategoryNorm.sequelize.transaction();
    try {
      await CategoryNorm.destroy({ where: { year: parseInt(year), month: parseInt(month) }, transaction: t });
      await CategoryNorm.bulkCreate(records, { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    const changes = [];
    for (const n of norms) {
      if (!n.categoryId) continue;
      const old = oldMap[n.categoryId];
      const oldHours = old?.normHours != null ? parseFloat(old.normHours) : null;
      const newHours = n.normHours != null ? parseFloat(n.normHours) : null;
      if (oldHours !== newHours) {
        changes.push({ categoryId: n.categoryId, categoryName: n.categoryName || n.categoryId, before: oldHours, after: newHours });
      }
    }

    await logRbActivity({
      userId:     req.user.id,
      tab:        'hour-norms',
      action:     'update',
      entityType: 'category_norm',
      summary:    `Норма часов по категориям: ${month}/${year}, категорий: ${records.length}${changes.length ? `, изменений: ${changes.length}` : ''}`,
      diff:       changes.length ? { changes } : null,
    });

    res.json({ saved: records.length });
  } catch (err) {
    console.error('category-norms POST /bulk error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
