/**
 * Люди и рабочие расписания.
 *
 * Расписание действует сразу: пересчитываются дни, цвета и проверка при
 * постановке задач. Изменения сохраняются в истории.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const { authenticate } = require('../../middleware/auth');
const { User, TaskScheduleChange, CalendarEvent, TaskPartAssignee } = require('../../models');
const context = require('../../services/tasks/context');
const teams = require('../../services/tasks/teams');
const loadQuery = require('../../services/tasks/loadQuery');
const workload = require('../../services/tasks/workload');
const eventVisibility = require('../../services/tasks/visibility');
const schedule = require('../../services/tasks/schedule');

/**
 * Люди в области видимости запрашивающего.
 *
 * Это не «все сотрудники»: человек видит тех, с кем состоит в общих командах,
 * плюс участников команд, открытых для всей компании. При двухстах сотрудниках
 * список всех подряд бессмысленен, а при скрытых командах ещё и опасен.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { start, end, medCenterId, teamId } = req.query;
    const all = await context.loadTeams();
    const scope = teams.peopleInScope(all, req.user.id, req.user.isAdmin, { medCenterId, teamId });

    const users = await User.findAll({
      // position — это должность из профиля («Старшая медсестра»), а не роль в
      // системе: права здесь ни при чём, в таблице людей нужно понимать, кто
      // перед тобой, прежде чем ставить ему задачу.
      attributes: ['id', 'displayName', 'username', 'avatar', 'position', 'taskWorkSchedule'],
      where: { id: scope },
      raw: true,
    });

    // Период необязателен: экран «Люди» открывается и без него, тогда свободное
    // время просто не считается.
    let freeByUser = new Map();
    if (start && end) {
      const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
      const matrix = await loadQuery.loadMatrix(scope, start, end, viewer);
      for (const [userId, perDay] of matrix) {
        const days = [...perDay].map(([, load]) => load);
        freeByUser.set(userId, {
          freeHours: round(days.reduce((s, d) => s + (d.free || 0), 0)),
          overloadedDays: days.filter(d => d.color === workload.COLORS.OVER).length,
          // Часы сверх нормы, а не только число испорченных дней: «2 дн.» ничего
          // не говорит о масштабе — это может быть и лишние двадцать минут, и
          // лишний рабочий день. Считается только там, где норма есть: в
          // выходной и в отпуск норма null, и вычитать из неё нечего.
          overloadHours: round(days.reduce((s, d) => s + (d.norm > 0 ? Math.max((d.hours || 0) - d.norm, 0) : 0), 0)),
        });
      }
    }

    res.json(users.map(u => ({
      ...u,
      workSchedule: u.taskWorkSchedule,
      weeklyHours: schedule.weeklyHours(u.taskWorkSchedule),
      teams: all
        .filter(t => teams.isMember(t, u.id) && teams.canSeeTeam(t, req.user.id, req.user.isAdmin))
        .map(t => ({ id: t.id, name: t.name })),
      ...(freeByUser.get(u.id) || {}),
    })));
  } catch (error) {
    console.error('Список людей:', error);
    res.status(500).json({ error: 'Не удалось получить список людей' });
  }
});

/**
 * Загрузка людей одной таблицей — вкладка «Сотрудники» на экране загрузки.
 *
 * Появилась потому, что человек редко состоит в одной команде, а половина
 * компании не состоит ни в одной: чтобы понять, кому можно поручить работу,
 * руководителю приходилось обходить карточки команд по очереди и складывать
 * одного и того же сотрудника в уме, а того, кого в команды не записали, он не
 * видел вовсе.
 *
 * Кого показывать — главное решение маршрута, и оно разное для двух случаев.
 *
 * Куратору модуля (администратор или adminAccess.tasks) приходят те, кто в
 * модуле участвует: у кого настроено рабочее расписание либо кто хоть раз был
 * зафиксирован исполнителем части задачи. Это не «все пользователи портала» —
 * такой список на 140 человек состоял бы из строк с прочерками, в которых
 * утонули бы те несколько, ради кого экран открывают. И не «только с
 * расписанием»: исполнитель без расписания часы всё равно тратит, его блоки
 * лежат в календаре, и не показать их значит соврать про день.
 *
 * Всем остальным остаётся прежняя граница: участники команд, чью загрузку им
 * открыли. Иначе вкладка стала бы обходом настроек команд — именно тем, от чего
 * закрытые команды и защищают. Участников команды при этом не фильтруем по
 * участию в модуле: членство в команде и есть явное участие, а свежедобавленный
 * человек не должен пропадать из таблицы, в которой его только что завели.
 *
 * Уволенные (isActive = false) не показываются никому: их часы — история, а
 * список отвечает на вопрос про завтра.
 */
router.get('/load', authenticate, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Нужен период: start и end' });

    const all = await context.loadTeams();
    const seesEveryone = !!(req.user.isAdmin || req.user.adminAccess?.tasks);

    // Исполнители берутся за всё время, а не за показанный период: человек,
    // которому в прошлом месяце ставили задачи, из списка исчезать не должен —
    // иначе он «пропадает» ровно тогда, когда у него освободилось время.
    const assignees = seesEveryone
      ? (await TaskPartAssignee.findAll({ attributes: ['userId'], group: ['userId'], raw: true })).map(a => a.userId)
      : [];

    const users = await User.findAll({
      // position — должность из профиля: в списке без деления на команды «кто
      // это вообще» по одному имени уже не понять, особенно у тех, кого в
      // командах нет.
      attributes: ['id', 'displayName', 'username', 'avatar', 'position', 'taskWorkSchedule'],
      where: seesEveryone
        ? {
          isActive: true,
          [Op.or]: [
            { taskWorkSchedule: { [Op.ne]: null } },
            ...(assignees.length ? [{ id: { [Op.in]: assignees } }] : []),
          ],
        }
        : { id: teams.peopleInScope(all, req.user.id, req.user.isAdmin), isActive: true },
      raw: true,
    });

    const scope = users.map(u => u.id);
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const matrix = await loadQuery.loadMatrix(scope, start, end, viewer);
    const byId = new Map(users.map(u => [u.id, u]));

    const rows = loadQuery.toRows(matrix).map(row => ({
      ...row,
      user: byId.get(row.userId) || null,
      // Команды человека — только те, о которых знает смотрящий: подпись
      // «Найм и офферы» под именем рассказала бы о скрытой команде больше, чем
      // список команд, куда она не попала.
      teams: all
        .filter(t => teams.isMember(t, row.userId) && teams.canSeeTeam(t, req.user.id, req.user.isAdmin))
        .map(t => ({ id: t.id, name: t.name })),
    }));

    res.json({
      rows,
      summary: loadQuery.summarize(matrix),
      // Кем ограничен список — чтобы подпись под таблицей говорила правду о
      // том, что человек видит, а не общую формулировку на оба случая.
      scope: seesEveryone ? 'module' : 'teams',
      // Исполнители без расписания: часы у них есть, а нормы нет, и полоса
      // сравнивать её не с чем. Это рабочий список «кого ещё завести».
      notEnrolled: users.filter(u => !u.taskWorkSchedule).length,
    });
  } catch (error) {
    console.error('Загрузка людей:', error);
    res.status(500).json({ error: 'Не удалось посчитать загрузку' });
  }
});

/**
 * Загрузка одного человека за период — часы и цвет, без содержания дел.
 *
 * Даже собственный руководитель не получает отсюда названий: для этого есть
 * календарь, который проходит через фильтр видимости.
 */
router.get('/:id/load', authenticate, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Нужен период: start и end' });

    const all = await context.loadTeams();
    const scope = teams.peopleInScope(all, req.user.id, req.user.isAdmin);
    if (!scope.includes(req.params.id)) {
      return res.status(403).json({ error: 'Загрузка этого человека вам закрыта' });
    }

    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const days = await loadQuery.daysOf(req.params.id, start, end, viewer);
    res.json({
      userId: req.params.id,
      days,
      freeHours: workload.freeOverPeriod(days.map(d => ({ ...d, events: [] })), viewer),
      overloadedDays: days.filter(d => d.color === workload.COLORS.OVER).length,
    });
  } catch (error) {
    console.error('Загрузка человека:', error);
    res.status(500).json({ error: 'Не удалось посчитать загрузку' });
  }
});

/**
 * Занятые интервалы одного дня без содержания событий.
 *
 * Форма постановки видит только геометрию времени. private чужого человека не
 * существует даже здесь; остальные уровни возвращаются одинаковыми серыми
 * интервалами, поэтому по ответу нельзя восстановить название или тип дела.
 */
router.get('/:id/slots', authenticate, async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Нужна дата YYYY-MM-DD' });
    }

    const all = await context.loadTeams();
    const scope = teams.peopleInScope(all, req.user.id, req.user.isAdmin);
    if (!scope.includes(req.params.id)) {
      return res.status(403).json({ error: 'Расписание этого человека вам закрыто' });
    }

    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const events = await CalendarEvent.findAll({
      attributes: loadQuery.LOAD_FIELDS,
      where: {
        createdBy: req.params.id,
        status: { [Op.ne]: 'cancelled' },
        startTime: { [Op.lt]: new Date(`${date}T23:59:59`) },
        endTime: { [Op.gt]: new Date(`${date}T00:00:00`) },
      },
      raw: true,
    });

    const user = await User.findByPk(req.params.id, { attributes: ['taskWorkSchedule'], raw: true });
    const workDay = schedule.forDate(user?.taskWorkSchedule, date);
    const slots = events
      .filter(event => eventVisibility.countsAsBusyFor(event, viewer))
      .map(event => ({ startTime: event.startTime, endTime: event.endTime }));
    res.json({ userId: req.params.id, date, slots, workDay });
  } catch (error) {
    console.error('Занятые интервалы человека:', error);
    res.status(500).json({ error: 'Не удалось получить занятые интервалы' });
  }
});

/**
 * Изменение недельного расписания.
 *
 * Себе — можно всегда. Норма дня вычисляется из границ смены; чужое расписание
 * меняет только руководитель общей команды или
 * администратор.
 */
router.put('/:id/schedule', authenticate, async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'workSchedule')) {
      return res.status(400).json({ error: 'Передайте workSchedule или null' });
    }
    let value;
    try { value = schedule.normalizeSchedule(req.body.workSchedule); }
    catch (error) { return res.status(400).json({ error: error.message }); }

    if (req.params.id !== req.user.id) {
      const all = await context.loadTeams();
      if (!teams.canEditNorm(all, req.user.id, req.params.id, req.user.isAdmin)) {
        return res.status(403).json({ error: 'Менять чужое расписание может руководитель команды' });
      }
    }

    const user = await User.findByPk(req.params.id, { attributes: ['id', 'taskWorkSchedule'] });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const oldValue = user.taskWorkSchedule;
    await user.update({ taskWorkSchedule: value });
    await TaskScheduleChange.create({
      userId: user.id,
      oldSchedule: oldValue,
      newSchedule: value,
      changedBy: req.user.id,
    });

    res.json({ userId: user.id, workSchedule: value, weeklyHours: schedule.weeklyHours(value), previous: oldValue });
  } catch (error) {
    console.error('Изменение расписания:', error);
    res.status(500).json({ error: 'Не удалось изменить расписание' });
  }
});

/** История изменений расписания. */
router.get('/:id/schedule/history', authenticate, async (req, res) => {
  try {
    const rows = await TaskScheduleChange.findAll({
      where: { userId: req.params.id },
      include: [{ model: User, as: 'changedByUser', attributes: ['id', 'displayName', 'username'], required: false }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json(rows);
  } catch (error) {
    console.error('История расписания:', error);
    res.status(500).json({ error: 'Не удалось получить историю' });
  }
});

const round = v => Math.round(v * 100) / 100;

module.exports = router;
