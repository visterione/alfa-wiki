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
  WhSpecialty, WhAsset, WhStock, MedCenter, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse } = require('../../services/warehouse/access');
const {
  generateToken, qrSvg, roomAppUrl, roomDoorCardSvg, roomDoorCardZpl,
  LABEL_SIZES, labelPng,
} = require('../../services/warehouse/qr');
const ptouch = require('../../services/warehouse/ptouchRaster');

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
        // warehousePlan нужен карте: у медцентра без корпусов схема лежит здесь,
        // и без неё миниатюра общей схемы рисовалась бы по одним кабинетам, без стен.
        // Логотип и адрес нужны списку кабинетов в мобилке: медцентры там
        // выбирают первым шагом, и узнают их по знаку и улице, а не по строке
        // «Альфа на Владимирской» среди пяти похожих.
        attributes: ['id', 'name', 'displayName', 'code', 'color', 'logoUrl',
          'logoSquareUrl', 'address', 'city', 'sortOrder', 'warehousePlan'],
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
      isService: r.isService, serviceKind: r.serviceKind,
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

    const floorJson = f => ({
      id: f.id, medCenterId: f.medCenterId, buildingId: f.buildingId,
      number: f.number, name: f.name,
      planWidthM: Number(f.planWidthM), planHeightM: Number(f.planHeightM),
      planBgUrl: f.planBgUrl, planBgOpacity: Number(f.planBgOpacity),
      outline: f.outline || {},
      rooms: rooms
        .filter(r => r.floorId === f.id)
        .filter(r => visible === null || visible.has(r.id))
        .sort(byRoomNumber)
        .map(roomJson),
    });

    const floorsByBuilding = groupBy(floors.map(floorJson), f => f.buildingId);

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
        logoUrl: mc.logoSquareUrl || mc.logoUrl,
        address: mc.address,
        city: mc.city,
        // Этажи медцентра — плоским списком (ver. 7.48). Это основной путь:
        // уровня корпуса в интерфейсе больше нет.
        floors: floors
          .filter(f => f.medCenterId === mc.id)
          .map(floorJson)
          .sort((a, z) => a.number - z.number || String(a.name || '').localeCompare(String(z.name || ''), 'ru')),
        /**
         * Корпуса остаются в ответе ради уже установленных сборок мобильного
         * приложения: они читают дерево как mc.buildings[].floors[].rooms, а
         * обновляются вручную — выкинуть корпуса из ответа значило бы оставить
         * часть телефонов с пустым списком кабинетов. Веб и новые сборки берут
         * mc.floors. Убрать, когда на телефонах не останется сборок до 7.48.
         */
        buildings: buildingsByMc.get(mc.id) || [],
        // Только геометрия схемы: фигуры бывают тяжёлыми, а дерево грузится на
        // каждом экране модуля. Полная схема приходит отдельным запросом плана.
        warehousePlan: {
          outline: mc.warehousePlan?.outline || {},
          planWidthM: Number(mc.warehousePlan?.planWidthM) || null,
          planHeightM: Number(mc.warehousePlan?.planHeightM) || null,
        },
        // Кабинеты без этажа показываются прямо под медцентром.
        rooms: rooms
          .filter(r => !r.floorId && !r.isService && r.medCenterId === mc.id)
          .filter(r => visible === null || visible.has(r.id))
          .sort(byRoomNumber)
          .map(roomJson),
        // Склады — отдельной веткой, а не среди кабинетов без этажа (ver. 7.47).
        // Это разные вещи: кабинет без этажа — обычное помещение, которому не
        // нарисовали план, а склад помещением не является вовсе. В списках они
        // и должны стоять порознь, иначе «Склад» ищут среди номеров кабинетов.
        services: rooms
          .filter(r => r.isService && r.medCenterId === mc.id)
          .filter(r => visible === null || visible.has(r.id))
          .sort((a, z) => String(a.name || a.number).localeCompare(String(z.name || z.number), 'ru'))
          .map(roomJson),
      }))
      .filter(mc => mc.floors.length > 0 || mc.rooms.length > 0 || mc.services.length > 0
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

/**
 * Свой код специальности. Пятнадцати кодов из Приложения А ТЗ хватает не всякой
 * сети: у неё бывает косметология, УЗИ, массаж — направления, которых в перечне
 * нет, а заводить их отделением с кодом «АХО» значит потерять специальность в
 * инвентарном номере навсегда.
 *
 * ── Почему код проверяется так строго ────────────────────────────────────────
 *
 * Код становится частью маски МЦ-2026-КОД-00001, где дефис — разделитель полей.
 * Код с дефисом или пробелом сделал бы номер неразбираемым: «МЦ-2026-УЗИ-2-00001»
 * невозможно прочитать ни человеку, ни разбору строки. Регистр приводим сами —
 * генератор номера всё равно поднимает код в верхний, и код «узи» в справочнике
 * означал бы, что в списке он выглядит иначе, чем на этикетке.
 */
router.post('/specialties', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const name = String(req.body?.name || '').trim();

    if (!code || !name) return res.status(400).json({ error: 'Нужны код и название' });
    if (code.length > 20) return res.status(400).json({ error: 'Код длиннее 20 символов' });
    if (!/^[A-ZА-ЯЁ0-9]+$/.test(code)) {
      return res.status(400).json({
        error: 'В коде допустимы только буквы и цифры без пробелов и дефисов: '
          + 'дефис разделяет части инвентарного номера',
      });
    }

    const exists = await WhSpecialty.findByPk(code);
    if (exists) {
      return res.status(409).json({ error: `Код «${code}» уже есть: ${exists.name}` });
    }

    // Свои коды становятся в конец списка: перечень из ТЗ занимает первые сотни
    // sortOrder, и вклиниваться в него незачем.
    const last = await WhSpecialty.max('sortOrder');
    const row = await WhSpecialty.create({
      code, name: name.slice(0, 120), sortOrder: (Number(last) || 0) + 10,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST warehouse/specialties error:', err);
    res.status(500).json({ error: err.message });
  }
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
/**
 * Новый этаж — у медцентра, а не у корпуса (ver. 7.48).
 *
 * buildingId принимается, но только от старых клиентов: медцентр из него
 * выводится, и в новых этажах он остаётся пустым. Одинаковый номер этажа в
 * одном медцентре не запрещён — после отказа от корпусов у медцентра временно
 * бывает два четвёртых этажа, и запрет помешал бы как раз тому, ради чего
 * миграция и делалась: перенести кабинеты и удалить лишний этаж руками.
 */
router.post('/floors', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const { buildingId, number, name, planWidthM, planHeightM } = req.body;
    if (number === undefined) return res.status(400).json({ error: 'Нужен номер этажа' });

    let medCenterId = req.body.medCenterId || null;
    if (!medCenterId && buildingId) {
      const building = await WhBuilding.findByPk(buildingId, { attributes: ['medCenterId'] });
      medCenterId = building?.medCenterId || null;
    }
    if (!medCenterId) return res.status(400).json({ error: 'Нужен медцентр' });

    const medCenter = await MedCenter.findByPk(medCenterId, { attributes: ['id'] });
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const row = await WhFloor.create({
      medCenterId, buildingId: buildingId || null,
      number, name: name?.trim() || null,
      planWidthM: planWidthM ?? 40, planHeightM: planHeightM ?? 25,
      sortOrder: number,
    });
    res.status(201).json(row);
  } catch (err) {
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
      include: [
        { model: MedCenter, as: 'medCenter' },
        // Корпус — только чтобы показать медцентр у этажей, заведённых до
        // ver. 7.48 и ещё не заполненных миграцией.
        { model: WhBuilding, as: 'building', include: [{ model: MedCenter, as: 'medCenter' }] },
      ],
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
        medCenterId: floor.medCenterId || floor.building?.medCenterId || null,
        medCenterName: floor.medCenter?.displayName || floor.medCenter?.name
          || floor.building?.medCenter?.displayName || floor.building?.medCenter?.name,
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
//
// Отделение — разрез, а не уровень дерева: оно принадлежит медцентру и собирает
// кабинеты, которые могут стоять на разных этажах. Поэтому справочник живёт
// отдельным списком, а не веткой /tree.
//
// Завести отделение важно до постановки оборудования на учёт: код специальности
// для маски инвентарного номера берётся из отделения того кабинета, куда встаёт
// актив, и после присвоения номер не меняется никогда. Кабинет без отделения даёт
// «АХО» — и переезд актива в правильное отделение это уже не исправит.

/**
 * Справочник отделений. Отдаётся отдельно от дерева, потому что дерево показывает
 * только действующие отделения и ничего не знает о том, сколько кабинетов на
 * каждом висит, — а без этого числа нельзя ни решить, что отделение пора гасить,
 * ни объяснить, почему погасить его нельзя.
 */
router.get('/departments', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { medCenterId } = req.query;
    // Погашенные отделения видит только тот, кто правит структуру: остальным они
    // не нужны, а в списке выглядели бы действующими.
    const withInactive = req.warehouse.capabilities.canEditLocations
      && ['1', 'true'].includes(String(req.query.includeInactive));

    const rows = await WhDepartment.findAll({
      where: {
        ...(medCenterId ? { medCenterId } : {}),
        ...(withInactive ? {} : { isActive: true }),
      },
      include: [{ model: User, as: 'head', attributes: userAttrs }],
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    });

    // Кабинеты считаем одним запросом на весь список: по запросу на отделение
    // это полсотни round-trip на открытие справочника.
    const counts = await WhRoom.findAll({
      attributes: ['departmentId', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
      where: { isActive: true, departmentId: { [Op.ne]: null } },
      group: ['departmentId'],
      raw: true,
    });
    const roomsByDept = new Map(counts.map(c => [c.departmentId, Number(c.cnt)]));

    res.json(rows.map(d => ({
      id: d.id, medCenterId: d.medCenterId, name: d.name, kind: d.kind,
      specialtyCode: d.specialtyCode, color: d.color, head: d.head,
      headUserId: d.headUserId, divisionId: d.divisionId,
      sortOrder: d.sortOrder, isActive: d.isActive,
      roomsCount: roomsByDept.get(d.id) || 0,
    })));
  } catch (err) {
    console.error('GET warehouse/departments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

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
  try {
    const row = await WhDepartment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Отделение не найдено' });
    const { name, specialtyCode, kind, headUserId, color, divisionId, isActive } = req.body;
    const wrong = await badSpecialty(specialtyCode);
    if (wrong) return res.status(400).json({ error: wrong });

    // Смена кода специальности касается только будущих номеров: у выданных
    // инвентарный номер остаётся прежним, потому что отражает специальность на
    // момент постановки на учёт. Здесь это не запрет, а предупреждение клиенту —
    // иначе правка выглядит как перенумерация всего парка.
    const renumbering = specialtyCode !== undefined
      && (specialtyCode || null) !== (row.specialtyCode || null);

    await row.update({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(specialtyCode !== undefined ? { specialtyCode: specialtyCode || null } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(headUserId !== undefined ? { headUserId: headUserId || null } : {}),
      ...(divisionId !== undefined ? { divisionId: divisionId || null } : {}),
      ...(color !== undefined ? { color: color || null } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    });
    res.json({ ...row.toJSON(), specialtyChanged: renumbering });
  } catch (err) {
    console.error('PUT warehouse/departments error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Закрытие отделения. Мягкое, как и у кабинета: на отделение ссылаются описи
 * инвентаризации, нормы расхода и группировки отчётов за прошлые периоды —
 * удалить строку значит оставить их без названия.
 *
 * С кабинетами внутри отделение не гасится. Погашенное отделение исчезает из
 * дерева, и кабинет остался бы с departmentId на невидимую строку: в списке
 * кабинетов колонка «Отделение» пустеет, актив продолжает числиться неизвестно
 * где, а вернуть всё обратно можно только через базу.
 */
router.delete('/departments/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const row = await WhDepartment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Отделение не найдено' });

    const rooms = await WhRoom.count({ where: { departmentId: row.id, isActive: true } });
    if (rooms > 0) {
      return res.status(409).json({
        error: `В отделении ${rooms} кабинет(ов) — сначала переведите их в другое отделение`,
      });
    }

    await row.update({ isActive: false });
    res.json({ ok: true, softDeleted: true });
  } catch (err) {
    console.error('DELETE warehouse/departments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Кабинеты ─────────────────────────────────────────────────────────────────
router.post('/rooms', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  try {
    const {
      medCenterId, floorId, departmentId, number, name, kind, responsibleUserId,
      misRoomAliases, capacityHours, plan, isService,
    } = req.body;
    if (!number?.trim()) return res.status(400).json({ error: 'Нужен номер или название кабинета' });

    // Склад заводится тем же маршрутом, но этажа у него нет по определению:
    // за ним не стоит помещения, которое можно нарисовать на плане. Принять
    // floorId и промолчать значило бы завести склад, который ищут на схеме.
    const service = Boolean(isService);
    if (service && floorId) {
      return res.status(400).json({ error: 'У склада не бывает этажа — он общий на медцентр' });
    }

    const location = await resolveRoomLocation({ medCenterId, floorId });
    if (location.error) return res.status(location.status).json({ error: location.error });

    const row = await WhRoom.create({
      medCenterId: location.medCenterId, floorId: location.floorId,
      departmentId: departmentId || null,
      number: number.trim(), name: name?.trim() || null,
      kind: kind || (service ? 'storage' : 'office'),
      isService: service,
      // serviceKind не принимается снаружи: он означает «к этому месту ведёт
      // быстрое действие», и таких мест ровно два на медцентр — их заводит
      // миграция. Всё, что человек создаёт руками, — склад без своей кнопки.
      serviceKind: null,
      responsibleUserId: responsibleUserId || null,
      misRoomAliases: Array.isArray(misRoomAliases) ? misRoomAliases : [],
      // У склада нет приёмов, и час приёма ему не с чем сравнивать: восемь
      // часов по умолчанию сделали бы из него кабинет с нулевой загрузкой.
      capacityHours: service ? 0 : (capacityHours ?? 8),
      plan: service ? {} : (plan || {}),
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
      misRoomAliases, capacityHours, workingDays, plan, isActive, floorId,
    } = req.body;

    /**
     * Перенос кабинета на другой этаж (ver. 7.48).
     *
     * Появился вместе с отказом от корпусов: у медцентра временно оказывается
     * два четвёртых этажа — из административного корпуса и из главного, — и
     * объединяет их владелец данных руками. Автоматически слить их нельзя, у
     * каждого свой план и свои полигоны кабинетов в одних координатах.
     *
     * Полигон при переносе сбрасывается: на плане другого этажа те же
     * координаты означают другое место, и кабинет оказался бы нарисован поверх
     * чужого. Пусть лучше он не нарисован вовсе — это видно и исправляется, а
     * тихо съехавший контур не видит никто.
     *
     * Право строже, чем у остальной правки: переезд между этажами меняет
     * структуру, а не свойства кабинета.
     */
    let move = {};
    if (floorId !== undefined && (floorId || null) !== row.floorId) {
      if (!req.warehouse.capabilities.canEditLocations) {
        return res.status(403).json({ error: 'Переносить кабинеты между этажами может только тот, кто правит локации' });
      }
      if (floorId) {
        const floor = await WhFloor.findByPk(floorId, {
          include: [{ model: WhBuilding, as: 'building', attributes: ['medCenterId'] }],
        });
        if (!floor) return res.status(404).json({ error: 'Этаж не найден' });
        const floorMc = floor.medCenterId || floor.building?.medCenterId || null;
        if (floorMc && floorMc !== row.medCenterId) {
          return res.status(400).json({ error: 'Этаж относится к другому медцентру' });
        }
        move = { floorId: floor.id, plan: {} };
      } else {
        move = { floorId: null, plan: {} };
      }
      if (row.isService) {
        return res.status(400).json({ error: 'У склада не бывает этажа — он общий на медцентр' });
      }
    }

    await row.update({
      ...move,
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

/**
 * Закрытие кабинета. Мягкое: он гасится, а не удаляется, потому что на него
 * ссылаются движения за все прошлые периоды.
 *
 * Пустым он должен быть по обеим статьям сразу. Раньше считалось только
 * оборудование, и кабинет с полками материалов гасился беспрепятственно: остаток
 * продолжал числиться в warehouse_stock и попадать в суммы по сети, а с экранов
 * пропадал вместе с кабинетом — найти его было негде.
 */
router.delete('/rooms/:id', authenticate, requireWarehouse('canEditLocations'), async (req, res) => {
  const row = await WhRoom.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Кабинет не найден' });

  const [assets, stock] = await Promise.all([
    WhAsset.count({ where: { roomId: row.id, isArchived: false } }),
    WhStock.count({
      where: { quantity: { [Op.gt]: 0 } },
      include: [{ model: WhStorage, as: 'storage', required: true, where: { roomId: row.id }, attributes: [] }],
    }),
  ]);
  if (assets > 0) {
    return res.status(409).json({ error: `В кабинете ${assets} активов — сначала переместите их` });
  }
  if (stock > 0) {
    return res.status(409).json({
      error: `В кабинете ${stock} позиций на остатке — сначала переместите или спишите их`,
    });
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
    // Медцентр берётся с самого этажа (ver. 7.48); корпус — запасной путь для
    // этажей, заведённых до миграции и ещё не заполненных.
    const floorMc = floor.medCenterId || floor.building?.medCenterId || null;
    if (!floorMc) return { status: 400, error: 'У этажа не указан медцентр' };
    if (medCenterId && floorMc !== medCenterId) {
      return { status: 400, error: 'Этаж относится к другому медцентру' };
    }
    return { medCenterId: floorMc, floorId: floor.id };
  }
  if (!medCenterId) return { status: 400, error: 'Нужен медцентр' };
  const medCenter = await MedCenter.findByPk(medCenterId);
  if (!medCenter) return { status: 404, error: 'Медцентр не найден' };
  return { medCenterId: medCenter.id, floorId: null };
}

/**
 * Что нужно генератору дверной этикетки: отделение, медцентр и путь через
 * корпус с этажом. Набор один и тот же у одиночной карточки, у ZPL и у пачки —
 * держим его одним объявлением, иначе третья копия неизбежно разойдётся с
 * первыми двумя.
 */
const doorCardInclude = [
  { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
  { model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName', 'address', 'city'] },
  {
    model: WhFloor, as: 'floor',
    include: [{
      model: WhBuilding, as: 'building',
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName', 'address', 'city'] }],
    }],
  },
];

/**
 * QR-код кабинета. Ведёт внутрь портала, на дашборд этого кабинета, и потому
 * требует входа — почему именно так, см. roomAppUrl в services/warehouse/qr.js.
 */
router.get('/rooms/:id/qr.svg', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const room = await WhRoom.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const svg = await qrSvg(roomAppUrl(room.id), { width: Number(req.query.size) || 300 });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('GET warehouse/locations/rooms/:id/qr.svg error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Этикетка кабинета на дверь. Использует те же размеры, что этикетки оборудования,
 * и отдаётся в SVG для превью или PNG точного физического размера для печати.
 */
router.get('/rooms/:id/door-card.svg', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const room = await WhRoom.findByPk(req.params.id, { include: doorCardInclude });
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const svg = await roomDoorCardSvg(room, { size: req.query.size });
    if (req.query.format === 'png') {
      const size = LABEL_SIZES[req.query.size] ? req.query.size : '80x24';
      // Поворот нужен файлу, который печатают лентой: у Brother головка пишет
      // поперёк ленты, и страницу драйвер ждёт стоячую. Печать из браузера идёт
      // своей страницей с @page и разворота не просит.
      const rotate = [90, 180, 270].includes(Number(req.query.rotate)) ? Number(req.query.rotate) : 0;
      const png = await labelPng(svg, size, { rotate });
      return res.type('image/png').send(png);
    }
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('GET warehouse/locations/rooms/:id/door-card.svg error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Отдельный профиль TDP-225: ZPL 44x25 мм, не связанный с лентами Brother. */
router.get('/rooms/:id/door-card.zpl', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const room = await WhRoom.findByPk(req.params.id, { include: doorCardInclude });
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const zpl = roomDoorCardZpl(room, { copies: Number(req.query.copies) || 1 });
    res.type('text/plain; charset=utf-8').send(zpl);
  } catch (err) {
    console.error('GET warehouse/locations/rooms/:id/door-card.zpl error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Пачка дверных этикеток на печать.
 *
 * Кабинеты маркируют не по одному: этикетки нужны сразу на этаж или на весь
 * медцентр, а карточка кабинета отдавала ровно одну — чтобы промаркировать
 * тридцать дверей, приходилось тридцать раз открыть дашборд и тридцать раз
 * пройти через диалог печати. Устроено так же, как пачка этикеток оборудования:
 * сервер растеризует каждую карточку в PNG нужного принтеру разрешения, а
 * браузер только раскладывает готовые пиксели по страницам.
 *
 * Порядок ответа задаём порядком запроса: findAll возвращает строки как ему
 * удобно, а человек отмечал кабинеты сверху вниз по списку и ждёт ленту в том же
 * порядке — иначе разложить отпечатанное по этажам нечем.
 */
router.post('/rooms/door-cards/batch', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [], size = '80x24', rotate } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не выбраны кабинеты' });
    if (ids.length > 200) return res.status(400).json({ error: 'За раз не больше 200 этикеток' });

    const labelSize = LABEL_SIZES[size] ? size : '80x24';
    const turn = [90, 180, 270].includes(Number(rotate)) ? Number(rotate) : 0;

    const rooms = await WhRoom.findAll({ where: { id: { [Op.in]: ids } }, include: doorCardInclude });
    const byId = new Map(rooms.map(r => [r.id, r]));

    const labels = [];
    for (const id of ids) {
      const room = byId.get(id);
      if (!room) continue;
      const svg = await roomDoorCardSvg(room, { size: labelSize });
      const png = await labelPng(svg, labelSize, { rotate: turn });
      labels.push({
        id: room.id,
        number: room.number,
        png: `data:image/png;base64,${png.toString('base64')}`,
      });
    }
    if (!labels.length) return res.status(404).json({ error: 'Ни одного из выбранных кабинетов не нашлось' });

    res.json({ size: labelSize, rotate: turn, labels, sizeMm: LABEL_SIZES[labelSize] });
  } catch (err) {
    console.error('POST warehouse/locations/rooms/door-cards/batch error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Та же пачка отдельными ZPL-заданиями для TDP-225, каждое строго 44x25 мм. */
router.post('/rooms/door-cards/batch.zpl', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не выбраны кабинеты' });
    if (ids.length > 200) return res.status(400).json({ error: 'За раз не больше 200 этикеток' });

    const rooms = await WhRoom.findAll({ where: { id: { [Op.in]: ids } }, include: doorCardInclude });
    const byId = new Map(rooms.map(r => [r.id, r]));
    const zpl = ids.map(id => byId.get(id)).filter(Boolean)
      .map(room => roomDoorCardZpl(room)).join('\n');
    if (!zpl) return res.status(404).json({ error: 'Ни одного из выбранных кабинетов не нашлось' });

    res.type('text/plain; charset=utf-8').send(zpl);
  } catch (err) {
    console.error('POST warehouse/locations/rooms/door-cards/batch.zpl error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Та же пачка — готовым заданием печати для Brother P-touch.
 *
 * Ради этой ручки и затевалась печать с телефона: маркировка дверей это обход
 * этажа, а не работа за столом. Подробности формата — в
 * services/warehouse/ptouchRaster.js.
 */
router.post('/rooms/door-cards/batch.prn', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [], rotate, mirror, autoCut } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не выбраны кабинеты' });
    if (ids.length > 200) return res.status(400).json({ error: 'За раз не больше 200 этикеток' });

    const rooms = await WhRoom.findAll({ where: { id: { [Op.in]: ids } }, include: doorCardInclude });
    const byId = new Map(rooms.map(r => [r.id, r]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    if (!ordered.length) return res.status(404).json({ error: 'Ни одного из выбранных кабинетов не нашлось' });

    const pngs = [];
    for (const room of ordered) {
      pngs.push(await labelPng(await roomDoorCardSvg(room, { size: '80x24' }), '80x24'));
    }
    const job = await ptouch.buildJobFromPngs(pngs, {
      rotate: Number(rotate) === 270 ? 270 : 90,
      // Зеркало по умолчанию включено — так печатает наш PT-E550W (см. ptouchRaster.js)
      mirror: mirror !== false,
      autoCut: autoCut !== false,
    });

    res.json({
      labels: ordered.map(r => ({ id: r.id, number: r.number, name: r.name })),
      bytes: job.length,
      prn: job.toString('base64'),
    });
  } catch (err) {
    console.error('POST warehouse/locations/rooms/door-cards/batch.prn error:', err);
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

  // Погашенная полка пропадает из выбора мест хранения, но остаток на ней
  // продолжает числиться — и снять его оттуда становится нечем: в форме операции
  // такое место уже не выбрать.
  if (isActive === false && row.isActive) {
    const left = await WhStock.count({ where: { storageId: row.id, quantity: { [Op.gt]: 0 } } });
    if (left > 0) {
      return res.status(409).json({
        error: `На этом месте хранения ${left} позиций на остатке — сначала переместите или спишите их`,
      });
    }
  }

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
