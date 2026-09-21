/**
 * Задачи, части и согласование срока.
 *
 * Главный файл модуля. Порядок маршрутов имеет значение: /inbox и /parts стоят
 * до /:id, иначе Express примет эти слова за идентификатор задачи.
 *
 * Ключевое отличие от доски: постановка задачи не назначает работу, а начинает
 * разговор. Автор предлагает срок, исполнитель либо ставит в план — и тогда
 * часть превращается в блок времени и начинает занимать часы, — либо предлагает
 * свой срок, и тогда в его календаре не меняется ничего.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const { authenticate } = require('../../middleware/auth');
const {
  Task, TaskPart, TaskPartAssignee, TaskPartDep, TaskHistory,
  TaskProject, TaskTeam, CalendarEvent, User, sequelize,
} = require('../../models');

const context = require('../../services/tasks/context');
const teamsService = require('../../services/tasks/teams');
const partsService = require('../../services/tasks/parts');
const codes = require('../../services/tasks/codes');
const planning = require('../../services/tasks/planning');
const loadQuery = require('../../services/tasks/loadQuery');
const workload = require('../../services/tasks/workload');
const scheduleService = require('../../services/tasks/schedule');
const taskNotify = require('../../services/tasks/notify');

const USER_FIELDS = ['id', 'displayName', 'username', 'avatar'];

/** Полная задача со всем, что нужно карточке. */
const TASK_INCLUDE = () => [
  { model: TaskProject, as: 'project', required: false },
  // Только id и название: остальное про команду спрашивают у маршрутов команд,
  // а состав тащить в каждую карточку задачи незачем.
  { model: TaskTeam, as: 'team', attributes: ['id', 'name'], required: false },
  { model: User, as: 'author', attributes: USER_FIELDS, required: false },
  {
    model: TaskPart,
    as: 'parts',
    required: false,
    include: [{
      model: TaskPartAssignee,
      as: 'assignees',
      required: false,
      include: [{ model: User, as: 'user', attributes: USER_FIELDS, required: false }],
    }],
  },
];

/** Задача в виде, пригодном для клиента: производные поля считаются здесь. */
function shape(task, deps = []) {
  const plain = task.get ? task.get({ plain: true }) : task;
  const parts = plain.parts || [];
  return {
    ...plain,
    status: partsService.taskStatus(parts),
    mode: partsService.taskMode(parts),
    people: partsService.taskPeople(parts),
    totalEffortHours: partsService.totalEffortHours(parts),
    // Период, в который задача фактически расписана (ver. 8.48). Выводится, а не
    // хранится: второй источник правды рядом с окнами подзадач разошёлся бы с
    // ними на первом же переносе. Срок задачи (dueDate) приезжает из базы рядом
    // — его можно нарушить, и потому он хранится.
    span: partsService.taskSpan(parts),
    breaksDeadline: partsService.breaksDeadline(plain, parts),
    // Отметка стоит на той подзадаче, которую надо править, а не общим признаком
    // на задачу: «одна подзадача выходит за срок» заставляет угадывать, какая.
    parts: parts.map(part => ({
      ...part,
      outsideTask: partsService.partOutsideTask(plain, part),
    })),
    deps: deps.filter(d => parts.some(p => p.id === d.partId)),
  };
}

/**
 * Помещается ли подзадача — один вопрос, два разных ответа.
 *
 * Однодневная спрашивает про один день: «станет 8,2 из 6,4». Многодневная — про
 * ёмкость окна целиком: «нужно 20 ч, свободно 14». Разводить это по вызывающим
 * нельзя — тогда экран входящих, форма постановки и постановка в план начнут
 * считать помещаемость каждый по-своему, а это ровно то число, ради которого
 * модуль существует.
 *
 * Дни окна возвращаются только для многодневной: интерфейсу они нужны, чтобы
 * нарисовать раскладку с остатком по каждому дню. Для однодневной там один день,
 * и он уже разобран в самом ответе.
 */
async function assessFor(part, userId, viewer) {
  const { from, to } = partsService.windowOf(part);
  const days = await loadQuery.daysOf(userId, from, to, viewer);
  const estimateHours = Number(part.estimateHours || 0);
  if (partsService.isWindowed(part)) {
    return {
      windowed: true, from, to, days,
      ...planning.assessWindow({ days, estimateHours }),
    };
  }
  const day = days[0] || {};
  return {
    windowed: false, from, to, date: to,
    ...planning.assessAssignment({
      currentHours: day.hours || 0,
      norm: day.norm ?? null,
      estimateHours,
      onVacation: day.onVacation,
      onDayOff: day.onDayOff,
    }),
  };
}

async function depsOf(taskIds) {
  if (!taskIds.length) return [];
  const parts = await TaskPart.findAll({ attributes: ['id'], where: { taskId: taskIds }, raw: true });
  const ids = parts.map(p => p.id);
  if (!ids.length) return [];
  return TaskPartDep.findAll({ where: { partId: { [Op.in]: ids } }, raw: true });
}

/**
 * Видна ли человеку задача. Одна функция на список, карточку и переход из
 * календаря — разъехавшись, они дали бы работу, которой нет в списке, но
 * которая открывается прямой ссылкой.
 *
 * Четыре основания, любого достаточно: автор, исполнитель, участник команды,
 * которой задача привязана (ver. 8.42), руководитель над её исполнителем.
 */
function canSeeTask(task, parts, user, allTeams) {
  if (task.authorId === user.id) return true;
  if (task.teamId && teamsService.teamIdsForTasks(allTeams, user.id).includes(task.teamId)) {
    return true;
  }
  const assigneeIds = (parts || []).flatMap(part => (part.assignees || []).map(a => a.userId));
  if (assigneeIds.includes(user.id)) return true;
  const scope = new Set(teamsService.taskScope(allTeams, user.id));
  return assigneeIds.some(id => scope.has(id));
}

/**
 * Может ли человек объявить задачу принадлежащей этой команде.
 *
 * Участник или руководитель — да, наблюдатель — нет, посторонний — нет.
 * Администратора-исключения здесь нет по той же причине, что и в видимости:
 * команды модуля скрытые, и администратор не знает об их существовании.
 */
async function canBindToTeam(teamId, userId) {
  const all = await context.loadTeams();
  const team = all.find(t => t.id === teamId);
  return !!team && teamsService.memberIds(team).includes(userId);
}

/** Запись в историю. Отдельной функцией, чтобы её нельзя было забыть. */
function log(taskId, partId, userId, action, payload = {}, transaction) {
  return TaskHistory.create({ taskId, partId, userId, action, payload }, { transaction });
}

/**
 * Уведомление о событии задачи: всплывающее окно в вебе, push на телефоне.
 *
 * Раньше это было сообщение от Альфа-Ассистента в чате — см. services/tasks/
 * notify.js о том, почему оно перестало быть перепиской. Здесь остался только
 * сбор текста: заголовок — суть события, тело — кто и что сделал.
 */
function notifyUsers(userIds, event) {
  return taskNotify.notify(userIds, event);
}

/** «18.08.26» — в уведомлении срок должен читаться без домысливания года. */
function dateText(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)}`;
}

function actorName(user) {
  return user?.displayName || user?.username || 'Сотрудник';
}

// ─────────────────────────────────────────────────────────────────────────────
// ВХОДЯЩИЕ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Что ждёт моего решения и кого жду я.
 *
 * Второй список не менее важен первого: автор должен видеть, что поставленная
 * им задача до сих пор никем не разобрана. На обычной доске она лежала бы в
 * колонке «К выполнению» и выглядела как начатая работа.
 */
router.get('/inbox', authenticate, async (req, res) => {
  try {
    const mine = await TaskPart.findAll({
      include: [
        {
          model: TaskPartAssignee,
          as: 'assignees',
          required: true,
          where: { userId: req.user.id, plannedDate: null, declinedAt: null },
        },
        { model: Task, as: 'task', required: true, include: [
          { model: User, as: 'author', attributes: USER_FIELDS, required: false },
          { model: TaskProject, as: 'project', required: false },
        ] },
      ],
      order: [['dueDate', 'ASC']],
    });

    // Части, готовые к работе: пока предыдущая не завершена, часть не
    // предлагается в календарь — связь «после» это условие, а не пометка.
    const allParts = await TaskPart.findAll({
      attributes: ['id', 'status'],
      where: { taskId: { [Op.in]: [...new Set(mine.map(p => p.taskId))] } },
      raw: true,
    });
    const byId = Object.fromEntries(allParts.map(p => [p.id, p]));
    const deps = await TaskPartDep.findAll({
      where: { partId: { [Op.in]: mine.map(p => p.id) } },
      raw: true,
    });

    const ready = [];
    const blocked = [];
    for (const part of mine) {
      (partsService.isUnblocked(part, byId, deps) ? ready : blocked).push(part);
    }

    // Оценка помещаемости на предложенный срок — то, ради чего экран и нужен.
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const withFit = [];
    for (const part of ready) {
      withFit.push({
        ...part.get({ plain: true }),
        assessment: await assessFor(part, req.user.id, viewer),
      });
    }

    const waiting = await TaskPart.findAll({
      include: [
        { model: Task, as: 'task', required: true, where: { authorId: req.user.id } },
        {
          model: TaskPartAssignee,
          as: 'assignees',
          required: true,
          where: { plannedDate: null, declinedAt: null, userId: { [Op.ne]: req.user.id } },
          include: [{ model: User, as: 'user', attributes: USER_FIELDS, required: false }],
        },
      ],
      order: [['dueDate', 'ASC']],
    });

    res.json({ mine: withFit, blocked, waiting });
  } catch (error) {
    console.error('Входящие:', error);
    res.status(500).json({ error: 'Не удалось получить входящие' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// СПИСОК И КАРТОЧКА
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Кому из перечисленных людей что назначено — id задач, а не самих частей.
 *
 * Отдельным запросом, а не включением в основную выборку: задача видна, если в
 * область попал хотя бы один исполнитель хотя бы одной части, и выразить это
 * через JOIN значит либо получить дубли строк, либо потерять задачи без частей.
 */
async function taskIdsAssignedTo(userIds) {
  if (!userIds.length) return [];
  const rows = await TaskPartAssignee.findAll({
    attributes: ['partId'],
    where: { userId: { [Op.in]: userIds } },
    include: [{ model: TaskPart, as: 'part', attributes: ['taskId'], required: true }],
    raw: true,
    nest: true,
  });
  return [...new Set(rows.map(r => r.part.taskId))];
}

/**
 * Список задач. Кто что видит — решается здесь, и это три разных вопроса.
 *
 *   scope=own   — «мои задачи»: я исполнитель или я автор, и больше ничего.
 *                 Этим ходят раздел «Моё» и личная доска. Раньше оба спрашивали
 *                 маршрут без параметров и получали полную область видимости —
 *                 руководителю команды в «Моё» приезжали задачи его участников.
 *   scope=team  — «задачи команды»: всё, что к ней привязано. Этим ходит доска
 *                 на странице команды. Право проверяется по составу: не
 *                 участник — 403, включая администратора, потому что команды
 *                 модуля скрытые и от администратора тоже.
 *   без scope   — полная область видимости: своё, подчинённые по команде и
 *                 задачи команд, в которых состоишь.
 *
 * Личная доска и «Моё» обязаны отвечать одинаково: это один набор задач в двух
 * отображениях, и разойтись они не должны — поэтому правило одно, параметр
 * один, и живёт он в одном месте.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const all = await context.loadTeams();
    const myTeamIds = teamsService.teamIdsForTasks(all, req.user.id);
    const scope = String(req.query.scope || '');
    const teamId = req.query.teamId || null;

    let where;
    if (scope === 'own') {
      const mine = await taskIdsAssignedTo([req.user.id]);
      where = { [Op.or]: [{ id: { [Op.in]: mine } }, { authorId: req.user.id }] };
    } else if (scope === 'team') {
      if (!teamId) return res.status(400).json({ error: 'Нужна команда' });
      // 404, а не 403: скрытая команда не должна подтверждать своё
      // существование кодом ответа — это ровно то, что она прячет.
      if (!myTeamIds.includes(teamId)) {
        return res.status(404).json({ error: 'Команда не найдена' });
      }
      where = { teamId };
    } else {
      /**
       * Область видимости названий, а не загрузки: свои задачи, задачи своих
       * подчинённых по команде, поставленные самим и задачи команд, в которых
       * состоишь. Часы коллег по-прежнему видны всей команде — но на экранах
       * загрузки, где это цифра занятости, а не содержание чужой работы.
       */
      const people = await taskIdsAssignedTo(teamsService.taskScope(all, req.user.id));
      where = {
        [Op.or]: [
          { id: { [Op.in]: people } },
          { authorId: req.user.id },
          { teamId: { [Op.in]: myTeamIds } },
        ],
      };
    }

    where.isArchived = req.query.archived === 'true';
    if (req.query.projectId) where.projectId = req.query.projectId;
    // Фильтр по команде поверх своей области видимости: «мои задачи в этой
    // команде». Права он не расширяет — выборка уже сужена выше.
    if (teamId && scope !== 'team') where.teamId = teamId;

    const rows = await Task.findAll({
      where,
      include: TASK_INCLUDE(),
      order: [['createdAt', 'DESC']],
    });
    const deps = await depsOf(rows.map(r => r.id));

    let list = rows.map(t => shape(t, deps));
    if (req.query.status) list = list.filter(t => t.status === req.query.status);
    if (req.query.mine === 'true') list = list.filter(t => t.authorId === req.user.id);
    // «Где я исполнитель» — не то же самое, что «мои задачи»: половина списка у
    // руководителя это то, что он поставил другим, и делать её ему не нужно.
    if (req.query.assigned === 'true') list = list.filter(t => t.people.includes(req.user.id));
    if (req.query.multi === 'true') list = list.filter(t => t.people.length > 1);

    res.json(list);
  } catch (error) {
    console.error('Список задач:', error);
    res.status(500).json({ error: 'Не удалось получить задачи' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id, {
      include: [
        ...TASK_INCLUDE(),
        {
          model: TaskHistory,
          as: 'history',
          required: false,
          include: [{ model: User, as: 'user', attributes: USER_FIELDS, required: false }],
        },
      ],
      order: [[{ model: TaskHistory, as: 'history' }, 'createdAt', 'ASC']],
    });
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });

    // UUID не является правом доступа. Карточка должна соблюдать ту же
    // область видимости, что список задач, иначе скрытую работу можно открыть
    // прямой ссылкой, хотя в интерфейсе её нет.
    const allTeams = await context.loadTeams();
    if (!canSeeTask(task, task.parts, req.user, allTeams)) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

    const deps = await depsOf([task.id]);
    res.json(shape(task, deps));
  } catch (error) {
    console.error('Карточка задачи:', error);
    res.status(500).json({ error: 'Не удалось получить задачу' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// СОЗДАНИЕ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создание задачи с частями.
 *
 * Проверка загрузки идёт по каждому исполнителю отдельно и по его личной норме.
 * Если кто-то не помещается, а объяснение не приложено — 409 с разбором, что
 * именно не так. Обойти можно всегда, но не молча: текст уходит исполнителю и
 * остаётся в истории задачи.
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Нужно название задачи' });

    const incoming = Array.isArray(req.body.parts) ? req.body.parts : [];
    if (!incoming.length) return res.status(400).json({ error: 'Нужна хотя бы одна подзадача' });

    /**
     * Привязка к команде объявляет задачу общей: её увидит весь состав вместе с
     * описанием и вложениями. Поэтому привязать можно только к своей команде и
     * только тому, кто в ней работает, — наблюдатель смотрит чужую работу, а не
     * пополняет её.
     */
    const teamId = req.body.teamId || null;
    if (teamId && !(await canBindToTeam(teamId, req.user.id))) {
      return res.status(403).json({ error: 'Можно привязать только к своей команде' });
    }
    /**
     * Срок задачи (ver. 8.48): начало и конец, оба необязательные.
     *
     * Задача без своего срока — обычное дело: работа, у которой есть только сроки
     * подзадач, никому ничего не обещала. Требовать срок значило бы заставлять
     * придумывать дату там, где её нет.
     *
     * startDate пустой при заполненном dueDate — это «один день», то же правило,
     * что у подзадач.
     */
    const taskDueDate = req.body.dueDate ? String(req.body.dueDate).slice(0, 10) : null;
    const taskStartDate = taskDueDate && req.body.startDate
      ? String(req.body.startDate).slice(0, 10) : null;
    if (taskStartDate && taskStartDate > taskDueDate) {
      return res.status(400).json({ error: 'Срок задачи начинается позже своего конца' });
    }

    for (const part of incoming) {
      if (!Array.isArray(part.assignees) || !part.assignees.length) {
        return res.status(400).json({ error: 'У каждой подзадачи должен быть исполнитель' });
      }
      if (!part.dueDate) return res.status(400).json({ error: 'У каждой подзадачи должен быть срок' });
      if (part.startDate && String(part.startDate).slice(0, 10) > String(part.dueDate).slice(0, 10)) {
        return res.status(400).json({ error: 'Окно подзадачи начинается позже своего срока' });
      }
      if (!(Number(part.estimateHours) > 0)) {
        return res.status(400).json({ error: 'У каждой подзадачи должен быть объём работы' });
      }
    }

    // Подзадача со сроком за пределами срока задачи НЕ отклоняется: иногда
    // именно так и выясняется, что обещание было невыполнимым, и запрет заставил
    // бы автора подогнать даты под обещание вместо того, чтобы его пересмотреть.
    // Признак конфликта считает partsService.breaksDeadline, и показывают его и
    // форма, и карточка.

    // Цикл в связях «после» ловится до сохранения: иначе часть навсегда
    // застрянет в ожидании готовности той, которая ждёт её саму.
    const localParts = incoming.map((p, i) => ({ id: p.id || `n${i}` }));
    const localDeps = [];
    incoming.forEach((p, i) => {
      for (const after of p.after || []) {
        localDeps.push({ partId: localParts[i].id, afterPartId: after });
      }
    });
    const cycle = partsService.findCycle(localParts, localDeps);
    if (cycle) {
      return res.status(400).json({ error: 'В связях «после» есть цикл', cycle });
    }

    // Разбор загрузки по каждому исполнителю каждой части. Однодневная часть
    // проверяется по своему дню, многодневная — по ёмкости всего окна: см.
    // assessFor, там же и причина, почему это одна функция на все экраны.
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const overloads = [];
    for (const part of incoming) {
      for (const userId of part.assignees) {
        const probe = {
          startDate: part.startDate ? String(part.startDate).slice(0, 10) : null,
          dueDate: String(part.dueDate).slice(0, 10),
          estimateHours: Number(part.estimateHours || 0),
        };
        // days из разбора здесь не нужны — это раскладка, дело исполнителя, — а
        // в ответе на неудачную постановку они раздули бы его на порядок.
        const { days, ...assessment } = await assessFor(probe, userId, viewer);
        if (!assessment.fits) overloads.push({ userId, dueDate: probe.dueDate, ...assessment });
      }
    }

    const unavailable = overloads.filter(item => ['vacation', 'day_off', 'no_norm'].includes(item.reason));
    if (unavailable.length) {
      return res.status(409).json({
        error: unavailable.some(item => item.reason === 'no_norm')
          ? 'У одного из исполнителей не настроено рабочее расписание'
          : 'Срок попадает на отпуск или выходной исполнителя',
        overloads: unavailable,
        requiresDateChange: true,
      });
    }

    let forced = null;
    if (overloads.length) {
      const check = planning.validateForce(req.body.explanation);
      if (!check.ok) {
        return res.status(409).json({ error: check.error, overloads, requiresExplanation: true });
      }
      forced = check.text;
    }

    const created = await sequelize.transaction(async transaction => {
      // Код выдаётся в той же транзакции, что и сама задача: иначе номер
      // сгорает на каждой неудачной проверке ниже, и в нумерации остаются дыры.
      const projectId = req.body.projectId || null;
      const project = projectId
        ? await TaskProject.findByPk(projectId, { attributes: ['id', 'key'], transaction })
        : null;
      const code = await codes.issue(sequelize, project?.key || codes.NO_PROJECT_PREFIX, transaction);

      const task = await Task.create({
        code,
        title,
        description: req.body.description || null,
        projectId,
        teamId,
        authorId: req.user.id,
        startDate: taskStartDate,
        dueDate: taskDueDate,
        attachments: req.body.attachments || [],
      }, { transaction });

      const idMap = new Map();
      for (let i = 0; i < incoming.length; i += 1) {
        const src = incoming[i];
        const part = await TaskPart.create({
          taskId: task.id,
          title: String(src.title || title).trim(),
          estimateHours: Number(src.estimateHours),
          startDate: src.startDate ? String(src.startDate).slice(0, 10) : null,
          dueDate: src.dueDate,
          status: partsService.STATUS.NEW,
          sortOrder: i,
        }, { transaction });
        idMap.set(localParts[i].id, part.id);

        await TaskPartAssignee.bulkCreate(
          src.assignees.map(userId => ({ partId: part.id, userId })),
          { transaction }
        );
      }

      const depRows = localDeps
        .map(d => ({ partId: idMap.get(d.partId), afterPartId: idMap.get(d.afterPartId) }))
        .filter(d => d.partId && d.afterPartId);
      if (depRows.length) await TaskPartDep.bulkCreate(depRows, { transaction });

      await log(task.id, null, req.user.id, 'created', {
        parts: incoming.length,
        people: [...new Set(incoming.flatMap(p => p.assignees))].length,
      }, transaction);

      if (forced) {
        await log(task.id, null, req.user.id, 'forced', { explanation: forced, overloads }, transaction);
      }

      // Собственная одиночная задача не требует переговоров с самим собой и
      // по макету сразу появляется в календаре автора.
      //
      // Многодневная сюда не попадает намеренно: её часы надо разложить по дням
      // окна, а раскладку в модуле делает человек, а не система. Своя
      // многодневная задача уходит автору же во входящие — там он её и разложит.
      if (incoming.length === 1
          && incoming[0].assignees.length === 1
          && incoming[0].assignees[0] === req.user.id
          && !incoming[0].startDate) {
        const partId = idMap.get(localParts[0].id);
        const part = await TaskPart.findByPk(partId, { transaction });
        const date = String(part.dueDate);
        const existing = await CalendarEvent.findAll({
          attributes: loadQuery.LOAD_FIELDS,
          where: {
            createdBy: req.user.id,
            startTime: { [Op.gte]: new Date(`${date}T00:00:00`) },
            endTime: { [Op.lte]: new Date(`${date}T23:59:59`) },
          },
          raw: true,
          transaction,
        });
        const workDay = scheduleService.forDate(req.user.taskWorkSchedule, date);
        const slot = planning.nextFloatingSlot(existing, date, Number(part.estimateHours), workDay.start);
        await CalendarEvent.create({
          title: part.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          eventType: 'task',
          status: 'planned',
          // «Занято, без названия»: коллеге нужно знать, что время у человека
          // занято, а чем именно — его дело. Раньше блок создавался с уровнем
          // team, и название задачи уходило любому сокоманднику по запросу
          // события. Сам исполнитель и его руководитель видят задачу там, где
          // ей место, — в модуле «Задачи».
          visibility: 'busy',
          createdBy: req.user.id,
          taskPartId: part.id,
          isFloating: true,
          dayOrder: slot.dayOrder,
        }, { transaction });
        await TaskPartAssignee.update(
          { plannedDate: date },
          { where: { partId: part.id, userId: req.user.id }, transaction }
        );
        await part.update({ status: partsService.STATUS.PLAN }, { transaction });
        await log(task.id, part.id, req.user.id, 'planned', {
          date,
          selfAssigned: true,
        }, transaction);
      }
      return task;
    });

    const task = await Task.findByPk(created.id, { include: TASK_INCLUDE() });
    const recipients = incoming.flatMap(p => p.assignees).filter(id => id !== req.user.id);
    await notifyUsers(recipients, {
      title: '📌 Новая задача',
      body: `${actorName(req.user)}: «${title}»`,
      taskId: created.id,
      code: created.code,
    });
    res.status(201).json(shape(task, await depsOf([created.id])));
  } catch (error) {
    console.error('Создание задачи:', error);
    res.status(500).json({ error: 'Не удалось создать задачу' });
  }
});

/** Отмена задачи. Блоки времени снимаются каскадом — часы возвращаются людям. */
/**
 * Привязка задачи к команде и снятие привязки.
 *
 * Отдельным маршрутом, а не полем в общем редактировании: это не правка
 * реквизита, а смена того, кто видит задачу. Привязали — её содержимое
 * открылось всему составу; сняли — снова видят только автор, исполнители и
 * руководитель над ними. Такое не должно уезжать вместе с исправлением опечатки
 * в названии.
 *
 * Менять вправе автор и руководитель команды, в которой задача сейчас лежит.
 * Второе — ради возможности убрать из команды то, что туда попало по ошибке:
 * без этого отвязать чужую задачу не мог бы никто, кроме её автора.
 */
router.put('/:id/team', authenticate, async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });

    const all = await context.loadTeams();
    const currentTeam = task.teamId ? all.find(t => t.id === task.teamId) : null;
    const mayChange = task.authorId === req.user.id
      || (currentTeam && teamsService.isLead(currentTeam, req.user.id));
    if (!mayChange) {
      return res.status(403).json({ error: 'Менять команду задачи может автор или руководитель команды' });
    }

    const teamId = req.body.teamId || null;
    if (teamId && !(await canBindToTeam(teamId, req.user.id))) {
      return res.status(403).json({ error: 'Можно привязать только к своей команде' });
    }
    if (teamId === task.teamId) return res.json({ teamId });

    const nextTeam = teamId ? all.find(t => t.id === teamId) : null;
    await task.update({ teamId });
    await log(task.id, null, req.user.id, 'team_changed', {
      from: currentTeam?.name || null,
      to: nextTeam?.name || null,
    });

    /**
     * Исполнителям стоит сказать: задача, которую человек считал личной, стала
     * видна ещё десятку коллег вместе с описанием и файлами. Узнавать об этом
     * из чужого разговора — худший из возможных способов.
     */
    const parts = await TaskPart.findAll({
      attributes: ['id'],
      where: { taskId: task.id },
      include: [{ model: TaskPartAssignee, as: 'assignees', attributes: ['userId'], required: false }],
    });
    const assignees = [...new Set(parts.flatMap(part => (part.assignees || []).map(a => a.userId)))]
      .filter(id => id !== req.user.id);
    await notifyUsers(assignees, nextTeam
      ? {
        title: '👥 Задача стала командной',
        body: `${actorName(req.user)} открыл «${task.title}» команде «${nextTeam.name}»`,
        taskId: task.id,
        code: task.code,
      }
      : {
        title: '🔒 Задача снова личная',
        body: `${actorName(req.user)} убрал «${task.title}» из команды`,
        taskId: task.id,
        code: task.code,
      });

    res.json({ teamId });
  } catch (error) {
    console.error('Смена команды задачи:', error);
    res.status(500).json({ error: 'Не удалось изменить команду задачи' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id, { include: TASK_INCLUDE() });
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    if (task.authorId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Отменить задачу может автор' });
    }
    const recipients = (task.parts || [])
      .flatMap(part => (part.assignees || []).map(a => a.userId))
      .filter(id => id !== req.user.id);
    const taskTitle = task.title;
    const taskCode = task.code;
    await task.destroy();
    await notifyUsers(recipients, {
      title: '🗑 Задача отменена',
      body: `${actorName(req.user)}: «${taskTitle}»`,
      code: taskCode,
    });
    res.json({ deleted: true });
  } catch (error) {
    console.error('Отмена задачи:', error);
    res.status(500).json({ error: 'Не удалось отменить задачу' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ЧАСТИ: ПЛАН, СРОК, ПЕРЕНОС
// ─────────────────────────────────────────────────────────────────────────────

async function findPart(id) {
  return TaskPart.findByPk(id, {
    include: [
      { model: Task, as: 'task', required: true },
      { model: TaskPartAssignee, as: 'assignees', required: false },
    ],
  });
}

const assigneeOf = (part, userId) => (part.assignees || []).find(a => a.userId === userId);

/**
 * Выложить раскладку в календарь: по блоку на каждый день (ver. 8.48).
 *
 * Отдельной сущности «сессия работы» в модуле нет и не появилось — ею оказался
 * сам блок в календаре. У однодневной подзадачи он один, у многодневной их
 * столько, сколько дней в раскладке, и всё остальное — нормы, цвета дней,
 * переработка, показатели команды — продолжает работать без единой правки,
 * потому что загрузка и так считается суммированием блоков по дням.
 *
 * Время внутри дня по-прежнему условное: блоки складываются подряд от начала
 * смены (см. nextFloatingSlot), и интерфейс модуля его не показывает.
 */
async function placeBlocks(part, userId, layout, days, transaction) {
  if (!layout.length) return [];
  const from = layout[0].date;
  const to = layout[layout.length - 1].date;
  const existing = await CalendarEvent.findAll({
    attributes: loadQuery.LOAD_FIELDS,
    where: {
      createdBy: userId,
      startTime: { [Op.lte]: new Date(`${to}T23:59:59`) },
      endTime: { [Op.gte]: new Date(`${from}T00:00:00`) },
      // Свои же блоки этой подзадачи в расчёт не идут: при переносе они в этой
      // же транзакции удаляются, и учитывать их значило бы выкладывать новую
      // раскладку после места, которое строкой ниже освободится.
      [Op.or]: [{ taskPartId: null }, { taskPartId: { [Op.ne]: part.id } }],
    },
    raw: true,
    transaction,
  });

  const byDate = new Map();
  for (const event of existing) {
    const key = loadQuery.toKey(event.startTime);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(event);
  }
  const workStart = new Map((days || []).map(day => [day.date, day.workStart]));

  const rows = layout.map(row => {
    const slot = planning.nextFloatingSlot(
      byDate.get(row.date) || [], row.date, row.hours, workStart.get(row.date)
    );
    return {
      title: part.title,
      startTime: slot.startTime,
      endTime: slot.endTime,
      eventType: 'task',
      status: 'planned',
      // «Занято, без названия»: коллеге нужно знать, что время у человека
      // занято, а чем именно — его дело. Сам исполнитель и его руководитель
      // видят задачу там, где ей место, — в модуле «Задачи».
      visibility: 'busy',
      createdBy: userId,
      taskPartId: part.id,
      isFloating: true,
      dayOrder: slot.dayOrder,
    };
  });
  await CalendarEvent.bulkCreate(rows, { transaction });
  return rows;
}

/** Человеческий перечень перегруженных дней — для отказа, который надо понять. */
function overloadText(overloads) {
  return overloads
    .map(day => `${dateText(day.date)} — станет ${day.after} из ${day.norm} ч`)
    .join('; ');
}

/** Сдвиг даты на календарные дни. */
function shiftDate(date, count) {
  const value = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  value.setDate(value.getDate() + count);
  return loadQuery.toKey(value);
}

/** Длина окна в календарных днях. */
function windowLength(part) {
  const { from, to } = partsService.windowOf(part);
  return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
}

/**
 * Поставить часть в план.
 *
 * Здесь и только здесь часть превращается в блок времени. До этого момента она
 * не занимает у человека ни часа — именно поэтому «не обработана» отличается от
 * «в работе», и именно поэтому автор видит, что задача до него ещё не дошла.
 *
 * Однодневная часть встаёт в день. Многодневная (ver. 8.48) требует раскладки:
 * человек сам говорит, сколько часов сидит над ней в каждый день окна, и в
 * календаре появляется по блоку на день.
 *
 * Раскладывает человек, а не система, и автоматического «поровну по дням» здесь
 * нет намеренно. Ровный слой молча влезает в уже плотный день и перегружает
 * его — ровно то, против чего модуль затевался. Сервер проверяет два условия:
 * сумма совпала с оценкой, и ни один день не ушёл в переработку без ведома
 * человека.
 */
router.post('/parts/:id/plan', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });

    const mine = assigneeOf(part, req.user.id);
    if (!mine) return res.status(403).json({ error: 'Вы не исполнитель этой подзадачи' });

    if (partsService.isWindowed(part)) {
      return planWindowed(req, res, part, mine);
    }

    const date = String(req.body.date || part.dueDate);
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const [dayInfo] = await loadQuery.daysOf(req.user.id, date, date, viewer);
    const assessment = planning.assessAssignment({
      currentHours: dayInfo?.hours || 0,
      norm: dayInfo?.norm ?? null,
      estimateHours: Number(part.estimateHours),
      onVacation: dayInfo?.onVacation,
      onDayOff: dayInfo?.onDayOff,
    });

    if (['vacation', 'day_off', 'no_norm'].includes(assessment.reason)) {
      const error = assessment.reason === 'vacation' ? 'На этот день запланирован отпуск'
        : assessment.reason === 'day_off' ? 'Этот день не входит в рабочее расписание'
          : 'Сначала настройте рабочее расписание';
      return res.status(409).json({ error, assessment });
    }

    // Взять сверх нормы можно — это своё решение исполнителя, а не обход
    // чужого. Но автор увидит, что человек ушёл в переработку.
    if (!assessment.fits && !req.body.force) {
      return res.status(409).json({ error: 'Не помещается в этот день', assessment });
    }

    await sequelize.transaction(async transaction => {
      const existing = await CalendarEvent.findAll({
        attributes: loadQuery.LOAD_FIELDS,
        where: {
          createdBy: req.user.id,
          startTime: { [Op.gte]: new Date(`${date}T00:00:00`) },
          endTime: { [Op.lte]: new Date(`${date}T23:59:59`) },
        },
        raw: true,
        transaction,
      });

      const slot = planning.nextFloatingSlot(existing, date, Number(part.estimateHours), dayInfo?.workStart);
      await CalendarEvent.create({
        title: part.title,
        startTime: slot.startTime,
        endTime: slot.endTime,
        eventType: 'task',
        status: 'planned',
        // См. выше: время наружу, содержание — нет.
        visibility: 'busy',
        createdBy: req.user.id,
        taskPartId: part.id,
        isFloating: true,
        dayOrder: slot.dayOrder,
      }, { transaction });

      // plannedUntil обнуляется явно: часть могла быть многодневной и стать
      // однодневной (см. /stretch), и оставшийся хвост показывал бы в списках
      // раскладку, которой уже нет.
      await mine.update({ plannedDate: date, plannedUntil: null }, { transaction });
      await part.update({
        status: partsService.STATUS.PLAN,
        dueDate: date,
      }, { transaction });

      await log(part.taskId, part.id, req.user.id, 'planned', {
        date,
        overload: !assessment.fits,
        after: assessment.after,
        norm: assessment.norm,
      }, transaction);
    });

    if (part.task.authorId !== req.user.id) {
      await notifyUsers([part.task.authorId], {
        title: '✅ Взято в план',
        body: `${actorName(req.user)} поставил «${part.title}» на ${dateText(date)}`,
        taskId: part.taskId,
        code: part.task.code,
      });
    }

    res.json({ planned: true, date, assessment });
  } catch (error) {
    console.error('Постановка в план:', error);
    res.status(500).json({ error: 'Не удалось поставить в план' });
  }
});

/**
 * Постановка в план многодневной части: проверка раскладки и её выкладка.
 *
 * Вынесено из маршрута отдельной функцией, а не сделано ветвлением внутри: у
 * однодневной и многодневной части совпадают только права и уведомление, а всё
 * остальное — что проверяем, что пишем в календарь и что пишем в историю —
 * разное, и в одном теле это читалось бы как два маршрута, слепленных if-ом.
 *
 * Срок и начало окна здесь НЕ меняются, в отличие от однодневной постановки, где
 * выбранный день становится новым сроком. Окно — это договорённость автора и
 * исполнителя о границах работы; раскладка живёт внутри него и его не двигает.
 * Сдвинуть окно можно переносом (/move) — он и считается переносом.
 */
async function planWindowed(req, res, part, mine) {
  const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
  const { from, to } = partsService.windowOf(part);
  const days = await loadQuery.daysOf(req.user.id, from, to, viewer);
  const estimateHours = Number(part.estimateHours);

  const check = planning.validateLayout({ entries: req.body.layout, estimateHours, days });
  if (!check.ok) {
    return res.status(409).json({
      error: check.error,
      requiresLayout: true,
      window: { from, to },
      estimateHours,
      days,
      assessment: planning.assessWindow({ days, estimateHours }),
    });
  }

  // Взять сверх нормы можно — это своё решение исполнителя, а не обход чужого.
  // Но автор увидит, что человек ушёл в переработку, и увидит, в какие дни.
  if (check.overloads.length && !req.body.force) {
    return res.status(409).json({
      error: `Переработка: ${overloadText(check.overloads)}`,
      requiresConfirm: true,
      overloads: check.overloads,
      window: { from, to },
      days,
    });
  }

  const layout = check.layout;
  const planned = layout[0].date;
  const until = layout[layout.length - 1].date;

  await sequelize.transaction(async transaction => {
    await CalendarEvent.destroy({
      where: { taskPartId: part.id, createdBy: req.user.id },
      transaction,
    });
    await placeBlocks(part, req.user.id, layout, days, transaction);
    await mine.update({ plannedDate: planned, plannedUntil: until }, { transaction });
    await part.update({ status: partsService.STATUS.PLAN }, { transaction });
    await log(part.taskId, part.id, req.user.id, 'planned', {
      date: planned,
      until,
      layout,
      windowed: true,
      overload: check.overloads.length > 0,
      overloads: check.overloads,
    }, transaction);
  });

  if (part.task.authorId !== req.user.id) {
    await notifyUsers([part.task.authorId], {
      title: '✅ Взято в план',
      body: `${actorName(req.user)} разложил «${part.title}» на ${layout.length} дн.: `
        + `${dateText(planned)} — ${dateText(until)}`,
      taskId: part.taskId,
      code: part.task.code,
    });
  }

  return res.json({ planned: true, date: planned, until, layout, overloads: check.overloads });
}

/**
 * Предложить другой срок.
 *
 * Календарь исполнителя не меняется: задача в него не попала. Автору уходит
 * предложение и цифра занятости — без названий чужих дел.
 */
router.post('/parts/:id/propose', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    if (!assigneeOf(part, req.user.id)) {
      return res.status(403).json({ error: 'Вы не исполнитель этой подзадачи' });
    }
    const date = String(req.body.date || '');
    if (!date) return res.status(400).json({ error: 'Нужен предлагаемый срок' });

    /**
     * У многодневной части окно СДВИГАЕТСЯ, а не растягивается.
     *
     * «Предлагаю не 22–26, а 29 сент. — 3 окт.» — это то, что человек имеет в
     * виду, называя другой срок. Если оставить начало на месте, предложение
     * молча превратится в «дайте мне на это вдвое больше времени», то есть в
     * другой разговор. Растянуть окно тоже можно, но это отдельное действие
     * (/stretch) с отдельным следом в истории.
     */
    const dueDate = date;
    const startDate = partsService.isWindowed(part)
      ? String(req.body.from || shiftDate(dueDate, -windowLength(part)))
      : null;
    if (startDate && startDate > dueDate) {
      return res.status(400).json({ error: 'Начало предложенного окна позже его конца' });
    }

    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const [was] = await loadQuery.daysOf(req.user.id, String(part.dueDate), String(part.dueDate), viewer);

    await sequelize.transaction(async transaction => {
      await part.update({ startDate, dueDate, status: partsService.STATUS.NEW }, { transaction });
      await log(part.taskId, part.id, req.user.id, 'proposed_date', {
        from: String(part.dueDate),
        to: dueDate,
        fromStart: part.startDate ? String(part.startDate) : null,
        toStart: startDate,
        // Цифра занятости — да, состав дня — нет.
        busyHours: was?.hours ?? null,
        norm: was?.norm ?? null,
      }, transaction);
    });

    await notifyUsers([part.task.authorId], {
      title: '📅 Предложен другой срок',
      body: `${actorName(req.user)}: «${part.title}» — `
        + (startDate ? `${dateText(startDate)} — ${dateText(dueDate)}` : dateText(dueDate)),
      taskId: part.taskId,
      code: part.task.code,
    });

    res.json({ proposed: true, date: dueDate, from: startDate });
  } catch (error) {
    console.error('Предложение срока:', error);
    res.status(500).json({ error: 'Не удалось предложить срок' });
  }
});

/** Автор согласовал предложенный срок. */
router.post('/parts/:id/accept', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    if (part.task.authorId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Согласовать срок может автор' });
    }
    await log(part.taskId, part.id, req.user.id, 'accepted_date', { date: String(part.dueDate) });
    await notifyUsers(
      (part.assignees || []).map(a => a.userId).filter(id => id !== req.user.id),
      {
        title: '✅ Срок согласован',
        body: `${actorName(req.user)}: «${part.title}» — ${dateText(part.dueDate)}`,
        taskId: part.taskId,
        code: part.task.code,
      }
    );
    res.json({ accepted: true, date: String(part.dueDate) });
  } catch (error) {
    console.error('Согласование срока:', error);
    res.status(500).json({ error: 'Не удалось согласовать срок' });
  }
});

/**
 * «Не моя зона» — часть возвращается автору.
 *
 * Если исполнителей больше не осталось, часть удаляется, а вместе с последней
 * частью уходит и задача: пустая задача без исполнителей никому не видна и
 * висела бы в базе мусором.
 */
router.post('/parts/:id/decline', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    const mine = assigneeOf(part, req.user.id);
    if (!mine) return res.status(403).json({ error: 'Вы не исполнитель этой подзадачи' });

    await sequelize.transaction(async transaction => {
      await log(part.taskId, part.id, req.user.id, 'declined', {
        reason: req.body.reason || null,
      }, transaction);
      await mine.destroy({ transaction });

      const left = await TaskPartAssignee.count({ where: { partId: part.id }, transaction });
      if (left === 0) {
        await part.destroy({ transaction });
        const parts = await TaskPart.count({ where: { taskId: part.taskId }, transaction });
        if (parts === 0) await Task.destroy({ where: { id: part.taskId }, transaction });
      }
    });

    await notifyUsers([part.task.authorId], {
      title: '↩️ Задача возвращена',
      body: `${actorName(req.user)}: «${part.title}» — не моя зона`,
      taskId: part.taskId,
      code: part.task.code,
    });

    res.json({ declined: true });
  } catch (error) {
    console.error('Возврат задачи:', error);
    res.status(500).json({ error: 'Не удалось вернуть задачу' });
  }
});

/**
 * Перенос части на другой день.
 *
 * После третьего переноса молчаливый перенос закрывается: часть уходит в
 * «анализируется», и ответ говорит, что дальше нужен выбор — разбить,
 * передоговориться или отменить. Кнопки «перенести ещё раз» в интерфейсе на
 * этом месте нет специально.
 */
router.post('/parts/:id/move', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    const mine = assigneeOf(part, req.user.id);
    if (!mine) return res.status(403).json({ error: 'Вы не исполнитель этой подзадачи' });

    if (!partsService.canMoveSilently(part)) {
      return res.status(409).json({
        error: 'Подзадача переносится третий раз — нужно решение, а не перенос',
        options: ['split', 'propose', 'cancel'],
        moveCount: part.moveCount,
      });
    }

    const date = String(req.body.date || '');
    if (!date) return res.status(400).json({ error: 'Нужен новый день' });

    if (partsService.isWindowed(part)) {
      return moveWindowed(req, res, part, mine, date);
    }

    const [dayInfo] = await loadQuery.daysOf(req.user.id, date, date, { id: req.user.id, isAdmin: req.user.isAdmin });
    if (dayInfo?.onVacation) return res.status(409).json({ error: 'На этот день запланирован отпуск' });
    if (dayInfo?.onDayOff || dayInfo?.norm === null) return res.status(409).json({ error: 'Этот день не входит в рабочее расписание' });

    const next = planning.afterMove(part);
    await sequelize.transaction(async transaction => {
      const existing = await CalendarEvent.findAll({
        attributes: loadQuery.LOAD_FIELDS,
        where: {
          createdBy: req.user.id,
          startTime: { [Op.gte]: new Date(`${date}T00:00:00`) },
          endTime: { [Op.lte]: new Date(`${date}T23:59:59`) },
          taskPartId: { [Op.ne]: part.id },
        },
        raw: true,
        transaction,
      });
      const slot = planning.nextFloatingSlot(existing, date, Number(part.estimateHours), dayInfo?.workStart);

      await CalendarEvent.update(
        { startTime: slot.startTime, endTime: slot.endTime, dayOrder: slot.dayOrder },
        { where: { taskPartId: part.id, createdBy: req.user.id }, transaction }
      );
      await mine.update({ plannedDate: date, plannedUntil: null }, { transaction });
      await part.update({ dueDate: date, moveCount: next.moveCount, status: next.status }, { transaction });
      await log(part.taskId, part.id, req.user.id, 'moved', {
        to: date,
        moveCount: next.moveCount,
        becameStuck: next.requiresDecision,
      }, transaction);
    });

    if (part.task.authorId !== req.user.id) {
      await notifyUsers([part.task.authorId], {
        title: next.requiresDecision ? '⚠️ Требует решения' : '📅 Задача перенесена',
        body: next.requiresDecision
          ? `«${part.title}» переносится третий раз — нужно разбить, передоговориться или отменить`
          : `${actorName(req.user)} перенёс «${part.title}» на ${dateText(date)}`,
        taskId: part.taskId,
        code: part.task.code,
      });
    }

    res.json({ moved: true, date, ...next });
  } catch (error) {
    console.error('Перенос части:', error);
    res.status(500).json({ error: 'Не удалось перенести' });
  }
});

/**
 * Перенос многодневной части: окно сдвигается целиком, раскладка снимается.
 *
 * Сдвиг, а не растягивание: перенос значит «эта работа делается не на той
 * неделе, а на следующей», и длина окна при нём сохраняется. Признать, что
 * работа оказалась длиннее, — другое решение, и у него свой маршрут (/stretch) и
 * свой след в истории.
 *
 * Раскладка не переезжает вместе с окном, даже когда сдвиг ровно на неделю и дни
 * недели совпадают, — и новая в этом же запросе не составляется. Причина та же,
 * по которой в модуле нет автоматического «поровну по дням»: в новом окне другая
 * занятость, и перенесённые часы молча перегрузили бы дни, которых человек не
 * видел. Часть возвращается в состояние «надо разложить», и человек делает это
 * отдельным шагом — глядя на свободное время новой недели.
 *
 * Отсюда и статус: не PLAN, а NEW. Часть снова ждёт разбора, и показывать её
 * запланированной, пока в календаре нет ни одного блока, значит врать во всех
 * списках сразу.
 *
 * Счётчик переносов увеличивается один раз на всю подзадачу, а не на каждый её
 * день: правило трёх переносов — про решение сдвинуть работу, а не про число
 * затронутых блоков.
 */
async function moveWindowed(req, res, part, mine, date) {
  const length = windowLength(part);
  const from = date;
  const to = req.body.until ? String(req.body.until).slice(0, 10) : shiftDate(date, length);
  if (from > to) return res.status(400).json({ error: 'Начало окна позже его конца' });
  if (windowLength({ startDate: from, dueDate: to }) !== length) {
    return res.status(400).json({
      error: 'Перенос сохраняет длину окна. Другая длительность — это изменение срока работы',
      expectedLength: length + 1,
    });
  }

  const next = planning.afterMove(part);
  await sequelize.transaction(async transaction => {
    await CalendarEvent.destroy({
      where: { taskPartId: part.id, createdBy: req.user.id },
      transaction,
    });
    await mine.update({ plannedDate: null, plannedUntil: null }, { transaction });
    await part.update({
      startDate: from,
      dueDate: to,
      moveCount: next.moveCount,
      status: next.requiresDecision ? partsService.STATUS.STUCK : partsService.STATUS.NEW,
    }, { transaction });
    await log(part.taskId, part.id, req.user.id, 'moved', {
      to,
      toStart: from,
      windowed: true,
      moveCount: next.moveCount,
      becameStuck: next.requiresDecision,
    }, transaction);
  });

  if (part.task.authorId !== req.user.id) {
    await notifyUsers([part.task.authorId], {
      title: next.requiresDecision ? '⚠️ Требует решения' : '📅 Задача перенесена',
      body: next.requiresDecision
        ? `«${part.title}» переносится третий раз — нужно разбить, изменить срок или отменить`
        : `${actorName(req.user)} перенёс «${part.title}» на ${dateText(from)} — ${dateText(to)}`,
      taskId: part.taskId,
      code: part.task.code,
    });
  }

  return res.json({ moved: true, date: to, from, ...next });
}

/**
 * Изменить длительность работы: растянуть на несколько дней или сжать в один.
 *
 * Третий выход из «анализируется», рядом с разбиением. Правило трёх переносов
 * упирается в вопрос «почему эта работа не помещается», и до ver. 8.48 на него
 * был единственный ответ: кусок слишком крупный, разбейте. Но самый частый ответ
 * другой — работа и не должна была помещаться в день, её на неделю. Раньше это
 * приходилось изображать четырьмя подзадачами «Вёрстка (1/4)», и три переноса
 * считались каждому куску отдельно.
 *
 * Как и разбиение, обнуляет счётчик переносов: условия переписаны, и наследовать
 * новой работе приговор предыдущей неправильно. И так же, как разбиение,
 * возвращает часть во входящие — длительность изменилась, значит раскладку надо
 * составить заново, глядя на новое свободное время.
 *
 * Сжать обратно в один день (from = to) можно тем же маршрутом: ошибиться в
 * другую сторону так же легко, и отдельного действия для отмены это не стоит.
 */
router.post('/parts/:id/stretch', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    if (!assigneeOf(part, req.user.id) && part.task.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Изменить срок может исполнитель или автор' });
    }

    const from = String(req.body.from || '').slice(0, 10);
    const to = String(req.body.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'Нужны начало и конец окна' });
    }
    if (from > to) return res.status(400).json({ error: 'Начало окна позже его конца' });

    /**
     * Длительность обязана измениться — иначе это перенос.
     *
     * Без этой проверки маршрут был дырой в правиле трёх переносов: он обнуляет
     * счётчик, и «растянув» работу на ту же длину можно было сдвигать её сколько
     * угодно, ни разу не дойдя до разговора о том, почему она не делается.
     * Сдвиг живёт в /move и считается переносом, здесь — только признание, что
     * работа идёт другое число дней.
     */
    if (windowLength({ startDate: from, dueDate: to }) === windowLength(part)) {
      return res.status(400).json({
        error: 'Длительность та же — это перенос, а не изменение срока работы',
        isMove: true,
        days: windowLength(part) + 1,
      });
    }

    // from === to означает «снова один день»: startDate обнуляется, и часть
    // возвращается к прежнему поведению целиком, а не остаётся окном нулевой
    // длины, которое пришлось бы особо обрабатывать в каждом расчёте.
    const startDate = from === to ? null : from;

    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const assessments = [];
    for (const assignee of part.assignees || []) {
      const { days, ...assessment } = await assessFor(
        { startDate, dueDate: to, estimateHours: part.estimateHours },
        assignee.userId,
        viewer
      );
      assessments.push({ userId: assignee.userId, ...assessment });
    }

    await sequelize.transaction(async transaction => {
      await part.update({
        startDate,
        dueDate: to,
        moveCount: 0,
        status: partsService.STATUS.NEW,
      }, { transaction });

      // Блоки снимаются у всех исполнителей: окно изменилось, и держать в
      // календаре раскладку по прежним дням значит показывать людям неправду.
      await CalendarEvent.destroy({ where: { taskPartId: part.id }, transaction });
      await TaskPartAssignee.update(
        { plannedDate: null, plannedUntil: null },
        { where: { partId: part.id }, transaction }
      );

      await log(part.taskId, part.id, req.user.id, 'stretched', {
        from: startDate,
        to,
        wasStart: part.startDate ? String(part.startDate) : null,
        wasDue: String(part.dueDate),
      }, transaction);
    });

    const recipients = [
      ...(part.assignees || []).map(a => a.userId),
      part.task.authorId,
    ].filter(id => id !== req.user.id);
    await notifyUsers([...new Set(recipients)], {
      title: '📆 Срок изменён',
      body: startDate
        ? `${actorName(req.user)}: «${part.title}» — ${dateText(startDate)} — ${dateText(to)}. Разложите часы по дням`
        : `${actorName(req.user)}: «${part.title}» — ${dateText(to)}, один день`,
      taskId: part.taskId,
      code: part.task.code,
    });

    res.json({ stretched: true, from: startDate, to, assessments });
  } catch (error) {
    console.error('Изменение срока части:', error);
    res.status(500).json({ error: 'Не удалось изменить срок подзадачи' });
  }
});

/** Продлить запланированный блок и честно пересчитать трудозатраты. */
router.post('/parts/:id/extend', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    if (!assigneeOf(part, req.user.id)) {
      return res.status(403).json({ error: 'Продлить может исполнитель этой подзадачи' });
    }

    const hours = Number(req.body.hours ?? 0.5);
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 8) {
      return res.status(400).json({ error: 'Продление должно быть от 15 минут до 8 часов' });
    }
    const before = Number(part.estimateHours);
    const estimateHours = Math.round((before + hours) * 100) / 100;

    await sequelize.transaction(async transaction => {
      await part.update({ estimateHours }, { transaction });
      /**
       * Часы добавляются в ПОСЛЕДНИЙ блок каждого исполнителя, а не во все разом.
       *
       * Раньше всем блокам части ставился одинаковый endTime = начало + полная
       * оценка. Пока блок у человека был один, это и означало «блок вырос». У
       * многодневной части (ver. 8.48) блоков столько, сколько дней в раскладке,
       * и то же присваивание раздуло бы КАЖДЫЙ день до полной оценки: вместо
       * плюс часа человек получил бы кратное увеличение занятости, а вместе с
       * ним — красную неделю и переработку, которой не было.
       *
       * Именно последний день, а не первый: продление случается в конце работы,
       * когда выяснилось, что не успеваешь, и дописывать часы в уже прошедший
       * понедельник значит задним числом переписывать его загрузку.
       */
      const blocks = await CalendarEvent.findAll({
        where: { taskPartId: part.id },
        order: [['startTime', 'ASC']],
        transaction,
      });
      const lastOf = new Map();
      for (const block of blocks) lastOf.set(block.createdBy, block);
      for (const block of lastOf.values()) {
        const endTime = new Date(new Date(block.endTime).getTime() + hours * 60 * 60 * 1000);
        await block.update({ endTime }, { transaction });
      }
      await log(part.taskId, part.id, req.user.id, 'extended', {
        from: before,
        to: estimateHours,
        added: hours,
      }, transaction);
    });

    if (part.task.authorId !== req.user.id) {
      await notifyUsers([part.task.authorId], {
        title: '⏱ Задача продлена',
        body: `${actorName(req.user)}: «${part.title}» — плюс ${hours} ч`,
        taskId: part.taskId,
        code: part.task.code,
      });
    }
    res.json({ extended: true, estimateHours, added: hours });
  } catch (error) {
    console.error('Продление части:', error);
    res.status(500).json({ error: 'Не удалось продлить задачу' });
  }
});

/**
 * Разбить часть надвое.
 *
 * Выход из «анализируется», ради которого правило трёх переносов и существует:
 * кусок становится мельче и наконец помещается в день. Счётчик переносов
 * обнуляется — это уже другая работа, и наследовать ей приговор предыдущей
 * неправильно.
 */
router.post('/parts/:id/split', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    if (!assigneeOf(part, req.user.id) && part.task.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Разбить может исполнитель или автор' });
    }

    const total = Number(part.estimateHours);
    if (total < 0.75) {
      return res.status(400).json({ error: 'Часть слишком мала, чтобы её делить' });
    }
    const { head, tail } = planning.splitEstimate(part, req.body.firstHours ?? total / 2);

    const created = await sequelize.transaction(async transaction => {
      const assignees = (part.assignees || []).map(a => a.userId);
      const next = await TaskPart.create({
        taskId: part.taskId,
        title: String(req.body.secondTitle || `${part.title} — продолжение`).trim(),
        estimateHours: tail,
        // Окно наследуется обеими половинами: разбиение отвечает на вопрос «чем
        // это будет сделано», а не «когда». Границы работы остаются те, о
        // которых договорились.
        startDate: part.startDate,
        dueDate: part.dueDate,
        status: partsService.STATUS.NEW,
        sortOrder: (part.sortOrder || 0) + 1,
      }, { transaction });
      await TaskPartAssignee.bulkCreate(
        assignees.map(userId => ({ partId: next.id, userId })),
        { transaction }
      );

      await part.update({
        title: String(req.body.firstTitle || part.title).trim(),
        estimateHours: head,
        moveCount: 0,
        status: partsService.STATUS.NEW,
      }, { transaction });

      // Блок времени старой части снимается: оценка изменилась, и держать в
      // календаре прежние часы значит показывать человеку неправду.
      await CalendarEvent.destroy({ where: { taskPartId: part.id }, transaction });
      await TaskPartAssignee.update(
        { plannedDate: null, plannedUntil: null },
        { where: { partId: part.id }, transaction }
      );

      await log(part.taskId, part.id, req.user.id, 'split', { head, tail, into: next.id }, transaction);
      return next;
    });

    res.json({ split: true, head, tail, newPartId: created.id });
  } catch (error) {
    console.error('Разбиение части:', error);
    res.status(500).json({ error: 'Не удалось разбить подзадачу' });
  }
});

/** Смена статуса части: в работу, на проверку, готово. */
router.put('/parts/:id/status', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });

    const status = String(req.body.status || '');
    const allowed = Object.values(partsService.STATUS);
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });

    const isAssignee = !!assigneeOf(part, req.user.id);
    if (!isAssignee && part.task.authorId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Менять статус может исполнитель или автор' });
    }

    await sequelize.transaction(async transaction => {
      const was = part.status;
      await part.update({ status }, { transaction });

      /**
       * Блок в календаре помечается завершённым, чтобы дело читалось как
       * сделанное, а не висело наравне с невыполненным. Часы при этом остаются
       * потраченными: время на работу ушло, и возвращать его в свободные —
       * значит показывать закрытый день пустым и снова ставить на него задачи.
       *
       * Но это верно только про дни, которые УЖЕ БЫЛИ. Многодневная подзадача
       * (ver. 8.48) разложена по нескольким дням, и законченная в среду работа
       * на четверг и пятницу больше времени не занимает: там её не делали и
       * делать не будут. Оставь эти блоки завершёнными — и человек до конца
       * недели выглядит занятым работой, которой нет, а руководитель считает,
       * что поручить ему нечего.
       *
       * Поэтому дни с завтрашнего помечаются отменёнными: busyHours пропускает
       * cancelled («его не делали») и считает completed («время потрачено») —
       * ровно то различие, которое здесь и нужно. Отменённые, а не удалённые,
       * потому что решение обратимо: «вернуть в работу» ниже поднимает все блоки
       * подзадачи обратно в planned, и раскладка восстанавливается целиком.
       */
      if (status === partsService.STATUS.DONE) {
        const tomorrow = new Date(`${loadQuery.toKey(new Date())}T00:00:00`);
        tomorrow.setDate(tomorrow.getDate() + 1);
        await CalendarEvent.update(
          { status: 'completed' },
          { where: { taskPartId: part.id, startTime: { [Op.lt]: tomorrow } }, transaction }
        );
        await CalendarEvent.update(
          { status: 'cancelled' },
          { where: { taskPartId: part.id, startTime: { [Op.gte]: tomorrow } }, transaction }
        );
      } else if (was === partsService.STATUS.DONE) {
        await CalendarEvent.update(
          { status: 'planned' },
          { where: { taskPartId: part.id }, transaction }
        );
      }

      await log(part.taskId, part.id, req.user.id, 'status_changed', { from: was, to: status }, transaction);
    });

    const recipients = [
      part.task.authorId,
      ...(part.assignees || []).map(a => a.userId),
    ].filter(id => id !== req.user.id);
    await notifyUsers(recipients, {
      title: status === partsService.STATUS.DONE ? '✅ Часть завершена' : '🔄 Статус изменён',
      body: `${actorName(req.user)}: «${part.title}» — ${partsService.STATUS_LABEL[status] || status}`,
      taskId: part.taskId,
      code: part.task.code,
    });

    res.json({ status });
  } catch (error) {
    console.error('Смена статуса:', error);
    res.status(500).json({ error: 'Не удалось изменить статус' });
  }
});

/** Карточка по календарному блоку: клиент знает partId, но открывает задачу. */
router.get('/parts/:id/task', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });

    const allTeams = await context.loadTeams();
    // Через ту же функцию, что и карточка: раньше здесь стоял peopleInScope —
    // область видимости ЧАСОВ, которая шире области видимости названий, и по
    // ссылке из календаря открывалось то, чего в списке задач человеку не
    // показывают.
    if (!canSeeTask(part.task, [part], req.user, allTeams)) {
      return res.status(404).json({ error: 'Часть не найдена' });
    }

    res.json({ taskId: part.taskId, partId: part.id });
  } catch (error) {
    console.error('Задача календарного блока:', error);
    res.status(500).json({ error: 'Не удалось открыть задачу' });
  }
});

/**
 * Ближайший день, куда часть помещается.
 *
 * Отдельным маршрутом, потому что этим пользуются оба экрана — и входящие, и
 * форма постановки. «Нет окна до конца горизонта» — валидный ответ, и показать
 * его надо честно, а не подобрать день молча.
 */
router.get('/parts/:id/next-fit', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });

    const userId = req.query.userId || req.user.id;
    const start = req.query.start || String(part.dueDate);
    const end = req.query.end || addDays(start, 30);

    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const days = await loadQuery.daysOf(userId, start, end, viewer);
    const estimateHours = Number(part.estimateHours);

    /**
     * У многодневной части ищется окно, а не день.
     *
     * Спрашивать «в какой день влезут 20 ч» бессмысленно: ни в один и не должны.
     * Окно той же длины скользит по горизонту, и подходит первое, чьей свободной
     * ёмкости хватает на всю оценку. Длина сохраняется намеренно — ответ на
     * вопрос «когда» не должен втихую менять ответ на вопрос «сколько это займёт».
     */
    if (partsService.isWindowed(part)) {
      const length = windowLength(part);
      for (let at = 0; at + length < days.length; at += 1) {
        const slice = days.slice(at, at + length + 1);
        if (planning.assessWindow({ days: slice, estimateHours }).fits) {
          return res.json({ date: slice[slice.length - 1].date, from: slice[0].date, searchedTo: end });
        }
      }
      return res.json({ date: null, from: null, searchedTo: end });
    }

    const date = workload.nextFit(
      days.map(d => ({ ...d, events: [], preHours: d.hours })),
      estimateHours,
      viewer
    );

    res.json({ date, searchedTo: end });
  } catch (error) {
    console.error('Поиск окна:', error);
    res.status(500).json({ error: 'Не удалось найти окно' });
  }
});

function addDays(date, count) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + count);
  return loadQuery.toKey(d);
}

module.exports = router;
