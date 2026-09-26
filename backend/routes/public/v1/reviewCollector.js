'use strict';

/**
 * Обмен с Альфа Парсером — сбор отзывов с площадок (ver. 8.80).
 *
 *   GET  /api/public/v1/review-collector/accounts             учётки с паролями и местами
 *   POST /api/public/v1/review-collector/accounts/:id/status  итог входа и найденные места
 *   POST /api/public/v1/review-collector/places/:id/reviews   пачка отзывов места
 *   GET  /api/public/v1/review-collector/jobs                 забрать задачи
 *   POST /api/public/v1/review-collector/jobs/:id             итог задачи
 *
 * Ключ — из «Интеграций», право reviews:collector. Этот ключ открывает пароли
 * всех площадок, поэтому в «Интеграциях» у него стоит задать IP сервера
 * парсера: белый список проверяет apiKeyAuth.
 *
 * Все запросы делает парсер; вики сама к нему не обращается.
 */

const express = require('express');
const router = express.Router();

const { apiKeyAuth, rateLimitByClient } = require('../../../middleware/publicApi');
const collector = require('../../../services/reviewCollector/jobs');
const { ingestPlace } = require('../../../services/reviewCollector/ingest');

const SCOPE = 'reviews:collector';

router.use(apiKeyAuth(SCOPE), rateLimitByClient());

// Номер не в формате UUID PostgreSQL отверг бы ошибкой приведения типа, и
// парсер получил бы 500 вместо честного «не найдено».
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('id', (req, res, next, id) => {
  if (UUID_RE.test(id)) return next();
  res.locals.errorCode = 'not_found';
  res.status(404).json({ ok: false, error: 'not_found', message: 'Не найдено' });
});

function handle(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json({ ok: true, ...data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[review-collector]', err);
      res.locals.errorCode = status >= 500 ? 'internal_error' : 'bad_request';
      res.status(status).json({ ok: false, error: res.locals.errorCode, message: err.message });
    }
  };
}

router.get('/accounts', handle(async () => ({
  accounts: await collector.accountsForCollector(),
})));

router.post('/accounts/:id/status', handle(async (req) => {
  await collector.reportAccountStatus(req.params.id, req.body || {});
  return {};
}));

router.post('/places/:id/reviews', handle(async (req) => {
  const { reviews, passId } = req.body || {};
  if (!Array.isArray(reviews)) {
    throw Object.assign(new Error('Ожидается массив reviews'), { status: 400 });
  }
  return { counts: await ingestPlace(req.params.id, reviews, { passId }) };
}));

router.get('/jobs', handle(async (req) => ({
  jobs: await collector.takeJobs(Math.min(parseInt(req.query.limit, 10) || 20, 100)),
})));

router.post('/jobs/:id', handle(async (req) => {
  await collector.finishJob(req.params.id, req.body || {});
  return {};
}));

module.exports = router;
