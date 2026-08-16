/**
 * Локации складского модуля: корпуса, этажи, отделения, кабинеты, места хранения
 * и геометрия планов этажей.
 *
 * Дерево локаций отдаётся одним запросом (GET /tree): его читает почти каждый
 * экран модуля — выбор кабинета, фильтр отчёта, навигация по планам. Собирать его
 * последовательными запросами значило бы четыре round-trip на каждое открытие
 * формы.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  sequelize, WhBuilding, WhFloor, WhDepartment, WhRoom, WhStorage, WhFloorShape,
  WhSpecialty, WhAsset, MedCenter, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse } = require('../../services/warehouse/access');
const { generateToken, qrSvg, roomPublicUrl } = require('../../services/warehouse/qr');

const userAttrs = ['id', 'displayName', 'username', 'avatar'];

/**
 * Порядок кабинетов по номеру — человеческий, а не побайтовый.
 *
 * Номер кабинета в базе строка, и обязан ею быть: в сети есть «312а», «1/2» и
 * «Ординаторская». Но сортировка строк даёт 1, 10, 11, 2, 3 — список, в котором
 * невозможно найти кабинет глазами. Intl.Collator с numeric сравнивает числовые
 * куски как числа: 1, 2, 3, 10, 11, и при этом не ломается на «312а».
 */
const roomCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const byRoomNumber = (a, b) => roomCollator.compare(String(a.number ?? ''), String(b.number ?? ''));

/**
 * Проверка кода специальности до вставки. Поле ссылается на справочник, и без
 * этой проверки несуществующий код возвращался пользователю сырым текстом
 * нарушения внешнего ключа — сообщением, из которого не следует ни что не так,
 * ни какие коды бывают.
 */
async function badSpecialty(code) {
  if (!code) return null;
  const found = await WhSpecialty.findByPk(code);
  if (found) return null;
  const all = await WhSpecialty.findAll({ attributes: ['code'], order: [['sortOrder', 'ASC']] });
  return `Специальности с кодом «${code}» нет в справочнике. Допустимые: ${all.map(s => s.code).join(', ')}.`;
}

// ── Дерево локаций ───────────────────────────────────────────────────────────
// Медцентр → корпус → этаж → кабинет (+ места хранения). Отделения отдаются
// плоским списком: они разрез, а не уровень вложенности — одно отделение
// занимает кабинеты на разных этажах.
router.get('/tree', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const scopedRooms = await req.warehouse.scopedRoomIds();

    const [medCenters, buildings, floors, departments, rooms, storages, counts] = await Promise.all([
      MedCenter.findAll({
        where: { isActive: true, isVirtual: false },
        attributes: ['id', 'name', 'displayName', 'code', 'color', 'logoUrl', 'city', 'sortOrder'],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']],
      }),
      WhBuilding.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
      WhFloor.findAll({ order: [['number', 'ASC']] }),
      WhDepartment.findAll({
        where: { isActive: true },
        include: [{ model: User, as: 'head', attributes: userAttrs }],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']],
      }),
      WhRoom.findAll({
        where: { isActive: true },
        include: [{ model: User, as: 'responsible', attributes: userAttrs }],
        order: [['number', 'ASC']],
      }),
      WhStorage.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
      roomCounters(),
    ]);

    const visible = scopedRooms === null ? null : new Set(scopedRooms);
    const storagesByRoom = groupBy(storages, s => s.roomId);
    const countsByRoom = new Map(counts.map(c => [c.roomId, c]));

    const roomJson = r => ({
      id: r.id, medCenterId: r.medCenterId, floorId: r.floorId,
      number: r.number, name: r.name, kind: r.kind,
      departmentId: r.departmentId,
      responsible: r.responsible,
      misRoomAliases: r.misRoomAliases,
      capacityHours: Number(r.capacityHours),
      plan: r.plan,
      hasPlan: Array.isArray(r.plan?.points) && r.plan.points.length >= 3,
      publicToken: r.publicToken,
      storages: (storagesByRoom.get(r.id) || []).map(s => ({
        id: s.id, name: s.name, kind: s.kind, tempMinC: s.tempMinC, tempMaxC: s.tempMaxC,
      })),
      counters: countsByRoom.get(r.id) || { assets: 0, positions: 0, stockValue: 0 },
    });

    const floorsByBuilding = groupBy(
      floors.map(f => ({
        id: f.id, buildingId: f.buildingId, number: f.number, name: f.name,
        planWidthM: Number(f.planWidthM), planHeightM: Number(f.planHeightM),
        planBgUrl: f.planBgUrl, planBgOpacity: Number(f.planBgOpacity),
        outline: f.outline || {},
        rooms: rooms
          .filter(r => r.floorId === f.id)
          .filter(r => visible === null || visible.has(r.id))
          .sort(byRoomNumber)
          .map(roomJson),
      })),
      f => f.buildingId
    );

    const buildingsByMc = groupBy(
      buildings.map(b => ({
        id: b.id, medCenterId: b.medCenterId, name: b.name, code: b.code, address: b.address,
        floors: (floorsByBuilding.get(b.id) || []).sort((a, z) => a.number - z.number),
      })),
      b => b.medCenterId
    );

    const tree = medCenters
      .map(mc => ({
        id: mc.id,
        name: mc.displayName || mc.name,
        code: mc.code,
        color: mc.color,
        logoUrl: mc.logoUrl,
        city: mc.city,
        buildings: buildingsByMc.get(mc.id) || [],
        // Кабинеты без этажа показываются прямо под медцентром.
        rooms: rooms
          .filter(r => !r.floorId && r.medCenterId === mc.id)
          .filter(r => visible === null || visible.has(r.id))
          .sort(byRoomNumber)
          .map(roomJson),
      }))
      .filter(mc => mc.buildings.length > 0 || mc.rooms.length > 0
        || req.warehouse.capabilities.canEditLocations);

    res.json({
      medCenters: tree,
      departments: departments.map(d => ({
        id: d.id, medCenterId: d.medCenterId, name: d.name, kind: d.kind,
        specialtyCode: d.specialtyCode, color: d.color, head: d.head,
      })),
      scope: scopedRooms === null ? 'all' : 'limited',
    });
  } catch (err) {
    console.error('GET warehouse/locations/tree error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function roomCounters() {
  const [rows] = await sequelize.query(`
    SELECT r.id AS "roomId",
           (SELECT COUNT(*)::int FROM warehouse_assets a
             WHERE a."roomId" = r.id AND a."isArchived" = FALSE) AS assets,
           (SELECT COUNT(*)::int FROM warehouse_stock s
              JOIN warehouse_storages st ON st.id = s."storageId"
             WHERE st."roomId" = r.id AND s.quantity > 0) AS positions,
           (SELECT COALESCE(SUM(s.quantity * s."unitCost"), 0) FROM warehouse_stock s
              JOIN warehouse_storages st ON st.id = s."storageId"
             WHERE st."roomId" = r.id) AS "stockValue"
    FROM warehouse_rooms r WHERE r."isActive" = TRUE
  `);
  return rows;
}

// ── Справочник специальностей ────────────────────────────────────────────────
router.get('/specialties', authenticate, requireWarehouse(), async (req, res) => {
  const rows = await WhSpecialty.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] });
  res.json(rows);
});

// ── Корпуса ──────────────────────────────────────────────────────────────────
router.post('/buildings', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const { medCenterId, name, code, address, sortOrder } = req.body;
    if (!medCenterId || !name?.trim()) {
      return res.status(400).json({ error: 'Нужны медцентр и название корпуса' });
    }
    const row = await WhBuilding.create({
      medCenterId, name: name.trim(), code: code?.trim() || null,
      address: address?.trim() || null, sortOrder: sortOrder ?? 100,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST warehouse/buildings error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/buildings/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhBuilding.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Корпус не найден' });
  const { name, code, address, sortOrder, isActive } = req.body;
  await row.update({
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(code !== undefined ? { code: code?.trim() || null } : {}),
    ...(address !== undefined ? { address: address?.trim() || null } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  });
  res.json(row);
});

router.delete('/buildings/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhBuilding.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Корпус не найден' });
  // Гасим флагом, а не удаляем: на кабинеты внутри ссылаются активы и вся история
  // движений. Реальное удаление увело бы историю каскадом.
  await row.update({ isActive: false });
  res.json({ ok: true, softDeleted: true });
});

// ── Этажи ────────────────────────────────────────────────────────────────────
router.post('/floors', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const { buildingId, number, name, planWidthM, planHeightM } = req.body;
    if (!buildingId || number === undefined) {
      return res.status(400).json({ error: 'Нужны корпус и номер этажа' });
    }
    const row = await WhFloor.create({
      buildingId, number, name: name?.trim() || null,
      planWidthM: planWidthM ?? 40, planHeightM: planHeightM ?? 25,
      sortOrder: number,
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Такой этаж в этом корпусе уже есть' });
    }
    console.error('POST warehouse/floors error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/floors/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhFloor.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Этаж не найден' });
  const { number, name, planWidthM, planHeightM, planBgUrl, planBgOpacity } = req.body;
  await row.update({
    ...(number !== undefined ? { number, sortOrder: number } : {}),
    ...(name !== undefined ? { name: name?.trim() || null } : {}),
    ...(planWidthM !== undefined ? { planWidthM } : {}),
    ...(planHeightM !== undefined ? { planHeightM } : {}),
    ...(planBgUrl !== undefined ? { planBgUrl } : {}),
    ...(planBgOpacity !== undefined ? { planBgOpacity } : {}),
  });
  res.json(row);
});

router.delete('/floors/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhFloor.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Этаж не найден' });
  const rooms = await WhRoom.count({ where: { floorId: row.id, isActive: true } });
  if (rooms > 0) {
    return res.status(409).json({ error: `На этаже ${rooms} активных кабинетов — сначала перенесите или отключите их` });
  }
  await row.destroy();
  res.json({ ok: true });
});

// ── Общая схема медцентра ────────────────────────────────────────────────────
// Это базовый вариант для небольшого МЦ: помещения лежат прямо в медцентре и
// рисуются на одной схеме. Корпуса и этажи добавляются только когда одной схемы
// становится мало; отдельного вида «помещение без этажа» при этом не возникает.
router.get('/med-centers/:id/plan', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const medCenter = await MedCenter.findByPk(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const rooms = await WhRoom.findAll({
      where: { medCenterId: medCenter.id, floorId: null, isActive: true },
      include: [
        { model: WhDepartment, as: 'department', attributes: ['id', 'name', 'color', 'specialtyCode'] },
        { model: User, as: 'responsible', attributes: userAttrs },
      ],
      order: [['number', 'ASC']],
    });
    const saved = medCenter.warehousePlan || {};
    const shapes = Array.isArray(saved.shapes) ? saved.shapes : [];

    res.json({
      floor: {
        id: `med-center:${medCenter.id}`,
        scope: 'medCenter',
        medCenterId: medCenter.id,
        medCenterName: medCenter.displayName || medCenter.name,
        name: 'Общая схема',
        planWidthM: Number(saved.planWidthM) || 40,
        planHeightM: Number(saved.planHeightM) || 25,
        planBgUrl: saved.planBgUrl || null,
        planBgOpacity: Number(saved.planBgOpacity ?? 0.35),
        outline: saved.outline || {},
      },
      rooms: rooms.map(roomPlanJson),
      shapes: shapes.map((shape, index) => ({
        ...shape,
        id: shape.id || `med-center-shape:${index}`,
      })),
    });
  } catch (err) {
    console.error('GET warehouse/med-centers/:id/plan error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/med-centers/:id/plan', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const medCenter = await MedCenter.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!medCenter) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Медцентр не найден' });
    }

    const { planWidthM, planHeightM, planBgOpacity, outline, rooms = [], shapes = [] } = req.body;
    const normalizedOutline = normalizeOutline(outline);
    if (normalizedOutline.error) {
      await transaction.rollback();
      return res.status(400).json({ error: normalizedOutline.error });
    }

    await medCenter.update({
      warehousePlan: {
        ...(medCenter.warehousePlan || {}),
        planWidthM: planWidthM ?? 40,
        planHeightM: planHeightM ?? 25,
        planBgOpacity: planBgOpacity ?? 0.35,
        outline: normalizedOutline.value,
        shapes: Array.isArray(shapes) ? shapes.map((shape, index) => ({
          kind: shape.kind || 'wall',
          geometry: shape.geometry || {},
          label: shape.label || null,
          style: shape.style || {},
          z: shape.z ?? index,
          sortOrder: shape.sortOrder ?? (index + 1) * 10,
          isTechnical: shape.isTechnical !== false,
        })) : [],
      },
    }, { transaction });

    for (const room of rooms) {
      if (!room.id || room.plan === undefined || room.plan === null) continue;
      await WhRoom.update(
        { plan: room.plan },
        { where: { id: room.id, medCenterId: medCenter.id, floorId: null }, transaction }
      );
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (err) {
    await transaction.rollback();
    console.error('PUT warehouse/med-centers/:id/plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── План этажа: геометрия кабинетов и оформление ─────────────────────────────
// Клиент присылает весь план целиком, а не отдельные фигуры: редактор работает с
// планом как с единым документом, и частичные сохранения давали бы битые состояния
// (стена сохранилась, кабинет — нет).
router.get('/floors/:id/plan', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const floor = await WhFloor.findByPk(req.params.id, {
      include: [{ model: WhBuilding, as: 'building', include: [{ model: MedCenter, as: 'medCenter' }] }],
    });
    if (!floor) return res.status(404).json({ error: 'Этаж не найден' });

    const [rooms, shapes] = await Promise.all([
      WhRoom.findAll({
        where: { floorId: floor.id, isActive: true },
        include: [
          { model: WhDepartment, as: 'department', attributes: ['id', 'name', 'color', 'specialtyCode'] },
          { model: User, as: 'responsible', attributes: userAttrs },
        ],
        order: [['number', 'ASC']],
      }),
      WhFloorShape.findAll({ where: { floorId: floor.id }, order: [['z', 'ASC']] }),
    ]);

    res.json({
      floor: {
        id: floor.id, scope: 'floor', number: floor.number, name: floor.name,
        buildingId: floor.buildingId,
        buildingName: floor.building?.name,
        medCenterName: floor.building?.medCenter?.displayName || floor.building?.medCenter?.name,
        planWidthM: Number(floor.planWidthM), planHeightM: Number(floor.planHeightM),
        planBgUrl: floor.planBgUrl, planBgOpacity: Number(floor.planBgOpacity),
        // Контур произвольной формы (ver. 6.69). Пустой — этаж прямоугольный.
        outline: floor.outline || {},
      },
      rooms: rooms.map(roomPlanJson),
      shapes,
    });
  } catch (err) {
    console.error('GET warehouse/floors/:id/plan error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function roomPlanJson(room) {
  return {
    id: room.id, number: room.number, name: room.name, kind: room.kind,
    departmentId: room.departmentId, department: room.department,
    responsible: room.responsible,
    capacityHours: Number(room.capacityHours),
    misRoomAliases: room.misRoomAliases,
    plan: room.plan || {},
  };
}

const isRing = ring => Array.isArray(ring) && ring.length >= 3
  && ring.every(point => Array.isArray(point) && point.length === 2
    && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));

const toRing = ring => ring.map(point => [Number(point[0]), Number(point[1])]);

/**
 * Контур схемы: внешнее кольцо плюс вырезы.
 *
 * Вырезы (ver. 6.85) — это внутренние дворы: они внутри здания, но это улица, и в
 * площадь этажа их считать нельзя. Битые кольца молча отбрасываются, а не роняют
 * запрос: контур с двором сохраняется хотя бы как контур, а не теряется целиком
 * из-за одного кривого выреза.
 */
function normalizeOutline(outline) {
  const points = Array.isArray(outline?.points) ? outline.points : [];
  const valid = isRing(points);
  if (points.length && !valid) {
    return { error: 'Контур схемы должен состоять минимум из трёх точек [x, y]' };
  }
  if (!valid) return { value: {} };

  const holes = (Array.isArray(outline?.holes) ? outline.holes : []).filter(isRing).map(toRing);
  return { value: holes.length ? { points: toRing(points), holes } : { points: toRing(points) } };
}

router.put('/floors/:id/plan', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const floor = await WhFloor.findByPk(req.params.id, { transaction: t });
    if (!floor) {
      await t.rollback();
      return res.status(404).json({ error: 'Этаж не найден' });
    }

    const { planWidthM, planHeightM, planBgOpacity, outline, rooms = [], shapes = null } = req.body;

    // Контур проверяем на вменяемость: меньше трёх точек — это не многоугольник, и
    // сохранять такое значит получить этаж, который клиент не сможет нарисовать.
    // Проверка общая с общей схемой медцентра — раньше здесь лежала её копия, и
    // вырезы пришлось бы добавлять в оба места.
    let outlinePatch = {};
    if (outline !== undefined) {
      const normalized = normalizeOutline(outline);
      if (normalized.error) {
        await t.rollback();
        return res.status(400).json({ error: normalized.error });
      }
      outlinePatch = { outline: normalized.value };
    }

    await floor.update({
      ...(planWidthM !== undefined ? { planWidthM } : {}),
      ...(planHeightM !== undefined ? { planHeightM } : {}),
      ...(planBgOpacity !== undefined ? { planBgOpacity } : {}),
      ...outlinePatch,
    }, { transaction: t });

    // Геометрия кабинетов: только поле plan. Номер, отделение и МОЛ правятся
    // отдельной формой — иначе редактор плана мог бы затереть их пустыми значениями.
    // Пустой plan — это не «нет данных», а «убрать с плана»: кабинет остаётся в
    // базе со всем имуществом, но с этажа исчезает. Различать их обязательно,
    // иначе убранный кабинет вернулся бы при следующей загрузке.
    for (const r of rooms) {
      if (!r.id || r.plan === undefined || r.plan === null) continue;
      await WhRoom.update({ plan: r.plan }, { where: { id: r.id, floorId: floor.id }, transaction: t });
    }

    // Оформление плана заменяется целиком: фигур немного, а diff по ним на клиенте
    // потребовал бы отслеживать удаления — лишняя сложность на ровном месте.
    if (Array.isArray(shapes)) {
      await WhFloorShape.destroy({ where: { floorId: floor.id }, transaction: t });
      if (shapes.length) {
        await WhFloorShape.bulkCreate(shapes.map((s, i) => ({
          floorId: floor.id,
          kind: s.kind || 'wall',
          geometry: s.geometry || {},
          label: s.label || null,
          style: s.style || {},
          z: s.z ?? i,
          sortOrder: s.sortOrder ?? (i + 1) * 10,
          // Техническое помещение против оформления: первое входит в площадь этажа.
          isTechnical: s.isTechnical !== false,
        })), { transaction: t });
      }
    }

    await t.commit();
    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error('PUT warehouse/floors/:id/plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Отделения ────────────────────────────────────────────────────────────────
router.post('/departments', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const { medCenterId, name, specialtyCode, kind, headUserId, color, divisionId } = req.body;
    if (!medCenterId || !name?.trim()) return res.status(400).json({ error: 'Нужны медцентр и название' });
    const wrong = await badSpecialty(specialtyCode);
    if (wrong) return res.status(400).json({ error: wrong });
    const row = await WhDepartment.create({
      medCenterId, name: name.trim(),
      specialtyCode: specialtyCode || null,
      kind: kind || 'specialty',
      headUserId: headUserId || null,
      divisionId: divisionId || null,
      color: color || null,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST warehouse/departments error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/departments/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhDepartment.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Отделение не найдено' });
  const { name, specialtyCode, kind, headUserId, color, divisionId, isActive } = req.body;
  const wrong = await badSpecialty(specialtyCode);
  if (wrong) return res.status(400).json({ error: wrong });
  await row.update({
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(specialtyCode !== undefined ? { specialtyCode: specialtyCode || null } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(headUserId !== undefined ? { headUserId: headUserId || null } : {}),
    ...(divisionId !== undefined ? { divisionId: divisionId || null } : {}),
    ...(color !== undefined ? { color: color || null } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  });
  res.json(row);
});

// ── Кабинеты ─────────────────────────────────────────────────────────────────
router.post('/rooms', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const {
      medCenterId, floorId, departmentId, number, name, kind, responsibleUserId,
      misRoomAliases, capacityHours, plan,
    } = req.body;
    if (!number?.trim()) return res.status(400).json({ error: 'Нужен номер или название кабинета' });

    const location = await resolveRoomLocation({ medCenterId, floorId });
    if (location.error) return res.status(location.status).json({ error: location.error });

    const row = await WhRoom.create({
      medCenterId: location.medCenterId, floorId: location.floorId,
      departmentId: departmentId || null,
      number: number.trim(), name: name?.trim() || null,
      kind: kind || 'office',
      responsibleUserId: responsibleUserId || null,
      misRoomAliases: Array.isArray(misRoomAliases) ? misRoomAliases : [],
      capacityHours: capacityHours ?? 8,
      plan: plan || {},
      publicToken: generateToken(),
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST warehouse/rooms error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Завести кабинеты по списку из МИС.
 *
 * ── Что это и чем не является ────────────────────────────────────────────────
 *
 * Это НЕ угадывание привязки: портал не решает, какой строке 1С соответствует
 * какой кабинет, — эту привязку человек делает сам на экране размещения. Здесь
 * из МИС берётся ровно одно: готовый перечень названий кабинетов, чтобы не
 * набирать сотню строк с клавиатуры.
 *
 * Названия попадают и в номер кабинета, и в misRoomAliases сразу: алиас нужен,
 * чтобы тепловая карта и расход на посещение сошлись с расписанием, а
 * заполнять его вторым заходом по каждому кабинету — та же ручная работа,
 * которую этот маршрут и убирает.
 *
 * ── Почему место хранения создаётся сразу ────────────────────────────────────
 *
 * Кабинет без места хранения бесполезен: в него нельзя ни разместить имущество
 * из ведомости, ни выдать материалы, а разбор молча пропускает такие строки с
 * «нет мест хранения». Пустой кабинет выглядит заведённым, но не работает —
 * поэтому вместе с ним появляется место хранения по умолчанию.
 */
router.post('/rooms/from-mis', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const { medCenterId, floorId, departmentId = null, rooms = [], storageName = 'Кабинет' } = req.body || {};
    if (!Array.isArray(rooms) || !rooms.length) {
      return res.status(400).json({ error: 'Не выбрано ни одного кабинета' });
    }

    const location = await resolveRoomLocation({ medCenterId, floorId });
    if (location.error) return res.status(location.status).json({ error: location.error });

    // Уже заведённые пропускаем: повторный запуск после того, как список из МИС
    // пополнился, не должен плодить дубли кабинетов.
    const existing = await WhRoom.findAll({ attributes: ['id', 'number', 'misRoomAliases'] });
    const taken = new Set();
    for (const room of existing) {
      taken.add(normalize(room.number));
      for (const alias of room.misRoomAliases || []) taken.add(normalize(alias));
    }

    const created = [];
    const skipped = [];

    await sequelize.transaction(async (t) => {
      for (const raw of rooms) {
        const title = String(raw?.room ?? raw ?? '').trim();
        if (!title) continue;
        if (taken.has(normalize(title))) { skipped.push(title); continue; }
        taken.add(normalize(title));

        const room = await WhRoom.create({
          medCenterId: location.medCenterId,
          floorId: location.floorId,
          departmentId: departmentId || null,
          number: title.slice(0, 30),
          name: title.length > 30 ? title : null,
          kind: 'office',
          // Название из МИС кладём алиасом даже когда оно же стало номером:
          // сопоставление ищется именно по алиасам, и пустой список означал бы,
          // что кабинет из расписания не находится.
          misRoomAliases: [title],
          publicToken: generateToken(),
        }, { transaction: t });

        await WhStorage.create({
          roomId: room.id,
          name: storageName || 'Кабинет',
          kind: 'cabinet',
        }, { transaction: t });

        created.push({ id: room.id, number: room.number });
      }
    });

    res.status(201).json({ created: created.length, skipped: skipped.length, rooms: created, skippedNames: skipped });
  } catch (err) {
    console.error('POST warehouse/rooms/from-mis error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/rooms/:id', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  try {
    const row = await WhRoom.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Кабинет не найден' });

    const scoped = await req.warehouse.scopedRoomIds();
    if (scoped !== null && !scoped.includes(row.id)) {
      return res.status(403).json({ error: 'Кабинет не в вашей зоне ответственности' });
    }

    const {
      departmentId, number, name, kind, responsibleUserId,
      misRoomAliases, capacityHours, workingDays, plan, isActive,
    } = req.body;

    await row.update({
      ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
      ...(number !== undefined ? { number: number.trim() } : {}),
      ...(name !== undefined ? { name: name?.trim() || null } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(responsibleUserId !== undefined ? { responsibleUserId: responsibleUserId || null } : {}),
      ...(misRoomAliases !== undefined ? { misRoomAliases: Array.isArray(misRoomAliases) ? misRoomAliases : [] } : {}),
      ...(capacityHours !== undefined ? { capacityHours } : {}),
      ...(workingDays !== undefined ? { workingDays } : {}),
      ...(plan !== undefined ? { plan } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    });
    res.json(row);
  } catch (err) {
    console.error('PUT warehouse/rooms error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rooms/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhRoom.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Кабинет не найден' });
  const assets = await WhAsset.count({ where: { roomId: row.id, isArchived: false } });
  if (assets > 0) {
    return res.status(409).json({ error: `В кабинете ${assets} активов — сначала переместите их` });
  }
  await row.update({ isActive: false });
  res.json({ ok: true, softDeleted: true });
});

/**
 * Подсказка по сопоставлению с МИС: какие названия кабинетов встречаются в
 * mis_appointments у этой клиники и какие из них ещё никуда не привязаны.
 * Без этого экрана заполнение misRoomAliases превращается в угадывание.
 */
router.get('/rooms/mis-suggestions', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const { medCenterId } = req.query;
    if (!medCenterId) return res.status(400).json({ error: 'Нужен medCenterId' });

    const mc = await MedCenter.findByPk(medCenterId);
    if (!mc) return res.status(404).json({ error: 'Медцентр не найден' });
    const clinicIds = (mc.misClinicIds || []).map(Number).filter(n => !Number.isNaN(n));
    if (!clinicIds.length) return res.json({ rooms: [], note: 'У медцентра не заданы misClinicIds' });

    const [rows] = await sequelize.query(`
      SELECT room, COUNT(*)::int AS appointments,
             MIN(time_start) AS "firstSeen", MAX(time_start) AS "lastSeen"
      FROM mis_appointments
      WHERE clinic_id IN (:ids) AND room IS NOT NULL AND room <> ''
        AND time_start > now() - interval '180 days'
      GROUP BY room ORDER BY appointments DESC LIMIT 200
    `, { replacements: { ids: clinicIds } });

    const existing = await WhRoom.findAll({ attributes: ['id', 'number', 'misRoomAliases'] });
    const claimed = new Set();
    for (const r of existing) {
      for (const a of r.misRoomAliases || []) claimed.add(normalize(a));
      claimed.add(normalize(r.number));
    }

    res.json({
      rooms: rows.map(r => ({ ...r, matched: claimed.has(normalize(r.room)) })),
    });
  } catch (err) {
    console.error('GET warehouse/rooms/mis-suggestions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function normalize(s) {
  return String(s || '').toLowerCase().replace(/каб(инет)?\.?\s*/g, '').replace(/[№\s]+/g, '').trim();
}

async function resolveRoomLocation({ medCenterId, floorId }) {
  if (floorId) {
    const floor = await WhFloor.findByPk(floorId, {
      include: [{ model: WhBuilding, as: 'building', attributes: ['medCenterId'] }],
    });
    if (!floor) return { status: 404, error: 'Этаж не найден' };
    if (medCenterId && floor.building.medCenterId !== medCenterId) {
      return { status: 400, error: 'Этаж относится к другому медцентру' };
    }
    return { medCenterId: floor.building.medCenterId, floorId: floor.id };
  }
  if (!medCenterId) return { status: 400, error: 'Нужен медцентр' };
  const medCenter = await MedCenter.findByPk(medCenterId);
  if (!medCenter) return { status: 404, error: 'Медцентр не найден' };
  return { medCenterId: medCenter.id, floorId: null };
}

/**
 * QR-код на дверь кабинета. Ведёт на публичную страницу /p/r/<token> с перечнем
 * оборудования и его статусами — без остатков, сумм и ФИО.
 *
 * Токен создаётся вместе с кабинетом, но у кабинетов, заведённых до появления
 * публичных карточек, его может не быть — тогда выдаём его здесь, а не отвечаем
 * ошибкой: человек нажал «QR на дверь», и это единственное, чего он хочет.
 */
router.get('/rooms/:id/qr.svg', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const room = await WhRoom.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    if (!room.publicToken) {
      await room.update({ publicToken: generateToken() });
    }
    const svg = await qrSvg(roomPublicUrl(room.publicToken), { width: Number(req.query.size) || 300 });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('GET warehouse/locations/rooms/:id/qr.svg error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Места хранения ───────────────────────────────────────────────────────────
router.post('/storages', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  try {
    const { roomId, name, kind, tempMinC, tempMaxC, sortOrder } = req.body;
    if (!roomId || !name?.trim()) return res.status(400).json({ error: 'Нужны кабинет и название' });
    const row = await WhStorage.create({
      roomId, name: name.trim(), kind: kind || 'cabinet',
      tempMinC: tempMinC ?? null, tempMaxC: tempMaxC ?? null,
      sortOrder: sortOrder ?? 100,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST warehouse/storages error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/storages/:id', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  const row = await WhStorage.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Место хранения не найдено' });
  const { name, kind, tempMinC, tempMaxC, sortOrder, isActive } = req.body;
  await row.update({
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(tempMinC !== undefined ? { tempMinC } : {}),
    ...(tempMaxC !== undefined ? { tempMaxC } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  });
  res.json(row);
});

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

module.exports = router;
