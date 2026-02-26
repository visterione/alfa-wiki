const express = require('express');
const { ExecutorSettings } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/executor-settings?misUserId=xxx
// Возвращает settings-объект для врача (или {} если нет записи)
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    const record = await ExecutorSettings.findOne({ where: { misUserId } });
    res.json(record ? record.settings : {});
  } catch (err) {
    console.error('Get executor settings error:', err);
    res.status(500).json({ error: 'Ошибка получения настроек' });
  }
});

// POST /api/executor-settings
// Upsert настроек исполнителя { misUserId, doctorName, settings }
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, settings } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    await ExecutorSettings.upsert({
      misUserId,
      doctorName: doctorName || '',
      settings: settings || {},
      updatedBy: req.user.id
    }, { conflictFields: ['misUserId'] });
    res.json({ ok: true });
  } catch (err) {
    console.error('Save executor settings error:', err);
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

module.exports = router;
