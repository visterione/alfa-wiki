'use strict';

/**
 * Обмен с Альфа Парсером — сбор отзывов с площадок (ver. 8.80).
 *
 *   GET  /api/public/v1/review-collector/accounts             учётки с паролями и местами
 *   POST /api/public/v1/review-collector/accounts/:id/status  итог входа и найденные места
 *   POST /api/public/v1/review-collector/places/:id/reviews   пачка отзывов места
 *   POST /api/public/v1/review-collector/places/:id/pass      итог прохода: что видели (ver. 8.85)
 *   GET  /api/public/v1/review-collector/jobs                 забрать задачи;
 *        ?kind=input&accountId=… — только ввод удалённого входа этой учётки
 *   POST /api/public/v1/review-collector/jobs/:id             итог задачи
 *   GET  /api/public/v1/review-collector/reply-context        образцы ответов, подпись и контакты
 *        ?boardId=…&platform=…&negative=0|1&exclude=… — для черновиков ответа (ver. 8.88)
 *   GET  /api/public/v1/review-collector/reply-sample?n=30    выборка для проверки качества
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
const { applyPass } = require('../../../services/reviewCollector/removal');
const { replyContext, replySample } = require('../../../services/reviewCollector/replyContext');

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

router.post('/places/:id/pass', handle(async (req) => {
  const { seen, removed, coveredFrom } = req.body || {};
  if (!Array.isArray(seen)) {
    throw Object.assign(new Error('Ожидается массив seen'), { status: 400 });
  }
  return { result: await applyPass(req.params.id, { seen, removed, coveredFrom }) };
}));

router.get('/jobs', handle(async (req) => {
  const kind = req.query.kind === 'input' ? 'input' : null;
  const accountId = kind && UUID_RE.test(String(req.query.accountId || '')) ? req.query.accountId : null;
  if (kind && !accountId) {
    throw Object.assign(new Error('Для ввода нужен accountId'), { status: 400 });
  }
  return {
    jobs: await collector.takeJobs(Math.min(parseInt(req.query.limit, 10) || 20, 100), { kind, accountId }),
  };
}));

router.get('/reply-context', handle(async (req) => {
  const { boardId, platform, negative, exclude } = req.query;
  if (!UUID_RE.test(String(boardId || ''))) {
    throw Object.assign(new Error('Нужен boardId'), { status: 400 });
  }
  return {
    context: await replyContext({
      boardId,
      platform: String(platform || ''),
      negative: negative === '1',
      exclude: UUID_RE.test(String(exclude || '')) ? exclude : null,
    }),
  };
}));

router.get('/reply-sample', handle(async (req) => ({
  reviews: await replySample(Math.min(parseInt(req.query.n, 10) || 30, 60)),
})));

router.post('/jobs/:id', handle(async (req) => {
  await collector.finishJob(req.params.id, req.body || {});
  return {};
}));

module.exports = router;
