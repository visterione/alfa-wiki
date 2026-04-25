const express = require('express');
const router  = express.Router();
const { RbScheduleCategory, RbScheduleCabinet } = require('../models');
const { authenticate } = require('../middleware/auth');

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', authenticate, async (req, res) => {
  try {
    const rows = await RbScheduleCategory.findAll({ order: [['name', 'ASC']] });
    res.json(rows);
  } catch (err) {
    console.error('GET rb-schedule-dicts/categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/categories', authenticate, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const row = await RbScheduleCategory.create({ name: name.trim(), color: color || '#94a3b8' });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST rb-schedule-dicts/categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/categories/:id', authenticate, async (req, res) => {
  try {
    const row = await RbScheduleCategory.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { name, color } = req.body;
    await row.update({
      ...(name  !== undefined && { name: name.trim() }),
      ...(color !== undefined && { color }),
    });
    res.json(row);
  } catch (err) {
    console.error('PUT rb-schedule-dicts/categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/categories/:id', authenticate, async (req, res) => {
  try {
    const row = await RbScheduleCategory.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE rb-schedule-dicts/categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Cabinets ──────────────────────────────────────────────────────────────────

router.get('/cabinets', authenticate, async (req, res) => {
  try {
    const rows = await RbScheduleCabinet.findAll({ order: [['clinicId', 'ASC'], ['name', 'ASC']] });
    res.json(rows);
  } catch (err) {
    console.error('GET rb-schedule-dicts/cabinets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/cabinets', authenticate, async (req, res) => {
  try {
    const { name, clinicId } = req.body;
    if (!name || !clinicId) return res.status(400).json({ error: 'name and clinicId required' });
    const row = await RbScheduleCabinet.create({ name: name.trim(), clinicId: String(clinicId) });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST rb-schedule-dicts/cabinets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/cabinets/:id', authenticate, async (req, res) => {
  try {
    const row = await RbScheduleCabinet.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { name, clinicId } = req.body;
    await row.update({
      ...(name     !== undefined && { name: name.trim() }),
      ...(clinicId !== undefined && { clinicId: String(clinicId) }),
    });
    res.json(row);
  } catch (err) {
    console.error('PUT rb-schedule-dicts/cabinets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/cabinets/:id', authenticate, async (req, res) => {
  try {
    const row = await RbScheduleCabinet.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE rb-schedule-dicts/cabinets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
