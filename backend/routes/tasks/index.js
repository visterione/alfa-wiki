/**
 * Модуль «Задачи» (ver. 6.75) — сборка подроутеров.
 *
 * Разложен по файлам по тем же причинам, что и складской учёт: справочник
 * проектов, команды, сами задачи, планирование и отчёты — пять довольно разных
 * наборов маршрутов, и общий файл пришлось бы читать поиском.
 *
 * Порядок монтирования важен: /projects, /teams, /people и /inbox стоят до
 * /:id, иначе Express примет слово «inbox» за идентификатор задачи.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middleware/auth');
const context = require('../../services/tasks/context');
const teamsService = require('../../services/tasks/teams');
const schedule = require('../../services/tasks/schedule');

/**
 * Что этому пользователю доступно в модуле. Клиент дёргает первым делом.
 *
 * Отдельно отдаётся признак «заведён ли человек в модуле» — рабочее расписание.
 * Без него интерфейс не может ни посчитать загрузку, ни принять задачу, и
 * честнее сказать об этом сразу, чем показывать пустой календарь.
 */
router.get('/access', authenticate, async (req, res) => {
  try {
    const teams = await context.loadTeams();
    const visible = teamsService.visibleTeams(teams, req.user.id, req.user.isAdmin);
    const workSchedule = req.user.taskWorkSchedule || null;

    res.json({
      allowed: true,
      workSchedule,
      weeklyHours: schedule.weeklyHours(workSchedule),
      // Пока расписание не задано, человек в планировании не участвует: ему нельзя
      // ставить задачи, и он не видит собственной загрузки.
      enrolled: workSchedule !== null,
      isAdmin: !!req.user.isAdmin,
      canManageProjects: !!(req.user.isAdmin || req.user.adminAccess?.tasks),
      teams: visible.map(t => ({
        id: t.id,
        name: t.name,
        medCenterId: t.medCenterId,
        isMember: teamsService.isMember(t, req.user.id),
        isLead: teamsService.isLead(t, req.user.id),
      })),
    });
  } catch (error) {
    console.error('Ошибка доступа к модулю «Задачи»:', error);
    res.status(500).json({ error: 'Не удалось получить доступ к модулю' });
  }
});

/**
 * Счётчик для бейджа на кнопке модуля.
 *
 * Считаются только те части, где ход за самим человеком: не разобранные
 * входящие и застрявшие после трёх переносов. Числа активных задач здесь
 * намеренно нет — оно никогда не опускается до нуля, а бейдж, который горит
 * всегда, перестают замечать через неделю. Ноль на кнопке должен означать
 * «сейчас от тебя ничего не ждут», иначе он ничего не означает.
 *
 * Запрос лёгкий: только count, без выборки самих частей и без расчёта загрузки,
 * которым занимаются «Входящие». Его дёргает сайдбар на каждой странице
 * портала, в том числе у людей, которые в модуль не заходят.
 */
router.get('/badge', authenticate, async (req, res) => {
  try {
    const { TaskPart, TaskPartAssignee } = require('../../models');
    const partsService = require('../../services/tasks/parts');

    const [inbox, stuck] = await Promise.all([
      TaskPartAssignee.count({
        where: { userId: req.user.id, plannedDate: null, declinedAt: null },
        include: [{ model: TaskPart, as: 'part', required: true }],
      }),
      TaskPartAssignee.count({
        where: { userId: req.user.id, declinedAt: null },
        include: [{
          model: TaskPart,
          as: 'part',
          required: true,
          where: { status: partsService.STATUS.STUCK },
        }],
      }),
    ]);

    res.json({ count: inbox + stuck, inbox, stuck });
  } catch (error) {
    console.error('Счётчик задач:', error);
    // Бейдж не стоит того, чтобы страница отдавала ошибку: показываем ноль.
    res.json({ count: 0, inbox: 0, stuck: 0 });
  }
});

router.use('/projects', require('./projects'));
router.use('/teams', require('./teams'));
router.use('/people', require('./people'));
router.use('/reports', require('./reports'));
router.use('/', require('./tasks'));

module.exports = router;
