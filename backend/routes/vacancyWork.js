'use strict';

/**
 * Работа с заявками и задачами (ver. 8.20, переработано в 8.21).
 *
 * Отдельным файлом от routes/vacancies.js намеренно. Там настройка — анкета,
 * процесс, исполнители, письма, — и она доступна только админу. Здесь ежедневная
 * работа, и её видит ещё и тот, кто назначен исполнителем хоть на один шаг:
 * задача без возможности её открыть бессмысленна.
 *
 * Сверок с «Реновацией» здесь больше нет: в 8.20 шаги с умением подтверждались
 * чтением из МИС, в 8.21 это убрано. Закрытие шага — отметка исполнителя.
 *
 * Маршруты ничего не решают сами: всё, что меняет состояние заявки, живёт в
 * services/vacancies/engine.js. Одно и то же событие приходит из трёх мест —
 * от сотрудника, от кандидата по его ссылке и от крона, — и три копии логики
 * разошлись бы на первой правке.
 */

const express = require('express');
const { Op } = require('sequelize');

const router = express.Router();

const {
  VacApplication, VacVacancy, VacTask, VacEvent, VacFile,
  VacServiceChoice, MedCenter, User
} = require('../models');
const { authenticate } = require('../middleware/auth');
const access = require('../services/vacancies/access');
const engine = require('../services/vacancies/engine');
const processSchema = require('../services/vacancies/processSchema');
const formSchema = require('../services/vacancies/formSchema');
const sla = require('../services/workingHours');

const USER_FIELDS = ['id', 'displayName', 'username', 'avatar', 'position', 'isActive'];

/** Доступ к разделу плюс посчитанные полномочия — нужны почти каждому маршруту. */
async function withAccess(req, res, next) {
  try {
    const acl = await access.resolve(req.user);
    if (!acl.allowed) return res.status(403).json({ error: 'Нет доступа к разделу' });
    req.acl = acl;
    next();
  } catch (error) {
    console.error('[vacancies/work] access:', error);
    res.status(500).json({ error: 'Не удалось проверить доступ' });
  }
}

router.use(authenticate, withAccess);

const APP_INCLUDE = [
  { model: VacVacancy, as: 'vacancy', attributes: ['id', 'title', 'process'] },
  { model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }
];

// Заявка «в архиве» — та, по которой больше ничего не произойдёт.
const ARCHIVE_STATUSES = ['rejected', 'cancelled', 'launched'];

/**
 * Сводка по заявке для списка: где она сейчас и сколько закрыто.
 *
 * Именованных стадий во втором поколении нет — при произвольном процессе они
 * врут. Вместо стадии показывается прогресс по шагам чек-листа и то, что сейчас
 * открыто.
 */
function summarize(app, tasks) {
  const process = app.vacancy?.process || { steps: [] };
  const checklist = processSchema.checklistSteps(process);
  const byStep = new Map(tasks.map(t => [t.stepKey, t]));

  const done = checklist.filter(s => byStep.get(s.key)?.completedAt).length;
  const open = tasks
    .filter(t => !t.completedAt)
    .map(t => processSchema.getStep(process, t.stepKey)?.title || t.stepKey);

  const overdue = tasks.some(t => !t.completedAt && t.dueAt && t.dueAt < new Date());

  return {
    checklist: checklist.map(s => ({
      key: s.key,
      title: s.checklist,
      done: Boolean(byStep.get(s.key)?.completedAt)
    })),
    done,
    total: checklist.length,
    open,
    overdue
  };
}

// ── Что показать при входе ─────────────────────────────────────────────────

router.get('/overview', async (req, res) => {
  try {
    const mine = await VacTask.count({
      where: {
        completedAt: null,
        assigneeIds: { [Op.contains]: [req.user.id] }
      }
    });
    res.json({
      canConfigure: req.acl.isAdmin,
      myTasksCount: mine
    });
  } catch (error) {
    console.error('[vacancies/work] overview:', error);
    res.status(500).json({ error: 'Не удалось загрузить раздел' });
  }
});

// ── Заявки ─────────────────────────────────────────────────────────────────

router.get('/applications', async (req, res) => {
  try {
    const archived = req.query.archived === 'true';
    const where = {
      ...access.applicationScope(req.acl),
      status: archived ? { [Op.in]: ARCHIVE_STATUSES } : { [Op.notIn]: ARCHIVE_STATUSES }
    };

    const rows = await VacApplication.findAll({
      where,
      include: APP_INCLUDE,
      order: [['createdAt', 'DESC']],
      limit: 500
    });

    const tasks = await VacTask.findAll({
      where: { applicationId: rows.map(r => r.id) }
    });
    const byApp = new Map();
    for (const task of tasks) {
      const list = byApp.get(task.applicationId) || [];
      list.push(task);
      byApp.set(task.applicationId, list);
    }

    res.json(rows.map(app => ({
      id: app.id,
      status: app.status,
      fullName: app.fullName,
      phone: app.phone,
      email: app.email,
      startDate: app.startDate,
      professions: app.professions,
      submittedAt: app.submittedAt,
      vacancy: app.vacancy ? { id: app.vacancy.id, title: app.vacancy.title } : null,
      medCenter: app.medCenter ? { id: app.medCenter.id, name: app.medCenter.name } : null,
      ...summarize(app, byApp.get(app.id) || [])
    })));
  } catch (error) {
    console.error('[vacancies/work] applications:', error);
    res.status(500).json({ error: 'Не удалось загрузить заявки' });
  }
});

async function loadApplication(req, res, next) {
  try {
    const app = await VacApplication.findByPk(req.params.id, { include: APP_INCLUDE });
    if (!app) return res.status(404).json({ error: 'Заявка не найдена' });
    if (!access.canSeeApplication(req.acl, app)) {
      return res.status(403).json({ error: 'Эта заявка вам не видна' });
    }
    req.application = app;
    next();
  } catch (error) {
    console.error('[vacancies/work] loadApplication:', error);
    res.status(500).json({ error: 'Не удалось открыть заявку' });
  }
}

/**
 * Карточка заявки.
 *
 * Анкета отдаётся целиком — разграничения по полям во втором поколении нет по
 * решению заказчика. Подписи берутся из снимка: он же и есть та анкета, на
 * которую человек отвечал.
 */
router.get('/applications/:id', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    const process = app.vacancy?.process || { steps: [] };

    const [tasks, events, files] = await Promise.all([
      VacTask.findAll({
        where: { applicationId: app.id },
        include: [
          { model: User, as: 'claimer', attributes: USER_FIELDS },
          { model: User, as: 'completer', attributes: USER_FIELDS }
        ]
      }),
      VacEvent.findAll({
        where: { applicationId: app.id },
        include: [{ model: User, as: 'author', attributes: USER_FIELDS }],
        order: [['createdAt', 'DESC']],
        limit: 200
      }),
      VacFile.findAll({ where: { applicationId: app.id } })
    ]);

    const now = new Date();
    const steps = await Promise.all((process.steps || []).map(async (step) => {
      const task = tasks.find(t => t.stepKey === step.key);
      const overdue = Boolean(task && !task.completedAt && task.dueAt && task.dueAt < now);
      return {
        key: step.key,
        title: step.title,
        hint: step.hint || null,
        kind: step.kind,
        scope: step.scope,
        archived: Boolean(step.archived),
        after: step.after || [],
        // Куда шаг умеет вернуть работу и как называется тот шаг: кнопка
        // «Вернуть» должна говорить, куда именно она отправляет.
        returnTo: step.returnTo || null,
        returnTitle: step.returnTo
          ? ((process.steps || []).find(s => s.key === step.returnTo)?.title || step.returnTo)
          : null,
        task: task ? {
          id: task.id,
          assigneeIds: task.assigneeIds,
          mine: (task.assigneeIds || []).includes(req.user.id),
          claimedBy: task.claimedBy,
          claimer: task.claimer,
          completedAt: task.completedAt,
          completer: task.completer,
          verifiedByMis: task.verifiedByMis,
          dueAt: task.dueAt,
          note: task.note,
          returned: task.returned || null,
          overdue,
          overdueHours: overdue ? await sla.overdueWorkingHours(task.dueAt, now) : 0
        } : null
      };
    }));

    res.json({
      id: app.id,
      status: app.status,
      email: app.email,
      fullName: app.fullName,
      phone: app.phone,
      startDate: app.startDate,
      professions: app.professions,
      submittedAt: app.submittedAt,
      decidedAt: app.decidedAt,
      decisionNote: app.decisionNote,
      revisionFields: app.revisionFields,
      launchedAt: app.launchedAt,
      cancelReason: app.cancelReason,
      consents: app.consents,
      vacancy: app.vacancy ? { id: app.vacancy.id, title: app.vacancy.title } : null,
      medCenter: app.medCenter ? { id: app.medCenter.id, name: app.medCenter.name } : null,

      form: app.formSnapshot,
      values: app.form,
      labels: formSchema.labelMap(app.formSnapshot),
      files,

      steps,
      ...summarize(app, tasks),
      canDecide: canDecide(req, app, process),
      events: events.map(e => ({
        id: e.id, action: e.action, payload: e.payload,
        author: e.author, createdAt: e.createdAt
      }))
    });
  } catch (error) {
    console.error('[vacancies/work] application:', error);
    res.status(500).json({ error: 'Не удалось открыть заявку' });
  }
});

/**
 * Решение принимает тот, на кого назначен шаг решения. Админ может тоже:
 * иначе заявка встанет намертво, если у главврача отпуск, а переназначать шаг
 * ради одного согласования — лишний круг.
 */
function canDecide(req, app, process) {
  if (app.status !== 'submitted') return false;
  if (req.acl.isAdmin) return true;
  const step = engine.decisionStep(process);
  if (!step) return false;
  return req.acl.scopes.some(s => s.vacancyId === app.vacancyId && s.stepKey === step.key);
}

function requireDecider(req, res, next) {
  const process = req.application.vacancy?.process || { steps: [] };
  if (!canDecide(req, req.application, process)) {
    return res.status(403).json({ error: 'Решение по этой заявке принимает не вы' });
  }
  next();
}

router.post('/applications/:id/approve', loadApplication, requireDecider, async (req, res) => {
  try {
    await engine.approve(req.application, req.user, req.body?.note);
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] approve:', error);
    res.status(500).json({ error: 'Не удалось согласовать заявку' });
  }
});

router.post('/applications/:id/revision', loadApplication, requireDecider, async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    const fields = Array.isArray(req.body?.fields) ? req.body.fields.slice(0, 60) : [];
    if (!note && !fields.length) {
      return res.status(400).json({ error: 'Напишите, что поправить, или отметьте поля' });
    }
    await engine.sendToRevision(req.application, req.user, note, fields);
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] revision:', error);
    res.status(500).json({ error: 'Не удалось вернуть заявку' });
  }
});

router.post('/applications/:id/reject', loadApplication, requireDecider, async (req, res) => {
  try {
    await engine.reject(req.application, req.user, String(req.body?.reason || '').trim());
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] reject:', error);
    res.status(500).json({ error: 'Не удалось отклонить заявку' });
  }
});

/** Отмена — на любом этапе и только админом: это выход из процесса, а не шаг. */
router.post('/applications/:id/cancel', loadApplication, async (req, res) => {
  try {
    if (!req.acl.isAdmin) return res.status(403).json({ error: 'Отменить заявку может администратор' });
    await engine.cancel(req.application, req.user, String(req.body?.reason || '').trim());
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] cancel:', error);
    res.status(500).json({ error: 'Не удалось отменить заявку' });
  }
});

// ── Задачи ─────────────────────────────────────────────────────────────────

router.get('/tasks/my', async (req, res) => {
  try {
    const tasks = await VacTask.findAll({
      where: { completedAt: null, assigneeIds: { [Op.contains]: [req.user.id] } },
      include: [{
        model: VacApplication, as: 'application', required: true,
        include: APP_INCLUDE
      }],
      order: [['dueAt', 'ASC']]
    });

    const now = new Date();
    const out = [];
    for (const task of tasks) {
      const app = task.application;
      if (!app || ARCHIVE_STATUSES.includes(app.status)) continue;
      const step = processSchema.getStep(app.vacancy?.process, task.stepKey);
      const overdue = Boolean(task.dueAt && task.dueAt < now);
      out.push({
        id: task.id,
        applicationId: app.id,
        stepKey: task.stepKey,
        title: step?.title || task.stepKey,
        hint: step?.hint || null,
        fullName: app.fullName,
        professions: app.professions,
        vacancy: app.vacancy?.title || null,
        medCenter: app.medCenter?.name || null,
        dueAt: task.dueAt,
        overdue,
        overdueHours: overdue ? await sla.overdueWorkingHours(task.dueAt, now) : 0,
        claimedBy: task.claimedBy,
        // Задача у нескольких — это «кто первый взял». Одна и та же строка у
        // двоих без этого превращается в «думали, сделает другой».
        requiresClaim: new Set((task.assigneeIds || []).filter(Boolean)).size > 1
      });
    }

    res.json(out);
  } catch (error) {
    console.error('[vacancies/work] my tasks:', error);
    res.status(500).json({ error: 'Не удалось загрузить задачи' });
  }
});

async function loadTask(req, res, next) {
  try {
    const task = await VacTask.findByPk(req.params.taskId, {
      include: [{ model: VacApplication, as: 'application', include: APP_INCLUDE }]
    });
    if (!task || !task.application) return res.status(404).json({ error: 'Задача не найдена' });
    if (!access.canSeeApplication(req.acl, task.application)) {
      return res.status(403).json({ error: 'Эта задача вам не видна' });
    }
    const mine = (task.assigneeIds || []).includes(req.user.id);
    if (!mine && !req.acl.isAdmin) {
      return res.status(403).json({ error: 'Задача назначена не на вас' });
    }
    req.task = task;
    req.application = task.application;
    next();
  } catch (error) {
    console.error('[vacancies/work] loadTask:', error);
    res.status(500).json({ error: 'Не удалось открыть задачу' });
  }
}

/** Взять общую задачу. После этого она закрепляется и пропадает у остальных. */
router.post('/tasks/:taskId/claim', loadTask, async (req, res) => {
  try {
    const task = req.task;
    if (task.completedAt) return res.status(400).json({ error: 'Задача уже закрыта' });
    if (task.claimedBy && task.claimedBy !== req.user.id) {
      return res.status(409).json({ error: 'Задачу уже взял коллега' });
    }
    await task.update({ claimedBy: req.user.id, claimedAt: new Date() });
    await engine.log(req.application.id, 'task_claimed', { stepKey: task.stepKey }, req.user.id);
    engine.signalChanged(task.assigneeIds, {
      reason: 'task_claimed', applicationId: req.application.id, stepKey: task.stepKey
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] claim:', error);
    res.status(500).json({ error: 'Не удалось взять задачу' });
  }
});

/**
 * Вернуть работу назад (ver. 8.38).
 *
 * Доступно шагу, у которого в процессе указано, куда возвращать. Право то же,
 * что у закрытия: возвращает тот, кто эту задачу и делает, — он и смотрел
 * документы.
 */
router.post('/tasks/:taskId/return', loadTask, async (req, res) => {
  try {
    const task = req.task;
    if (task.completedAt) return res.status(400).json({ error: 'Задача уже закрыта' });
    if (task.claimedBy && task.claimedBy !== req.user.id && !req.acl.isAdmin) {
      return res.status(409).json({ error: 'Задачу взял коллега' });
    }

    const note = String(req.body?.note || '').trim();
    const fields = Array.isArray(req.body?.fields) ? req.body.fields.slice(0, 60) : [];
    if (!note && !fields.length) {
      return res.status(400).json({ error: 'Напишите, что поправить, или отметьте поля' });
    }

    const result = await engine.returnToStep(req.application, task, req.user, { note, fields });
    if (!result.ok) return res.status(409).json(result);
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] return:', error);
    res.status(500).json({ error: 'Не удалось вернуть работу' });
  }
});

router.post('/tasks/:taskId/complete', loadTask, async (req, res) => {
  try {
    const task = req.task;
    if (task.completedAt) return res.status(400).json({ error: 'Задача уже закрыта' });
    if (task.claimedBy && task.claimedBy !== req.user.id && !req.acl.isAdmin) {
      return res.status(409).json({ error: 'Задачу взял коллега' });
    }

    const result = await engine.completeTask(req.application, task, req.user, {
      note: String(req.body?.note || '').trim() || null
    });

    if (!result.ok) return res.status(409).json(result);
    res.json({ ok: true });
  } catch (error) {
    console.error('[vacancies/work] complete:', error);
    res.status(500).json({ error: 'Не удалось закрыть задачу' });
  }
});

/** Услуги, отмеченные кандидатом, — их смотрит тот, кто вносит их в МИС. */
router.get('/applications/:id/services', loadApplication, async (req, res) => {
  try {
    const rows = await VacServiceChoice.findAll({
      where: { applicationId: req.application.id },
      order: [['title', 'ASC']]
    });
    res.json(rows);
  } catch (error) {
    console.error('[vacancies/work] services:', error);
    res.status(500).json({ error: 'Не удалось загрузить услуги' });
  }
});

module.exports = router;
