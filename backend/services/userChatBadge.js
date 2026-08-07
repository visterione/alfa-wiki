'use strict';

/**
 * Метка сотрудника в чатах.
 *
 * Иконку задаёт роль, цвет — клиника. Правила выбора при нескольких ролях и
 * клиниках живут в utils/resolveChatBadge.js; здесь — только работа с базой.
 *
 * Результат материализуется в users.chatBadge: запросов чата, читающих метку,
 * больше двадцати, и джойнить в каждом роли с клиниками неоправданно дорого.
 * Поэтому при любом изменении входных данных нужно звать recompute*.
 */

const { User, Role, MedCenter, UserRole, UserMedCenter } = require('../models');
const { normalizeBadgeOverride, resolveBadge, sameBadge } = require('../utils/resolveChatBadge');

const USER_INCLUDES = [
  {
    model: Role,
    as: 'roles',
    through: { attributes: [] },
    attributes: ['id', 'name', 'chatBadgeIcon', 'chatBadgeLabel', 'badgePriority']
  },
  {
    model: MedCenter,
    as: 'medCenters',
    through: { attributes: [] },
    attributes: ['id', 'name', 'color', 'sortOrder']
  }
];

async function applyToUsers(users) {
  let changed = 0;
  for (const user of users) {
    const badge = resolveBadge(user);
    if (sameBadge(user.chatBadge, badge)) continue;
    await user.update({ chatBadge: badge });
    changed += 1;
  }
  return changed;
}

/** Пересчитывает и сохраняет метки указанных пользователей. Возвращает число изменённых. */
async function recomputeForUsers(userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length) return 0;

  const users = await User.findAll({
    where: { id: ids },
    attributes: ['id', 'chatBadge', 'chatBadgeOverride'],
    include: USER_INCLUDES
  });

  return applyToUsers(users);
}

/** Роль сменила иконку/приоритет — пересчитываем всех её носителей. */
async function recomputeForRole(roleId) {
  if (!roleId) return 0;
  const links = await UserRole.findAll({ where: { roleId }, attributes: ['userId'] });
  return recomputeForUsers(links.map(link => link.userId));
}

/** У клиники сменился цвет/порядок — пересчитываем всех её сотрудников. */
async function recomputeForMedCenter(medCenterId) {
  if (!medCenterId) return 0;
  const links = await UserMedCenter.findAll({ where: { medCenterId }, attributes: ['userId'] });
  return recomputeForUsers(links.map(link => link.userId));
}

/** Полный пересчёт — миграция и ручная починка. */
async function recomputeAll() {
  const users = await User.findAll({
    attributes: ['id', 'chatBadge', 'chatBadgeOverride'],
    include: USER_INCLUDES
  });

  return { total: users.length, changed: await applyToUsers(users) };
}

module.exports = {
  normalizeBadgeOverride,
  resolveBadge,
  recomputeForUsers,
  recomputeForRole,
  recomputeForMedCenter,
  recomputeAll
};
