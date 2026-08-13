/**
 * Настройка прав складского модуля.
 *
 * Роли модуля выдаются ролям портала — тем же механизмом, что и остальные права
 * (roles.permissions), просто в своей ветке `warehouse.roles`. Отдельного реестра
 * прав не заводим: их в портале уже два (adminAccess и permissions), и третий
 * гарантированно разъехался бы с ними.
 *
 * Экран настройки при этом свой, а не общий экран ролей: там правится вся система
 * прав портала, и чтобы выдать эпидемиологу доступ к срокам годности, пришлось бы
 * пускать человека в настройку всего сразу.
 */

const express = require('express');
const router = express.Router();
const { Role, User, sequelize } = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, resolveAccess, visibleRoomIds } = require('../../services/warehouse/access');
const roles = require('../../services/warehouse/roles');

/**
 * Справочник: роли модуля, матрица отчётов и возможностей.
 * Отдаётся любому, кто вообще имеет доступ в модуль: знать, кому что положено,
 * полезно и рядовому пользователю — он поймёт, к кому идти за доступом.
 */
router.get('/matrix', authenticate, requireWarehouse(), async (req, res) => {
  res.json({
    roles: Object.entries(roles.WAREHOUSE_ROLES).map(([key, def]) => ({ key, ...def })),
    reports: Object.entries(roles.ACCESS_MATRIX).map(([code, def]) => ({
      code, title: def.title, read: def.read, write: def.write,
    })),
    capabilities: Object.entries(roles.CAPABILITY_MATRIX).map(([key, def]) => ({
      key, title: def.title, roles: def.roles,
    })),
    // Свои роли и область видимости — чтобы экран мог подсветить строки матрицы,
    // которые касаются лично тебя.
    my: {
      roles: [...req.warehouse.roles],
      assigned: [...(req.warehouse.access.assigned || [])],
      derived: [...(req.warehouse.access.derived || [])],
      scope: req.warehouse.scope,
      capabilities: req.warehouse.capabilities,
    },
  });
});

/**
 * Назначение ролей модуля ролям портала.
 */
router.get('/role-grants', authenticate, requireWarehouse('canManageAccess'), async (req, res) => {
  try {
    const all = await Role.findAll({
      attributes: ['id', 'name', 'description', 'permissions', 'isSystem'],
      order: [['name', 'ASC']],
    });

    // Сколько человек в каждой роли: без этого непонятно, на кого повлияет
    // изменение, и права меняют вслепую.
    const [counts] = await sequelize.query(`
      SELECT r.id, COUNT(DISTINCT u.id)::int AS users
      FROM roles r
      LEFT JOIN user_roles ur ON ur."roleId" = r.id
      LEFT JOIN users u ON (u.id = ur."userId" OR u."roleId" = r.id) AND u."isActive" = TRUE
      GROUP BY r.id
    `).catch(() => [[]]);
    const byId = new Map((counts || []).map(c => [c.id, c.users]));

    res.json(all.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      users: byId.get(r.id) ?? null,
      warehouseRoles: Array.isArray(r.permissions?.warehouse?.roles)
        ? r.permissions.warehouse.roles.filter(k => roles.WAREHOUSE_ROLES[k])
        : [],
    })));
  } catch (err) {
    console.error('GET warehouse/permissions/role-grants error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/role-grants/:roleId', authenticate, requireWarehouse('canManageAccess'), async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Роль не найдена' });

    const incoming = Array.isArray(req.body.warehouseRoles) ? req.body.warehouseRoles : [];
    const unknown = incoming.filter(k => !roles.WAREHOUSE_ROLES[k]);
    if (unknown.length) {
      return res.status(400).json({ error: `Неизвестные роли модуля: ${unknown.join(', ')}` });
    }
    // Выводимые роли назначать нельзя: зав. отделением — это тот, кто указан
    // головой отделения, а не тот, кому поставили галочку. Разрешив назначение,
    // мы получили бы два несогласованных источника одной и той же роли.
    const derived = incoming.filter(k => roles.WAREHOUSE_ROLES[k].kind === 'derived');
    if (derived.length) {
      return res.status(400).json({
        error: 'Эти роли не назначаются, они следуют из данных: '
          + derived.map(k => roles.WAREHOUSE_ROLES[k].label).join(', ')
          + '. Назначьте человека заведующим отделением или ответственным за кабинет.',
      });
    }

    const permissions = { ...(role.permissions || {}) };
    permissions.warehouse = { ...(permissions.warehouse || {}), roles: incoming };
    // Ветку read/write/delete/admin оставляем как есть: на неё опирается общий
    // requirePermission портала, и обнулять её здесь не наше дело.
    await role.update({ permissions });

    res.json({ id: role.id, warehouseRoles: incoming });
  } catch (err) {
    console.error('PUT warehouse/permissions/role-grants error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Проверка доступа конкретного человека: что он реально откроет и в каком объёме.
 *
 * Экран настройки без этого превращается в гадание — таблица галочек есть, а
 * ответа на вопрос «Иванова увидит амортизацию?» нет. Здесь он считается тем же
 * кодом, что и на боевых запросах, а не пересказывается.
 */
router.get('/effective/:userId', authenticate, requireWarehouse('canManageAccess'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
      ],
      attributes: { exclude: ['password'] },
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const access = await resolveAccess(user);
    if (!access.allowed) {
      return res.json({
        user: { id: user.id, displayName: user.displayName, username: user.username },
        allowed: false,
        reason: 'Не включён доступ к разделу «Складской учёт» в карточке пользователя',
      });
    }

    const roomIds = await visibleRoomIds(user, access);

    res.json({
      user: {
        id: user.id, displayName: user.displayName, username: user.username,
        isAdmin: user.isAdmin,
        portalRoles: [user.role?.name, ...(user.roles || []).map(r => r.name)].filter(Boolean),
      },
      allowed: true,
      roles: [...access.roles].map(k => ({
        key: k, label: roles.WAREHOUSE_ROLES[k]?.label || k,
        kind: roles.WAREHOUSE_ROLES[k]?.kind,
      })),
      scope: access.scope,
      visibleRooms: roomIds === null ? 'all' : roomIds.length,
      capabilities: access.capabilities,
      reports: Object.entries(roles.ACCESS_MATRIX).map(([code, def]) => ({
        code, title: def.title,
        read: roles.canRead(access.roles, code),
        write: roles.canWrite(access.roles, code),
      })),
    });
  } catch (err) {
    console.error('GET warehouse/permissions/effective error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Пользователи с доступом к модулю — для выбора в проверке. */
router.get('/users', authenticate, requireWarehouse('canManageAccess'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT u.id, u."displayName", u.username, u."isAdmin",
             (u."adminAccess" ->> 'warehouse')::bool AS "hasModule"
      FROM users u
      WHERE u."isActive" = TRUE AND (u."isBot" IS NULL OR u."isBot" = FALSE)
        AND (u."isAdmin" = TRUE OR (u."adminAccess" ->> 'warehouse')::bool = TRUE)
      ORDER BY u."displayName" NULLS LAST, u.username
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET warehouse/permissions/users error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
