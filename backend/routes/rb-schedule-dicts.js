const express = require('express');
const router  = express.Router();
const { RbScheduleCategory, RbScheduleCabinet, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

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
    console.error('rb-schedule-dicts history error:', err.message);
  }
}

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
    await recordHistory(req.user?.id, `Добавлена категория расписания: ${name.trim()}`);
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
    await recordHistory(req.user?.id, `Изменена категория расписания: ${row.name}`);
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
    await recordHistory(req.user?.id, `Удалена категория расписания: ${row.name}`);
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
    await recordHistory(req.user?.id, `Добавлен кабинет: ${name.trim()}`);
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
    await recordHistory(req.user?.id, `Изменён кабинет: ${row.name}`);
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
    await recordHistory(req.user?.id, `Удалён кабинет: ${row.name}`);
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE rb-schedule-dicts/cabinets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
