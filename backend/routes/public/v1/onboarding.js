'use strict';

/**
 * Публичный контур анкеты врача.
 *
 *   POST /api/public/v1/onboarding/request-code   — код на почту
 *   POST /api/public/v1/onboarding/verify-code    — обмен кода на заявку
 *   GET  /api/public/v1/onboarding/:token         — черновик
 *   PUT  /api/public/v1/onboarding/:token         — автосохранение
 *   POST /api/public/v1/onboarding/:token/submit  — отправка на согласование
 *   GET/POST .../:token/services                  — выбор услуг после согласования
 *
 * Без авторизации и без API-ключа: анкету заполняет человек, у которого нет и не
 * будет аккаунта в портале. Право предъявляется токеном заявки — он же
 * персональная ссылка из письма.
 *
 * Защита от мусора на публичной ссылке — три вещи сразу: скрытое поле-приманка,
 * лимит по IP (наследуется от routes/public/index.js) и код на почту. Внешнюю
 * капчу не берём: она тянет чужой скрипт, а значит правки CSP и nginx, аккаунт и
 * ключи — ради задачи, которую подтверждение адреса решает лучше. Код заодно
 * гарантирует, что e-mail, по которому считается уникальность заявки, настоящий.
 */

const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');

const router = express.Router();

const {
  OnbApplication, OnbFile, OnbServiceChoice, OnbEmailCode, OnbTask, MedCenter
} = require('../../../models');
const proc = require('../../../services/onboarding/process');
const schema = require('../../../services/onboarding/formSchema');
const validation = require('../../../services/onboarding/validation');
const engine = require('../../../services/onboarding/engine');
const mailer = require('../../../services/onboarding/mailer');
const files = require('../../../services/onboarding/files');
const misVerify = require('../../../services/onboarding/misVerify');
const { misRequest } = require('../../../services/misClient');

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
// Не чаще одного письма в минуту на адрес: кнопка «отправить повторно» не должна
// превращаться в рассылку с нашего домена на чужой ящик.
const CODE_RESEND_MS = 60 * 1000;

function fail(res, status, code, message) {
  res.locals.errorCode = code;
  return res.status(status).json({ ok: false, error: code, message });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashCode(email, code) {
  return crypto.createHash('sha256').update(`${normalizeEmail(email)}:${code}`).digest('hex');
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
}

// ── Справочники для формы ─────────────────────────────────────────────────
//
// Филиалы и специальности нужны до того, как человек что-то заполнил, поэтому
// отдаются без токена. Обе выдачи публичны и так: список клиник висит на сайте,
// перечень специальностей — в записи на приём.
//
// Справочник специальностей кэшируем: ручка открыта без ключа и без токена, а
// каждый её вызов иначе превращается в поход в МИС. Меняется он раз в год, так
// что десять минут задержки здесь ничего не стоят.
const PROFESSIONS_TTL_MS = 10 * 60 * 1000;
let professionsCache = { at: 0, list: [] };

async function loadProfessions() {
  if (Date.now() - professionsCache.at < PROFESSIONS_TTL_MS && professionsCache.list.length) {
    return professionsCache.list;
  }
  try {
    const response = await misRequest('getProfessions', { without_doctors: true });
    if (Number(response?.error) === 0 && Array.isArray(response.data)) {
      const list = response.data
        .filter(p => !p.is_deleted)
        .map(p => ({ id: String(p.id), name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      professionsCache = { at: Date.now(), list };
      return list;
    }
  } catch (error) {
    // Без справочника форму всё равно можно открыть и заполнить остальное —
    // черновик не потеряется. Отдаём последнее, что знали.
    console.warn('[onboarding/public] Специальности из МИС недоступны:', error.message);
  }
  return professionsCache.list;
}

router.get('/meta', async (req, res) => {
  try {
    const centers = await MedCenter.findAll({
      // Публичная анкета предлагает только настоящие работающие филиалы.
      // Состав управляется флагами справочника в админке, без списка названий
      // в коде: АУП, Направители и ИП Микаелян отмечены там как служебные.
      where: { isActive: true, isVirtual: false },
      attributes: ['id', 'name', 'displayName', 'city', 'address'],
      order: [['name', 'ASC']]
    });

    const professions = await loadProfessions();

    res.json({ ok: true, blocks: schema.BLOCKS, steps: schema.STEPS, medCenters: centers, professions });
  } catch (error) {
    console.error('[onboarding/public] meta:', error);
    fail(res, 500, 'server_error', 'Не удалось загрузить справочники');
  }
});

// ── Подтверждение адреса ──────────────────────────────────────────────────

router.post('/request-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    // Поле-приманка: у настоящего посетителя оно скрыто и остаётся пустым.
    // Отвечаем как при успехе — боту незачем знать, что его отсеяли.
    if (req.body?.website) {
      return res.json({ ok: true, sent: true });
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail(res, 400, 'invalid_email', 'Укажите корректный адрес электронной почты');
    }

    const recent = await OnbEmailCode.findOne({
      where: { email, createdAt: { [Op.gt]: new Date(Date.now() - CODE_RESEND_MS) } },
      order: [['createdAt', 'DESC']]
    });
    if (recent) {
      return fail(res, 429, 'too_soon', 'Код уже отправлен. Повторить можно через минуту');
    }

    const code = String(crypto.randomInt(100000, 1000000));
    await OnbEmailCode.create({
      email,
      codeHash: hashCode(email, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      requestIp: clientIp(req)
    });

    const sent = await mailer.sendVerificationCode(email, code);
    if (!sent.success) {
      return fail(res, 502, 'mail_failed', 'Не удалось отправить письмо. Попробуйте позже');
    }

    res.json({ ok: true, sent: true });
  } catch (error) {
    console.error('[onboarding/public] request-code:', error);
    fail(res, 500, 'server_error', 'Не удалось отправить код');
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    if (!email || !code) return fail(res, 400, 'invalid_request', 'Укажите адрес и код');

    const record = await OnbEmailCode.findOne({
      where: { email, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
      order: [['createdAt', 'DESC']]
    });
    if (!record) return fail(res, 400, 'code_expired', 'Код не найден или истёк. Запросите новый');

    if (record.attempts >= CODE_MAX_ATTEMPTS) {
      return fail(res, 429, 'too_many_attempts', 'Слишком много попыток. Запросите новый код');
    }
    if (record.codeHash !== hashCode(email, code)) {
      await record.increment('attempts');
      return fail(res, 400, 'code_invalid', 'Код не подходит');
    }

    await record.update({ usedAt: new Date() });

    // Ключ уникальности — e-mail: если по нему уже есть заявка в работе, вторую
    // не создаём, а пускаем человека продолжать существующую.
    let app = await OnbApplication.findOne({
      where: { email, status: { [Op.in]: proc.ACTIVE_STATUSES } }
    });

    if (!app) {
      app = await OnbApplication.create({
        email,
        accessToken: crypto.randomBytes(24).toString('hex'),
        emailVerifiedAt: new Date()
      });
      await engine.log(app.id, 'created', { ip: clientIp(req) });
      await mailer.sendDraftLink(app);
    } else if (!app.emailVerifiedAt) {
      await app.update({ emailVerifiedAt: new Date() });
    }

    res.json({ ok: true, token: app.accessToken, status: app.status });
  } catch (error) {
    console.error('[onboarding/public] verify-code:', error);
    fail(res, 500, 'server_error', 'Не удалось подтвердить адрес');
  }
});

// ── Работа с заявкой по токену ────────────────────────────────────────────

async function loadApplication(req, res, next) {
  try {
    const token = String(req.params.token || '');
    if (token.length < 16) return fail(res, 404, 'not_found', 'Заявка не найдена');

    const app = await OnbApplication.findOne({ where: { accessToken: token } });
    if (!app) return fail(res, 404, 'not_found', 'Заявка не найдена');

    req.application = app;
    next();
  } catch (error) {
    console.error('[onboarding/public] loadApplication:', error);
    fail(res, 500, 'server_error', 'Не удалось открыть заявку');
  }
}

/** Редактировать анкету можно, только пока она черновик или вернулась на доработку. */
function editable(app) {
  return app.status === proc.STATUS.DRAFT || app.status === proc.STATUS.REVISION;
}

router.get('/:token', loadApplication, async (req, res) => {
  const app = req.application;
  const appFiles = await OnbFile.findAll({ where: { applicationId: app.id } });
  const servicesReady = await servicesStageReady(app);

  // Кто вернул анкету на доработку. Врачу это показывается облачком с аватаркой:
  // безымянное «нужно поправить» выглядит отпиской системы, а замечание от
  // конкретного главврача читают и выполняют.
  let decidedBy = null;
  if (app.status === proc.STATUS.REVISION && app.decidedBy) {
    const { User } = require('../../../models');
    const decider = await User.findByPk(app.decidedBy, {
      attributes: ['displayName', 'username', 'avatar', 'position']
    });
    if (decider) {
      decidedBy = {
        name: decider.displayName || decider.username,
        position: decider.position || 'Главврач',
        avatar: decider.avatar || null
      };
    }
  }

  res.json({
    ok: true,
    application: {
      status: app.status,
      statusLabel: proc.STATUS_LABELS[app.status] || app.status,
      email: app.email,
      medCenterId: app.medCenterId,
      professions: app.professions || [],
      form: app.form || {},
      consents: app.consents || {},
      // Врачу показываются только замечания главврача — остальное решение
      // (кто согласовал, внутренние комментарии) его не касается.
      revisionNote: app.status === proc.STATUS.REVISION ? app.decisionNote : null,
      revisionFields: app.status === proc.STATUS.REVISION ? (app.revisionFields || []) : [],
      revisionAt: app.status === proc.STATUS.REVISION ? app.decidedAt : null,
      revisionBy: decidedBy,
      editable: editable(app),
      servicesReady
    },
    files: appFiles.map(f => ({
      id: f.id, kind: f.kind, originalName: f.originalName, size: f.size,
      url: `/uploads/onboarding/${f.filename}?app=${app.accessToken}`
    })),
    blocks: schema.BLOCKS,
    steps: schema.STEPS,
    consentVersion: schema.CONSENT_VERSION
  });
});

/**
 * Автосохранение. Черновик принимается как есть, без проверки обязательных
 * полей: анкета длинная, её заполняют с телефона в несколько заходов, и
 * требовать полноты на каждом сохранении бессмысленно.
 */
router.put('/:token', loadApplication, async (req, res) => {
  const app = req.application;
  if (!editable(app)) return fail(res, 409, 'not_editable', 'Анкета уже отправлена и не редактируется');

  try {
    const form = { ...(app.form || {}), ...validation.sanitize(req.body?.form || {}) };

    const patch = { form };

    if (req.body?.medCenterId !== undefined) {
      const mc = req.body.medCenterId
        ? await MedCenter.findOne({
            where: {
              id: String(req.body.medCenterId),
              isActive: true,
              isVirtual: false
            },
            attributes: ['id']
          })
        : null;
      patch.medCenterId = mc ? mc.id : null;
    }
    if (Array.isArray(req.body?.professions)) {
      patch.professions = req.body.professions
        .filter(p => p && p.id)
        .slice(0, 10)
        .map(p => ({ id: String(p.id), name: String(p.name || '').slice(0, 200) }));
    }

    // Поля, по которым ищут и маршрутизируют, дублируются в колонки.
    patch.fullName = form.fullName || app.fullName;
    patch.phone = form.phone || app.phone;
    patch.startDate = form.startDate || app.startDate;

    await app.update(patch);
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[onboarding/public] save draft:', error);
    fail(res, 500, 'server_error', 'Не удалось сохранить черновик');
  }
});

/** Фиксация согласий: время, адрес и версия текста, а не просто галочка. */
router.post('/:token/consents', loadApplication, async (req, res) => {
  const app = req.application;
  if (!editable(app)) return fail(res, 409, 'not_editable', 'Анкета уже отправлена');

  const now = new Date().toISOString();
  const ip = clientIp(req);
  const consents = { ...(app.consents || {}) };

  for (const key of ['pd', 'image']) {
    if (req.body?.[key]) {
      consents[key] = { acceptedAt: now, ip, version: schema.CONSENT_VERSION };
    } else {
      delete consents[key];
    }
  }

  await app.update({ consents });
  res.json({ ok: true, consents });
});

// ── Файлы ─────────────────────────────────────────────────────────────────

const upload = files.uploader();

router.post('/:token/files', loadApplication, (req, res, next) => {
  if (!editable(req.application)) return fail(res, 409, 'not_editable', 'Анкета уже отправлена');
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (req.file) files.removeFile(req.file.filename);
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Файл больше ${files.MAX_FILE_MB} МБ`
      : err.message;
    fail(res, 400, 'file_rejected', message);
  });
}, async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'file_missing', 'Файл не приложен');

    const kind = String(req.body?.kind || '');
    if (!Object.values(schema.FILE_FIELDS).includes(kind)) {
      files.removeFile(req.file.filename);
      return fail(res, 400, 'bad_kind', 'Неизвестный тип файла');
    }

    // Портрет один: новый заменяет прежний, иначе маркетологи получат список
    // фотографий и вопрос «какая настоящая».
    if (kind === 'photo') {
      const old = await OnbFile.findAll({ where: { applicationId: req.application.id, kind: 'photo' } });
      for (const file of old) {
        files.removeFile(file.filename);
        await file.destroy();
      }
    }

    const record = await OnbFile.create({
      applicationId: req.application.id,
      kind,
      filename: req.file.filename,
      // multipart отдаёт имя байтами, а multer читает их как latin1 — русское
      // название иначе приезжает крякозябрами.
      originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 255),
      mimeType: req.file.mimetype,
      size: req.file.size
    });

    res.json({
      ok: true,
      file: {
        id: record.id, kind: record.kind, originalName: record.originalName, size: record.size,
        url: `/uploads/onboarding/${record.filename}?app=${req.application.accessToken}`
      }
    });
  } catch (error) {
    console.error('[onboarding/public] upload:', error);
    if (req.file) files.removeFile(req.file.filename);
    fail(res, 500, 'server_error', 'Не удалось сохранить файл');
  }
});

router.delete('/:token/files/:id', loadApplication, async (req, res) => {
  if (!editable(req.application)) return fail(res, 409, 'not_editable', 'Анкета уже отправлена');

  const file = await OnbFile.findOne({
    where: { id: req.params.id, applicationId: req.application.id }
  });
  if (!file) return fail(res, 404, 'not_found', 'Файл не найден');

  files.removeFile(file.filename);
  await file.destroy();
  res.json({ ok: true });
});

// ── Отправка на согласование ──────────────────────────────────────────────

router.post('/:token/submit', loadApplication, async (req, res) => {
  const app = req.application;
  if (!editable(app)) return fail(res, 409, 'not_editable', 'Анкета уже отправлена');

  try {
    const appFiles = await OnbFile.findAll({ where: { applicationId: app.id } });
    const check = validation.validateForSubmit(app, app.form || {}, appFiles);
    const selectedCenter = app.medCenterId
      ? await MedCenter.findOne({
          where: { id: app.medCenterId, isActive: true, isVirtual: false },
          attributes: ['id']
        })
      : null;
    if (app.medCenterId && !selectedCenter && !check.errors.some(item => item.field === 'medCenterId')) {
      check.errors.push({ field: 'medCenterId', message: 'Выберите действующий филиал' });
    }

    if (check.errors.length) {
      res.locals.errorCode = 'validation_failed';
      return res.status(422).json({
        ok: false, error: 'validation_failed',
        message: 'Анкета заполнена не полностью', errors: check.errors
      });
    }

    await engine.submit(app);
    res.json({ ok: true, status: app.status });
  } catch (error) {
    console.error('[onboarding/public] submit:', error);
    fail(res, 500, 'server_error', 'Не удалось отправить анкету');
  }
});

// ── Выбор услуг ───────────────────────────────────────────────────────────

/**
 * Персональная ссылка сама является правом на экран услуг. Ни этап процесса,
 * ни doctor_id, ни полнота старых колонок заявки не должны её блокировать.
 * Закрываем только окончательно остановленные заявки.
 */
function servicesStageDecision({ status }) {
  return ![proc.STATUS.REJECTED, proc.STATUS.CANCELLED].includes(status);
}

async function servicesStageReady(app) {
  return servicesStageDecision({ status: app.status });
}

/**
 * В старых письмах могла остаться ссылка на предыдущую закрытую заявку того же
 * врача. В самой анкете кнопка уже использует новый токен, поэтому получалось:
 * кнопка работает, письмо говорит «заявка закрыта». Для экранов услуг безопасно
 * подхватываем единственную активную заявку подтверждённого e-mail.
 */
async function resolveCurrentServicesApplication(req, res, next) {
  const app = req.application;
  if (servicesStageDecision({ status: app.status })) return next();

  try {
    const current = await OnbApplication.findOne({
      where: {
        email: normalizeEmail(app.email),
        emailVerifiedAt: { [Op.ne]: null },
        status: { [Op.in]: proc.ACTIVE_STATUSES }
      },
      order: [['createdAt', 'DESC']]
    });
    if (current) req.application = current;
    next();
  } catch (error) {
    console.error('[onboarding/public] resolve services application:', error);
    fail(res, 500, 'server_error', 'Не удалось открыть список услуг');
  }
}

router.get('/:token/services', loadApplication, resolveCurrentServicesApplication, async (req, res) => {
  const app = req.application;
  if (!(await servicesStageReady(app))) {
    return fail(res, 409, 'not_available', 'Эта заявка закрыта, выбор услуг недоступен');
  }

  try {
    const catalog = await misVerify.servicesForApplication(app);
    if (!catalog.ok) return fail(res, 502, 'mis_unavailable', catalog.reason);

    const chosen = await OnbServiceChoice.findAll({ where: { applicationId: app.id } });
    const byId = new Map(chosen.filter(c => c.serviceId).map(c => [String(c.serviceId), c]));

    res.json({
      ok: true,
      submitted: chosen.length > 0 && Boolean(await isServicesStepDone(app)),
      services: catalog.services.map(s => {
        const pick = byId.get(String(s.serviceId));
        return {
          ...s,
          chosen: Boolean(pick),
          doctorDuration: pick?.doctorDuration ?? null,
          comment: pick?.comment ?? ''
        };
      }),
      custom: chosen.filter(c => c.isCustom).map(c => ({
        id: c.id, title: c.title, comment: c.comment
      }))
    });
  } catch (error) {
    console.error('[onboarding/public] services:', error);
    fail(res, 500, 'server_error', 'Не удалось загрузить список услуг');
  }
});

async function isServicesStepDone(app) {
  const task = await OnbTask.findOne({
    where: { applicationId: app.id, stepKey: proc.DOCTOR_STEP }
  });
  return Boolean(task?.completedAt);
}

/**
 * Сохранение выбора. Пишем целиком, а не по одной услуге: врач отмечает разделы
 * пачками, и десятки мелких запросов на одном экране — это гарантированные
 * гонки между ними.
 */
router.post('/:token/services', loadApplication, resolveCurrentServicesApplication, async (req, res) => {
  const app = req.application;
  if (!(await servicesStageReady(app))) {
    return fail(res, 409, 'not_ready', 'Выбор услуг сейчас недоступен');
  }
  if (await isServicesStepDone(app)) {
    return fail(res, 409, 'already_submitted', 'Список уже отправлен бухгалтеру');
  }

  try {
    const incoming = Array.isArray(req.body?.services) ? req.body.services : [];
    const custom = Array.isArray(req.body?.custom) ? req.body.custom.slice(0, 50) : [];

    await OnbServiceChoice.destroy({ where: { applicationId: app.id } });

    const rows = incoming
      .filter(s => s && s.serviceId)
      .slice(0, 2000)
      .map(s => ({
        applicationId: app.id,
        serviceId: String(s.serviceId),
        code: s.code ? String(s.code).slice(0, 100) : null,
        title: String(s.title || 'Без названия').slice(0, 500),
        price: s.price != null ? Number(s.price) : null,
        misDuration: s.duration != null ? Number(s.duration) : null,
        doctorDuration: s.doctorDuration != null ? Number(s.doctorDuration) : null,
        comment: s.comment ? String(s.comment).slice(0, 2000) : null,
        isCustom: false
      }));

    for (const item of custom) {
      if (!item?.title) continue;
      rows.push({
        applicationId: app.id,
        serviceId: null,
        title: String(item.title).slice(0, 500),
        comment: item.comment ? String(item.comment).slice(0, 2000) : null,
        isCustom: true
      });
    }

    await OnbServiceChoice.bulkCreate(rows);
    res.json({ ok: true, saved: rows.length });
  } catch (error) {
    console.error('[onboarding/public] save services:', error);
    fail(res, 500, 'server_error', 'Не удалось сохранить выбор');
  }
});

router.post('/:token/services/submit', loadApplication, resolveCurrentServicesApplication, async (req, res) => {
  const app = req.application;
  if (!(await servicesStageReady(app))) {
    return fail(res, 409, 'not_ready', 'Выбор услуг сейчас недоступен');
  }
  if (await isServicesStepDone(app)) {
    return fail(res, 409, 'already_submitted', 'Список уже отправлен бухгалтеру');
  }

  const count = await OnbServiceChoice.count({ where: { applicationId: app.id } });
  if (!count) return fail(res, 422, 'nothing_chosen', 'Отметьте хотя бы одну услугу');

  try {
    // Страховка для старых согласованных заявок, в которых задача врача ещё не
    // была создана. Письмо повторно не отправляем: врач уже пришёл по ссылке.
    const task = await OnbTask.findOne({
      where: { applicationId: app.id, stepKey: proc.DOCTOR_STEP }
    });
    if (!task) await engine.openDoctorServicesTask(app, { notifyDoctor: false });

    await engine.onServicesPicked(app);
    res.json({ ok: true });
  } catch (error) {
    console.error('[onboarding/public] submit services:', error);
    fail(res, 500, 'server_error', 'Не удалось отправить список');
  }
});

module.exports = router;
// Для тестов: доступ к каталогу не должен снова начать зависеть от МИС.
module.exports.servicesStageDecision = servicesStageDecision;
