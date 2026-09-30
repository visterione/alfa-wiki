'use strict';

/**
 * Статистика → Аналитика → Расписания: дыры в приёме по направлению (ver. 9.17).
 * Логика — services/scheduleCoverage.js.
 *
 * Читать может любой, кто дошёл до раздела: это график работы врачей, а не
 * деньги и не пациенты. Состав группы — общая настройка для всех, кто смотрит
 * отчёт, поэтому менять её можно только с доступом к статистике.
 */

const express = require('express');

const { authenticate } = require('../middleware/auth');
const coverage = require('../services/scheduleCoverage');

const router = express.Router();

const clientError = (msg) => /формате|позже|больше|Не выбрана/.test(msg);

router.get('/professions', authenticate, async (req, res) => {
  try {
    res.json({ professions: await coverage.listProfessions() });
  } catch (err) {
    console.error('❌ Расписания: специальности:', err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get('/report', authenticate, async (req, res) => {
  try {
    const report = await coverage.getReport({
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
      professionId: String(req.query.professionId || ''),
      minGap: Number(req.query.minGap) || 60,
      window: req.query.window ? String(req.query.window) : undefined,
    });
    res.json(report);
  } catch (err) {
    if (!clientError(err.message)) console.error('❌ Расписания: отчёт:', err.message);
    res.status(clientError(err.message) ? 400 : 502).json({ error: err.message });
  }
});

router.put('/exclusions/:professionId', authenticate, async (req, res) => {
  if (!req.user.isAdmin && !req.user.canAccessStatistics) {
    return res.status(403).json({ error: 'Нужен доступ к статистике' });
  }
  try {
    const excluded = await coverage.setExcluded(req.params.professionId, req.body?.userIds);
    res.json({ excluded });
  } catch (err) {
    console.error('❌ Расписания: исключения:', err.message);
    res.status(500).json({ error: 'Не удалось сохранить состав группы' });
  }
});

module.exports = router;
