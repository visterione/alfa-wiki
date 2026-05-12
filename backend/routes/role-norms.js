const express = require('express');
const { RoleNorm } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

const router = express.Router();

// GET /api/role-norms?year=2026&month=3
router.get('/', authenticate, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year и month обязательны' });
    }
    const norms = await RoleNorm.findAll({
      where: { year: parseInt(year), month: parseInt(month) },
      order: [['roleTitle', 'ASC']]
    });
    res.json(norms);
  } catch (err) {
    console.error('role-norms GET error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/role-norms/periods
router.get('/periods', authenticate, async (req, res) => {
  try {
    const rows = await RoleNorm.findAll({
      attributes: ['year', 'month'],
      group: ['year', 'month'],
      order: [['year', 'DESC'], ['month', 'DESC']]
    });
    res.json(rows.map(r => ({ year: r.year, month: r.month })));
  } catch (err) {
    console.error('role-norms GET /periods error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/role-norms/bulk
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { year, month, norms } = req.body;
    if (!year || !month || !Array.isArray(norms)) {
      return res.status(400).json({ error: 'year, month и norms обязательны' });
    }

    const existing = await RoleNorm.findAll({
      where: { year: parseInt(year), month: parseInt(month) }
    });
    const oldMap = Object.fromEntries(existing.map(n => [n.roleTitle, n.normHours != null ? parseFloat(n.normHours) : null]));

    const records = norms.map(n => ({
      roleTitle: String(n.roleTitle || '').trim(),
      year:  parseInt(year),
      month: parseInt(month),
      normHours: n.normHours != null ? parseFloat(n.normHours) : null,
      createdBy: req.user.id
    })).filter(r => r.roleTitle);

    const t = await RoleNorm.sequelize.transaction();
    try {
      await RoleNorm.destroy({ where: { year: parseInt(year), month: parseInt(month) }, transaction: t });
      await RoleNorm.bulkCreate(records, { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    const newMap = Object.fromEntries(records.map(n => [n.roleTitle, n.normHours]));
    const changes = [];
    const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    for (const key of allKeys) {
      if (oldMap[key] !== newMap[key]) {
        changes.push({ role: key, before: oldMap[key] ?? null, after: newMap[key] ?? null });
      }
    }

    await logRbActivity({
      userId:     req.user.id,
      tab:        'hour-norms',
      action:     'update',
      entityType: 'role_norm',
      summary:    `Норма часов по должностям: ${month}/${year}, должностей: ${records.length}${changes.length ? `, изменений: ${changes.length}` : ''}`,
      diff:       changes.length ? { changes } : null,
    });

    res.json({ saved: records.length });
  } catch (err) {
    console.error('role-norms POST /bulk error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
