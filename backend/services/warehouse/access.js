/**
 * Права складского модуля.
 *
 * Два уровня, и их важно не путать:
 *
 *   1) **Доступ к разделу** — гранулярный флаг adminAccess.warehouse, тем же
 *      механизмом, что «Отзывы» и «Справочник медцентров». Без него человек не
 *      видит раздел вообще.
 *
 *   2) **Права внутри модуля** — строка в warehouse_user_permissions: по разделу
 *      и по каждому отчёту block / read / edit. Выставляются человеку поимённо в
 *      дереве прав админки (services/warehouse/permissions.js — перечень ключей).
 *      Прежнего третьего уровня — матрицы должностей — больше нет: чтобы выдать
 *      один отчёт, приходилось подбирать должность, в которую он входит.
 *
 * **Область видимости** считается отдельно и из двух источников: списка медцентров
 * в правах и того, где человек записан ответственным. Второе — не право, а факт:
 * МОЛ кабинета видит свой кабинет, даже если медцентры в правах не перечислены.
 * Это условие в SQL, а не фильтр в интерфейсе: иначе достаточно поправить адрес
 * запроса, чтобы увидеть чужие данные.
 */

const {
  WhDepartment, WhRoom, WhFloor, WhBuilding, WhAsset, WhUserPermission,
} = require('../../models');
const perms = require('./permissions');

/**
 * Где человек записан ответственным. Не право, а факт: сегодня он ведёт кабинет,
 * завтра нет, и видимость должна меняться вместе с этим, а не отдельной заявкой.
 *
 * Отдельным запросом на пользователя — это два коротких COUNT по индексированным
 * полям, и кэшировать их опаснее, чем выполнять.
 */
async function ownsAnything(user) {
  if (!user?.id) return false;
  const [depts, rooms, assets] = await Promise.all([
    WhDepartment.count({ where: { headUserId: user.id, isActive: true } }),
    WhRoom.count({ where: { responsibleUserId: user.id, isActive: true } }),
    WhAsset.count({ where: { responsibleUserId: user.id, isArchived: false } }),
  ]);
  return depts > 0 || rooms > 0 || assets > 0;
}

function hasModuleAccess(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return Boolean(user.adminAccess?.warehouse);
}

/**
 * Полный расчёт прав пользователя в модуле.
 *
 * Администратор портала получает полный набор в коде, без строки в таблице:
 * иначе после выката некому было бы раздать права, и модуль оказался бы заперт
 * сам от себя.
 */
async function resolveAccess(user) {
  if (!hasModuleAccess(user)) {
    return { allowed: false, perms: perms.emptyPerms(), medCenterIds: [] };
  }

  if (user.isAdmin) {
    const full = perms.fullPerms();
    return {
      allowed: true,
      perms: full,
      medCenterIds: [],
      capabilities: perms.capabilities(full),
      tabs: perms.visibleTabs(full),
      isAdmin: true,
    };
  }

  const row = await WhUserPermission.findOne({ where: { userId: user.id } });
  const normalized = perms.normalize(row?.perms);
  const medCenterIds = Array.isArray(row?.medCenterIds) ? row.medCenterIds : [];

  return {
    allowed: true,
    perms: normalized,
    medCenterIds,
    capabilities: perms.capabilities(normalized),
    tabs: perms.visibleTabs(normalized),
    isAdmin: false,
  };
}

/**
 * Кабинеты, доступные пользователю. null означает «ограничений нет» — так
 * вызывающий код отличает «вся сеть» от «ограничение с пустым списком», которые
 * иначе выглядели бы одинаково и открыли бы наблюдателю всю сеть.
 *
 * Ограничение складывается из двух источников. Список медцентров в правах — то,
 * что выдал администратор. Свои кабинеты — то, за что человек отвечает по данным;
 * они добавляются всегда, даже если медцентр в правах не перечислен, иначе МОЛ
 * перестал бы видеть собственный кабинет из-за чужой настройки.
 */
async function visibleRoomIds(user, access) {
  if (!access.allowed) return [];
  const scoped = Array.isArray(access.medCenterIds) ? access.medCenterIds : [];
  if (!scoped.length) return null;

  const ids = new Set();

  const inScope = await WhRoom.findAll({
    where: { medCenterId: scoped, isActive: true }, attributes: ['id'],
  });
  for (const r of inScope) ids.add(r.id);

  const [ownDepts, ownRooms, ownAssets] = await Promise.all([
    WhDepartment.findAll({ where: { headUserId: user.id, isActive: true }, attributes: ['id'] }),
    WhRoom.findAll({ where: { responsibleUserId: user.id, isActive: true }, attributes: ['id'] }),
    WhAsset.findAll({ where: { responsibleUserId: user.id, isArchived: false }, attributes: ['roomId'] }),
  ]);
  for (const r of ownRooms) ids.add(r.id);
  for (const a of ownAssets) if (a.roomId) ids.add(a.roomId);
  if (ownDepts.length) {
    const deptRooms = await WhRoom.findAll({
      where: { departmentId: ownDepts.map(d => d.id), isActive: true }, attributes: ['id'],
    });
    for (const r of deptRooms) ids.add(r.id);
  }

  return [...ids];
}

async function visibleDepartmentIds(user, access) {
  if (!access.allowed) return [];
  const scoped = Array.isArray(access.medCenterIds) ? access.medCenterIds : [];
  if (!scoped.length) return null;

  const ids = new Set();
  const inScope = await WhDepartment.findAll({
    where: { medCenterId: scoped, isActive: true }, attributes: ['id'],
  });
  for (const d of inScope) ids.add(d.id);

  const own = await WhDepartment.findAll({
    where: { headUserId: user.id, isActive: true }, attributes: ['id'],
  });
  for (const d of own) ids.add(d.id);

  const rooms = await WhRoom.findAll({
    where: { responsibleUserId: user.id, isActive: true }, attributes: ['departmentId'],
  });
  for (const r of rooms) if (r.departmentId) ids.add(r.departmentId);

  return [...ids];
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
      // Раздел открыт, но в дереве прав не отмечено ничего. Сообщение прямое:
      // прежнее говорило про «роль в модуле», которых больше нет, и человек шёл
      // искать их в настройках, где их уже не было.
      if (!perms.hasAnything(access.perms) && !(await ownsAnything(req.user))) {
        return res.status(403).json({
          error: 'Доступ к разделу открыт, но права внутри модуля не выданы. '
            + 'Попросите администратора отметить нужное в дереве прав вашей карточки.',
        });
      }
      if (capability && !access.capabilities[capability]) {
        return res.status(403).json({
          error: `Недостаточно прав: «${perms.capabilityTitle(capability)}»`,
        });
      }

      req.warehouse = {
        access,
        perms: access.perms,
        capabilities: access.capabilities,
        tabs: access.tabs,
        medCenterIds: access.medCenterIds,
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
 * право на этот отчёт — именно здесь «этот человек не открывает амортизацию»
 * перестаёт быть обещанием интерфейса и становится правилом сервера.
 */
function requireReport(code, mode = 'read') {
  return (req, res, next) => {
    const set = req.warehouse?.perms;
    if (!set) return res.status(403).json({ error: 'Нет доступа' });

    const ok = mode === 'write'
      ? perms.canWriteReport(set, code)
      : perms.canReadReport(set, code);
    if (!ok) {
      const title = perms.REPORTS[code]?.label || code;
      return res.status(403).json({
        error: mode === 'write'
          ? `Нет права на изменение в отчёте «${title}»`
          : `Отчёт «${title}» вам не открыт. Права выдаёт администратор в вашей карточке пользователя.`,
        code,
      });
    }
    next();
  };
}

/**
 * Полный путь локации строкой: «3 этаж / Хирургия / Каб. 312».
 * Нужен почти каждому отчёту, поэтому собран здесь один раз.
 *
 * Корпуса в пути больше нет (ver. 7.48): этаж принадлежит медцентру напрямую, а
 * то, чем два одноимённых этажа отличаются друг от друга, теперь стоит в самом
 * названии этажа.
 */
async function roomPath(roomId) {
  const room = await WhRoom.findByPk(roomId, {
    include: [
      { model: WhFloor, as: 'floor' },
      { model: WhDepartment, as: 'department' },
    ],
  });
  if (!room) return '';
  // У склада этажа не бывает, и подпись у него своя: «Каб. Склад» читалось бы
  // как ошибка ввода.
  if (room.isService) {
    return [room.department?.name, room.name || room.number].filter(Boolean).join(' / ');
  }
  return [
    room.floor ? `${room.floor.number} этаж${room.floor.name ? ` — ${room.floor.name}` : ''}` : null,
    room.department?.name,
    `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`,
  ].filter(Boolean).join(' / ');
}

module.exports = {
  hasModuleAccess,
  ownsAnything,
  resolveAccess,
  visibleRoomIds,
  visibleDepartmentIds,
  requireWarehouse,
  requireReport,
  roomPath,
};
