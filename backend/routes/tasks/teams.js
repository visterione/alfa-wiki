/**
 * Команды: границы видимости и загрузка внутри команды.
 *
 * Скрытая команда обрабатывается здесь особым образом и в двух местах сразу:
 * её нет в списке и её нет в счётчике закрытых. Второе не менее важно, чем
 * первое — «ещё 3 команды закрыты для вас» при скрытой команде выдаёт ровно
 * то, что она прячет.
 *
 * Приглашений по ссылке больше нет (ver. 8.45). Состав правится напрямую, и это
 * не упрощение ради упрощения: ссылка давала членство, но не право видеть
 * раздел, поэтому приглашённый всё равно упирался в отсутствие кнопки и шёл к
 * администратору. Прямое добавление делает оба дела сразу — см. openTasksModule.
 * Таблица task_team_invites осталась в базе нетронутой: выданные ссылки просто
 * перестали приниматься, а удалять таблицу с историей ради чистоты не стали.
 */

const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();

const { authenticate } = require('../../middleware/auth');
const {
  TaskTeam, TaskTeamMember, Task, TaskPart, TaskPartAssignee,
  TaskProject, TaskHistory, User, sequelize,
} = require('../../models');
const partsService = require('../../services/tasks/parts');
const context = require('../../services/tasks/context');
const teams = require('../../services/tasks/teams');
const loadQuery = require('../../services/tasks/loadQuery');

/** Команда со списком участников — в форме, которую ждёт сервис. */
async function loadTeam(id) {
  const team = await TaskTeam.findByPk(id, {
    include: [{ model: TaskTeamMember, as: 'members', required: false }],
  });
  if (!team) return null;
  return {
    row: team,
    plain: {
      id: team.id,
      name: team.name,
      medCenterId: team.medCenterId,
      access: team.access,
      isHidden: team.isHidden,
      members: (team.members || []).map(m => ({ userId: m.userId, role: m.role })),
    },
  };
}

/** Список команд, о существовании которых человек знает. */
router.get('/', authenticate, async (req, res) => {
  try {
    const all = await context.loadTeams();
    const visible = teams.visibleTeams(all, req.user.id, req.user.isAdmin);
    res.json({
      teams: visible.map(t => ({
        ...t,
        canSeeLoad: teams.canSeeTeamLoad(t, req.user.id, req.user.isAdmin),
        isMember: teams.isMember(t, req.user.id),
        isLead: teams.isLead(t, req.user.id),
      })),
      // Скрытые сюда не попадают — см. closedTeamCount.
      closedCount: teams.closedTeamCount(all, req.user.id, req.user.isAdmin),
    });
  } catch (error) {
    console.error('Список команд:', error);
    res.status(500).json({ error: 'Не удалось получить список команд' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Нужно название команды' });

    const created = await sequelize.transaction(async transaction => {
      const team = await TaskTeam.create({
        name,
        medCenterId: req.body.medCenterId || null,
        access: teams.ACCESS.MEMBERS,
        isHidden: true,
        ownerId: req.user.id,
      }, { transaction });

      // Создатель всегда руководитель созданной команды: иначе он немедленно
      // теряет доступ к тому, что только что завёл, если команда скрытая.
      const rows = [{ teamId: team.id, userId: req.user.id, role: teams.ROLES.LEAD }];
      for (const m of req.body.members || []) {
        if (m.userId === req.user.id) continue;
        rows.push({ teamId: team.id, userId: m.userId, role: m.role || teams.ROLES.MEMBER });
      }
      await TaskTeamMember.bulkCreate(rows, { transaction });
      return team;
    });

    const team = await loadTeam(created.id);
    res.status(201).json(team.plain);
  } catch (error) {
    console.error('Создание команды:', error);
    res.status(500).json({ error: 'Не удалось создать команду' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    // 404, а не 403: для того, кому команда закрыта, её не существует.
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    res.json(team.plain);
  } catch (error) {
    console.error('Команда:', error);
    res.status(500).json({ error: 'Не удалось получить команду' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    if (!teams.isLead(team.plain, req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Настраивать команду может руководитель' });
    }

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.medCenterId !== undefined) patch.medCenterId = req.body.medCenterId || null;
    // Команды всегда закрыты. Публичных режимов в модуле больше нет: доступ
    // определяется только ролью member / lead / viewer в составе команды.
    patch.access = teams.ACCESS.MEMBERS;
    patch.isHidden = true;
    await team.row.update(patch);

    const fresh = await loadTeam(req.params.id);
    res.json(fresh.plain);
  } catch (error) {
    console.error('Настройка команды:', error);
    res.status(500).json({ error: 'Не удалось изменить команду' });
  }
});

/**
 * Удаление команды не трогает ни задачи, ни календари участников: команда —
 * это граница видимости, а не владелец работы.
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    if (!teams.isLead(team.plain, req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Удалить команду может руководитель' });
    }
    await team.row.destroy();
    res.json({ deleted: true });
  } catch (error) {
    console.error('Удаление команды:', error);
    res.status(500).json({ error: 'Не удалось удалить команду' });
  }
});

/**
 * Открыть человеку модуль «Задачи», если он не был ему открыт.
 *
 * Завести в команду и не дать зайти в раздел — бессмысленная пара действий, а
 * раньше это были именно два разных действия в двух разных местах портала:
 * руководитель добавлял человека здесь, тот открывал портал и не находил
 * кнопки, и разбираться шли к администратору. Приглашение ссылкой эту дыру не
 * закрывало — оно давало членство, но не право видеть раздел.
 *
 * Право снимается только руками администратора: исключение из команды его не
 * отбирает. Человек мог попасть в модуль не через эту команду, и молча закрыть
 * ему раздел при перестановке состава значило бы отобрать доступ к его
 * собственным задачам.
 *
 * Возвращает true, только если право действительно выдали.
 */
async function openTasksModule(userId) {
  const user = await User.findByPk(userId, { attributes: ['id', 'isAdmin', 'adminAccess'] });
  if (!user || user.isAdmin || user.adminAccess?.tasks === true) return false;
  // Слияние, а не присвоение: в adminAccess лежат права других модулей, и
  // перезапись объекта целиком стирала бы их.
  await user.update({ adminAccess: { ...(user.adminAccess || {}), tasks: true } });
  return true;
}

router.post('/:id/members', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    if (!teams.isLead(team.plain, req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Приглашать может руководитель команды' });
    }
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'Нужен пользователь' });

    await TaskTeamMember.upsert({
      teamId: team.plain.id,
      userId,
      role: role || teams.ROLES.MEMBER,
    });

    const opened = await openTasksModule(userId);
    const fresh = await loadTeam(req.params.id);
    // Клиент показывает «доступ к модулю открыт» только когда это правда:
    // сообщать об этом каждый раз значило бы обещать действие, которого не
    // было, и через неделю на сообщение перестанут смотреть.
    res.json({ ...fresh.plain, accessGranted: opened });
  } catch (error) {
    console.error('Добавление в команду:', error);
    res.status(500).json({ error: 'Не удалось добавить человека' });
  }
});

router.delete('/:id/members/:userId', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    if (!teams.isLead(team.plain, req.user.id) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Убирать из команды может руководитель' });
    }
    await TaskTeamMember.destroy({
      where: { teamId: team.plain.id, userId: req.params.userId },
    });
    const fresh = await loadTeam(req.params.id);
    res.json(fresh.plain);
  } catch (error) {
    console.error('Исключение из команды:', error);
    res.status(500).json({ error: 'Не удалось убрать человека' });
  }
});

/**
 * Обзор команды: кто за что отвечает и что требует вмешательства.
 *
 * Отвечает на другой вопрос, чем доска и загрузка, и поэтому существует
 * отдельно. Доска показывает состояние работы, загрузка — часы; ни та, ни
 * другая не отвечают на «за что отвечает Белякова», а именно этот вопрос
 * задают о команде первым. Поэтому единица ответа здесь — человек, а не
 * карточка и не день: строка сотрудника со своими активными частями.
 *
 * Отдаются только КОМАНДНЫЕ задачи — те, что привязаны к этой команде. Личные
 * задачи участников сюда не попадают, даже если смотрит руководитель, которому
 * они видны в других разделах: обзор команды — про общую работу, и подмешивать
 * в него чужие личные дела значит превратить его в слежку.
 */
router.get('/:id/overview', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    // 404, а не 403: для постороннего скрытая команда не существует.
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    // Содержимое команды открыто её составу, включая наблюдателя. Тот, кому
    // видна только сама команда (уровень доступа «вся компания»), получает
    // список людей без единой задачи — и это правильный ответ, а не ошибка.
    const inTeam = (team.plain.members || []).some(m => m.userId === req.user.id);

    const rows = inTeam ? await Task.findAll({
      where: { teamId: team.plain.id, isArchived: false },
      include: [
        { model: TaskProject, as: 'project', attributes: ['id', 'name', 'color'], required: false },
        {
          model: TaskPart,
          as: 'parts',
          required: false,
          include: [{
            model: TaskPartAssignee,
            as: 'assignees',
            required: false,
            attributes: ['userId', 'plannedDate'],
          }],
        },
      ],
      order: [['createdAt', 'DESC']],
    }) : [];

    const tasks = rows.map(row => row.get({ plain: true }));
    const today = new Date().toISOString().slice(0, 10);

    /**
     * Три сигнала, и все три — про то, что ход за человеком, а не про объём
     * работы. Числа «сколько всего задач» здесь намеренно нет: оно не падает до
     * нуля никогда, а показатель, который горит всегда, перестают замечать
     * через неделю — ровно по той же причине, по какой в бейдже модуля считают
     * только неразобранное.
     */
    const signals = { unplanned: 0, stuck: 0, overdue: 0 };
    for (const task of tasks) {
      for (const part of task.parts || []) {
        if (part.status === partsService.STATUS.DONE) continue;
        if (part.status === partsService.STATUS.STUCK) signals.stuck += 1;
        if ((part.assignees || []).some(a => !a.plannedDate)) signals.unplanned += 1;
        if (String(part.dueDate) < today) signals.overdue += 1;
      }
    }

    // Человек — строка обзора, поэтому части раскладываются по исполнителям, а
    // не по задачам. Один и тот же кусок на троих попадёт в три строки: это
    // честно, за него отвечают трое.
    const byUser = new Map((team.plain.members || []).map(m => [m.userId, []]));
    for (const task of tasks) {
      for (const part of task.parts || []) {
        if (part.status === partsService.STATUS.DONE) continue;
        for (const assignee of part.assignees || []) {
          if (!byUser.has(assignee.userId)) continue;
          byUser.get(assignee.userId).push({
            taskId: task.id,
            code: task.code,
            taskTitle: task.title,
            partId: part.id,
            title: part.title,
            status: part.status,
            dueDate: part.dueDate,
            plannedDate: assignee.plannedDate,
            estimateHours: part.estimateHours,
            project: task.project || null,
            isOverdue: String(part.dueDate) < today,
          });
        }
      }
    }

    const users = await User.findAll({
      attributes: ['id', 'displayName', 'username', 'avatar', 'taskWorkSchedule'],
      where: { id: (team.plain.members || []).map(m => m.userId) },
      raw: true,
    });
    const byId = new Map(users.map(u => [u.id, u]));

    const people = (team.plain.members || []).map(member => ({
      user: byId.get(member.userId) || null,
      role: member.role,
      enrolled: !!byId.get(member.userId)?.taskWorkSchedule,
      // Ближайший срок первым: обзор читают сверху вниз и останавливаются на
      // том, что горит, а не досматривают до конца.
      parts: (byUser.get(member.userId) || [])
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
    }));

    res.json({
      team: team.plain,
      inTeam,
      isLead: teams.isLead(team.plain, req.user.id),
      signals,
      people,
      taskCount: tasks.length,
    });
  } catch (error) {
    console.error('Обзор команды:', error);
    res.status(500).json({ error: 'Не удалось собрать обзор команды' });
  }
});

/**
 * Показатели команды за период.
 *
 * Отвечает на вопрос, которого нет ни на одной другой вкладке: не «что сейчас»
 * и не «сколько часов», а «как команда работает». Считается по её истории —
 * одиннадцать типов событий пишутся туда с самого запуска модуля, и до сих пор
 * их читала только лента в карточке задачи.
 *
 * Что здесь есть и почему именно это:
 *
 *   соблюдение срока   — доля закрытого не позже предложенного срока. Главная
 *                        цифра: всё остальное объясняет, почему она такая.
 *   продления          — сколько раз оценка не сошлась и на сколько часов.
 *                        Систематические продления значат, что команда
 *                        оценивает не работу, а желаемое.
 *   переносы           — сколько подзадач двигали и сколько дошло до третьего
 *                        переноса, после которого система требует решения.
 *   продавлено         — постановки сверх нормы вместе с объяснениями, которые
 *                        тогда вписали. Это единственное место, где видно, как
 *                        часто команда живёт в аврале, и чем его объясняют.
 *   возвраты           — «не моя зона»: задачи адресуют не тому.
 *   скорость разбора   — медиана от постановки до «взял в план». Отличает
 *                        «медленно работаем» от «медленно начинаем».
 *
 * Медиана, а не среднее: одна задача, пролежавшая месяц в отпуске исполнителя,
 * утягивает среднее так, что по нему нельзя судить об остальных.
 *
 * Считается ТОЛЬКО по командным задачам — тем, что привязаны к этой команде.
 * Личные дела участников в показатели команды не попадают, как и в обзор.
 */
router.get('/:id/stats', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Нужен период: start и end' });

    const inTeam = (team.plain.members || []).some(m => m.userId === req.user.id);
    if (!inTeam) return res.json({ inTeam: false });

    const from = new Date(`${start}T00:00:00`);
    const to = new Date(`${end}T23:59:59`);

    const tasks = await Task.findAll({
      attributes: ['id', 'code', 'title', 'projectId'],
      where: { teamId: team.plain.id },
      include: [
        { model: TaskProject, as: 'project', attributes: ['id', 'name', 'color'], required: false },
        {
          model: TaskPart,
          as: 'parts',
          required: false,
          include: [{ model: TaskPartAssignee, as: 'assignees', attributes: ['userId'], required: false }],
        },
      ],
    });

    const partById = new Map();
    const taskOfPart = new Map();
    for (const row of tasks) {
      const task = row.get({ plain: true });
      for (const part of task.parts || []) {
        partById.set(part.id, part);
        taskOfPart.set(part.id, task);
      }
    }
    if (!partById.size) {
      return res.json({ inTeam: true, empty: true, team: team.plain });
    }

    const events = await TaskHistory.findAll({
      attributes: ['partId', 'userId', 'action', 'payload', 'createdAt'],
      where: {
        partId: { [Op.in]: [...partById.keys()] },
        createdAt: { [Op.between]: [from, to] },
      },
      order: [['createdAt', 'ASC']],
      raw: true,
    });

    // Часы подзадачи — с умножением на исполнителей, как везде в модуле: общий
    // кусок на троих это не два часа, а шесть.
    const hoursOf = part => Number(part.estimateHours || 0) * Math.max((part.assignees || []).length, 1);
    const people = new Map((team.plain.members || []).map(m => [m.userId, {
      userId: m.userId, done: 0, hours: 0, onTime: 0, moved: 0, extended: 0,
    }]));
    const bump = (userId, field, value = 1) => {
      const row = people.get(userId);
      if (row) row[field] += value;
    };

    const stats = {
      done: 0, hours: 0, onTime: 0, late: 0,
      moved: 0, becameStuck: 0,
      extended: 0, extendedHours: 0,
      forced: 0, declined: 0,
    };
    const byProject = new Map();
    const forcedReasons = [];
    const declinedReasons = [];

    for (const event of events) {
      const part = partById.get(event.partId);
      if (!part) continue;
      const payload = event.payload || {};

      if (event.action === 'status_changed' && payload.to === 'done') {
        stats.done += 1;
        stats.hours += hoursOf(part);
        // Срок считается по дате закрытия, а не по времени: подзадача, закрытая
        // в свой последний день вечером, просрочена не была.
        const closed = new Date(event.createdAt).toISOString().slice(0, 10);
        const inTime = closed <= String(part.dueDate);
        if (inTime) stats.onTime += 1; else stats.late += 1;

        const task = taskOfPart.get(event.partId);
        const key = task.project?.id || 'none';
        const bucket = byProject.get(key) || {
          id: task.project?.id || null,
          name: task.project?.name || 'Без проекта',
          color: task.project?.color || null,
          hours: 0,
          done: 0,
        };
        bucket.hours += hoursOf(part);
        bucket.done += 1;
        byProject.set(key, bucket);

        for (const a of part.assignees || []) {
          bump(a.userId, 'done');
          bump(a.userId, 'hours', Number(part.estimateHours || 0));
          if (inTime) bump(a.userId, 'onTime');
        }
      }

      if (event.action === 'moved') {
        stats.moved += 1;
        if (payload.becameStuck) stats.becameStuck += 1;
        bump(event.userId, 'moved');
      }

      if (event.action === 'extended') {
        stats.extended += 1;
        stats.extendedHours += Math.max(Number(payload.to || 0) - Number(payload.from || 0), 0);
        bump(event.userId, 'extended');
      }

      if (event.action === 'forced') {
        stats.forced += 1;
        if (payload.explanation) {
          const task = taskOfPart.get(event.partId);
          forcedReasons.push({
            code: task?.code || null,
            title: task?.title || null,
            text: String(payload.explanation),
            at: event.createdAt,
          });
        }
      }

      if (event.action === 'declined') {
        stats.declined += 1;
        const task = taskOfPart.get(event.partId);
        declinedReasons.push({
          code: task?.code || null,
          title: part.title || task?.title || null,
          text: payload.reason ? String(payload.reason) : null,
          at: event.createdAt,
        });
      }
    }

    /**
     * Скорость разбора: от появления подзадачи до первого «взял в план».
     *
     * Берётся первое событие planned у каждой подзадачи: их может быть
     * несколько, если человек снимал и ставил заново, но интересует именно
     * первое — сколько работа пролежала нетронутой.
     */
    const firstPlanned = new Map();
    for (const event of events) {
      if (event.action !== 'planned') continue;
      if (!firstPlanned.has(event.partId)) firstPlanned.set(event.partId, event.createdAt);
    }
    const waits = [];
    for (const [partId, at] of firstPlanned) {
      const part = partById.get(partId);
      if (!part?.createdAt) continue;
      const hours = (new Date(at) - new Date(part.createdAt)) / 3600000;
      if (hours >= 0) waits.push(hours);
    }
    waits.sort((a, b) => a - b);
    const median = waits.length
      ? (waits.length % 2
        ? waits[(waits.length - 1) / 2]
        : (waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2)
      : null;

    const users = await User.findAll({
      attributes: ['id', 'displayName', 'username', 'avatar'],
      where: { id: [...people.keys()] },
      raw: true,
    });
    const byId = new Map(users.map(u => [u.id, u]));

    const round = value => Math.round(Number(value) * 10) / 10;

    res.json({
      inTeam: true,
      empty: false,
      team: team.plain,
      period: { start, end },
      totals: {
        ...stats,
        hours: round(stats.hours),
        extendedHours: round(stats.extendedHours),
        // Процент не считается, когда считать не из чего: ноль закрытых
        // подзадач это не «ноль процентов в срок», а отсутствие ответа.
        onTimePercent: stats.done ? Math.round((stats.onTime / stats.done) * 100) : null,
        planWaitHours: median === null ? null : round(median),
        planWaitCount: waits.length,
      },
      byProject: [...byProject.values()]
        .map(row => ({ ...row, hours: round(row.hours) }))
        .sort((a, b) => b.hours - a.hours),
      // Последние объяснения, а не все: их читают, чтобы понять характер
      // авралов, и десятка хватает.
      forcedReasons: forcedReasons.slice(-10).reverse(),
      declinedReasons: declinedReasons.slice(-10).reverse(),
      people: [...people.values()]
        .map(row => ({
          ...row,
          hours: round(row.hours),
          user: byId.get(row.userId) || null,
          onTimePercent: row.done ? Math.round((row.onTime / row.done) * 100) : null,
        }))
        .sort((a, b) => b.done - a.done || b.hours - a.hours),
    });
  } catch (error) {
    console.error('Показатели команды:', error);
    res.status(500).json({ error: 'Не удалось собрать показатели команды' });
  }
});

/**
 * Загрузка участников команды за период — часы и цвет, без содержания.
 *
 * Ответ собирается loadQuery, который названий событий не выбирает вовсе.
 */
router.get('/:id/load', authenticate, async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);
    if (!team || !teams.canSeeTeam(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    if (!teams.canSeeTeamLoad(team.plain, req.user.id, req.user.isAdmin)) {
      return res.status(403).json({ error: 'Загрузка этой команды закрыта' });
    }

    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Нужен период: start и end' });

    const memberIds = teams.memberIds(team.plain);
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };
    const matrix = await loadQuery.loadMatrix(memberIds, start, end, viewer);

    const users = await User.findAll({
      attributes: ['id', 'displayName', 'username', 'avatar', 'taskWorkSchedule'],
      where: { id: memberIds },
      raw: true,
    });
    const byId = new Map(users.map(u => [u.id, u]));

    const rows = loadQuery.toRows(matrix).map(row => ({
      ...row,
      user: byId.get(row.userId) || null,
    }));

    // Процент — от суммы личных норм участников, а не от «людей × 8 ч»:
    // команда из подрядчиков на part-time иначе выглядела бы недозагруженной.
    // Сам свод живёт в loadQuery: те же цифры теперь считает и вкладка
    // «Сотрудники», и расходиться они не должны.
    const summary = loadQuery.summarize(matrix);

    res.json({ team: team.plain, rows, summary });
  } catch (error) {
    console.error('Загрузка команды:', error);
    res.status(500).json({ error: 'Не удалось посчитать загрузку' });
  }
});

module.exports = router;
