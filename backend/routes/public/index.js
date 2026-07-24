'use strict';

/**
 * Публичный контур API — единственная часть вики, рассчитанная на вызовы извне.
 *
 * Монтируется в server.js на /api/public ДО общего express.json(), чтобы работал
 * собственный лимит размера тела. Аутентификация здесь своя (ключ внешней системы),
 * JWT внутреннего API не используется.
 */

const express = require('express');
const router = express.Router();

const { auditLog, rateLimitByIp, limitBodySize } = require('../../middleware/publicApi');
const formsRoutes = require('./v1/forms');

// Порядок важен: сначала лог и грубые лимиты, потом разбор тела, потом маршруты
router.use(auditLog());
router.use(limitBodySize(100 * 1024));
router.use(rateLimitByIp(120));
router.use(express.json({ limit: '100kb' }));

// Некорректный JSON — понятная ошибка вместо стандартной HTML-страницы Express
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    res.locals.errorCode = 'invalid_json';
    return res.status(400).json({ ok: false, error: 'invalid_json', message: 'Тело запроса не является корректным JSON' });
  }
  if (err && err.type === 'entity.too.large') {
    res.locals.errorCode = 'payload_too_large';
    return res.status(413).json({ ok: false, error: 'payload_too_large', message: 'Тело запроса слишком большое' });
  }
  next(err);
});

// Проверка доступности контура — без ключа, чтобы разработчик сайта мог убедиться,
// что адрес верный и до нас достучались
router.get('/v1/ping', (req, res) => {
  res.json({ ok: true, service: 'alfa-wiki public api', version: 'v1', time: new Date().toISOString() });
});

router.use('/v1/forms', formsRoutes);

router.use((req, res) => {
  res.locals.errorCode = 'not_found';
  res.status(404).json({ ok: false, error: 'not_found', message: 'Такого метода нет' });
});

module.exports = router;
