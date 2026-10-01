'use strict';

/**
 * Статистика → Аналитика → Расписания: дыры в приёме по направлению (ver. 9.17).
 * Логика — services/scheduleCoverage.js.
 *
 * Читать может любой, кто дошёл до раздела: это график работы врачей, а не
 * деньги и не пациенты. Кого из врачей считать, с 9.19 решает сам смотрящий —
 * выбор живёт в его браузере и приходит параметром exclude. Общий список
 * исключений, который до этого писался отсюда же, больше не меняется: им
 * сравнивали бы отдельных врачей, и отчёт поменялся бы у всех коллег.
 */

const express = require('express');

const { authenticate } = require('../middleware/auth');
const coverage = require('../services/scheduleCoverage');

const router = express.Router();

const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const clientError = (msg) => /формате|позже|больше|Не выбрана/.test(msg);

router.get('/professions', authenticate, async (req, res) => {
  try {
    res.json(await coverage.listProfessions());
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
      professionIds: list(req.query.professionIds ?? req.query.professionId),
      exclude: req.query.exclude === undefined ? undefined : list(req.query.exclude),
      minGap: Number(req.query.minGap) || 60,
      window: req.query.window ? String(req.query.window) : undefined,
    });
    res.json(report);
  } catch (err) {
    if (!clientError(err.message)) console.error('❌ Расписания: отчёт:', err.message);
    res.status(clientError(err.message) ? 400 : 502).json({ error: err.message });
  }
});

module.exports = router;
