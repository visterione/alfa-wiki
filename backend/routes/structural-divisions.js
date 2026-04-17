const express = require('express');
const router  = express.Router();
const { StructuralDivision } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/structural-divisions
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await StructuralDivision.findAll({ order: [['name', 'ASC']] });
    res.json(rows);
  } catch (err) {
    console.error('GET structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/structural-divisions
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, doctorIds } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const row = await StructuralDivision.create({ name: name.trim(), doctorIds: doctorIds || [] });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/structural-divisions/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await StructuralDivision.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { name, doctorIds } = req.body;
    await row.update({
      ...(name      !== undefined && { name: name.trim() }),
      ...(doctorIds !== undefined && { doctorIds }),
    });
    res.json(row);
  } catch (err) {
    console.error('PUT structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/structural-divisions/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await StructuralDivision.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
