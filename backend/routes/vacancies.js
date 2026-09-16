'use strict';

/**
 * Настройка раздела «Вакансии» (ver. 8.20, переработано в 8.21 и 8.34).
 *
 * Рабочая единица одна — вакансия: анкета, процесс, письма, исполнители и чаты
 * лежат в ней самой и правятся на одном экране. В 8.20 между вакансией и
 * анкетой стоял шаблон, и чтобы завести одну должность, приходилось ходить по
 * двум страницам; этот слой убран в 8.21.
 *
 * В 8.34 шаблон вернулся, но не слоем, а заготовкой: вакансия берёт из него
 * КОПИЮ анкеты, процесса, писем и приложенных файлов и дальше живёт сама по
 * себе, ссылки на шаблон не храня. Отсюда и вся разница в коде — у шаблона нет
 * ни состояния набора, ни филиала, ни исполнителей, а его правка ничего не
 * меняет в уже заведённых вакансиях.
 *
 * Право — полный админ. Ежедневная работа с заявками и задачами живёт в
 * routes/vacancyWork.js и доступна ещё и назначенным исполнителям: задача без
 * возможности её открыть бессмысленна.
 */

const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');

const router = express.Router();

const {
  VacVacancy, VacTemplate, VacAttachment, VacApplication, VacAssignment, VacTask, VacChatLink,
  MedCenter, User
} = require('../models');
const { authenticate } = require('../middleware/auth');
const formSchema = require('../services/vacancies/formSchema');
const processSchema = require('../services/vacancies/processSchema');
const priceCatalogue = require('../services/vacancies/priceCatalogue');
const chatLinks = require('../services/vacancies/chatLinks');
const attachments = require('../services/vacancies/attachments');
const mailer = require('../services/vacancies/mailer');
const links = require('../services/vacancies/links');

const USER_FIELDS = ['id', 'displayName', 'username', 'avatar', 'position', 'isActive'];

/** Настоящие работающие филиалы: «АУП» и «Направители» — служебные группировки. */
const REAL_BRANCHES = { isActive: true, isVirtual: false };

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа к настройке раздела' });
  next();
}

router.use(authenticate, requireAdmin);

/**
 * Короткий код прямой ссылки. Восемь знаков шестнадцатеричного алфавита: в нём
 * нет ни O, ни l, ни I, и код можно продиктовать голосом.
 */
async function freshCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = crypto.randomBytes(4).toString('hex');
    if (!await VacVacancy.count({ where: { publicCode: code } })) return code;
  }
  // Восемь подряд совпадений на четырёх байтах — это не случайность, а
  // поломка; молча отдать девятый вариант было бы хуже, чем упасть.
  throw new Error('Не удалось подобрать свободный код вакансии');
}

/** Ключи шагов, по которым у вакансии уже заведены задачи. */
async function stepKeysInUse(vacancyId) {
  const rows = await VacTask.findAll({
    attributes: ['stepKey'],
    group: ['stepKey'],
    include: [{
      model: VacApplication, as: 'application', attributes: [], required: true,
      where: { vacancyId }
    }]
  });
  return new Set(rows.map(r => r.stepKey));
}

/**
 * С чего начинается пустая вакансия или пустой шаблон.
 *
 * Не с чистого листа: пустой экран не подсказывает, с чего начать, а поле с
 * ролью «ФИО» и шаг решения обязаны быть в любом случае — без них набор всё
 * равно не открыть. Заодно заготовка сразу проходит проверку, и человек видит
 * рабочий пример структуры, а не список требований.
 */
function starterForm() {
  return {
    blocks: [{
      key: 'main',
      title: 'Основное',
      fields: [{ key: 'fullName', label: 'ФИО', type: 'text', role: 'fullName', required: true, max: 255 }]
    }],
    steps: [{ key: 'about', title: 'О себе', blocks: ['main'] }]
  };
}

function starterProcess() {
  return {
    steps: [{
      key: 'decision',
      title: 'Решение по анкете',
      hint: 'Единственная точка, где процесс может встать целиком.',
      kind: 'decision',
      scope: 'branch',
      after: [],
      slaHours: 24,
      checklist: 'Анкета согласована'
    }]
  };
}

/**
 * Тексты писем к сохранению.
 *
 * Пустое значение — не «письмо без текста», а «берём умолчание»: так человек
 * может стереть свою правку и вернуться к исходному тексту, не вспоминая его.
 * Поэтому совпавшее с умолчанием в базу не пишется вовсе.
 */
function cleanEmails(incoming) {
  const source = incoming && typeof incoming === 'object' ? incoming : {};
  const clean = {};

  for (const key of Object.keys(mailer.LETTERS)) {
    const own = source[key];
    if (!own || typeof own !== 'object') continue;
    const part = {};
    for (const field of ['subject', 'title', 'body']) {
      const value = String(own[field] ?? '').trim().slice(0, field === 'body' ? 4000 : 200);
      if (value && value !== mailer.LETTERS[key][field]) part[field] = value;
    }
    if (Object.keys(part).length) clean[key] = part;
  }
  return clean;
}

// ── Справочники ────────────────────────────────────────────────────────────

/**
 * Чем бывает поле, какие у него бывают роли, какие бывают шаги и письма.
 *
 * Отдаётся с сервера, а не зашито в редактор, по той же причине, по которой так
 * устроено публичное API портала: реестр один, и второй его список на фронте
 * разошёлся бы с первым на ближайшей правке.
 */
router.get('/meta', (req, res) => {
  res.json({
    fieldTypes: Object.entries(formSchema.FIELD_TYPES).map(([key, spec]) => ({
      key,
      label: spec.label,
      lengthMax: Boolean(spec.lengthMax),
      numeric: Boolean(spec.numeric),
      accept: Boolean(spec.accept),
      external: Boolean(spec.external)
    })),
    fieldRoles: Object.entries(formSchema.FIELD_ROLES).map(([key, spec]) => ({
      key, label: spec.label, hint: spec.hint || null,
      types: spec.types, required: Boolean(spec.required)
    })),
    stepKinds: Object.entries(processSchema.STEP_KINDS).map(([key, spec]) => ({
      key, label: spec.label, hint: spec.hint || null,
      unique: Boolean(spec.unique), assignee: Boolean(spec.assignee),
      requiresRole: spec.requiresRole || [], forcedScope: spec.forcedScope || null
    })),
    scopes: Object.entries(processSchema.SCOPES).map(([key, spec]) => ({ key, label: spec.label })),
    letters: Object.entries(mailer.LETTERS).map(([key, spec]) => ({
      key, name: spec.name, subject: spec.subject, title: spec.title, body: spec.body
    })),
    // Наши файлы у поля анкеты (ver. 8.34): сколько их можно повесить и что
    // вообще принимается. Редактор пишет об этом человеку до выбора файла, а не
    // после отказа.
    attachments: {
      max: formSchema.MAX_ATTACHMENTS,
      maxSizeMb: attachments.MAX_FILE_MB,
      hint: attachments.ACCEPT_HINT
    }
  });
});

router.get('/med-centers', async (req, res) => {
  try {
    const rows = await MedCenter.findAll({
      where: REAL_BRANCHES,
      attributes: ['id', 'name', 'code', 'color', 'logoUrl', 'city', 'address'],
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json(rows);
  } catch (error) {
    console.error('[vacancies] med-centers:', error);
    res.status(500).json({ error: 'Не удалось загрузить медцентры' });
  }
});

/**
 * Ссылка и QR филиала — то, что печатают и вешают в регистратуре. Ведёт на
 * список вакансий медцентра.
 */
router.get('/materials/:code', async (req, res) => {
  try {
    const branch = await MedCenter.findOne({
      where: { code: req.params.code, ...REAL_BRANCHES },
      attributes: ['id', 'name', 'code']
    });
    if (!branch) return res.status(404).json({ error: 'Филиал не найден' });

    const materials = await links.branchMaterials(branch.code);
    res.json({ branch: { id: branch.id, name: branch.name, code: branch.code }, ...materials });
  } catch (error) {
    console.error('[vacancies] materials:', error);
    res.status(500).json({ error: 'Не удалось собрать материалы' });
  }
});

// ── Вакансии ───────────────────────────────────────────────────────────────
//
// Ресурс называется openings, а не vacancies: раздел и так смонтирован на
// /api/vacancies, и «/vacancies/vacancies» читалось бы как опечатка.

router.get('/openings', async (req, res) => {
  try {
    const rows = await VacVacancy.findAll({
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'code', 'color'] }],
      order: [['sortOrder', 'ASC'], ['title', 'ASC']]
    });

    const counts = await VacApplication.count({
      where: { vacancyId: rows.map(r => r.id) },
      group: ['vacancyId']
    });
    const byVacancy = new Map(counts.map(r => [r.vacancyId, Number(r.count)]));

    res.json(rows.map(v => ({
      id: v.id,
      title: v.title,
      description: v.description,
      status: v.status,
      publicCode: v.publicCode,
      blockCount: Array.isArray(v.form?.blocks) ? v.form.blocks.length : 0,
      stepCount: Array.isArray(v.process?.steps) ? v.process.steps.length : 0,
      applicationCount: byVacancy.get(v.id) || 0,
      medCenter: v.medCenter,
      updatedAt: v.updatedAt
    })));
  } catch (error) {
    console.error('[vacancies] openings:', error);
    res.status(500).json({ error: 'Не удалось загрузить вакансии' });
  }
});

/**
 * Новая вакансия — с шаблона либо с заготовки.
 *
 * Шаблон необязателен и ничем себя дальше не проявляет: вакансия получает
 * КОПИЮ его анкеты, процесса, писем и приложенных файлов, а ссылки на шаблон не
 * хранит. Поэтому правка шаблона не трогает уже заведённые наборы, а править
 * анкету под конкретную вакансию можно как угодно — это и просил заказчик:
 * «предзаполнилось, а дальше добавим специфическое».
 *
 * Без шаблона вакансия создаётся не пустой, а с заготовкой (см. starterForm).
 */
router.post('/openings', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Нужен заголовок вакансии' });

    const branch = await MedCenter.findOne({ where: { id: req.body?.medCenterId, ...REAL_BRANCHES } });
    if (!branch) return res.status(400).json({ error: 'Филиал не найден' });
    if (!branch.code) {
      return res.status(400).json({
        error: `У филиала «${branch.name}» не заполнен латинский код — без него ссылку не построить`
      });
    }

    let template = null;
    if (req.body?.templateId) {
      template = await VacTemplate.findByPk(req.body.templateId);
      if (!template) return res.status(400).json({ error: 'Шаблон не найден' });
    }

    const vacancy = await VacVacancy.create({
      medCenterId: branch.id,
      title,
      description: String(req.body?.description || '').trim() || template?.description || null,
      publicCode: await freshCode(),
      status: 'draft',
      form: template ? template.form : starterForm(),
      process: template ? template.process : starterProcess(),
      emails: template ? template.emails : {},
      createdBy: req.user.id
    });

    // Файлы копируются после создания: пока вакансии нет, копии некуда
    // привязать. Анкета после этого переписывается — в ней лежат ссылки на
    // файлы шаблона, и оставить их значит показать кандидату документ, который
    // уедет вместе с удалённым шаблоном.
    if (template) {
      const form = await attachments.copyInto(
        vacancy.form,
        { templateId: template.id },
        { vacancyId: vacancy.id },
        req.user.id
      );
      if (form !== vacancy.form) await vacancy.update({ form });
    }

    res.status(201).json({ id: vacancy.id });
  } catch (error) {
    console.error('[vacancies] create opening:', error);
    res.status(500).json({ error: 'Не удалось создать вакансию' });
  }
});

async function loadVacancy(req, res, next) {
  try {
    const vacancy = await VacVacancy.findByPk(req.params.id, {
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'code', 'color'] }]
    });
    if (!vacancy) return res.status(404).json({ error: 'Вакансия не найдена' });
    req.vacancy = vacancy;
    next();
  } catch (error) {
    console.error('[vacancies] loadVacancy:', error);
    res.status(500).json({ error: 'Не удалось открыть вакансию' });
  }
}

router.get('/openings/:id', loadVacancy, async (req, res) => {
  try {
    const vacancy = req.vacancy;

    const applicationCount = await VacApplication.count({ where: { vacancyId: vacancy.id } });
    // Шаги, по которым уже есть задачи: редактор запирает им ключ и удаление.
    const lockedStepKeys = applicationCount ? [...(await stepKeysInUse(vacancy.id))] : [];

    res.json({
      id: vacancy.id,
      title: vacancy.title,
      description: vacancy.description,
      status: vacancy.status,
      publicCode: vacancy.publicCode,
      medCenter: vacancy.medCenter,
      form: vacancy.form || { blocks: [], steps: [] },
      process: vacancy.process || { steps: [] },
      emails: vacancy.emails || {},
      attachments: await attachments.listFor({ vacancyId: vacancy.id }),
      applicationCount,
      lockedStepKeys,
      publicUrl: links.vacancyUrl(vacancy.publicCode),
      branchUrl: vacancy.medCenter?.code ? links.branchUrl(vacancy.medCenter.code) : null,
      updatedAt: vacancy.updatedAt
    });
  } catch (error) {
    console.error('[vacancies] opening:', error);
    res.status(500).json({ error: 'Не удалось открыть вакансию' });
  }
});

/**
 * Заголовок, описание и анкета.
 *
 * Анкета проходит проверку всегда, даже у черновика. Держать в базе заведомо
 * сломанную схему незачем: редактор всё равно не даст её собрать, а пришедшая
 * мимо редактора сломанная анкета потом обрушит публичный контур в месте, по
 * которому причину уже не найти.
 *
 * Переименование ключей полей здесь не запрещено, в отличие от шагов процесса.
 * Причина в снимке: отправленная заявка носит свою копию анкеты и читается по
 * ней, а не по нынешней вакансии, — переименование её не задевает. У шагов
 * иначе, там ключ лежит в задачах и назначениях.
 */
router.put('/openings/:id', loadVacancy, async (req, res) => {
  try {
    const patch = {};

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim().slice(0, 200);
      if (!title) return res.status(400).json({ error: 'Нужен заголовок вакансии' });
      patch.title = title;
    }
    if (req.body?.description !== undefined) {
      patch.description = String(req.body.description).trim() || null;
    }
    if (req.body?.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder) || 0;

    if (req.body?.form !== undefined) {
      const { errors, form } = formSchema.validateForm(req.body.form);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });

      // Шагу выбора услуг нужно поле со специальностью. Убрать это поле,
      // оставив шаг, технически можно — но узнать об этом при открытии набора, а
      // не сейчас, значит гадать, что сломалось: правка была на другой вкладке и
      // час назад. Проверяем только требования шагов к анкете, а не процесс
      // целиком: у черновика он может быть законно недособран.
      const broken = starvedSteps(req.vacancy.process, form);
      if (broken.length) {
        return res.status(400).json({
          error: `Шагу «${broken[0].title}» нужно поле с ролью «Специальность» — уберите сначала шаг`
        });
      }

      // Ссылки на чужие файлы редактор прислать не должен, но сама анкета
      // приходит обычным PUT, и проверить это больше негде.
      patch.form = await attachments.keepOwn({ vacancyId: req.vacancy.id }, form);
    }

    await req.vacancy.update(patch);

    // Файл прикладывается сразу, анкета сохраняется кнопкой — значит
    // загруженный и тут же отцепленный бланк остаётся ничьим. Убираем такие,
    // пока по вакансии никто не откликнулся: дальше на эти файлы уже могут
    // ссылаться снимки анкет в заявках (см. attachments.pruneUnused).
    if (patch.form) {
      const responded = await VacApplication.count({ where: { vacancyId: req.vacancy.id } });
      await attachments.pruneUnused({ vacancyId: req.vacancy.id }, patch.form, { keepAll: responded > 0 });
    }

    res.json({ ok: true, updatedAt: req.vacancy.updatedAt });
  } catch (error) {
    console.error('[vacancies] save opening:', error);
    res.status(500).json({ error: 'Не удалось сохранить вакансию' });
  }
});

/** Шаги, которым после правки анкеты перестало хватать нужного им поля. */
function starvedSteps(process, form) {
  return (process?.steps || []).filter(step => {
    if (step.archived) return false;
    const needs = processSchema.STEP_KINDS[step.kind]?.requiresRole || [];
    return needs.some(role => !(form.blocks || []).some(
      b => !b.repeat && (b.fields || []).some(f => f.role === role)
    ));
  });
}

/**
 * Процесс.
 *
 * Два запрета здесь строже, чем у анкеты, и оба по одной причине: ключ шага
 * лежит строками в задачах и назначениях, а не только внутри вакансии.
 * Переименовать ключ шага, по которому уже есть задачи, нельзя — задачи
 * осиротеют. Удалить такой шаг тоже нельзя: он уходит в архив, то есть
 * перестаёт появляться у новых заявок, но остаётся собой для старых.
 */
router.put('/openings/:id/process', loadVacancy, async (req, res) => {
  try {
    const vacancy = req.vacancy;
    const { errors, process: next } = processSchema.validateProcess(req.body?.process, vacancy.form);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const inUse = await stepKeysInUse(vacancy.id);
    if (inUse.size) {
      const nextKeys = new Set(next.steps.map(s => s.key));
      const lost = [...inUse].filter(key => !nextKeys.has(key));
      if (lost.length) {
        const was = processSchema.getStep(vacancy.process, lost[0]);
        return res.status(400).json({
          error: `По шагу «${was?.title || lost[0]}» уже есть задачи — его нельзя удалить или переименовать, только убрать в архив`
        });
      }
    }

    await vacancy.update({ process: next });
    res.json({ ok: true, updatedAt: vacancy.updatedAt });
  } catch (error) {
    console.error('[vacancies] save process:', error);
    res.status(500).json({ error: 'Не удалось сохранить процесс' });
  }
});

/** Тексты писем. Разбор общий с шаблонами — см. cleanEmails. */
router.put('/openings/:id/emails', loadVacancy, async (req, res) => {
  try {
    await req.vacancy.update({ emails: cleanEmails(req.body?.emails) });
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] save emails:', error);
    res.status(500).json({ error: 'Не удалось сохранить письма' });
  }
});

/** Готовое письмо, как его увидит кандидат. Собирается тем же кодом, что и настоящее. */
router.get('/openings/:id/email-preview/:key', loadVacancy, (req, res) => {
  const { key } = req.params;
  if (!mailer.LETTERS[key]) return res.status(404).json({ error: 'Такого письма нет' });
  res.json(mailer.preview(req.vacancy, key));
});

/** Специальности филиала — то, из чего кандидат выбирает в анкете. */
router.get('/openings/:id/specialities', loadVacancy, async (req, res) => {
  try {
    res.json(await priceCatalogue.specialities(req.vacancy.medCenterId));
  } catch (error) {
    console.error('[vacancies] specialities:', error);
    res.status(500).json({ error: 'Не удалось загрузить разделы прайса' });
  }
});

/** Прямая ссылка и QR на саму вакансию — их отправляют конкретному человеку. */
router.get('/openings/:id/materials', loadVacancy, async (req, res) => {
  try {
    res.json(await links.vacancyMaterials(req.vacancy.publicCode));
  } catch (error) {
    console.error('[vacancies] opening materials:', error);
    res.status(500).json({ error: 'Не удалось собрать материалы' });
  }
});

/**
 * Шаги, на которые никого не назначили.
 *
 * Шаг считается закрытым, если исполнитель есть либо на филиал вакансии, либо
 * сетевой: сетевое назначение работает запасным вариантом.
 */
async function orphanSteps(vacancy) {
  const steps = processSchema.assignableSteps(vacancy.process);
  if (!steps.length) return [];

  const rows = await VacAssignment.findAll({
    where: { vacancyId: vacancy.id, stepKey: steps.map(s => s.key) },
    include: [{ model: User, as: 'user', attributes: ['id', 'isActive'] }]
  });

  const covered = new Set(rows.filter(r => r.user?.isActive).map(r => r.stepKey));
  return steps.filter(s => !covered.has(s.key));
}

/**
 * Состояние вакансии.
 *
 * Открыть можно только то, что проходит проверку целиком: анкета, процесс и
 * живой исполнитель на каждом шаге. Шаг без исполнителя дал бы задачу с пустым
 * списком, которая протухнет по сроку, не показавшись никому.
 */
router.post('/openings/:id/status', loadVacancy, async (req, res) => {
  try {
    const vacancy = req.vacancy;
    const next = String(req.body?.status || '');
    if (!['draft', 'open', 'closed'].includes(next)) {
      return res.status(400).json({ error: 'Неизвестное состояние' });
    }

    if (next === 'open') {
      const form = formSchema.validateForm(vacancy.form);
      if (form.errors.length) return res.status(400).json({ error: form.errors[0], errors: form.errors });

      const proc = processSchema.validateProcess(vacancy.process, vacancy.form);
      if (proc.errors.length) return res.status(400).json({ error: proc.errors[0], errors: proc.errors });

      const orphans = await orphanSteps(vacancy);
      if (orphans.length) {
        return res.status(400).json({
          error: `Некому выполнять шаг «${orphans[0].title}»`,
          errors: orphans.map(s => `Не назначен исполнитель шага «${s.title}»`)
        });
      }
    }

    await vacancy.update({ status: next });
    res.json({ ok: true, status: next });
  } catch (error) {
    console.error('[vacancies] status:', error);
    res.status(500).json({ error: 'Не удалось изменить состояние вакансии' });
  }
});

/**
 * Удаление вакансии — только пока по ней никто не откликнулся. С заявками она
 * закрывается, а не удаляется: их ещё доводить до выхода человека на работу,
 * когда набор давно закрыт.
 */
router.delete('/openings/:id', loadVacancy, async (req, res) => {
  try {
    const applications = await VacApplication.count({ where: { vacancyId: req.vacancy.id } });
    if (applications) return res.status(400).json({ error: 'По вакансии есть отклики — её можно только закрыть' });

    // Строки уедут каскадом, файлы на диске — нет: за ними некому следить.
    for (const row of await VacAttachment.findAll({ where: { vacancyId: req.vacancy.id } })) {
      attachments.removeFile(row.filename);
    }

    await req.vacancy.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] delete opening:', error);
    res.status(500).json({ error: 'Не удалось удалить вакансию' });
  }
});

// ── Наши файлы в анкете ────────────────────────────────────────────────────
//
// Образец заявления, памятка, бланк согласия — то, что кандидат скачивает,
// заполняет и присылает обратно. Файл принадлежит вакансии либо шаблону, а поле
// анкеты держит ссылку на него в своей схеме.
//
// Загрузка идёт сразу, а не вместе с анкетой: анкета сохраняется кнопкой и
// целиком, и класть в тот же запрос двоичные файлы значило бы пересылать их при
// каждой правке подписи у соседнего поля.

const receiveAttachment = attachments.uploader().single('file');

/** Multer отвечает ошибкой, а не исключением: и слишком большой файл, и чужой тип — это 400. */
function withAttachment(req, res, next) {
  receiveAttachment(req, res, (error) => {
    if (!error) return next();
    // Про размер multer сообщает по-английски («File too large»), а читать это
    // будет тот, кто прикладывает бланк.
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Файл больше ${attachments.MAX_FILE_MB} МБ`
      : error.message;
    res.status(400).json({ error: message });
  });
}

async function addAttachment(req, res, owner) {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

  // Подпись — то, что кандидат увидит ссылкой. Без неё берём имя файла: оно
  // обычно осмысленное («Заявление о приёме.docx»), а пустая ссылка не годится.
  const title = String(req.body?.title || '').trim().slice(0, 200) || req.file.originalname;

  const row = await VacAttachment.create({
    ...owner,
    title,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedBy: req.user.id
  });

  res.status(201).json({
    id: row.id, title: row.title, filename: row.filename,
    originalName: row.originalName, mimeType: row.mimeType, size: row.size
  });
}

/**
 * Удаление бланка.
 *
 * Ссылку на него из анкеты не вычищаем: анкета правится в редакторе и
 * сохраняется целиком, и переписать её здесь значило бы затереть несохранённую
 * работу человека. Неразрешимая ссылка публичный контур не ломает — он
 * показывает только те файлы, которые нашлись.
 */
async function dropAttachment(req, res, owner) {
  const row = await VacAttachment.findOne({
    where: { id: req.params.attachmentId, ...attachments.ownerWhere(owner) }
  });
  if (!row) return res.status(404).json({ error: 'Файл не найден' });

  attachments.removeFile(row.filename);
  await row.destroy();
  res.json({ ok: true });
}

router.post('/openings/:id/attachments', loadVacancy, withAttachment, async (req, res) => {
  try {
    await addAttachment(req, res, { vacancyId: req.vacancy.id });
  } catch (error) {
    console.error('[vacancies] add attachment:', error);
    attachments.removeFile(req.file?.filename);
    res.status(500).json({ error: 'Не удалось приложить файл' });
  }
});

router.delete('/openings/:id/attachments/:attachmentId', loadVacancy, async (req, res) => {
  try {
    await dropAttachment(req, res, { vacancyId: req.vacancy.id });
  } catch (error) {
    console.error('[vacancies] delete attachment:', error);
    res.status(500).json({ error: 'Не удалось удалить файл' });
  }
});

// ── Шаблоны ────────────────────────────────────────────────────────────────
//
// Заготовка должности: анкета, процесс и тексты писем под «Врача»,
// «Медсестру», «Администратора». Вакансия берёт из шаблона копию и дальше живёт
// сама по себе — см. POST /openings.
//
// Филиала, исполнителей и чатов у шаблона нет: исполнитель шага — конкретный
// человек в конкретном медцентре, и тянуть его за собой в другой филиал значит
// приносить больше правок, чем экономить.

router.get('/templates', async (req, res) => {
  try {
    const rows = await VacTemplate.findAll({
      include: [{ model: User, as: 'author', attributes: ['id', 'displayName'] }],
      order: [['sortOrder', 'ASC'], ['title', 'ASC']]
    });

    res.json(rows.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      blockCount: Array.isArray(t.form?.blocks) ? t.form.blocks.length : 0,
      fieldCount: formSchema.flatFields(t.form).length,
      stepCount: Array.isArray(t.process?.steps) ? t.process.steps.length : 0,
      author: t.author,
      updatedAt: t.updatedAt
    })));
  } catch (error) {
    console.error('[vacancies] templates:', error);
    res.status(500).json({ error: 'Не удалось загрузить шаблоны' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Нужно название шаблона' });

    const template = await VacTemplate.create({
      title,
      description: String(req.body?.description || '').trim() || null,
      form: starterForm(),
      process: starterProcess(),
      emails: {},
      createdBy: req.user.id
    });

    res.status(201).json({ id: template.id });
  } catch (error) {
    console.error('[vacancies] create template:', error);
    res.status(500).json({ error: 'Не удалось создать шаблон' });
  }
});

/**
 * Шаблон из готовой вакансии.
 *
 * Тот самый «огромный список», который заказчик не хочет заносить заново, уже
 * собран в первой вакансии врача. Заставлять повторять его в шаблоне руками
 * значит ровно та же работа с тем же риском забыть половину.
 *
 * Берётся анкета, процесс, письма и приложенные файлы. Исполнители, чаты и
 * филиал не берутся — их в шаблоне нет.
 */
router.post('/templates/from-opening/:id', loadVacancy, async (req, res) => {
  try {
    const vacancy = req.vacancy;
    const title = String(req.body?.title || '').trim().slice(0, 200) || vacancy.title;

    const template = await VacTemplate.create({
      title,
      description: String(req.body?.description || '').trim() || null,
      form: vacancy.form,
      process: vacancy.process,
      emails: vacancy.emails,
      createdBy: req.user.id
    });

    const form = await attachments.copyInto(
      template.form,
      { vacancyId: vacancy.id },
      { templateId: template.id },
      req.user.id
    );
    if (form !== template.form) await template.update({ form });

    res.status(201).json({ id: template.id, title: template.title });
  } catch (error) {
    console.error('[vacancies] template from opening:', error);
    res.status(500).json({ error: 'Не удалось сохранить шаблон' });
  }
});

async function loadTemplate(req, res, next) {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });
    req.template = template;
    next();
  } catch (error) {
    console.error('[vacancies] loadTemplate:', error);
    res.status(500).json({ error: 'Не удалось открыть шаблон' });
  }
}

router.get('/templates/:id', loadTemplate, async (req, res) => {
  try {
    const template = req.template;
    res.json({
      id: template.id,
      title: template.title,
      description: template.description,
      form: template.form || { blocks: [], steps: [] },
      process: template.process || { steps: [] },
      emails: template.emails || {},
      attachments: await attachments.listFor({ templateId: template.id }),
      updatedAt: template.updatedAt
    });
  } catch (error) {
    console.error('[vacancies] template:', error);
    res.status(500).json({ error: 'Не удалось открыть шаблон' });
  }
});

/**
 * Название, описание и анкета шаблона.
 *
 * Проверки те же, что у вакансии, и по той же причине: держать в базе заведомо
 * сломанную схему незачем — она уедет в вакансию копией и обрушит публичный
 * контур уже там, где причину не найти.
 *
 * Чего здесь нет — запретов на переименование ключей: задач и назначений у
 * шаблона не бывает, держать его ключи нечем.
 */
router.put('/templates/:id', loadTemplate, async (req, res) => {
  try {
    const patch = {};

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim().slice(0, 200);
      if (!title) return res.status(400).json({ error: 'Нужно название шаблона' });
      patch.title = title;
    }
    if (req.body?.description !== undefined) {
      patch.description = String(req.body.description).trim() || null;
    }

    if (req.body?.form !== undefined) {
      const { errors, form } = formSchema.validateForm(req.body.form);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });

      const broken = starvedSteps(req.template.process, form);
      if (broken.length) {
        return res.status(400).json({
          error: `Шагу «${broken[0].title}» нужно поле с ролью «Специальность» — уберите сначала шаг`
        });
      }

      patch.form = await attachments.keepOwn({ templateId: req.template.id }, form);
    }

    await req.template.update(patch);

    if (patch.form) {
      await attachments.pruneUnused({ templateId: req.template.id }, patch.form);
    }

    res.json({ ok: true, updatedAt: req.template.updatedAt });
  } catch (error) {
    console.error('[vacancies] save template:', error);
    res.status(500).json({ error: 'Не удалось сохранить шаблон' });
  }
});

router.put('/templates/:id/process', loadTemplate, async (req, res) => {
  try {
    const { errors, process: next } = processSchema.validateProcess(req.body?.process, req.template.form);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    await req.template.update({ process: next });
    res.json({ ok: true, updatedAt: req.template.updatedAt });
  } catch (error) {
    console.error('[vacancies] save template process:', error);
    res.status(500).json({ error: 'Не удалось сохранить процесс' });
  }
});

router.put('/templates/:id/emails', loadTemplate, async (req, res) => {
  try {
    await req.template.update({ emails: cleanEmails(req.body?.emails) });
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] save template emails:', error);
    res.status(500).json({ error: 'Не удалось сохранить письма' });
  }
});

/** Превью собирается тем же кодом, что и настоящее письмо: шаблону нужны только название и тексты. */
router.get('/templates/:id/email-preview/:key', loadTemplate, (req, res) => {
  const { key } = req.params;
  if (!mailer.LETTERS[key]) return res.status(404).json({ error: 'Такого письма нет' });
  res.json(mailer.preview(req.template, key));
});

/**
 * Удаление шаблона. Ничего не спрашиваем у вакансий: связи с ними у шаблона
 * нет — они получили копию и от него не зависят.
 */
router.delete('/templates/:id', loadTemplate, async (req, res) => {
  try {
    for (const row of await VacAttachment.findAll({ where: { templateId: req.template.id } })) {
      attachments.removeFile(row.filename);
    }
    await req.template.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] delete template:', error);
    res.status(500).json({ error: 'Не удалось удалить шаблон' });
  }
});

router.post('/templates/:id/attachments', loadTemplate, withAttachment, async (req, res) => {
  try {
    await addAttachment(req, res, { templateId: req.template.id });
  } catch (error) {
    console.error('[vacancies] add template attachment:', error);
    attachments.removeFile(req.file?.filename);
    res.status(500).json({ error: 'Не удалось приложить файл' });
  }
});

router.delete('/templates/:id/attachments/:attachmentId', loadTemplate, async (req, res) => {
  try {
    await dropAttachment(req, res, { templateId: req.template.id });
  } catch (error) {
    console.error('[vacancies] delete template attachment:', error);
    res.status(500).json({ error: 'Не удалось удалить файл' });
  }
});

// ── Исполнители ────────────────────────────────────────────────────────────

/**
 * Ролей под процесс не заводим — исполнитель всегда конкретный человек. В
 * списке для выбора все работающие сотрудники, а не только те, у кого есть
 * раздел: назначение исполнителем и право собирать вакансии — разные вещи,
 * кадровик и маркетолог шаги выполняют, а конструктор им не нужен.
 */
router.get('/openings/:id/assignments', loadVacancy, async (req, res) => {
  try {
    const vacancy = req.vacancy;

    const [rows, centers, users] = await Promise.all([
      VacAssignment.findAll({
        where: { vacancyId: vacancy.id },
        include: [{ model: User, as: 'user', attributes: USER_FIELDS }],
        order: [['stepKey', 'ASC']]
      }),
      MedCenter.findAll({
        where: REAL_BRANCHES, attributes: ['id', 'name'],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']]
      }),
      User.findAll({ where: { isActive: true }, attributes: USER_FIELDS, order: [['displayName', 'ASC']] })
    ]);

    res.json({
      // Филиал у вакансии один, поэтому филиальные шаги настраиваются сразу на
      // него: выбирать медцентр, как это было в 8.20, больше не из чего.
      medCenter: vacancy.medCenter,
      steps: [
        ...processSchema.assignableSteps(vacancy.process),
        // Не шаг, а служебная точка: кому писать о просрочке. Иерархии
        // подчинения в портале нет, поэтому получатель назначается поимённо.
        {
          key: processSchema.ESCALATION_KEY,
          title: 'Кому сообщать о просрочке',
          hint: 'Не шаг процесса: у этой точки нет задачи и строки в чек-листе.',
          scope: 'network',
          kind: 'service'
        }
      ],
      medCenters: centers,
      users,
      assignments: rows.map(r => ({
        id: r.id, stepKey: r.stepKey, medCenterId: r.medCenterId, userId: r.userId, user: r.user
      }))
    });
  } catch (error) {
    console.error('[vacancies] assignments:', error);
    res.status(500).json({ error: 'Не удалось загрузить исполнителей' });
  }
});

/** Пересчёт исполнителей у задач, которые уже открыты по этому шагу. */
async function reassignOpenTasks(vacancy, stepKey) {
  // Требуется здесь, а не сверху: движок сам тянет назначения, и импорт на
  // уровне файла замкнул бы их друг на друга.
  const engine = require('../services/vacancies/engine');
  const assignments = require('../services/vacancies/assignments');

  const tasks = await VacTask.findAll({
    where: { stepKey, completedAt: null },
    include: [{
      model: VacApplication, as: 'application', required: true,
      where: { vacancyId: vacancy.id }, attributes: ['id', 'medCenterId', 'vacancyId']
    }]
  });
  if (!tasks.length) return;

  const touched = new Set();
  for (const task of tasks) {
    (task.assigneeIds || []).forEach(id => touched.add(id));
    const ids = await assignments.resolveAssignees(vacancy.id, stepKey, task.application.medCenterId);
    ids.forEach(id => touched.add(id));
    // Если взявший задачу больше не исполнитель, снимаем захват: иначе задача
    // осталась бы закреплённой за человеком, которому её уже не видно.
    const claimValid = !task.claimedBy || ids.includes(task.claimedBy);
    await task.update({ assigneeIds: ids, ...(claimValid ? {} : { claimedBy: null, claimedAt: null }) });
  }
  engine.signalChanged([...touched], { reason: 'assignments_changed', stepKey });
}

/**
 * Полная замена состава исполнителей шага. Именно замена, а не добавление:
 * экран показывает список целиком, и «сохранить» должно означать «стало так»,
 * иначе снятый человек остался бы назначенным.
 *
 * Настройка действует и на уже открытые задачи, а не только на следующие
 * заявки: иначе замена выбывшего сотрудника не спасала бы то, что на нём уже
 * зависло.
 */
router.put('/openings/:id/assignments/:stepKey', loadVacancy, async (req, res) => {
  try {
    const vacancy = req.vacancy;
    const { stepKey } = req.params;

    const known = stepKey === processSchema.ESCALATION_KEY
      || processSchema.assignableSteps(vacancy.process).some(s => s.key === stepKey);
    if (!known) return res.status(400).json({ error: 'Неизвестный шаг' });

    const medCenterId = req.body?.medCenterId || null;
    const userIds = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds)] : [];

    if (medCenterId) {
      const branch = await MedCenter.count({ where: { id: medCenterId, ...REAL_BRANCHES } });
      if (!branch) return res.status(400).json({ error: 'Неизвестный филиал' });
    }
    if (userIds.length) {
      const alive = await User.count({ where: { id: { [Op.in]: userIds }, isActive: true } });
      if (alive !== userIds.length) return res.status(400).json({ error: 'Среди выбранных есть неработающие сотрудники' });
    }

    await VacAssignment.destroy({ where: { vacancyId: vacancy.id, stepKey, medCenterId } });
    if (userIds.length) {
      await VacAssignment.bulkCreate(userIds.map(userId => ({
        vacancyId: vacancy.id, stepKey, medCenterId, userId
      })));
    }

    await reassignOpenTasks(vacancy, stepKey);
    res.json({ ok: true, stepKey, medCenterId, userIds });
  } catch (error) {
    console.error('[vacancies] save assignments:', error);
    res.status(500).json({ error: 'Не удалось сохранить исполнителей' });
  }
});

// ── Рабочие чаты ───────────────────────────────────────────────────────────

router.get('/openings/:id/chats', loadVacancy, async (req, res) => {
  try {
    const rows = await VacChatLink.findAll({
      where: { vacancyId: req.vacancy.id },
      order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']]
    });
    res.json(rows.map(chatLinks.toJson));
  } catch (error) {
    console.error('[vacancies] chats:', error);
    res.status(500).json({ error: 'Не удалось загрузить чаты' });
  }
});

/**
 * Превью чата читается на бэкенде: страницу приглашения из браузера не
 * прочитать, её отдают без CORS. Заодно здесь же скачивается аватарка — у
 * телеграма она живёт по временному адресу, который через месяц перестанет
 * открываться прямо в отправленном письме.
 */
router.post('/openings/:id/chats', loadVacancy, async (req, res) => {
  try {
    const check = chatLinks.normalizeUrl(req.body?.url);
    if (!check.ok) return res.status(400).json({ error: check.reason });

    const preview = await chatLinks.fetchPreview(check.url);
    const avatarPath = await chatLinks.storeAvatar(preview);

    const link = await VacChatLink.create({
      vacancyId: req.vacancy.id,
      medCenterId: req.body?.medCenterId || null,
      url: check.url,
      title: String(req.body?.title || preview.title || 'Рабочий чат').slice(0, 255),
      subtitle: String(req.body?.subtitle || '').slice(0, 255) || null,
      avatarPath,
      fetchedAt: preview.ok ? new Date() : null,
      fetchError: preview.ok ? null : String(preview.reason || '').slice(0, 255)
    });

    res.status(201).json(chatLinks.toJson(link));
  } catch (error) {
    console.error('[vacancies] add chat:', error);
    res.status(500).json({ error: 'Не удалось добавить чат' });
  }
});

router.delete('/openings/:id/chats/:chatId', loadVacancy, async (req, res) => {
  try {
    const link = await VacChatLink.findOne({
      where: { id: req.params.chatId, vacancyId: req.vacancy.id }
    });
    if (!link) return res.status(404).json({ error: 'Чат не найден' });

    chatLinks.removeAvatar(link.avatarPath);
    await link.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] delete chat:', error);
    res.status(500).json({ error: 'Не удалось удалить чат' });
  }
});

module.exports = router;
