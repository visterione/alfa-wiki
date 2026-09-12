'use strict';

/**
 * Внутренний API раздела «Вакансии» (ver. 8.20).
 *
 * Сейчас здесь шаблоны: список, чтение и конструктор анкеты. Конструктор
 * процесса, публичный контур и работа с заявками приезжают следующими кусками.
 *
 * Право пока одно — полный админ. Гранулярного флага нет намеренно: до первой
 * живой вакансии раздел собирают и настраивают, а не работают в нём, и кого
 * сюда пускать, станет понятно вместе с переездом заявок.
 */

const express = require('express');

const router = express.Router();

const { Op } = require('sequelize');

const {
  VacTemplate, VacVacancy, VacApplication, VacAssignment, VacTask,
  MedCenter, User
} = require('../models');
const { authenticate } = require('../middleware/auth');
const formSchema = require('../services/vacancies/formSchema');
const processSchema = require('../services/vacancies/processSchema');
const links = require('../services/vacancies/links');

const USER_FIELDS = ['id', 'displayName', 'username', 'avatar', 'position', 'isActive'];

/** Настоящие работающие филиалы: «АУП» и «Направители» — служебные группировки. */
const REAL_BRANCHES = { isActive: true, isVirtual: false };

/** Ключи шагов, по которым у шаблона уже заведены задачи. */
async function stepKeysInUse(templateId) {
  const rows = await VacTask.findAll({
    attributes: ['stepKey'],
    group: ['stepKey'],
    include: [{
      model: VacApplication, as: 'application', attributes: [], required: true,
      where: { templateId }
    }]
  });
  return new Set(rows.map(r => r.stepKey));
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа к разделу' });
  next();
}

router.use(authenticate, requireAdmin);

/**
 * Шаблоны.
 *
 * Анкета и процесс целиком здесь не отдаются: в шаблоне врача это полсотни
 * полей и десять шагов, а списку нужны только размеры, чтобы показать «14
 * блоков, 10 шагов». Полный шаблон будет отдавать редактор по своему маршруту.
 */
router.get('/templates', async (req, res) => {
  try {
    const rows = await VacTemplate.findAll({
      where: { isArchived: false },
      order: [['title', 'ASC']]
    });

    const vacancyCounts = await VacVacancy.count({
      where: { templateId: rows.map(r => r.id) },
      group: ['templateId']
    });
    const byTemplate = new Map(vacancyCounts.map(r => [r.templateId, Number(r.count)]));

    res.json(rows.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      isPublished: t.isPublished,
      blockCount: Array.isArray(t.form?.blocks) ? t.form.blocks.length : 0,
      stepCount: Array.isArray(t.process?.steps) ? t.process.steps.length : 0,
      vacancyCount: byTemplate.get(t.id) || 0,
      updatedAt: t.updatedAt
    })));
  } catch (error) {
    console.error('[vacancies] templates:', error);
    res.status(500).json({ error: 'Не удалось загрузить шаблоны' });
  }
});

// ── Вакансии ───────────────────────────────────────────────────────────────
//
// Ресурс называется openings, а не vacancies: раздел и так смонтирован на
// /api/vacancies, и «/vacancies/vacancies» читалось бы как опечатка.

/** Вакансии всех филиалов: список для того, кто их заводит. */
router.get('/openings', async (req, res) => {
  try {
    const rows = await VacVacancy.findAll({
      include: [
        { model: VacTemplate, as: 'template', attributes: ['id', 'title'] },
        { model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'code'] }
      ],
      order: [['sortOrder', 'ASC'], ['title', 'ASC']]
    });

    res.json(rows.map(v => ({
      id: v.id,
      title: v.title,
      description: v.description,
      isOpen: v.isOpen,
      template: v.template ? { id: v.template.id, title: v.template.title } : null,
      medCenter: v.medCenter
        ? { id: v.medCenter.id, name: v.medCenter.name, code: v.medCenter.code }
        : null
    })));
  } catch (error) {
    console.error('[vacancies] list:', error);
    res.status(500).json({ error: 'Не удалось загрузить вакансии' });
  }
});

/**
 * Новая вакансия.
 *
 * Шаблон обязан быть опубликованным: по черновику откликаться нельзя, иначе
 * заявки пойдут по полуготовой анкете. Филиал — настоящий работающий: «АУП» и
 * «Направители» вакансий не открывают.
 */
router.post('/openings', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Нужен заголовок вакансии' });

    const template = await VacTemplate.findByPk(req.body?.templateId);
    if (!template) return res.status(400).json({ error: 'Шаблон не найден' });
    if (!template.isPublished) {
      return res.status(400).json({ error: `Шаблон «${template.title}» ещё черновик — сначала опубликуйте его` });
    }

    const branch = await MedCenter.findOne({ where: { id: req.body?.medCenterId, ...REAL_BRANCHES } });
    if (!branch) return res.status(400).json({ error: 'Филиал не найден' });
    if (!branch.code) {
      // Без кода вакансию некуда повесить: публичный адрес строится именно из
      // него, и открытая вакансия в филиале без кода была бы невидимой.
      return res.status(400).json({ error: `У филиала «${branch.name}» не заполнен латинский код — без него QR-ссылку не построить` });
    }

    const opening = await VacVacancy.create({
      templateId: template.id,
      medCenterId: branch.id,
      title,
      description: String(req.body?.description || '').trim() || null,
      isOpen: req.body?.isOpen !== false,
      sortOrder: Number(req.body?.sortOrder) || 0,
      createdBy: req.user.id
    });

    res.status(201).json({ id: opening.id });
  } catch (error) {
    console.error('[vacancies] create opening:', error);
    res.status(500).json({ error: 'Не удалось создать вакансию' });
  }
});

/**
 * Правка вакансии. Шаблон и филиал не меняются: заявки хранят и то и другое
 * своими колонками, и перенос вакансии в другой филиал означал бы, что у
 * поданных заявок исполнители остались от прежнего.
 */
router.put('/openings/:id', async (req, res) => {
  try {
    const opening = await VacVacancy.findByPk(req.params.id);
    if (!opening) return res.status(404).json({ error: 'Вакансия не найдена' });

    const patch = {};
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim().slice(0, 200);
      if (!title) return res.status(400).json({ error: 'Нужен заголовок вакансии' });
      patch.title = title;
    }
    if (req.body?.description !== undefined) {
      patch.description = String(req.body.description).trim() || null;
    }
    if (req.body?.isOpen !== undefined) patch.isOpen = Boolean(req.body.isOpen);
    if (req.body?.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder) || 0;

    await opening.update(patch);
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] save opening:', error);
    res.status(500).json({ error: 'Не удалось сохранить вакансию' });
  }
});

/**
 * Удаление вакансии — только пока по ней никто не откликнулся. С заявками она
 * закрывается, а не удаляется: их ещё доводить до выхода человека на работу,
 * когда набор давно закрыт.
 */
router.delete('/openings/:id', async (req, res) => {
  try {
    const opening = await VacVacancy.findByPk(req.params.id);
    if (!opening) return res.status(404).json({ error: 'Вакансия не найдена' });

    const applications = await VacApplication.count({ where: { vacancyId: opening.id } });
    if (applications) return res.status(400).json({ error: 'По вакансии есть отклики — её можно только закрыть' });

    await opening.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] delete opening:', error);
    res.status(500).json({ error: 'Не удалось удалить вакансию' });
  }
});

/**
 * Медцентры с их кодами.
 *
 * Адрес QR-кода строится из MedCenter.code, а поле необязательное — оно
 * появилось для других задач. Раздел обязан показывать, у каких филиалов кода
 * нет: без него вакансию опубликовать некуда, и узнать об этом лучше до того,
 * как кто-то распечатает табличку с пустой ссылкой.
 */
router.get('/med-centers', async (req, res) => {
  try {
    const rows = await MedCenter.findAll({
      where: REAL_BRANCHES,
      attributes: ['id', 'name', 'code'],
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json(rows);
  } catch (error) {
    console.error('[vacancies] med-centers:', error);
    res.status(500).json({ error: 'Не удалось загрузить медцентры' });
  }
});

/**
 * Ссылка и QR филиала — то, что печатают и вешают в регистратуре.
 *
 * Строится из MedCenter.code, а не из названия: код не меняется при
 * переименовании клиники, и напечатанная табличка переживёт ребрендинг.
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

/**
 * Справочники для конструктора: чем бывает поле и какие у него бывают роли.
 *
 * Отдаются с сервера, а не зашиты в редактор, ровно по той причине, по которой
 * так устроено публичное API портала (services/public/formRegistry.js): реестр
 * типов один, и второй его список на фронте разошёлся бы с первым на ближайшей
 * правке. Добавили тип — он появился в редакторе сам.
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
      key,
      label: spec.label,
      hint: spec.hint || null,
      types: spec.types,
      required: Boolean(spec.required)
    })),
    stepKinds: Object.entries(processSchema.STEP_KINDS).map(([key, spec]) => ({
      key,
      label: spec.label,
      hint: spec.hint || null,
      unique: Boolean(spec.unique),
      assignee: Boolean(spec.assignee),
      ability: Boolean(spec.ability),
      requiresKind: spec.requiresKind || [],
      requiresRole: spec.requiresRole || [],
      forcedScope: spec.forcedScope || null
    })),
    scopes: Object.entries(processSchema.SCOPES).map(([key, spec]) => ({ key, label: spec.label }))
  });
});

/** Шаблон целиком — для редактора. */
router.get('/templates/:id', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    // Сколько заявок уже подано: редактор предупреждает, что правка анкеты не
    // достанет тех, кто уже отправил свою, — у них лежит снимок.
    const applicationCount = await VacApplication.count({ where: { templateId: template.id } });
    const vacancyCount = await VacVacancy.count({ where: { templateId: template.id } });
    // Шаги, по которым уже есть задачи: редактор запирает им ключ и удаление.
    const lockedStepKeys = applicationCount ? [...(await stepKeysInUse(template.id))] : [];

    res.json({
      id: template.id,
      title: template.title,
      description: template.description,
      form: template.form || { blocks: [], steps: [] },
      process: template.process || { steps: [] },
      emails: template.emails || {},
      isPublished: template.isPublished,
      isArchived: template.isArchived,
      applicationCount,
      vacancyCount,
      lockedStepKeys,
      updatedAt: template.updatedAt
    });
  } catch (error) {
    console.error('[vacancies] template:', error);
    res.status(500).json({ error: 'Не удалось загрузить шаблон' });
  }
});

/**
 * Новый шаблон.
 *
 * Создаётся не пустым: один блок, одно поле с ролью «ФИО» и один шаг. Пустая
 * анкета — это экран, на котором непонятно, с чего начать, а любая анкета всё
 * равно обязана иметь поле с ролью «ФИО», иначе заявка будет безымянной.
 * Заодно такой шаблон сразу проходит проверку, и человек видит рабочий пример
 * структуры, а не список требований.
 */
router.post('/templates', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 150);
    if (!title) return res.status(400).json({ error: 'Нужно название должности' });

    const template = await VacTemplate.create({
      title,
      description: String(req.body?.description || '').trim() || null,
      form: {
        blocks: [{
          key: 'main',
          title: 'Основное',
          fields: [{ key: 'fullName', label: 'ФИО', type: 'text', role: 'fullName', required: true, max: 255 }]
        }],
        steps: [{ key: 'about', title: 'О себе', blocks: ['main'] }]
      },
      process: { steps: [] },
      emails: {},
      isPublished: false,
      createdBy: req.user.id
    });

    res.status(201).json({ id: template.id });
  } catch (error) {
    console.error('[vacancies] create template:', error);
    res.status(500).json({ error: 'Не удалось создать шаблон' });
  }
});

/**
 * Сохранение шаблона.
 *
 * Анкета проходит проверку всегда, даже у черновика. Держать в базе заведомо
 * сломанную схему незачем: редактор всё равно не даст её собрать, а пришедшая
 * мимо редактора сломанная анкета потом обрушит публичный контур в месте, по
 * которому причину уже не найти.
 *
 * Переименование ключей здесь не запрещено, в отличие от шагов процесса.
 * Причина в снимке: отправленная заявка носит свою копию анкеты и читается по
 * ней, а не по нынешнему шаблону, — переименование её не задевает. У шагов
 * иначе, там ключ лежит в задачах и назначениях.
 */
router.put('/templates/:id', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    const patch = {};

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim().slice(0, 150);
      if (!title) return res.status(400).json({ error: 'Нужно название должности' });
      patch.title = title;
    }
    if (req.body?.description !== undefined) {
      patch.description = String(req.body.description).trim() || null;
    }

    if (req.body?.form !== undefined) {
      const { errors, form } = formSchema.validateForm(req.body.form);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      patch.form = form;
    }

    await template.update(patch);
    res.json({ ok: true, updatedAt: template.updatedAt });
  } catch (error) {
    console.error('[vacancies] save template:', error);
    res.status(500).json({ error: 'Не удалось сохранить шаблон' });
  }
});

/**
 * Публикация и возврат в черновик.
 *
 * Опубликованный шаблон можно выбрать при создании вакансии, черновик — нет:
 * полуготовая анкета, случайно выбранная в вакансии, обернётся заявками по
 * полуготовой анкете.
 *
 * Проверка процесса здесь пока грубая — ровно один шаг решения. Полный
 * разбор (зависимости, кольца, исполнители) приедет вместе с конструктором
 * процесса; до тех пор этой проверки хватает, чтобы не опубликовать шаблон,
 * заявки по которому некому согласовать и который поэтому не тронется с места.
 */
router.post('/templates/:id/publish', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    const publish = req.body?.isPublished !== false;

    if (publish) {
      const form = formSchema.validateForm(template.form);
      if (form.errors.length) return res.status(400).json({ error: form.errors[0], errors: form.errors });

      const proc = processSchema.validateProcess(template.process, template.form);
      if (proc.errors.length) return res.status(400).json({ error: proc.errors[0], errors: proc.errors });

      // Шаг без исполнителя не закроет никто: задача появится с пустым списком
      // и протухнет по сроку, не показавшись никому на глаза. Это ловится
      // именно при публикации, а не при сохранении процесса: исполнителей
      // расставляют после того, как шаги придуманы.
      const orphans = await orphanSteps(template);
      if (orphans.length) {
        return res.status(400).json({
          error: `Некому выполнять шаг «${orphans[0].title}»`,
          errors: orphans.map(s => `Не назначен исполнитель шага «${s.title}»`)
        });
      }
    } else if (await VacVacancy.count({ where: { templateId: template.id, isOpen: true } })) {
      // Иначе открытая вакансия осталась бы висеть по QR на шаблоне, который
      // объявлен недоделанным.
      return res.status(400).json({ error: 'По шаблону есть открытые вакансии — сначала закройте их' });
    }

    await template.update({ isPublished: publish });
    res.json({ ok: true, isPublished: publish });
  } catch (error) {
    console.error('[vacancies] publish template:', error);
    res.status(500).json({ error: 'Не удалось изменить состояние шаблона' });
  }
});

/**
 * Удаление шаблона.
 *
 * Только пока по нему ничего не происходило. Шаблон с заявками не удаляется
 * даже в архив: заявка ссылается на него колонкой, и внешний ключ стоит на
 * RESTRICT намеренно — история найма не должна исчезать вместе с должностью.
 */
router.delete('/templates/:id', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    const applications = await VacApplication.count({ where: { templateId: template.id } });
    if (applications) return res.status(400).json({ error: 'По шаблону есть заявки — его нельзя удалить' });

    const vacancies = await VacVacancy.count({ where: { templateId: template.id } });
    if (vacancies) return res.status(400).json({ error: 'По шаблону есть вакансии — сначала удалите их' });

    await template.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies] delete template:', error);
    res.status(500).json({ error: 'Не удалось удалить шаблон' });
  }
});

/**
 * Шаги, на которые никого не назначили.
 *
 * Филиальный шаг считается закрытым, если исполнитель есть хотя бы в одном
 * настоящем филиале либо назначен сетевой: сетевое назначение работает как
 * запасное для всех филиалов сразу. Требовать человека в каждом филиале
 * отдельно было бы правильно, но не даёт опубликовать шаблон, пока не заполнены
 * все одиннадцать клиник, — а половина из них наймом сейчас не занята.
 */
async function orphanSteps(template) {
  const steps = processSchema.assignableSteps(template.process);
  if (!steps.length) return [];

  const rows = await VacAssignment.findAll({
    where: { templateId: template.id, stepKey: steps.map(s => s.key) },
    include: [{ model: User, as: 'user', attributes: ['id', 'isActive'] }]
  });

  const covered = new Set(
    rows.filter(r => r.user?.isActive).map(r => r.stepKey)
  );
  return steps.filter(s => !covered.has(s.key));
}

/**
 * Сохранение процесса.
 *
 * Два запрета здесь строже, чем у анкеты, и оба по одной причине: ключ шага
 * лежит строками в задачах и назначениях, а не только внутри шаблона.
 *
 * Переименовать ключ шага, по которому уже есть задачи, нельзя — задачи
 * осиротеют, и заявка в работе потеряет половину своей истории. Удалить такой
 * шаг тоже нельзя: он уходит в архив, то есть перестаёт появляться у новых
 * заявок, но остаётся собой для старых.
 */
router.put('/templates/:id/process', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    const { errors, process: next } = processSchema.validateProcess(req.body?.process, template.form);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const inUse = await stepKeysInUse(template.id);
    if (inUse.size) {
      const nextKeys = new Set(next.steps.map(s => s.key));
      const lost = [...inUse].filter(key => !nextKeys.has(key));
      if (lost.length) {
        const was = processSchema.getStep(template.process, lost[0]);
        return res.status(400).json({
          error: `По шагу «${was?.title || lost[0]}» уже есть задачи — его нельзя удалить или переименовать, только убрать в архив`
        });
      }
    }

    await template.update({ process: next });
    res.json({ ok: true, updatedAt: template.updatedAt });
  } catch (error) {
    console.error('[vacancies] save process:', error);
    res.status(500).json({ error: 'Не удалось сохранить процесс' });
  }
});

/**
 * Исполнители шагов.
 *
 * Ролей под процесс не заводим — исполнитель всегда конкретный человек. В
 * первом поколении это себя оправдало: ролей в проекте и так много, а участников
 * найма на всю сеть десяток.
 *
 * В списке для выбора — все работающие сотрудники, а не только те, у кого есть
 * раздел. Назначение исполнителем и доступ к настройкам вакансий — разные вещи:
 * кадровик и маркетолог шаги выполняют, а собирать шаблоны им незачем.
 */
router.get('/templates/:id/assignments', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    const [rows, centers, users] = await Promise.all([
      VacAssignment.findAll({
        where: { templateId: template.id },
        include: [{ model: User, as: 'user', attributes: USER_FIELDS }],
        order: [['stepKey', 'ASC']]
      }),
      MedCenter.findAll({
        where: REAL_BRANCHES,
        attributes: ['id', 'name'],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']]
      }),
      User.findAll({
        where: { isActive: true },
        attributes: USER_FIELDS,
        order: [['displayName', 'ASC']]
      })
    ]);

    res.json({
      steps: [
        ...processSchema.assignableSteps(template.process),
        // Не шаг, а служебная точка: кому писать о просрочке. Иерархии
        // подчинения в портале нет, поэтому получатель назначается поимённо,
        // ровно как исполнитель.
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

/**
 * Полная замена состава исполнителей шага в филиале. Именно замена, а не
 * добавление: экран показывает список целиком, и «сохранить» должно означать
 * «стало так», иначе снятый человек остался бы назначенным.
 *
 * Пересчёта уже открытых задач здесь пока нет — задач ещё не бывает. Он
 * приедет вместе с рабочим контуром: настройка должна действовать и на заявки
 * в работе, а не только на следующие.
 */
router.put('/templates/:id/assignments/:stepKey', async (req, res) => {
  try {
    const template = await VacTemplate.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Шаблон не найден' });

    const { stepKey } = req.params;
    const known = stepKey === processSchema.ESCALATION_KEY
      || processSchema.assignableSteps(template.process).some(s => s.key === stepKey);
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

    await VacAssignment.destroy({ where: { templateId: template.id, stepKey, medCenterId } });
    if (userIds.length) {
      await VacAssignment.bulkCreate(userIds.map(userId => ({
        templateId: template.id, stepKey, medCenterId, userId
      })));
    }

    res.json({ ok: true, stepKey, medCenterId, userIds });
  } catch (error) {
    console.error('[vacancies] save assignments:', error);
    res.status(500).json({ error: 'Не удалось сохранить исполнителей' });
  }
});

module.exports = router;
