const express = require('express');
const router  = express.Router();
const { RbHoliday } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/rb-holidays — list all holidays
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await RbHoliday.findAll({ order: [['date', 'ASC']] });
    res.json(rows);
  } catch (err) {
    console.error('GET rb-holidays error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/rb-holidays — add holiday
router.post('/', authenticate, async (req, res) => {
  try {
    const { date, name } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const row = await RbHoliday.create({ date, name: name?.trim() || null });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Дата уже добавлена' });
    }
    console.error('POST rb-holidays error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/rb-holidays/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await RbHoliday.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE rb-holidays error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
