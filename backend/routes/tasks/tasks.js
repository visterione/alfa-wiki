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
  TaskProject, CalendarEvent, User, sequelize,
} = require('../../models');

const context = require('../../services/tasks/context');
const teamsService = require('../../services/tasks/teams');
const partsService = require('../../services/tasks/parts');
const planning = require('../../services/tasks/planning');
const loadQuery = require('../../services/tasks/loadQuery');
const workload = require('../../services/tasks/workload');
const notificationService = require('../../services/notificationService');

const USER_FIELDS = ['id', 'displayName', 'username', 'avatar'];

/** Полная задача со всем, что нужно карточке. */
const TASK_INCLUDE = () => [
  { model: TaskProject, as: 'project', required: false },
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
    deps: deps.filter(d => parts.some(p => p.id === d.partId)),
  };
}

async function depsOf(taskIds) {
  if (!taskIds.length) return [];
  const parts = await TaskPart.findAll({ attributes: ['id'], where: { taskId: taskIds }, raw: true });
  const ids = parts.map(p => p.id);
  if (!ids.length) return [];
  return TaskPartDep.findAll({ where: { partId: { [Op.in]: ids } }, raw: true });
}

/** Запись в историю. Отдельной функцией, чтобы её нельзя было забыть. */
function log(taskId, partId, userId, action, payload = {}, transaction) {
  return TaskHistory.create({ taskId, partId, userId, action, payload }, { transaction });
}

/**
 * Уведомления о задачах идут через уже существующего Альфа-Ассистента.
 * Ошибка чата не должна откатывать выполненное действие с задачей: история и
 * календарь уже являются источником правды, а уведомление можно дочитать при
 * следующем открытии входящих.
 */
async function notifyUsers(userIds, text, taskId) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  await Promise.allSettled(unique.map(userId => notificationService.sendMessageToUser(
    userId,
    taskId ? `${text}\n\n[Открыть задачу →](/tasks?task=${taskId})` : text,
    { type: 'task', ...(taskId ? { taskId } : {}) }
  )));
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
    const norm = req.user.dailyNormHours === null ? null : Number(req.user.dailyNormHours);
    const withFit = [];
    for (const part of ready) {
      const date = String(part.dueDate);
      const days = await loadQuery.daysOf(req.user.id, date, date, viewer);
      const today = days[0] || { hours: 0, onVacation: false };
      withFit.push({
        ...part.get({ plain: true }),
        assessment: planning.assessAssignment({
          currentHours: today.hours || 0,
          norm,
          estimateHours: Number(part.estimateHours),
          onVacation: today.onVacation,
        }),
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

router.get('/', authenticate, async (req, res) => {
  try {
    const all = await context.loadTeams();
    const scope = teamsService.peopleInScope(all, req.user.id, req.user.isAdmin, {
      medCenterId: req.query.medCenterId,
      teamId: req.query.teamId,
    });

    // Видны задачи, у которых хотя бы один исполнитель попал в область
    // видимости, плюс собственные. Фильтровать по ярлыку на задаче нельзя:
    // так её можно было бы спрятать от самого исполнителя.
    const visibleParts = await TaskPartAssignee.findAll({
      attributes: ['partId'],
      where: { userId: { [Op.in]: scope } },
      include: [{ model: TaskPart, as: 'part', attributes: ['taskId'], required: true }],
      raw: true,
      nest: true,
    });
    const taskIds = [...new Set(visibleParts.map(r => r.part.taskId))];

    const where = {
      [Op.or]: [{ id: { [Op.in]: taskIds } }, { authorId: req.user.id }],
      isArchived: req.query.archived === 'true',
    };
    if (req.query.projectId) where.projectId = req.query.projectId;

    const rows = await Task.findAll({
      where,
      include: TASK_INCLUDE(),
      order: [['createdAt', 'DESC']],
    });
    const deps = await depsOf(rows.map(r => r.id));

    let list = rows.map(t => shape(t, deps));
    if (req.query.status) list = list.filter(t => t.status === req.query.status);
    if (req.query.mine === 'true') list = list.filter(t => t.authorId === req.user.id);
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
    const scope = new Set(teamsService.peopleInScope(
      allTeams,
      req.user.id,
      req.user.isAdmin
    ));
    const assigneeIds = (task.parts || []).flatMap(part =>
      (part.assignees || []).map(a => a.userId)
    );
    const canSee = task.authorId === req.user.id
      || assigneeIds.includes(req.user.id)
      || assigneeIds.some(id => scope.has(id));
    if (!canSee) return res.status(404).json({ error: 'Задача не найдена' });

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
    if (!incoming.length) return res.status(400).json({ error: 'Нужна хотя бы одна часть' });
    for (const part of incoming) {
      if (!Array.isArray(part.assignees) || !part.assignees.length) {
        return res.status(400).json({ error: 'У каждой части должен быть исполнитель' });
      }
      if (!part.dueDate) return res.status(400).json({ error: 'У каждой части должен быть срок' });
    }

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

    // Разбор загрузки по каждому исполнителю каждой части.
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const overloads = [];
    for (const part of incoming) {
      for (const userId of part.assignees) {
        const date = String(part.dueDate);
        const [dayInfo] = await loadQuery.daysOf(userId, date, date, viewer);
        const assessment = planning.assessAssignment({
          currentHours: dayInfo?.hours || 0,
          norm: dayInfo?.norm ?? null,
          estimateHours: Number(part.estimateHours || 0),
          onVacation: dayInfo?.onVacation,
        });
        if (!assessment.fits) overloads.push({ userId, dueDate: date, ...assessment });
      }
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
      const task = await Task.create({
        title,
        description: req.body.description || null,
        projectId: req.body.projectId || null,
        authorId: req.user.id,
        attachments: req.body.attachments || [],
      }, { transaction });

      const idMap = new Map();
      for (let i = 0; i < incoming.length; i += 1) {
        const src = incoming[i];
        const part = await TaskPart.create({
          taskId: task.id,
          title: String(src.title || title).trim(),
          estimateHours: Number(src.estimateHours),
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
      if (incoming.length === 1
          && incoming[0].assignees.length === 1
          && incoming[0].assignees[0] === req.user.id) {
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
        const slot = planning.nextFloatingSlot(existing, date, Number(part.estimateHours));
        await CalendarEvent.create({
          title: part.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          eventType: 'task',
          status: 'planned',
          visibility: 'team',
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
    await notifyUsers(
      recipients,
      `📌 ${actorName(req.user)} поставил вам задачу «${title}»`,
      created.id
    );
    res.status(201).json(shape(task, await depsOf([created.id])));
  } catch (error) {
    console.error('Создание задачи:', error);
    res.status(500).json({ error: 'Не удалось создать задачу' });
  }
});

/** Отмена задачи. Блоки времени снимаются каскадом — часы возвращаются людям. */
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
    await task.destroy();
    await notifyUsers(
      recipients,
      `🗑 ${actorName(req.user)} отменил задачу «${taskTitle}»`,
      null
    );
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
 * Поставить часть в план на день.
 *
 * Здесь и только здесь часть превращается в блок времени. До этого момента она
 * не занимает у человека ни часа — именно поэтому «не обработана» отличается от
 * «в работе», и именно поэтому автор видит, что задача до него ещё не дошла.
 */
router.post('/parts/:id/plan', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });

    const mine = assigneeOf(part, req.user.id);
    if (!mine) return res.status(403).json({ error: 'Вы не исполнитель этой части' });

    const date = String(req.body.date || part.dueDate);
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const [dayInfo] = await loadQuery.daysOf(req.user.id, date, date, viewer);
    const assessment = planning.assessAssignment({
      currentHours: dayInfo?.hours || 0,
      norm: dayInfo?.norm ?? null,
      estimateHours: Number(part.estimateHours),
      onVacation: dayInfo?.onVacation,
    });

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

      const slot = planning.nextFloatingSlot(existing, date, Number(part.estimateHours));
      await CalendarEvent.create({
        title: part.title,
        startTime: slot.startTime,
        endTime: slot.endTime,
        eventType: 'task',
        status: 'planned',
        visibility: 'team',
        createdBy: req.user.id,
        taskPartId: part.id,
        isFloating: true,
        dayOrder: slot.dayOrder,
      }, { transaction });

      await mine.update({ plannedDate: date }, { transaction });
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
      await notifyUsers(
        [part.task.authorId],
        `✅ ${actorName(req.user)} поставил в план «${part.title}» на ${date}`,
        part.taskId
      );
    }

    res.json({ planned: true, date, assessment });
  } catch (error) {
    console.error('Постановка в план:', error);
    res.status(500).json({ error: 'Не удалось поставить в план' });
  }
});

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
      return res.status(403).json({ error: 'Вы не исполнитель этой части' });
    }
    const date = String(req.body.date || '');
    if (!date) return res.status(400).json({ error: 'Нужен предлагаемый срок' });

    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const [was] = await loadQuery.daysOf(req.user.id, String(part.dueDate), String(part.dueDate), viewer);

    await sequelize.transaction(async transaction => {
      await part.update({ dueDate: date, status: partsService.STATUS.NEW }, { transaction });
      await log(part.taskId, part.id, req.user.id, 'proposed_date', {
        from: String(part.dueDate),
        to: date,
        // Цифра занятости — да, состав дня — нет.
        busyHours: was?.hours ?? null,
        norm: was?.norm ?? null,
      }, transaction);
    });

    await notifyUsers(
      [part.task.authorId],
      `📅 ${actorName(req.user)} предложил новый срок для «${part.title}»: ${date}`,
      part.taskId
    );

    res.json({ proposed: true, date });
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
      `✅ ${actorName(req.user)} согласовал срок для «${part.title}»: ${String(part.dueDate)}`,
      part.taskId
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
    if (!mine) return res.status(403).json({ error: 'Вы не исполнитель этой части' });

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

    await notifyUsers(
      [part.task.authorId],
      `↩️ ${actorName(req.user)} вернул задачу «${part.title}» с пометкой «не моя зона»`,
      part.taskId
    );

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
    if (!mine) return res.status(403).json({ error: 'Вы не исполнитель этой части' });

    if (!partsService.canMoveSilently(part)) {
      return res.status(409).json({
        error: 'Часть переносится третий раз — нужно решение, а не перенос',
        options: ['split', 'propose', 'cancel'],
        moveCount: part.moveCount,
      });
    }

    const date = String(req.body.date || '');
    if (!date) return res.status(400).json({ error: 'Нужен новый день' });

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
      const slot = planning.nextFloatingSlot(existing, date, Number(part.estimateHours));

      await CalendarEvent.update(
        { startTime: slot.startTime, endTime: slot.endTime, dayOrder: slot.dayOrder },
        { where: { taskPartId: part.id, createdBy: req.user.id }, transaction }
      );
      await mine.update({ plannedDate: date }, { transaction });
      await part.update({ dueDate: date, moveCount: next.moveCount, status: next.status }, { transaction });
      await log(part.taskId, part.id, req.user.id, 'moved', {
        to: date,
        moveCount: next.moveCount,
        becameStuck: next.requiresDecision,
      }, transaction);
    });

    if (part.task.authorId !== req.user.id) {
      await notifyUsers(
        [part.task.authorId],
        `📅 ${actorName(req.user)} перенёс «${part.title}» на ${date}${next.requiresDecision ? ' — задача требует решения' : ''}`,
        part.taskId
      );
    }

    res.json({ moved: true, date, ...next });
  } catch (error) {
    console.error('Перенос части:', error);
    res.status(500).json({ error: 'Не удалось перенести' });
  }
});

/** Продлить запланированный блок и честно пересчитать трудозатраты. */
router.post('/parts/:id/extend', authenticate, async (req, res) => {
  try {
    const part = await findPart(req.params.id);
    if (!part) return res.status(404).json({ error: 'Часть не найдена' });
    if (!assigneeOf(part, req.user.id)) {
      return res.status(403).json({ error: 'Продлить может исполнитель этой части' });
    }

    const hours = Number(req.body.hours ?? 0.5);
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 8) {
      return res.status(400).json({ error: 'Продление должно быть от 15 минут до 8 часов' });
    }
    const before = Number(part.estimateHours);
    const estimateHours = Math.round((before + hours) * 100) / 100;

    await sequelize.transaction(async transaction => {
      await part.update({ estimateHours }, { transaction });
      const blocks = await CalendarEvent.findAll({
        where: { taskPartId: part.id },
        transaction,
      });
      for (const block of blocks) {
        const endTime = new Date(new Date(block.startTime).getTime() + estimateHours * 60 * 60 * 1000);
        await block.update({ endTime }, { transaction });
      }
      await log(part.taskId, part.id, req.user.id, 'extended', {
        from: before,
        to: estimateHours,
        added: hours,
      }, transaction);
    });

    if (part.task.authorId !== req.user.id) {
      await notifyUsers(
        [part.task.authorId],
        `⏱ ${actorName(req.user)} продлил «${part.title}» на ${hours} ч`,
        part.taskId
      );
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
        { plannedDate: null },
        { where: { partId: part.id }, transaction }
      );

      await log(part.taskId, part.id, req.user.id, 'split', { head, tail, into: next.id }, transaction);
      return next;
    });

    res.json({ split: true, head, tail, newPartId: created.id });
  } catch (error) {
    console.error('Разбиение части:', error);
    res.status(500).json({ error: 'Не удалось разбить часть' });
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

      // Готовая работа освобождает время сразу: блок помечается завершённым, и
      // часы возвращаются в свободные в тот же момент, а не в конце дня.
      if (status === partsService.STATUS.DONE) {
        await CalendarEvent.update(
          { status: 'completed' },
          { where: { taskPartId: part.id }, transaction }
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
    await notifyUsers(
      recipients,
      `🔄 ${actorName(req.user)} изменил статус «${part.title}»: ${status}`,
      part.taskId
    );

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
    const scope = new Set(teamsService.peopleInScope(
      allTeams,
      req.user.id,
      req.user.isAdmin
    ));
    const assigneeIds = (part.assignees || []).map(a => a.userId);
    const canSee = part.task.authorId === req.user.id
      || assigneeIds.includes(req.user.id)
      || assigneeIds.some(id => scope.has(id));
    if (!canSee) return res.status(404).json({ error: 'Часть не найдена' });

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
    const date = workload.nextFit(
      days.map(d => ({ ...d, events: [], preHours: d.hours })),
      Number(part.estimateHours),
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
