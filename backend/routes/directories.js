const express = require('express');
const { DirectoriesMeta } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/directories/:type — all records for a given entity type
router.get('/:type', authenticate, async (req, res) => {
  try {
    const records = await DirectoriesMeta.findAll({
      where: { entityType: req.params.type },
    });
    const map = {};
    for (const r of records) map[r.entityId] = r.data;
    res.json(map);
  } catch (err) {
    console.error('directories GET error:', err);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// PUT /api/directories/:type/:id — upsert manual fields for one entity
router.put('/:type/:id', authenticate, async (req, res) => {
  try {
    const { type, id } = req.params;
    const incoming = req.body || {};

    const [record] = await DirectoriesMeta.findOrCreate({
      where: { entityType: type, entityId: id },
      defaults: { data: {} },
    });

    await record.update({ data: { ...record.data, ...incoming } });
    res.json(record.data);
  } catch (err) {
    console.error('directories PUT error:', err);
    res.status(500).json({ error: 'Ошибка сохранения данных' });
  }
});

// POST /api/directories/:type — create a new manual entity (cabinets)
router.post('/:type', authenticate, async (req, res) => {
  try {
    const { type } = req.params;
    const { id, ...data } = req.body || {};
    const entityId = id || `${type}-${Date.now()}`;
    const record = await DirectoriesMeta.create({
      entityType: type,
      entityId,
      data,
    });
    res.status(201).json({ id: record.entityId, ...record.data });
  } catch (err) {
    console.error('directories POST error:', err);
    res.status(500).json({ error: 'Ошибка создания записи' });
  }
});

// DELETE /api/directories/:type/:id — remove a manual entity
router.delete('/:type/:id', authenticate, async (req, res) => {
  try {
    const deleted = await DirectoriesMeta.destroy({
      where: { entityType: req.params.type, entityId: req.params.id },
    });
    if (!deleted) return res.status(404).json({ error: 'Запись не найдена' });
    res.json({ ok: true });
  } catch (err) {
    console.error('directories DELETE error:', err);
    res.status(500).json({ error: 'Ошибка удаления записи' });
  }
});

module.exports = router;
