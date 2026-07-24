'use strict';

/**
 * Приём форм от внешних систем.
 *
 *   POST /api/public/v1/forms/:formType
 *   GET  /api/public/v1/forms/:formType/schema   — описание полей, для разработчика
 *
 * Заголовки:
 *   X-Api-Key: <ключ>            обязательный
 *   Idempotency-Key: <строка>    необязательный; повтор с тем же ключом не создаёт дубль
 *
 * Ответ 202 означает «заявка принята и записана». Доставка в чат идёт следом и,
 * если упадёт, будет повторена кроном.
 */

const express = require('express');
const router = express.Router();

const { apiKeyAuth, rateLimitByClient } = require('../../../middleware/publicApi');
const formRegistry = require('../../../services/public/formRegistry');
const fieldValidator = require('../../../services/public/fieldValidator');
const submissionService = require('../../../services/public/submissionService');

/**
 * Достаёт форму по :formType. 404 отдаём до аутентификации: несуществующий путь
 * не зависит от ключа.
 */
function loadForm(req, res, next) {
  const form = formRegistry.getForm(req.params.formType);
  if (!form) {
    res.locals.errorCode = 'unknown_form';
    return res.status(404).json({
      ok: false,
      error: 'unknown_form',
      message: `Форма «${req.params.formType}» не найдена`,
      availableForms: formRegistry.listFormTypes()
    });
  }
  req.form = form;
  next();
}

/** Проверка ключа именно на эту форму: ключ сайта не должен слать чужие формы. */
function authForForm(req, res, next) {
  return apiKeyAuth(formRegistry.scopeFor(req.params.formType))(req, res, next);
}

// ── Схема формы ───────────────────────────────────────────────────────────
// Отдаём разработчику сайта список полей — чтобы не сверяться с документацией руками.

router.get('/:formType/schema', loadForm, authForForm, (req, res) => {
  const form = req.form;

  res.json({
    ok: true,
    formType: form.formType,
    title: form.title,
    fields: form.fields.map(f => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: Boolean(f.required),
      maxLength: f.max || null,
      values: f.values || null
    }))
  });
});

// ── Приём заявки ──────────────────────────────────────────────────────────

router.post('/:formType', loadForm, authForForm, rateLimitByClient(), async (req, res) => {
  try {
    const form = req.form;

    const result = fieldValidator.validate(req.body || {}, form.fields);
    if (!result.ok) {
      res.locals.errorCode = 'validation_failed';
      return res.status(400).json({
        ok: false,
        error: 'validation_failed',
        message: 'Некоторые поля заполнены неверно',
        fields: result.fields,
        // Подсказка на случай опечатки в названии поля
        unknownFields: result.unknownFields.length ? result.unknownFields : undefined
      });
    }

    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim().slice(0, 100);

    const { submission, duplicate } = await submissionService.acceptSubmission({
      formType:  form.formType,
      payload:   result.value,
      client:    req.apiClient,
      idempotencyKey: idempotencyKey || null,
      sourceIp:  req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
      userAgent: req.headers['user-agent'],
      io:        req.app.get('io')
    });

    return res.status(duplicate ? 200 : 202).json({
      ok: true,
      id: submission.id,
      duplicate,
      delivered: submission.deliveryStatus === 'sent'
    });
  } catch (error) {
    console.error('[public/forms] ошибка приёма заявки:', error);
    res.locals.errorCode = 'internal_error';
    return res.status(500).json({ ok: false, error: 'internal_error', message: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
