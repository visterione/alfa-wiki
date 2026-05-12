const express = require('express');
const { ExecutorSettings, RbScheduleCategory } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity, diffExecSettings } = require('../services/rbLogger');

const router = express.Router();

// GET /api/executor-settings?misUserId=xxx
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
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, settings, clinicNames } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });

    const existing = await ExecutorSettings.findOne({ where: { misUserId } });
    const oldSettings = existing ? existing.settings : null;

    await ExecutorSettings.upsert({
      misUserId,
      doctorName: doctorName || '',
      settings: settings || {},
      updatedBy: req.user.id
    }, { conflictFields: ['misUserId'] });

    const categories = await RbScheduleCategory.findAll({ attributes: ['id', 'name'] });
    const roleNames = Object.fromEntries(categories.map(c => [String(c.id), c.name]));

    const diff = oldSettings ? diffExecSettings(oldSettings, settings || {}, clinicNames || {}, roleNames) : null;
    const hasDiff = diff && diff.length > 0;

    await logRbActivity({
      userId:     req.user.id,
      tab:        'executors',
      action:     existing ? 'update' : 'create',
      entityType: 'executor_settings',
      entityId:   misUserId,
      doctorName: doctorName || '',
      misUserId,
      summary:    existing
        ? `Изменены настройки сотрудника: ${doctorName || misUserId}${hasDiff ? ` (${diff.length} изм.)` : ''}`
        : `Добавлен сотрудник: ${doctorName || misUserId}`,
      diff: hasDiff ? { changes: diff } : null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Save executor settings error:', err);
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

// POST /api/executor-settings/reset-all
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
          ...(clinicData.lockedAdvance      ? {} : { advance: 0 }),
          ...(clinicData.lockedMainPayment  ? {} : { mainPayment: 0 }),
          ...(clinicData.lockedFixedSalary  ? {} : { fixedSalary: 0 }),
          ...(clinicData.lockedHourlyRate   ? {} : { hourlyRate: 0 }),
          ...(clinicData.lockedHoursWorked  ? {} : { hoursWorked: 0 }),
          ...(clinicId === 'global' ? {
            cabinets: (clinicData.cabinets || []).filter(c => lockedCabs.includes(c)),
          } : {}),
        };
      }
      await record.update({ settings: { ...s, clinicSettings: newCs } });
    }));

    await logRbActivity({
      userId:  req.user.id,
      tab:     'executors',
      action:  'reset',
      entityType: 'executor_settings_all',
      summary: `Глобальный сброс незафиксированных данных по всем сотрудникам (${all.length} сотр.)`,
    });

    res.json({ ok: true, count: all.length });
  } catch (err) {
    console.error('Reset-all executor settings error:', err);
    res.status(500).json({ error: 'Ошибка сброса настроек' });
  }
});

module.exports = router;
