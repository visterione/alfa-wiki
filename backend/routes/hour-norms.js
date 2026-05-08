const express = require('express');
const { HourNorm, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const RB_TIME_SLUG = 'rb-time';

async function recordHistory(userId, summary) {
  try {
    const page = await Page.findOne({ where: { slug: RB_TIME_SLUG } });
    await PageHistory.create({
      pageId: page ? page.id : null,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: { pageSlug: RB_TIME_SLUG }
    });
  } catch (err) {
    console.error('hour-norms history error:', err.message);
  }
}

// GET /api/hour-norms?year=2026&month=3
// Возвращает нормы часов за указанный месяц
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
// Возвращает список всех периодов (year, month), для которых есть хоть одна запись
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
// Сохраняет (upsert) нормы для набора специальностей за период
// Body: { year, month, norms: [{ professionTitle, normHours }] }
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { year, month, norms } = req.body;
    if (!year || !month || !Array.isArray(norms)) {
      return res.status(400).json({ error: 'year, month и norms обязательны' });
    }

    const records = norms.map(n => ({
      professionTitle: String(n.professionTitle || '').trim(),
      year: parseInt(year),
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

    await recordHistory(req.user.id, `Обновлены нормы часов: ${month}/${year}, специальностей: ${records.length}`);

    res.json({ saved: records.length });
  } catch (err) {
    console.error('hour-norms POST /bulk error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
