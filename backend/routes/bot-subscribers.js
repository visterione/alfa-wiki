/**
 * Статистика подписчиков ботов (Telegram/MAX) по медцентрам.
 * Источник — таблица bot_subscribers (наполняется синком из Fromni).
 */
const express = require('express');
const { sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { ORGANIZATIONS } = require('../bot/patient/config');

const router = express.Router();

// GET /api/bot-subscribers/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=telegram|max&granularity=day|month
// Подписки по периодам (по дате подписки startedAt), только помеченные (tagged).
// from/to принимают YYYY-MM-DD или YYYY-MM (месяц целиком). granularity: 'day' | 'month' (по умолч. month).
router.get('/stats', authenticate, async (req, res) => {
  try {
    const { from, to, platform, granularity } = req.query;

    const FMT = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD', month: 'YYYY-MM' };
    const gran = FMT[granularity] ? granularity : 'month';
    const fmt = FMT[gran];

    // tagged — опознанные в МИС; web — номерной telegram (без МИС), подмешиваем в счётчик Telegram
    const where = [`status IN ('tagged', 'web')`, `"startedAt" IS NOT NULL`];
    const repl = {};

    if (from && /^\d{4}-\d{2}(-\d{2})?$/.test(from)) {
      repl.from = /^\d{4}-\d{2}$/.test(from) ? `${from}-01` : from;
      where.push(`"startedAt" >= :from`);
    }
    if (to && /^\d{4}-\d{2}(-\d{2})?$/.test(to)) {
      if (/^\d{4}-\d{2}$/.test(to)) { repl.to = `${to}-01`; where.push(`"startedAt" < (:to)::date + interval '1 month'`); }
      else { repl.to = to; where.push(`"startedAt" < (:to)::date + interval '1 day'`); }
    }
    if (platform === 'telegram' || platform === 'max') { where.push(`platform = :platform`); repl.platform = platform; }

    const [rows] = await sequelize.query(
      `SELECT organization, platform,
              to_char(date_trunc('${gran}', "startedAt"), '${fmt}') AS period,
              COUNT(*)::int AS count
         FROM bot_subscribers
        WHERE ${where.join(' AND ')}
        GROUP BY organization, platform, period
        ORDER BY period ASC`,
      { replacements: repl }
    );

    const periods = [...new Set(rows.map(r => r.period))].sort();

    const byOrg = {};
    const byPlatform = { telegram: 0, max: 0 };
    let total = 0;
    for (const r of rows) {
      byOrg[r.organization] = (byOrg[r.organization] || 0) + r.count;
      if (byPlatform[r.platform] != null) byPlatform[r.platform] += r.count;
      total += r.count;
    }

    const organizations = Object.entries(ORGANIZATIONS).map(([key, name]) => ({ key, name }));

    res.json({ periods, granularity: gran, organizations, rows, totals: { byOrg, byPlatform, total } });
  } catch (err) {
    console.error('Bot subscribers stats error:', err);
    res.status(500).json({ error: 'Ошибка получения статистики подписчиков' });
  }
});

// GET /api/bot-subscribers/overlap?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=telegram|max
// Распределение подписчиков по числу разных медцентров, на боты которых они подписаны.
// Идентификация человека — по нормализованному телефону (объединяет Telegram и MAX),
// поэтому считаем только опознанных (status='tagged', есть телефон).
// Фильтр периода — по дате подписки (startedAt), как в /stats: считаем медцентры,
// на которые человек подписался в рамках выбранного окна.
router.get('/overlap', authenticate, async (req, res) => {
  try {
    const { from, to, platform } = req.query;

    const where = [`status = 'tagged'`, `phone IS NOT NULL`, `phone <> ''`, `"startedAt" IS NOT NULL`];
    const repl = {};
    if (from && /^\d{4}-\d{2}(-\d{2})?$/.test(from)) {
      repl.from = /^\d{4}-\d{2}$/.test(from) ? `${from}-01` : from;
      where.push(`"startedAt" >= :from`);
    }
    if (to && /^\d{4}-\d{2}(-\d{2})?$/.test(to)) {
      if (/^\d{4}-\d{2}$/.test(to)) { repl.to = `${to}-01`; where.push(`"startedAt" < (:to)::date + interval '1 month'`); }
      else { repl.to = to; where.push(`"startedAt" < (:to)::date + interval '1 day'`); }
    }
    if (platform === 'telegram' || platform === 'max') { where.push(`platform = :platform`); repl.platform = platform; }

    const [rows] = await sequelize.query(
      `WITH per_person AS (
         SELECT phone, COUNT(DISTINCT organization) AS centers
           FROM bot_subscribers
          WHERE ${where.join(' AND ')}
          GROUP BY phone
       )
       SELECT centers::int AS centers, COUNT(*)::int AS subscribers
         FROM per_person
        GROUP BY centers
        ORDER BY centers ASC`,
      { replacements: repl }
    );

    const maxCenters = Object.keys(ORGANIZATIONS).length;
    // Плотное распределение 1..maxCenters (нули для отсутствующих корзин)
    const byCount = Object.fromEntries(rows.map(r => [r.centers, r.subscribers]));
    const distribution = Array.from({ length: maxCenters }, (_, i) => ({
      centers: i + 1,
      subscribers: byCount[i + 1] || 0,
    }));

    const totalPeople = distribution.reduce((s, d) => s + d.subscribers, 0);
    const multiCenter = distribution.reduce((s, d) => s + (d.centers > 1 ? d.subscribers : 0), 0);
    const memberships = distribution.reduce((s, d) => s + d.centers * d.subscribers, 0);

    res.json({
      distribution,
      totalPeople,
      multiCenter,
      avgCenters: totalPeople ? memberships / totalPeople : 0,
    });
  } catch (err) {
    console.error('Bot subscribers overlap error:', err);
    res.status(500).json({ error: 'Ошибка получения статистики экосистемы' });
  }
});

module.exports = router;
