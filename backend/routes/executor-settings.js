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

// POST /api/executor-settings/reset-all
// Сбрасывает все незафиксированные (locked !== true) записи у ВСЕХ врачей
router.post('/reset-all', authenticate, async (req, res) => {
  try {
    const all = await ExecutorSettings.findAll();
    const resetSection = (arr) => (arr || []).filter(it => it.locked === true);

    await Promise.all(all.map(async record => {
      const s = record.settings || {};
      const cs = s.clinicSettings || {};
      const newCs = {};
      for (const [clinicId, clinicData] of Object.entries(cs)) {
        const lockedCabs = clinicData.lockedCabinets || [];
        newCs[clinicId] = {
          ...clinicData,
          deductions:      resetSection(clinicData.deductions),
          materials:       resetSection(clinicData.materials),
          serviceMaterials: resetSection(clinicData.serviceMaterials),
          extras:          resetSection(clinicData.extras),
          ...(clinicId === 'global' ? {
            cabinets: (clinicData.cabinets || []).filter(c => lockedCabs.includes(c)),
          } : {}),
        };
      }
      await record.update({ settings: { ...s, clinicSettings: newCs } });
    }));

    res.json({ ok: true, count: all.length });
  } catch (err) {
    console.error('Reset-all executor settings error:', err);
    res.status(500).json({ error: 'Ошибка сброса настроек' });
  }
});

module.exports = router;
