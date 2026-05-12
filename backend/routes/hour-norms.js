const express = require('express');
const { HourNorm } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

const router = express.Router();

// GET /api/hour-norms?year=2026&month=3
router.get('/', authenticate, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year и month обязательны' });
    }
    const norms = await HourNorm.findAll({
      where: { year: parseInt(year), month: parseInt(month) },
      order: [['professionTitle', 'ASC']]
    });
    res.json(norms);
  } catch (err) {
    console.error('hour-norms GET error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/hour-norms/periods
router.get('/periods', authenticate, async (req, res) => {
  try {
    const rows = await HourNorm.findAll({
      attributes: ['year', 'month'],
      group: ['year', 'month'],
      order: [['year', 'DESC'], ['month', 'DESC']]
    });
    res.json(rows.map(r => ({ year: r.year, month: r.month })));
  } catch (err) {
    console.error('hour-norms GET /periods error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/hour-norms/bulk
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { year, month, norms } = req.body;
    if (!year || !month || !Array.isArray(norms)) {
      return res.status(400).json({ error: 'year, month и norms обязательны' });
    }

    const existing = await HourNorm.findAll({
      where: { year: parseInt(year), month: parseInt(month) }
    });
    const oldMap = Object.fromEntries(existing.map(n => [n.professionTitle, n.normHours != null ? parseFloat(n.normHours) : null]));

    const records = norms.map(n => ({
      professionTitle: String(n.professionTitle || '').trim(),
      year:  parseInt(year),
      month: parseInt(month),
      normHours: n.normHours != null ? parseFloat(n.normHours) : null,
      createdBy: req.user.id
    })).filter(r => r.professionTitle);

    const t = await HourNorm.sequelize.transaction();
    try {
      await HourNorm.destroy({ where: { year: parseInt(year), month: parseInt(month) }, transaction: t });
      await HourNorm.bulkCreate(records, { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    const newMap = Object.fromEntries(records.map(n => [n.professionTitle, n.normHours]));
    const changes = [];
    const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    for (const key of allKeys) {
      const ov = oldMap[key] ?? null;
      const nv = newMap[key] ?? null;
      if (ov !== nv) {
        changes.push({ profession: key, before: ov, after: nv });
      }
    }

    await logRbActivity({
      userId:     req.user.id,
      tab:        'hour-norms',
      action:     'update',
      entityType: 'hour_norm',
      summary:    `Норма часов по специальностям: ${month}/${year}, специальностей: ${records.length}${changes.length ? `, изменений: ${changes.length}` : ''}`,
      diff:       changes.length ? { changes } : null,
    });

    res.json({ saved: records.length });
  } catch (err) {
    console.error('hour-norms POST /bulk error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
