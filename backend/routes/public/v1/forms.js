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
const fileIntake = require('../../../services/public/fileIntake');
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

/**
 * Формы с файлами приходят как multipart/form-data — их разбирает multer.
 * Форма без файлов идёт обычным JSON, который уже разобран в routes/public/index.js.
 */
function parseFiles(req, res, next) {
  if (!req.form.files?.length) return next();

  fileIntake.uploaderFor(req.form)(req, res, (err) => {
    if (!err) return next();

    // При отказе multer может успеть записать часть файлов — не оставляем их на диске
    Object.values(req.files || {}).flat().forEach(fileIntake.removeFile);

    res.locals.errorCode = 'file_rejected';
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Файл больше ${req.form.limits?.maxFileMb || 5} МБ`
      : err.message;
    return res.status(400).json({ ok: false, error: 'file_rejected', message });
  });
}

// ── Схема формы ───────────────────────────────────────────────────────────
// Отдаём разработчику сайта список полей — чтобы не сверяться с документацией руками.

router.get('/:formType/schema', loadForm, authForForm, (req, res) => {
  const form = req.form;

  res.json({
    ok: true,
    formType: form.formType,
    title: form.title,
    // requiredIf — поле обязательно не всегда, а при условии; описываем это словами
    // (requiredWhen), проверить функцию на стороне сайта всё равно нельзя
    fields: form.fields.map(f => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: Boolean(f.required),
      conditional: Boolean(f.requiredIf),
      requiredWhen: f.requiredWhen || null,
      maxLength: f.max || null,
      values: f.values || null
    })),
    files: (form.files || []).map(f => ({
      key: f.key,
      label: f.label,
      required: Boolean(f.required),
      conditional: Boolean(f.requiredIf),
      requiredWhen: f.requiredWhen || null,
      maxCount: f.maxCount || 1,
      maxSizeMb: f.maxSizeMb || 5,
      mimeTypes: f.mimeTypes || []
    }))
  });
});

// ── Приём заявки ──────────────────────────────────────────────────────────

router.post('/:formType', loadForm, authForForm, rateLimitByClient(), parseFiles, async (req, res) => {
  try {
    const form = req.form;

    const result = fieldValidator.validate(req.body || {}, form.fields, form.validateAll);
    if (!result.ok) {
      // Заявку не приняли — приложенные к ней файлы на диске не оставляем
      Object.values(req.files || {}).flat().forEach(fileIntake.removeFile);

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

    // Файлы проверяем после текстовых полей: обязательность файла зависит от них
    const filesResult = fileIntake.validateFiles(req.files, form, result.value);
    if (!filesResult.ok) {
      res.locals.errorCode = 'validation_failed';
      return res.status(400).json({
        ok: false,
        error: 'validation_failed',
        message: 'Некоторые поля заполнены неверно',
        fields: filesResult.fields
      });
    }

    if (Object.keys(filesResult.attachments || {}).length > 0) {
      result.value.attachments = filesResult.attachments;
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
