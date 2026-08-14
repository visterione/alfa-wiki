/**
 * Команды: границы видимости и загрузка внутри команды.
 *
 * Скрытая команда обрабатывается здесь особым образом и в двух местах сразу:
 * её нет в списке и её нет в счётчике закрытых. Второе не менее важно, чем
 * первое — «ещё 3 команды закрыты для вас» при скрытой команде выдаёт ровно
 * то, что она прячет.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middleware/auth');
const { TaskTeam, TaskTeamMember, User, sequelize } = require('../../models');
const context = require('../../services/tasks/context');
const teams = require('../../services/tasks/teams');
const workload = require('../../services/tasks/workload');
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
        access: teams.ACCESS[String(req.body.access || 'all').toUpperCase()] || teams.ACCESS.ALL,
        isHidden: !!req.body.isHidden,
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
    if (req.body.access !== undefined) patch.access = req.body.access;
    if (req.body.isHidden !== undefined) patch.isHidden = !!req.body.isHidden;
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
    const fresh = await loadTeam(req.params.id);
    res.json(fresh.plain);
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
      attributes: ['id', 'displayName', 'username', 'avatar', 'dailyNormHours'],
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
    const summary = summarize(matrix);

    res.json({ team: team.plain, rows, summary });
  } catch (error) {
    console.error('Загрузка команды:', error);
    res.status(500).json({ error: 'Не удалось посчитать загрузку' });
  }
});

/**
 * Свод по уже посчитанной матрице.
 *
 * Считается по готовым числам, а не пересчётом из событий: второй проход по
 * календарю ради тех же цифр — лишний запрос и лишний способ разойтись с
 * таблицей, которую пользователь видит рядом.
 */
function summarize(matrix) {
  let hours = 0;
  let capacity = 0;
  let overloadedDays = 0;
  const perUser = [];

  for (const [userId, perDay] of matrix) {
    let free = 0;
    let over = 0;
    for (const [, load] of perDay) {
      if (load.onVacation || load.norm === null) continue;
      hours += load.hours;
      capacity += load.norm;
      free += load.free;
      if (load.color === workload.COLORS.OVER) {
        over += 1;
        overloadedDays += 1;
      }
    }
    perUser.push({ userId, freeHours: round(free), overloadedDays: over });
  }

  return {
    hours: round(hours),
    capacity: round(capacity),
    percent: capacity ? Math.round((hours / capacity) * 100) : 0,
    freeHours: round(Math.max(0, capacity - hours)),
    overloadedDays,
    perUser: perUser.sort((a, b) => b.freeHours - a.freeHours),
  };
}

const round = v => Math.round(v * 100) / 100;

module.exports = router;
