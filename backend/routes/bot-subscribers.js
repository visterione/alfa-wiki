/**
 * Статистика ботов и каналов связи (ver. 5.91, переписан на свои данные в 8.02).
 *
 * Источник — наши таблицы: подписчики в bot_subscribers, отправки в
 * notif_outbox. Раньше и то и другое приходило из Fromni выгрузкой, и вкладка
 * «Боты» показывала чужую картину с чужой задержкой. С 7.84 боты наши, с 7.86
 * отправку ведём сами — считать по агрегатору больше незачем.
 *
 * У подписчика есть признак source: 'bot' — пришёл к нашему боту сам,
 * 'import' — достался выгрузкой из Fromni. Разделение осталось намеренно:
 * пока живут обе истории, по нему видно, насколько переезд состоялся.
 */
const express = require('express');
const { sequelize, Setting } = require('../models');
const { authenticate } = require('../middleware/auth');
const { ORGANIZATIONS } = require('../bot/patient/config');

const router = express.Router();

/**
 * Соответствие «клиника МИС → организация». Живёт в настройке notif_clinic_org
 * и заполняется вместе с рассылкой; здесь оно нужно затем же, зачем отправке —
 * визит знает клинику, а боты и счета заведены на организацию.
 */
async function clinicOrgMap() {
  const row = await Setting.findByPk('notif_clinic_org');
  return (row && row.value) || {};
}

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

    // source в разрезе намеренно: 'bot' — человек пришёл к нашему боту сам,
    // 'import' — строка досталась выгрузкой из Fromni. Пока живут обе истории,
    // по этой доле видно, насколько переезд с агрегатора состоялся, и без неё
    // рост «подписчиков» читался бы как заслуга ботов, которой нет.
    const [rows] = await sequelize.query(
      `SELECT organization, platform, source,
              to_char(date_trunc('${gran}', "startedAt"), '${fmt}') AS period,
              COUNT(*)::int AS count
         FROM bot_subscribers
        WHERE ${where.join(' AND ')}
        GROUP BY organization, platform, source, period
        ORDER BY period ASC`,
      { replacements: repl }
    );

    const periods = [...new Set(rows.map(r => r.period))].sort();

    const byOrg = {};
    const byPlatform = { telegram: 0, max: 0 };
    const bySource = { bot: 0, import: 0 };
    let total = 0;
    for (const r of rows) {
      byOrg[r.organization] = (byOrg[r.organization] || 0) + r.count;
      if (byPlatform[r.platform] != null) byPlatform[r.platform] += r.count;
      if (bySource[r.source] != null) bySource[r.source] += r.count;
      total += r.count;
    }

    const organizations = Object.entries(ORGANIZATIONS).map(([key, name]) => ({ key, name }));

    res.json({ periods, granularity: gran, organizations, rows, totals: { byOrg, byPlatform, bySource, total } });
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

// GET /api/bot-subscribers/penetration?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week|month
// Охват среди реальных пациентов: за каждый период берём уникальных пациентов с визитами
// (mis_appointments, кроме отказов status_id=5) и считаем, сколько из них подписаны на боты.
// Подписка определяется по patient_id из bot_subscribers (status='tagged'): категории
// Telegram/MAX проставляются пациенту в МИС при тегировании, платформа хранится в строке.
router.get('/penetration', authenticate, async (req, res) => {
  try {
    const { from, to, granularity } = req.query;

    const FMT = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD', month: 'YYYY-MM' };
    const gran = FMT[granularity] ? granularity : 'day';
    const fmt = FMT[gran];

    const where = [`time_start IS NOT NULL`, `patient_id IS NOT NULL`, `status_id IS DISTINCT FROM 5`];
    const repl = {};
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { repl.from = from; where.push(`time_start >= :from`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { repl.to = to; where.push(`time_start < (:to)::date + interval '1 day'`); }

    const [rows] = await sequelize.query(
      `WITH visits AS (
         SELECT DISTINCT
                to_char(date_trunc('${gran}', time_start), '${fmt}') AS period,
                patient_id
           FROM mis_appointments
          WHERE ${where.join(' AND ')}
       ),
       tg AS (
         SELECT DISTINCT (jsonb_array_elements_text("patientIds"))::int AS pid
           FROM bot_subscribers WHERE platform = 'telegram' AND status = 'tagged'
       ),
       mx AS (
         SELECT DISTINCT (jsonb_array_elements_text("patientIds"))::int AS pid
           FROM bot_subscribers WHERE platform = 'max' AND status = 'tagged'
       )
       SELECT v.period,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE tg.pid IS NOT NULL)::int AS telegram,
              COUNT(*) FILTER (WHERE mx.pid IS NOT NULL)::int AS max,
              COUNT(*) FILTER (WHERE tg.pid IS NOT NULL AND mx.pid IS NOT NULL)::int AS both,
              COUNT(*) FILTER (WHERE tg.pid IS NULL AND mx.pid IS NULL)::int AS none
         FROM visits v
         LEFT JOIN tg ON tg.pid = v.patient_id
         LEFT JOIN mx ON mx.pid = v.patient_id
        GROUP BY v.period
        ORDER BY v.period ASC`,
      { replacements: repl }
    );

    // Итоги за весь период (уникальные пациенты по всему окну, без двойного счёта по дням)
    const [[totals]] = await sequelize.query(
      `WITH visits AS (
         SELECT DISTINCT patient_id FROM mis_appointments WHERE ${where.join(' AND ')}
       ),
       tg AS (
         SELECT DISTINCT (jsonb_array_elements_text("patientIds"))::int AS pid
           FROM bot_subscribers WHERE platform = 'telegram' AND status = 'tagged'
       ),
       mx AS (
         SELECT DISTINCT (jsonb_array_elements_text("patientIds"))::int AS pid
           FROM bot_subscribers WHERE platform = 'max' AND status = 'tagged'
       )
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE tg.pid IS NOT NULL)::int AS telegram,
              COUNT(*) FILTER (WHERE mx.pid IS NOT NULL)::int AS max,
              COUNT(*) FILTER (WHERE tg.pid IS NOT NULL AND mx.pid IS NOT NULL)::int AS both,
              COUNT(*) FILTER (WHERE tg.pid IS NOT NULL OR mx.pid IS NOT NULL)::int AS any
         FROM visits v
         LEFT JOIN tg ON tg.pid = v.patient_id
         LEFT JOIN mx ON mx.pid = v.patient_id`,
      { replacements: repl }
    );

    res.json({ granularity: gran, rows, totals: totals || { total: 0, telegram: 0, max: 0, both: 0, any: 0 } });
  } catch (err) {
    console.error('Bot subscribers penetration error:', err);
    res.status(500).json({ error: 'Ошибка получения охвата пациентов' });
  }
});

// ── Каналы связи (ver. 8.02) ──────────────────────────────────────────────

// Как ступень каскада называется в журнале и кому она принадлежит. Ключ — то,
// что sender кладёт в notif_outbox.channel; порядок массива задаёт порядок в
// отчёте, чтобы наши боты стояли первыми, а платные ступени — следом.
const CHANNEL_META = [
  { key: 'telegram',          title: 'Telegram-бот',   provider: 'Вики',   paid: false },
  { key: 'max',               title: 'MAX-бот',        provider: 'Вики',   paid: false },
  { key: 'imobis:vk',         title: 'ВКонтакте',      provider: 'Имобис', paid: true  },
  { key: 'imobis:viber',      title: 'Viber',          provider: 'Имобис', paid: true  },
  { key: 'imobis:sms',        title: 'SMS',            provider: 'Имобис', paid: true  },
  { key: 'notify+vk',         title: 'Notify и ВК',    provider: 'Fromni', paid: true  },
  { key: 'whatsapp-business', title: 'WhatsApp',       provider: 'Fromni', paid: true  },
  { key: 'viber',             title: 'Viber',          provider: 'Fromni', paid: true  },
  { key: 'sms+webchat',       title: 'SMS',            provider: 'Fromni', paid: true  }
];

/**
 * К какой ступени отнести строку журнала.
 *
 * У Имобиса и у Fromni каскад свой: несколько ступеней уходят одним запросом, и
 * в channel оказывается весь маршрут через «→». Какая из них в итоге доставила,
 * провайдер сообщает не всегда — Fromni не сообщает вовсе, и это ровно та
 * причина, по которой в 7.95 появилась прямая отправка через Имобис.
 *
 * Считаем по первой ступени маршрута: каскад останавливается на первой
 * доставленной, и она же самая частая. Строки с маршрутом из нескольких ступеней
 * возвращаются отдельным счётчиком — чтобы в отчёте было видно, какая доля
 * цифр держится на этом допущении, а не выдавать его за точное знание.
 */
function splitChannel(value) {
  const raw = String(value || '').trim();
  if (!raw) return { key: null, ambiguous: false };

  const steps = raw.split('→').map(s => s.trim()).filter(Boolean);
  return { key: steps[0] || null, ambiguous: steps.length > 1 };
}

// GET /api/bot-subscribers/channels?from=YYYY-MM-DD&to=YYYY-MM-DD
// Чем в действительности доставлялись уведомления: разрез журнала отправок по
// ступеням каскада, медцентрам и событиям.
//
// Источник — наш notif_outbox, а не отчёт агрегатора. До 8.02 вкладка «Боты»
// показывала только подписчиков, и те приходили выгрузкой из Fromni; теперь
// боты наши, отправку ведём сами, и знание о том, что куда ушло, тоже наше.
router.get('/channels', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;

    const where = [`o.status = 'sent'`, `o.channel IS NOT NULL`];
    const repl = {};
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { repl.from = from; where.push(`o.sent_at >= :from`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { repl.to = to; where.push(`o.sent_at < (:to)::date + interval '1 day'`); }

    // Организацию журнал не хранит: она выводится из клиники визита тем же
    // соответствием notif_clinic_org, по которому её выбирает отправка. Держать
    // копию в строке очереди незачем — соответствие меняется, визит нет.
    const [rows] = await sequelize.query(
      `SELECT o.channel, o.event, o.status, o.delivery_status,
              a.clinic_id, a.clinic_name,
              COUNT(*)::int AS count
         FROM notif_outbox o
         LEFT JOIN notif_appointments a ON a.appt_id = o.appt_id
        WHERE ${where.join(' AND ')}
        GROUP BY o.channel, o.event, o.status, o.delivery_status, a.clinic_id, a.clinic_name`,
      { replacements: repl }
    );

    // Промахи считаем отдельно и рядом: доля недоставленного — первое, на что
    // смотрят, когда решают, оставлять ли ступень в каскаде.
    const failWhere = where.map(w => w.replace(`o.status = 'sent'`, `o.status IN ('failed', 'skipped')`));
    const [failed] = await sequelize.query(
      `SELECT o.status, COUNT(*)::int AS count
         FROM notif_outbox o
        WHERE ${failWhere.join(' AND ').replace(`o.channel IS NOT NULL`, 'TRUE')}
        GROUP BY o.status`,
      { replacements: repl }
    );

    const orgMap = await clinicOrgMap();

    const byChannel = new Map();
    const byOrg = {};
    const byEvent = {};
    let total = 0;
    let ambiguous = 0;
    let unknown = 0;

    for (const r of rows) {
      const { key, ambiguous: multi } = splitChannel(r.channel);
      total += r.count;
      if (multi) ambiguous += r.count;

      const slot = key || 'unknown';
      if (!key) unknown += r.count;

      byChannel.set(slot, (byChannel.get(slot) || 0) + r.count);
      byEvent[r.event] = (byEvent[r.event] || 0) + r.count;

      const org = orgMap[String(r.clinic_id)] || 'unknown';
      byOrg[org] = byOrg[org] || { total: 0, channels: {} };
      byOrg[org].total += r.count;
      byOrg[org].channels[slot] = (byOrg[org].channels[slot] || 0) + r.count;
    }

    // Ступени возвращаем в порядке каскада и всегда все: нулевая ступень — тоже
    // ответ на вопрос «а SMS вообще уходят», и пропадать из отчёта она не должна.
    const channels = CHANNEL_META.map(meta => ({
      ...meta,
      count: byChannel.get(meta.key) || 0,
      share: total ? (byChannel.get(meta.key) || 0) / total : 0
    }));

    if (unknown) {
      channels.push({ key: 'unknown', title: 'Прочее', provider: '—', paid: false, count: unknown, share: unknown / total });
    }

    res.json({
      total,
      channels,
      byOrg,
      byEvent,
      ambiguous,
      failed: Object.fromEntries(failed.map(f => [f.status, f.count]))
    });
  } catch (err) {
    console.error('Bot subscribers channels error:', err);
    res.status(500).json({ error: 'Ошибка получения статистики каналов' });
  }
});

module.exports = router;
