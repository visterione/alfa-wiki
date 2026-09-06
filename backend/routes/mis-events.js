'use strict';

/**
 * Приёмник событий от МИС (ver. 7.88).
 *
 * В админке Renovatio есть настройка «уведомления о событиях»: название, адрес
 * обращения и событие из списка. Это второй конец моста — тот самый, через
 * который у Fromni работали лабораторные уведомления. Готовность результатов
 * через публичное API не спросить (getPatientLabResults требует patient_key,
 * выдаваемый только по логину пациента), но спрашивать и не нужно: МИС
 * рассказывает сама.
 *
 * Пока задача одна — записать присланное как есть. Формат тела нам неизвестен, и
 * гадать о нём по документации мы уже пробовали: getAppointmentsV2 стоил нам
 * вечера пустых подстановок. Разбирать начнём, увидев настоящий запрос.
 *
 * Адрес открыт наружу без авторизации: МИС ходит без нашего токена. Защищает его
 * секрет в самом пути — он же отличает событие от события, потому что в
 * настройке Renovatio одна запись = одно событие.
 */

const express = require('express');
const { MisEvent } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Чем именно ходит Renovatio — JSON, формой или простым текстом, — мы не знаем.
// Поэтому разбираем любое тело: непрочитанное тело означало бы пустую запись и
// ещё один заход на те же грабли.
router.use(express.json({ limit: '2mb' }));
router.use(express.urlencoded({ extended: true, limit: '2mb' }));
router.use(express.text({ type: '*/*', limit: '2mb' }));

const SECRET = process.env.MIS_EVENTS_SECRET || '';

// Заголовки храним не все: cookie и авторизация в журнале не нужны, а вот тип
// содержимого и подпись, если она есть, — нужны.
const KEEP_HEADERS = ['content-type', 'user-agent', 'x-signature', 'x-api-key', 'authorization'];

function pickHeaders(req) {
  const out = {};
  for (const name of KEEP_HEADERS) {
    const value = req.get(name);
    if (value) out[name] = name === 'authorization' ? '(есть)' : value;
  }
  return out;
}

/**
 * Приём. Отвечаем 200 всегда, когда секрет сошёлся: МИС не должна копить
 * неудачные попытки из-за того, что мы ещё не научились разбирать её формат.
 *
 * Путь: /api/mis-events/<секрет>/<имя события>
 */
router.all('/:secret/:event?', async (req, res) => {
  if (!SECRET || req.params.secret !== SECRET) {
    return res.status(404).send('Not found');
  }

  try {
    await MisEvent.create({
      event: req.params.event || null,
      body: req.body && typeof req.body === 'object' ? req.body : { raw: String(req.body || '') },
      headers: pickHeaders(req),
      method: req.method,
      query: req.query || {},
      // За nginx настоящий адрес приходит заголовком; пригодится, чтобы
      // убедиться, что зовёт действительно МИС.
      remoteAddr: req.get('x-real-ip') || req.get('x-forwarded-for') || req.ip
    });

    console.log(`[mis-events] ${req.method} «${req.params.event || 'без имени'}» принято`);
  } catch (err) {
    console.error('[mis-events] не смог записать событие:', err.message);
  }

  res.status(200).json({ ok: true });
});

/** Просмотр принятого — администратору. */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await MisEvent.findAll({
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 20, 100)
    });
    res.json(rows);
  } catch (err) {
    console.error('[mis-events] GET /:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
