/**
 * Отчёты по загрузке.
 *
 * Чего здесь нет намеренно: времени в приложении, активности, статуса «онлайн»
 * и счётчиков переносов по конкретным людям. Загрузка — это сумма
 * запланированного, а не наблюдение за человеком, и модуль, в котором появится
 * первое из перечисленного, перестанут заполнять честно в тот же месяц.
 *
 * Проценты без персональных норм врут: одна и та же команда выглядит
 * перегруженной при норме 7 ч и катастрофой при 6,4. Поэтому всё считается от
 * суммы личных норм участников.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middleware/auth');
const { Op } = require('sequelize');
const { TaskPart, TaskPartAssignee, Task, User } = require('../../models');

const context = require('../../services/tasks/context');
const teams = require('../../services/tasks/teams');
const loadQuery = require('../../services/tasks/loadQuery');
const workload = require('../../services/tasks/workload');
const partsService = require('../../services/tasks/parts');

router.get('/', authenticate, async (req, res) => {
  try {
    const { start, end, medCenterId, teamId } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Нужен период: start и end' });

    const all = await context.loadTeams();
    const scope = teams.peopleInScope(all, req.user.id, req.user.isAdmin, { medCenterId, teamId });
    const viewer = { id: req.user.id, isAdmin: req.user.isAdmin };

    const matrix = await loadQuery.loadMatrix(scope, start, end, viewer);

    // Не обработано: части, у которых хоть один исполнитель не назначил день.
    // Это главная цифра отчёта — она показывает, сколько работы числится
    // поставленной, но на самом деле ещё никем не начато.
    const unprocessed = await TaskPartAssignee.count({
      where: { userId: { [Op.in]: scope }, plannedDate: null, declinedAt: null },
    });

    const parts = await TaskPart.findAll({
      attributes: ['id', 'taskId', 'status', 'estimateHours'],
      include: [{
        model: TaskPartAssignee,
        as: 'assignees',
        required: true,
        where: { userId: { [Op.in]: scope } },
        attributes: ['userId'],
      }],
    });

    const byTask = new Map();
    for (const part of parts) {
      if (!byTask.has(part.taskId)) byTask.set(part.taskId, []);
      byTask.get(part.taskId).push(part.get({ plain: true }));
    }
    const multiPersonTasks = [...byTask.values()]
      .filter(list => partsService.taskPeople(list).length > 1).length;
    const stuckParts = parts.filter(p => p.status === partsService.STATUS.STUCK).length;

    const users = await User.findAll({
      attributes: ['id', 'displayName', 'username', 'avatar', 'dailyNormHours'],
      where: { id: scope },
      raw: true,
    });
    const byId = new Map(users.map(u => [u.id, u]));

    let overloadedPersonDays = 0;
    const freeByPerson = [];
    for (const [userId, perDay] of matrix) {
      let free = 0;
      let over = 0;
      for (const [, load] of perDay) {
        if (load.onVacation || load.norm === null) continue;
        free += load.free;
        if (load.color === workload.COLORS.OVER) over += 1;
      }
      overloadedPersonDays += over;
      freeByPerson.push({
        user: byId.get(userId) || { id: userId },
        freeHours: round(free),
        overloadedDays: over,
      });
    }
    freeByPerson.sort((a, b) => b.freeHours - a.freeHours);

    // По командам — только те, чью загрузку запрашивающий вправе видеть.
    const byTeam = [];
    for (const team of all) {
      if (!teams.canSeeTeamLoad(team, req.user.id, req.user.isAdmin)) continue;
      if (medCenterId && team.medCenterId !== medCenterId) continue;
      let hours = 0;
      let capacity = 0;
      for (const userId of teams.memberIds(team)) {
        const perDay = matrix.get(userId);
        if (!perDay) continue;
        for (const [, load] of perDay) {
          if (load.onVacation || load.norm === null) continue;
          hours += load.hours;
          capacity += load.norm;
        }
      }
      byTeam.push({
        id: team.id,
        name: team.name,
        hours: round(hours),
        capacity: round(capacity),
        percent: capacity ? Math.round((hours / capacity) * 100) : 0,
      });
    }
    byTeam.sort((a, b) => b.percent - a.percent);

    res.json({
      period: { start, end },
      people: scope.length,
      unprocessed,
      overloadedPersonDays,
      multiPersonTasks,
      stuckParts,
      freeByPerson,
      byTeam,
      // Явным полем, а не комментарием в коде: интерфейс показывает это внизу
      // отчёта, чтобы вопрос «а можно ещё метрику активности» закрывался сам.
      deliberatelyAbsent: [
        'время в приложении',
        'активность и статус «онлайн»',
        'счётчики переносов по конкретным людям',
      ],
    });
  } catch (error) {
    console.error('Отчёт по загрузке:', error);
    res.status(500).json({ error: 'Не удалось построить отчёт' });
  }
});

const round = v => Math.round(v * 100) / 100;

module.exports = router;
