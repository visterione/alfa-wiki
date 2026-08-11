/**
 * Права складского модуля.
 *
 * Два уровня, и их важно не путать:
 *
 *   1) Доступ к модулю — гранулярный флаг adminAccess.warehouse, тем же
 *      механизмом, что «Отзывы» и «Справочник медцентров». Без него человек
 *      вообще не видит раздел.
 *
 *   2) Роль внутри модуля — что человеку можно делать и какие локации он видит.
 *      Этого в портале до сих пор не было: доступ везде решался флагом «пустил /
 *      не пустил». Здесь нужен row-level scope, потому что зав. отделением по ТЗ
 *      видит отчёты «в рамках своего отделения», а не по всей сети.
 *
 * Роль внутри модуля выводится, а не хранится отдельным полем: источник —
 * warehouse_departments.headUserId (зав. отделением) и права роли
 * permissions.warehouse. Заводить третий реестр прав ради этого модуля значит
 * гарантировать, что он разъедется с двумя существующими.
 */

const { WhDepartment, WhRoom, WhFloor, WhBuilding } = require('../../models');

// Уровни, по возрастанию полномочий.
const LEVELS = {
  none:       0,
  viewer:     1,   // только чтение своих локаций
  department: 2,   // ведёт своё отделение: выдача, приём, инвентаризация
  warehouse:  3,   // зав. складом: вся сеть, движения и закупки
  admin:      4,   // настройка модуля: локации, номенклатура, права
};

/**
 * Есть ли у пользователя доступ к модулю вообще.
 */
function hasModuleAccess(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return Boolean(user.adminAccess?.warehouse);
}

/**
 * Права роли по модулю: {read, write, delete, admin}. Собираются по всем ролям
 * пользователя — так же, как это делает requirePermission в middleware/auth.js.
 */
function rolePermissions(user) {
  const acc = { read: false, write: false, delete: false, admin: false };
  if (!user) return acc;
  if (user.isAdmin) return { read: true, write: true, delete: true, admin: true };

  const roles = [];
  if (Array.isArray(user.roles)) roles.push(...user.roles);
  if (user.role) roles.push(user.role);

  for (const role of roles) {
    const p = role?.permissions?.warehouse;
    if (!p) continue;
    for (const key of Object.keys(acc)) {
      if (p[key]) acc[key] = true;
    }
  }
  return acc;
}

/**
 * Итоговый уровень пользователя в модуле.
 */
async function resolveLevel(user) {
  if (!hasModuleAccess(user)) return 'none';
  if (user.isAdmin) return 'admin';

  const perms = rolePermissions(user);
  if (perms.admin) return 'admin';
  if (perms.write && perms.delete) return 'warehouse';

  // Зав. отделением: тот, кто указан головой хотя бы одного отделения. Право на
  // запись при этом всё равно нужно — иначе он только смотрит.
  const heads = await WhDepartment.count({ where: { headUserId: user.id, isActive: true } });
  if (heads > 0) return perms.write ? 'department' : 'viewer';

  if (perms.write) return 'warehouse';
  return 'viewer';
}

function atLeast(level, required) {
  return LEVELS[level] >= LEVELS[required];
}

/**
 * Отделения, которые человек видит. null означает «все» — так вызывающий код
 * различает «нет ограничения» и «ограничение с пустым списком», которые иначе
 * выглядели бы одинаково и открыли бы viewer'у всю сеть.
 */
async function visibleDepartmentIds(user, level) {
  if (atLeast(level, 'warehouse')) return null;

  const own = await WhDepartment.findAll({
    where: { headUserId: user.id, isActive: true },
    attributes: ['id'],
  });
  if (own.length) return own.map(d => d.id);

  // Не зав. отделением — тогда видит отделения тех кабинетов, где он МОЛ. Это
  // старшая медсестра или ответственный за кабинет.
  const rooms = await WhRoom.findAll({
    where: { responsibleUserId: user.id, isActive: true },
    attributes: ['departmentId'],
  });
  const ids = [...new Set(rooms.map(r => r.departmentId).filter(Boolean))];
  return ids;
}

/**
 * Кабинеты, доступные пользователю. Возвращает null, если ограничений нет.
 */
async function visibleRoomIds(user, level) {
  const deptIds = await visibleDepartmentIds(user, level);
  if (deptIds === null) return null;

  const where = { isActive: true };
  const rooms = await WhRoom.findAll({ where, attributes: ['id', 'departmentId', 'responsibleUserId'] });
  const set = new Set(deptIds);
  return rooms
    .filter(r => (r.departmentId && set.has(r.departmentId)) || r.responsibleUserId === user.id)
    .map(r => r.id);
}

/**
 * Express-middleware: пускает в модуль и кладёт в req.warehouse уровень и права.
 */
function requireWarehouse(required = 'viewer') {
  return async (req, res, next) => {
    try {
      if (!hasModuleAccess(req.user)) {
        return res.status(403).json({ error: 'Нет доступа к разделу «Складской учёт»' });
      }
      const level = await resolveLevel(req.user);
      if (!atLeast(level, required)) {
        return res.status(403).json({
          error: `Недостаточно прав: нужен уровень «${required}», у вас «${level}»`,
        });
      }
      req.warehouse = {
        level,
        perms: rolePermissions(req.user),
        scopedRoomIds: () => visibleRoomIds(req.user, level),
        scopedDepartmentIds: () => visibleDepartmentIds(req.user, level),
      };
      next();
    } catch (err) {
      console.error('warehouse access error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  };
}

/**
 * Полный путь локации строкой: «Главный корпус / 3 этаж / Каб. 312 / Шкаф А».
 * Нужен почти каждому отчёту, поэтому собран здесь один раз.
 */
async function roomPath(roomId) {
  const room = await WhRoom.findByPk(roomId, {
    include: [{
      model: WhFloor, as: 'floor',
      include: [{ model: WhBuilding, as: 'building' }],
    }, {
      model: WhDepartment, as: 'department',
    }],
  });
  if (!room) return '';
  const parts = [
    room.floor?.building?.name,
    room.floor ? `${room.floor.number} этаж` : null,
    room.department?.name,
    `Каб. ${room.number}${room.name ? ` — ${room.name}` : ''}`,
  ];
  return parts.filter(Boolean).join(' / ');
}

module.exports = {
  LEVELS,
  hasModuleAccess,
  rolePermissions,
  resolveLevel,
  atLeast,
  visibleRoomIds,
  visibleDepartmentIds,
  requireWarehouse,
  roomPath,
};
