/**
 * Права складского модуля.
 *
 * Три уровня, и их важно не путать:
 *
 *   1) **Доступ к разделу** — гранулярный флаг adminAccess.warehouse, тем же
 *      механизмом, что «Отзывы» и «Справочник медцентров». Без него человек не
 *      видит раздел вообще.
 *
 *   2) **Роли внутри модуля** — матрица из ТЗ (services/warehouse/roles.js):
 *      бухгалтер, зав. складом, инженер, эпидемиолог и так далее. Часть ролей
 *      назначается ролью портала, часть выводится из данных — зав. отделением это
 *      тот, кто указан головой отделения, а не тот, кому выдали галочку.
 *
 *   3) **Область видимости** — сеть или свои локации. ТЗ прямо оговаривает, что
 *      зав. отделением видит отчёты «в рамках своего отделения», и это не
 *      фильтр в интерфейсе, а условие в SQL: иначе достаточно поправить адрес
 *      запроса, чтобы увидеть чужие данные.
 */

const { WhDepartment, WhRoom, WhFloor, WhBuilding, WhAsset, WhInventorySession } = require('../../models');
const roles = require('./roles');

/**
 * Роли, выводимые из данных: их не назначают, они следуют из того, где человек
 * записан ответственным. Отдельным запросом на пользователя — это три коротких
 * COUNT по индексированным полям, и кэшировать их опаснее, чем выполнять: права
 * должны меняться сразу после смены ответственного.
 */
async function derivedRoles(user) {
  const out = new Set();
  if (!user?.id) return out;

  const [depts, rooms, assets, sessions] = await Promise.all([
    WhDepartment.count({ where: { headUserId: user.id, isActive: true } }),
    WhRoom.count({ where: { responsibleUserId: user.id, isActive: true } }),
    WhAsset.count({ where: { responsibleUserId: user.id, isArchived: false } }),
    WhInventorySession.count({ where: { chairmanUserId: user.id } }),
  ]);

  if (depts > 0) out.add('department_head');
  if (rooms > 0 || assets > 0) out.add('responsible');
  if (sessions > 0) out.add('commission_chair');
  return out;
}

function hasModuleAccess(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return Boolean(user.adminAccess?.warehouse);
}

/**
 * Полный расчёт прав пользователя в модуле: набор ролей, область видимости,
 * доступные отчёты и возможности.
 */
async function resolveAccess(user) {
  if (!hasModuleAccess(user)) {
    return { allowed: false, roles: new Set(), scope: 'none' };
  }
  const assigned = roles.assignedRoles(user);
  const derived = await derivedRoles(user);
  const all = new Set([...assigned, ...derived]);

  return {
    allowed: true,
    roles: all,
    assigned,
    derived,
    scope: all.size ? roles.widestScope(all) : 'none',
    capabilities: roles.capabilities(all),
  };
}

/**
 * Кабинеты, доступные пользователю. null означает «ограничений нет» — так
 * вызывающий код отличает «вся сеть» от «ограничение с пустым списком», которые
 * иначе выглядели бы одинаково и открыли бы наблюдателю всю сеть.
 */
async function visibleRoomIds(user, access) {
  if (access.scope === 'network') return null;
  if (access.scope === 'none') return [];

  const [ownDepts, ownRooms, ownAssets] = await Promise.all([
    WhDepartment.findAll({ where: { headUserId: user.id, isActive: true }, attributes: ['id'] }),
    WhRoom.findAll({ where: { responsibleUserId: user.id, isActive: true }, attributes: ['id'] }),
    WhAsset.findAll({ where: { responsibleUserId: user.id, isArchived: false }, attributes: ['roomId'] }),
  ]);

  const ids = new Set(ownRooms.map(r => r.id));
  for (const a of ownAssets) if (a.roomId) ids.add(a.roomId);

  if (ownDepts.length) {
    const deptRooms = await WhRoom.findAll({
      where: { departmentId: ownDepts.map(d => d.id), isActive: true },
      attributes: ['id'],
    });
    for (const r of deptRooms) ids.add(r.id);
  }
  return [...ids];
}

async function visibleDepartmentIds(user, access) {
  if (access.scope === 'network') return null;
  if (access.scope === 'none') return [];

  const own = await WhDepartment.findAll({
    where: { headUserId: user.id, isActive: true }, attributes: ['id'],
  });
  if (own.length) return own.map(d => d.id);

  const rooms = await WhRoom.findAll({
    where: { responsibleUserId: user.id, isActive: true }, attributes: ['departmentId'],
  });
  return [...new Set(rooms.map(r => r.departmentId).filter(Boolean))];
}

/**
 * Express-middleware: пускает в модуль и кладёт в req.warehouse расчёт прав.
 * capability — необязательное требование конкретной возможности.
 */
function requireWarehouse(capability = null) {
  return async (req, res, next) => {
    try {
      const access = await resolveAccess(req.user);
      if (!access.allowed) {
        return res.status(403).json({ error: 'Нет доступа к разделу «Складской учёт»' });
      }
      if (!access.roles.size) {
        return res.status(403).json({
          error: 'Раздел открыт, но роль в модуле не назначена. Обратитесь к администратору модуля.',
        });
      }
      if (capability && !access.capabilities[capability]) {
        const title = roles.CAPABILITY_MATRIX[capability]?.title || capability;
        return res.status(403).json({ error: `Недостаточно прав: «${title}»` });
      }

      req.warehouse = {
        access,
        roles: access.roles,
        scope: access.scope,
        capabilities: access.capabilities,
        // Уровень оставлен для совместимости с экранами, написанными до матрицы.
        level: access.capabilities.canManageAccess ? 'admin'
          : access.capabilities.canManageCatalog ? 'warehouse'
          : access.capabilities.canIssue ? 'department' : 'viewer',
        scopedRoomIds: () => visibleRoomIds(req.user, access),
        scopedDepartmentIds: () => visibleDepartmentIds(req.user, access),
      };
      next();
    } catch (err) {
      console.error('warehouse access error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  };
}

/**
 * Middleware конкретного отчёта. Ставится после requireWarehouse и проверяет
 * право по матрице ТЗ — именно здесь «эпидемиолог не открывает амортизацию»
 * перестаёт быть обещанием интерфейса и становится правилом сервера.
 */
function requireReport(code, mode = 'read') {
  return (req, res, next) => {
    const set = req.warehouse?.roles;
    if (!set) return res.status(403).json({ error: 'Нет доступа' });

    const ok = mode === 'write' ? roles.canWrite(set, code) : roles.canRead(set, code);
    if (!ok) {
      const entry = roles.ACCESS_MATRIX[code];
      const allowed = (mode === 'write' ? entry?.write : entry?.read) || [];
      return res.status(403).json({
        error: `Отчёт «${entry?.title || code}» доступен ролям: `
          + allowed.map(r => roles.WAREHOUSE_ROLES[r]?.label || r).join(', '),
        code,
        requiredRoles: allowed,
      });
    }
    next();
  };
}

/**
 * Полный путь локации строкой: «Главный корпус / 3 этаж / Каб. 312».
 * Нужен почти каждому отчёту, поэтому собран здесь один раз.
 */
async function roomPath(roomId) {
  const room = await WhRoom.findByPk(roomId, {
    include: [
      { model: WhFloor, as: 'floor', include: [{ model: WhBuilding, as: 'building' }] },
      { model: WhDepartment, as: 'department' },
    ],
  });
  if (!room) return '';
  return [
    room.floor?.building?.name,
    room.floor ? `${room.floor.number} этаж` : null,
    room.department?.name,
    `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`,
  ].filter(Boolean).join(' / ');
}

module.exports = {
  hasModuleAccess,
  derivedRoles,
  resolveAccess,
  visibleRoomIds,
  visibleDepartmentIds,
  requireWarehouse,
  requireReport,
  roomPath,
};
