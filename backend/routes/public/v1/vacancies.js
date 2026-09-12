'use strict';

/**
 * Публичный контур вакансий (ver. 8.20).
 *
 *   GET  /api/public/v1/vacancies/b/:code          — вакансии филиала (это и есть QR)
 *   POST /api/public/v1/vacancies/request-code     — код на почту
 *   POST /api/public/v1/vacancies/verify-code      — обмен кода на заявку
 *   GET  /api/public/v1/vacancies/a/:token         — анкета и черновик
 *   PUT  /api/public/v1/vacancies/a/:token         — автосохранение
 *   POST /api/public/v1/vacancies/a/:token/files   — файл к полю анкеты
 *   DELETE .../a/:token/files/:id                  — убрать файл
 *   POST /api/public/v1/vacancies/a/:token/submit  — отправка
 *
 * Без авторизации и без API-ключа: анкету заполняет человек, у которого нет и
 * не будет аккаунта в портале. Право предъявляется токеном заявки — он же
 * персональная ссылка из письма.
 *
 * Защита от мусора — три вещи сразу: скрытое поле-приманка, лимит по IP
 * (наследуется от routes/public/index.js) и код на почту. Внешнюю капчу не
 * берём: она тянет чужой скрипт, а значит правки CSP и nginx, аккаунт и ключи —
 * ради задачи, которую подтверждение адреса решает лучше. Код заодно
 * гарантирует, что адрес, по которому считается уникальность отклика,
 * настоящий.
 *
 * Отличие от первого поколения: всё начинается не с почты, а с выбора вакансии.
 * Филиал при этом не спрашивается — он известен из адреса, по которому человек
 * пришёл.
 */

const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');

const router = express.Router();

const {
  VacTemplate, VacVacancy, VacApplication, VacEmailCode, VacFile, VacEvent,
  VacTask, VacServiceChoice, MedCenter
} = require('../../../models');
const formSchema = require('../../../services/vacancies/formSchema');
const mailer = require('../../../services/vacancies/mailer');
const files = require('../../../services/vacancies/files');
const engine = require('../../../services/vacancies/engine');
const misStaff = require('../../../services/misStaff');
const { misRequest } = require('../../../services/misClient');

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
// Не чаще одного письма в минуту на адрес: кнопка «отправить повторно» не
// должна превращаться в рассылку с нашего домена на чужой ящик.
const CODE_RESEND_MS = 60 * 1000;

// Заявка, которую человек ещё ведёт или которая уже в работе. По этому набору
// считается уникальность отклика: повторно откликнуться на ту же вакансию можно
// только после отказа или отмены.
const ACTIVE_STATUSES = ['draft', 'submitted', 'revision', 'in_progress', 'launched'];

const EDITABLE_STATUSES = ['draft', 'revision'];

function fail(res, status, code, message) {
  res.locals.errorCode = code;
  return res.status(status).json({ ok: false, error: code, message });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashCode(email, vacancyId, code) {
  return crypto.createHash('sha256')
    .update(`${normalizeEmail(email)}:${vacancyId}:${code}`)
    .digest('hex');
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
}

async function log(applicationId, action, payload = {}) {
  try {
    await VacEvent.create({ applicationId, action, payload });
  } catch (error) {
    // Журнал не должен ронять сам переход: заявка уже изменилась, и откат
    // сделал бы состояние противоречивым.
    console.error('[vacancies/public] Не удалось записать событие:', error.message);
  }
}

// ── Справочник специальностей ──────────────────────────────────────────────
//
// Кэшируем: ручка открыта без ключа и без токена, а каждый её вызов иначе
// превращается в поход в МИС. Меняется справочник раз в год, так что десять
// минут задержки здесь ничего не стоят.
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
    // Без справочника анкету всё равно можно открыть и заполнить остальное —
    // черновик не потеряется. Отдаём последнее, что знали.
    console.warn('[vacancies/public] Специальности из МИС недоступны:', error.message);
  }
  return professionsCache.list;
}

// ── Вакансии филиала ───────────────────────────────────────────────────────

/**
 * То, что открывается по QR. Черновики шаблонов и закрытые вакансии сюда не
 * попадают: полуготовая анкета, случайно выбранная в вакансии, обернулась бы
 * откликами по полуготовой анкете.
 */
router.get('/b/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return fail(res, 404, 'not_found', 'Филиал не найден');

    const branch = await MedCenter.findOne({
      where: { code, isActive: true, isVirtual: false },
      attributes: ['id', 'name', 'displayName', 'city', 'address']
    });
    if (!branch) return fail(res, 404, 'not_found', 'Филиал не найден');

    const rows = await VacVacancy.findAll({
      where: { medCenterId: branch.id, isOpen: true },
      include: [{
        model: VacTemplate, as: 'template', attributes: ['id', 'isPublished'],
        where: { isPublished: true }, required: true
      }],
      order: [['sortOrder', 'ASC'], ['title', 'ASC']]
    });

    res.json({
      ok: true,
      branch: {
        name: branch.displayName || branch.name,
        city: branch.city || null,
        address: branch.address || null
      },
      vacancies: rows.map(v => ({ id: v.id, title: v.title, description: v.description }))
    });
  } catch (error) {
    console.error('[vacancies/public] branch:', error);
    fail(res, 500, 'server_error', 'Не удалось загрузить вакансии');
  }
});

// ── Подтверждение адреса ───────────────────────────────────────────────────

/** Открытая вакансия по опубликованному шаблону — вместе с самим шаблоном. */
async function loadOpenVacancy(vacancyId) {
  if (!vacancyId) return null;
  return VacVacancy.findOne({
    where: { id: vacancyId, isOpen: true },
    include: [
      { model: VacTemplate, as: 'template', where: { isPublished: true }, required: true },
      { model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName'] }
    ]
  });
}

router.post('/request-code', async (req, res) => {
  try {
    // Поле-приманка: у настоящего посетителя оно скрыто и остаётся пустым.
    // Отвечаем как при успехе — боту незачем знать, что его отсеяли.
    if (req.body?.website) return res.json({ ok: true, sent: true });

    const email = normalizeEmail(req.body?.email);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail(res, 400, 'invalid_email', 'Укажите корректный адрес электронной почты');
    }

    const vacancy = await loadOpenVacancy(req.body?.vacancyId);
    if (!vacancy) return fail(res, 404, 'vacancy_closed', 'Вакансия больше не открыта');

    const recent = await VacEmailCode.findOne({
      where: {
        email,
        vacancyId: vacancy.id,
        createdAt: { [Op.gt]: new Date(Date.now() - CODE_RESEND_MS) }
      },
      order: [['createdAt', 'DESC']]
    });
    if (recent) return fail(res, 429, 'too_soon', 'Код уже отправлен. Повторить можно через минуту');

    const code = String(crypto.randomInt(100000, 1000000));
    await VacEmailCode.create({
      email,
      vacancyId: vacancy.id,
      codeHash: hashCode(email, vacancy.id, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      requestIp: clientIp(req)
    });

    const sent = await mailer.sendVerificationCode(vacancy.template, email, code);
    if (!sent.success) return fail(res, 502, 'mail_failed', 'Не удалось отправить письмо. Попробуйте позже');

    res.json({ ok: true, sent: true });
  } catch (error) {
    console.error('[vacancies/public] request-code:', error);
    fail(res, 500, 'server_error', 'Не удалось отправить код');
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    if (!email || !code) return fail(res, 400, 'invalid_request', 'Укажите адрес и код');

    const vacancy = await loadOpenVacancy(req.body?.vacancyId);
    if (!vacancy) return fail(res, 404, 'vacancy_closed', 'Вакансия больше не открыта');

    const record = await VacEmailCode.findOne({
      where: { email, vacancyId: vacancy.id, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
      order: [['createdAt', 'DESC']]
    });
    if (!record) return fail(res, 400, 'code_expired', 'Код не найден или истёк. Запросите новый');

    if (record.attempts >= CODE_MAX_ATTEMPTS) {
      return fail(res, 429, 'too_many_attempts', 'Слишком много попыток. Запросите новый код');
    }
    if (record.codeHash !== hashCode(email, vacancy.id, code)) {
      await record.increment('attempts');
      return fail(res, 400, 'code_invalid', 'Код не подходит');
    }

    await record.update({ usedAt: new Date() });

    // Уникальность считается по паре «почта + вакансия»: откликаться на
    // несколько вакансий сети один человек вправе, дважды на одну и ту же — нет,
    // и вместо второй заявки его пускаем продолжать первую.
    let app = await VacApplication.findOne({
      where: { email, vacancyId: vacancy.id, status: { [Op.in]: ACTIVE_STATUSES } }
    });

    if (!app) {
      app = await VacApplication.create({
        vacancyId: vacancy.id,
        templateId: vacancy.templateId,
        medCenterId: vacancy.medCenterId,
        email,
        accessToken: crypto.randomBytes(24).toString('hex'),
        emailVerifiedAt: new Date(),
        // Снимок снимается здесь, а не при отправке: черновик заполняют в
        // несколько заходов с телефона, и правка шаблона посреди этого меняла
        // бы форму прямо под руками у человека.
        formSnapshot: vacancy.template.form || { blocks: [], steps: [] }
      });
      await log(app.id, 'created', { ip: clientIp(req), vacancy: vacancy.title });
      await mailer.sendDraftLink(vacancy.template, app, vacancy.title);
    } else if (!app.emailVerifiedAt) {
      await app.update({ emailVerifiedAt: new Date() });
    }

    res.json({ ok: true, token: app.accessToken, status: app.status });
  } catch (error) {
    console.error('[vacancies/public] verify-code:', error);
    fail(res, 500, 'server_error', 'Не удалось подтвердить адрес');
  }
});

// ── Работа с заявкой по токену ─────────────────────────────────────────────

async function loadApplication(req, res, next) {
  try {
    const token = String(req.params.token || '');
    if (token.length < 16) return fail(res, 404, 'not_found', 'Заявка не найдена');

    const app = await VacApplication.findOne({
      where: { accessToken: token },
      include: [
        { model: VacVacancy, as: 'vacancy', attributes: ['id', 'title', 'description'] },
        { model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName'] }
      ]
    });
    if (!app) return fail(res, 404, 'not_found', 'Заявка не найдена');

    req.application = app;
    next();
  } catch (error) {
    console.error('[vacancies/public] loadApplication:', error);
    fail(res, 500, 'server_error', 'Не удалось открыть заявку');
  }
}

function editable(app) {
  return EDITABLE_STATUSES.includes(app.status);
}

/**
 * Анкета кандидата.
 *
 * Схема берётся из снимка заявки, а не из нынешнего шаблона: человек отвечает
 * на ту форму, которую открыл. Справочник специальностей подмешивается, только
 * если такое поле в анкете есть, — у технички ходить в МИС незачем.
 */
router.get('/a/:token', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    const form = app.formSnapshot?.blocks?.length ? app.formSnapshot : { blocks: [], steps: [] };

    const needsProfessions = formSchema.flatFields(form).some(f => f.type === 'professions');
    const professions = needsProfessions ? await loadProfessions() : [];

    const fileRows = await VacFile.findAll({
      where: { applicationId: app.id },
      attributes: ['id', 'fieldKey', 'filename', 'originalName', 'mimeType', 'size']
    });

    res.json({
      ok: true,
      status: app.status,
      editable: editable(app),
      form,
      values: app.form || {},
      files: fileRows,
      professions,
      revisionFields: app.revisionFields || [],
      decisionNote: app.status === 'revision' ? app.decisionNote : null,
      vacancy: app.vacancy ? { title: app.vacancy.title, description: app.vacancy.description } : null,
      branch: app.medCenter ? (app.medCenter.displayName || app.medCenter.name) : null
    });
  } catch (error) {
    console.error('[vacancies/public] read:', error);
    fail(res, 500, 'server_error', 'Не удалось открыть анкету');
  }
});

/**
 * Автосохранение. Черновик принимается как есть, без проверки обязательных
 * полей: анкета длинная, её заполняют с телефона в несколько заходов, и
 * требовать полноты на каждом сохранении бессмысленно.
 */
router.put('/a/:token', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    if (!editable(app)) return fail(res, 409, 'not_editable', 'Анкету уже отправили, менять её нельзя');

    const form = app.formSnapshot;
    const { errors, values } = formSchema.validateAnswers(form, req.body?.values, { partial: true });
    if (errors.length) return fail(res, 400, 'invalid_values', errors[0].message);

    const roles = formSchema.rolesFrom(form, values);
    await app.update({
      form: values,
      fullName: roles.fullName ?? null,
      phone: roles.phone ?? null,
      startDate: roles.startDate ?? null,
      professions: roles.professions ?? []
    });

    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[vacancies/public] save:', error);
    fail(res, 500, 'server_error', 'Не удалось сохранить анкету');
  }
});

// ── Файлы ──────────────────────────────────────────────────────────────────

const receiveFile = files.uploader().single('file');

router.post('/a/:token/files', loadApplication, (req, res, next) => {
  receiveFile(req, res, (error) => {
    if (error) return fail(res, 400, 'upload_failed', error.message);
    next();
  });
}, async (req, res) => {
  try {
    const app = req.application;
    if (!editable(app)) {
      files.removeFile(req.file?.filename);
      return fail(res, 409, 'not_editable', 'Анкету уже отправили, менять её нельзя');
    }
    if (!req.file) return fail(res, 400, 'no_file', 'Файл не получен');

    const fieldKey = String(req.body?.fieldKey || '');
    const field = formSchema.fileFields(app.formSnapshot).find(f => f.key === fieldKey);
    if (!field) {
      files.removeFile(req.file.filename);
      return fail(res, 400, 'unknown_field', 'В анкете нет такого поля');
    }
    if (!files.acceptsFile(field, req.file.mimetype)) {
      files.removeFile(req.file.filename);
      return fail(res, 400, 'wrong_type', `Поле «${field.label}» принимает другой вид файлов`);
    }

    const row = await VacFile.create({
      applicationId: app.id,
      fieldKey,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    });

    res.json({
      ok: true,
      file: {
        id: row.id, fieldKey, filename: row.filename,
        originalName: row.originalName, mimeType: row.mimeType, size: row.size
      }
    });
  } catch (error) {
    console.error('[vacancies/public] upload:', error);
    files.removeFile(req.file?.filename);
    fail(res, 500, 'server_error', 'Не удалось загрузить файл');
  }
});

router.delete('/a/:token/files/:id', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    if (!editable(app)) return fail(res, 409, 'not_editable', 'Анкету уже отправили, менять её нельзя');

    const row = await VacFile.findOne({ where: { id: req.params.id, applicationId: app.id } });
    if (!row) return fail(res, 404, 'not_found', 'Файл не найден');

    files.removeFile(row.filename);
    await row.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/public] delete file:', error);
    fail(res, 500, 'server_error', 'Не удалось удалить файл');
  }
});

// ── Отправка ───────────────────────────────────────────────────────────────

/**
 * Отправка анкеты.
 *
 * Здесь же фиксируются согласия: не галочкой, а фактом — время, адрес и версия
 * текста. Галочка без этого юридически ничего не значит, а через год будет
 * непонятно, под каким именно текстом она стояла.
 *
 * Задача решения ставится отсюда же: это единственный шаг, который открывается
 * не закрытием предыдущего, а действием кандидата.
 */
router.post('/a/:token/submit', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    if (!editable(app)) return fail(res, 409, 'not_editable', 'Анкета уже отправлена');

    const form = app.formSnapshot;
    const { errors, values } = formSchema.validateAnswers(form, req.body?.values ?? app.form, { partial: false });
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_values',
        message: errors[0].message,
        fields: errors.map(e => e.field)
      });
    }

    // Обязательные галочки — это и есть согласия: отдельного списка для них в
    // анкете нет, и заводить второй способ спрашивать то же самое незачем.
    const consentFields = formSchema.flatFields(form)
      .filter(f => f.type === 'checkbox' && f.required);

    const consents = {
      version: form.consentVersion || null,
      at: new Date().toISOString(),
      ip: clientIp(req),
      items: consentFields.map(f => ({ key: f.key, label: f.label }))
    };

    const roles = formSchema.rolesFrom(form, values);

    await app.update({
      form: values,
      consents,
      status: 'submitted',
      submittedAt: new Date(),
      // Пометки прошлой доработки сняты: человек прислал исправленное, и
      // подсвечивать ему те же поля второй раз неправильно.
      revisionFields: [],
      fullName: roles.fullName ?? null,
      phone: roles.phone ?? null,
      startDate: roles.startDate ?? null,
      professions: roles.professions ?? []
    });

    await log(app.id, 'submitted', { ip: clientIp(req) });
    await engine.onSubmitted(app);

    const template = await VacTemplate.findByPk(app.templateId);
    await mailer.sendSubmitted(template, app, app.vacancy?.title);

    res.json({ ok: true, status: app.status });
  } catch (error) {
    console.error('[vacancies/public] submit:', error);
    fail(res, 500, 'server_error', 'Не удалось отправить анкету');
  }
});

// ── Выбор услуг ────────────────────────────────────────────────────────────
//
// Шаг, который кандидат закрывает сам: он отмечает по прайсу, что готов
// оказывать, и при необходимости правит длительность приёма. Отдельный экран, а
// не блок анкеты, потому что список приходит из МИС и появляется только после
// согласования — до него прайс по специальности запрашивать не у кого.

/** Шаг выбора услуг этого шаблона, если он вообще есть в процессе. */
async function servicesStep(app) {
  const template = await VacTemplate.findByPk(app.templateId, { attributes: ['id', 'process'] });
  return (template?.process?.steps || []).find(s => s.kind === 'services_pick' && !s.archived) || null;
}

/**
 * Открыт ли экран.
 *
 * Правом является сама персональная ссылка, поэтому проверяем только то, что
 * действительно мешает: заявка окончательно остановлена, шага в процессе нет
 * или очередь до него ещё не дошла.
 */
async function servicesGate(app) {
  if (['rejected', 'cancelled'].includes(app.status)) {
    return { ok: false, code: 'closed', message: 'Эта заявка закрыта' };
  }
  const step = await servicesStep(app);
  if (!step) return { ok: false, code: 'no_step', message: 'По этой вакансии услуги выбирать не нужно' };

  const task = await VacTask.findOne({ where: { applicationId: app.id, stepKey: step.key } });
  if (!task) {
    return { ok: false, code: 'not_ready', message: 'Анкета ещё на рассмотрении — мы напишем, когда дойдёт очередь' };
  }
  return { ok: true, step, task, submitted: Boolean(task.completedAt) };
}

router.get('/a/:token/services', loadApplication, async (req, res) => {
  const app = req.application;
  const gate = await servicesGate(app);
  if (!gate.ok) return fail(res, 409, gate.code, gate.message);

  try {
    const catalog = await misStaff.servicesForApplication(app);
    if (!catalog.ok) return fail(res, 502, 'mis_unavailable', catalog.reason);

    const chosen = await VacServiceChoice.findAll({ where: { applicationId: app.id } });
    const byId = new Map(chosen.filter(c => c.serviceId).map(c => [String(c.serviceId), c]));

    res.json({
      ok: true,
      submitted: gate.submitted,
      vacancy: app.vacancy ? { title: app.vacancy.title } : null,
      services: catalog.services.map(s => {
        const pick = byId.get(String(s.serviceId));
        return {
          ...s,
          chosen: Boolean(pick),
          doctorDuration: pick?.doctorDuration ?? null,
          comment: pick?.comment ?? ''
        };
      }),
      custom: chosen.filter(c => c.isCustom).map(c => ({ id: c.id, title: c.title, comment: c.comment }))
    });
  } catch (error) {
    console.error('[vacancies/public] services:', error);
    fail(res, 500, 'server_error', 'Не удалось загрузить список услуг');
  }
});

/**
 * Сохранение выбора. Пишем целиком, а не по одной услуге: человек отмечает
 * разделы пачками, и десятки мелких запросов на одном экране — это
 * гарантированные гонки между ними.
 */
router.post('/a/:token/services', loadApplication, async (req, res) => {
  const app = req.application;
  const gate = await servicesGate(app);
  if (!gate.ok) return fail(res, 409, gate.code, gate.message);
  if (gate.submitted) return fail(res, 409, 'already_submitted', 'Список уже отправлен');

  try {
    const incoming = Array.isArray(req.body?.services) ? req.body.services : [];
    const custom = Array.isArray(req.body?.custom) ? req.body.custom.slice(0, 50) : [];

    await VacServiceChoice.destroy({ where: { applicationId: app.id } });

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

    await VacServiceChoice.bulkCreate(rows);
    res.json({ ok: true, saved: rows.length });
  } catch (error) {
    console.error('[vacancies/public] save services:', error);
    fail(res, 500, 'server_error', 'Не удалось сохранить выбор');
  }
});

router.post('/a/:token/services/submit', loadApplication, async (req, res) => {
  const app = req.application;
  const gate = await servicesGate(app);
  if (!gate.ok) return fail(res, 409, gate.code, gate.message);
  if (gate.submitted) return fail(res, 409, 'already_submitted', 'Список уже отправлен');

  const count = await VacServiceChoice.count({ where: { applicationId: app.id } });
  if (!count) return fail(res, 422, 'nothing_chosen', 'Отметьте хотя бы одну услугу');

  try {
    await engine.onServicesPicked(app);
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/public] submit services:', error);
    fail(res, 500, 'server_error', 'Не удалось отправить список');
  }
});

module.exports = router;
