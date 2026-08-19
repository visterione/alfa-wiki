/**
 * Операции: документы и движения, наряды ТО, ремонты, инвентаризация, котировки.
 *
 * Всё, что меняет остатки и размещение, проходит через createDocument из
 * services/warehouse/stock.js. Отдельных «быстрых» ручек, правящих остаток напрямую,
 * здесь нет намеренно: как только такая появится, журнал перестанет совпадать со
 * складом, и отчёт № 2 потеряет смысл аудиторского следа.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  sequelize, WhDocument, WhMovement, WhAsset, WhRoom, WhStorage, WhDepartment,
  WhFloor, WhBuilding, WhNomenclature, WhBatch, WhContractor, WhStock,
  WhMaintenanceOrder, WhRepair, WhInventorySession, WhInventoryItem,
  WhRfq, WhRfqItem, WhRfqQuote, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport, roomPath } = require('../../services/warehouse/access');
const { createDocument } = require('../../services/warehouse/stock');
const {
  generateMaintenanceNumber, generateRepairNumber, generateRfqNumber, generateDocumentNumber,
} = require('../../services/warehouse/numbering');

const userAttrs = ['id', 'displayName', 'username', 'avatar'];

// ── Документы и движения ─────────────────────────────────────────────────────
router.get('/documents', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { type, from, to, status, q, page = 1, limit = 50 } = req.query;
    const where = {};
    if (type) where.type = { [Op.in]: String(type).split(',') };
    if (status) where.status = status;
    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = new Date(from);
      if (to) where.date[Op.lte] = new Date(`${to}T23:59:59`);
    }

    // Поиск по журналу раньше жил на клиенте и фильтровал только загруженную
    // сотню документов: искать по номеру в журнале за год было бесполезно —
    // нужный документ просто не попадал в выборку. С постраничной навигацией
    // клиентский фильтр стал бы ещё и обманчивым: он показывал бы совпадения
    // на текущей странице и молчал про остальные.
    const search = String(q || '').trim();
    if (search) {
      const like = { [Op.iLike]: `%${search}%` };
      where[Op.or] = [
        { number: like },
        { reasonText: like },
        { comment: like },
        { '$author.displayName$': like },
      ];
    }

    const rows = await WhDocument.findAndCountAll({
      where,
      include: [
        { model: User, as: 'author', attributes: userAttrs },
        { model: User, as: 'signer', attributes: userAttrs },
        { model: WhRoom, as: 'fromRoom', attributes: ['id', 'number', 'name'] },
        { model: WhRoom, as: 'toRoom', attributes: ['id', 'number', 'name'] },
        { model: WhContractor, as: 'contractor', attributes: ['id', 'name'] },
      ],
      order: [['date', 'DESC']],
      limit: Math.min(Number(limit) || 50, 200),
      offset: ((Number(page) || 1) - 1) * (Number(limit) || 50),
      distinct: true,
      // Без subQuery: false условие по $author.displayName$ не доезжает до
      // подзапроса с LIMIT и роняет запрос. Все связи здесь belongsTo, строк
      // соединение не размножает — счётчик остаётся верным.
      subQuery: false,
    });
    res.json({ total: rows.count, items: rows.rows });
  } catch (err) {
    console.error('GET warehouse/documents error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/documents/:id', authenticate, requireWarehouse(), async (req, res) => {
  const doc = await WhDocument.findByPk(req.params.id, {
    include: [
      { model: User, as: 'author', attributes: userAttrs },
      { model: User, as: 'signer', attributes: userAttrs },
      { model: WhRoom, as: 'fromRoom', attributes: ['id', 'number', 'name'] },
      { model: WhRoom, as: 'toRoom', attributes: ['id', 'number', 'name'] },
      { model: WhContractor, as: 'contractor', attributes: ['id', 'name'] },
      {
        model: WhMovement, as: 'movements',
        include: [
          { model: WhAsset, as: 'asset', attributes: ['id', 'inventoryNumber', 'name', 'model'] },
          { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
          { model: WhBatch, as: 'batch', attributes: ['id', 'batchNumber', 'expiryDate'] },
          { model: WhStorage, as: 'fromStorage', attributes: ['id', 'name'] },
          { model: WhStorage, as: 'toStorage', attributes: ['id', 'name'] },
          { model: User, as: 'doctor', attributes: userAttrs },
        ],
      },
    ],
  });
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  res.json(doc);
});

/**
 * Создание и проведение документа. Один эндпоинт на все типы: логика различий
 * живёт в сервисе, а не размазана по семи маршрутам.
 */
router.post('/documents', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  try {
    const { type, lines, comment, reasonCode, reasonText, contractorId, fromRoomId, toRoomId, sign, occurredAt } = req.body;
    if (!type) return res.status(400).json({ error: 'Не указан тип документа' });
    const supported = new Set(['receipt', 'return', 'issue', 'transfer', 'repair_out', 'repair_in', 'writeoff', 'surplus']);
    if (!supported.has(type)) return res.status(400).json({ error: 'Неподдерживаемый тип документа' });

    // Зона ответственности: выдавать и перемещать можно только из своих кабинетов.
    const scoped = await req.warehouse.scopedRoomIds();
    if (scoped !== null) {
      const storageIds = (lines || []).map(l => l.fromStorageId).filter(Boolean);
      if (storageIds.length) {
        const storages = await WhStorage.findAll({ where: { id: { [Op.in]: storageIds } }, attributes: ['id', 'roomId'] });
        const foreign = storages.find(s => !scoped.includes(s.roomId));
        if (foreign) {
          return res.status(403).json({ error: 'В документе есть место хранения не из вашей зоны ответственности' });
        }
      }
    }

    const result = await createDocument({
      type, lines, user: req.user, comment, reasonCode, reasonText,
      contractorId, fromRoomId, toRoomId,
      // Устройство пишем из User-Agent: колонка 13 отчёта № 2 нужна при разборе недостач.
      device: req.headers['user-agent']?.slice(0, 250) || null,
      sign: sign !== false,
      occurredAt,
    });

    const full = await WhDocument.findByPk(result.document.id, {
      include: [{ model: WhMovement, as: 'movements' }],
    });
    res.status(201).json(full);
  } catch (err) {
    // Ошибки вида «недостаточно остатка» — это не сбой сервера, а бизнес-правило:
    // отдаём 400 с текстом, который можно показать человеку.
    const businessError = /Недостаточно|требует|не найден|не поддерживает|без строк|больше нуля|место хранения|кабинет/i.test(err.message);
    if (!businessError) console.error('POST warehouse/documents error:', err);
    res.status(businessError ? 400 : 500).json({ error: err.message });
  }
});

// ── Журнал движений (отчёт № 2, режим 1) ─────────────────────────────────────
router.get('/movements', authenticate, requireWarehouse(), requireReport('RPT-MOVEMENT'), async (req, res) => {
  try {
    const {
      from, to, type, assetId, nomenclatureId, fromRoomId, toRoomId,
      doctorUserId, interDepartmentOnly, page = 1, limit = 100,
    } = req.query;

    const where = {};
    if (type) where.type = { [Op.in]: String(type).split(',') };
    if (assetId) where.assetId = assetId;
    if (nomenclatureId) where.nomenclatureId = nomenclatureId;
    if (fromRoomId) where.fromRoomId = fromRoomId;
    if (toRoomId) where.toRoomId = toRoomId;
    if (doctorUserId) where.doctorUserId = doctorUserId;
    if (from || to) {
      where.occurredAt = {};
      if (from) where.occurredAt[Op.gte] = new Date(from);
      if (to) where.occurredAt[Op.lte] = new Date(`${to}T23:59:59`);
    }

    const scoped = await req.warehouse.scopedRoomIds();
    if (scoped !== null) {
      where[Op.or] = [
        { fromRoomId: { [Op.in]: scoped } },
        { toRoomId: { [Op.in]: scoped } },
      ];
    }

    const rows = await WhMovement.findAndCountAll({
      where,
      include: [
        { model: WhDocument, as: 'document', attributes: ['id', 'number', 'type', 'status', 'signedAt', 'device', 'oneCStatus'] },
        { model: WhAsset, as: 'asset', attributes: ['id', 'inventoryNumber', 'name', 'model', 'serialNumber'] },
        { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
        { model: WhBatch, as: 'batch', attributes: ['id', 'batchNumber', 'expiryDate'] },
        {
          model: WhRoom, as: 'fromRoom', attributes: ['id', 'number', 'name'],
          include: [{ model: WhDepartment, as: 'department', attributes: ['id', 'name'] }],
        },
        {
          model: WhRoom, as: 'toRoom', attributes: ['id', 'number', 'name'],
          include: [{ model: WhDepartment, as: 'department', attributes: ['id', 'name'] }],
        },
        { model: User, as: 'fromResponsible', attributes: userAttrs },
        { model: User, as: 'toResponsible', attributes: userAttrs },
        { model: User, as: 'doctor', attributes: userAttrs },
        { model: User, as: 'initiator', attributes: userAttrs },
      ],
      order: [['occurredAt', 'DESC']],
      limit: Math.min(Number(limit) || 100, 500),
      offset: ((Number(page) || 1) - 1) * (Number(limit) || 100),
      distinct: true,
    });

    let items = rows.rows;
    // Только межотделенческие: чекбокс из параметров отбора отчёта № 2.
    if (interDepartmentOnly === 'true') {
      items = items.filter(m =>
        m.fromRoom?.department?.id && m.toRoom?.department?.id &&
        m.fromRoom.department.id !== m.toRoom.department.id
      );
    }

    const summary = await movementSummary(where);
    res.json({ total: rows.count, items, summary });
  } catch (err) {
    console.error('GET warehouse/movements error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function movementSummary(where) {
  const rows = await WhMovement.findAll({
    where,
    attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
    group: ['type'],
    raw: true,
  });
  const byType = {};
  for (const r of rows) byType[r.type] = Number(r.cnt);
  return { total: Object.values(byType).reduce((a, b) => a + b, 0), byType };
}

// ── Наряды ТО ────────────────────────────────────────────────────────────────
router.get('/maintenance', authenticate, requireWarehouse(), requireReport('RPT-MAINTENANCE'), async (req, res) => {
  try {
    const { from, to, status, type, contractorId, mandatoryOnly, overdueOnly, assetId } = req.query;
    const where = {};
    if (status) where.status = { [Op.in]: String(status).split(',') };
    if (type) where.type = { [Op.in]: String(type).split(',') };
    if (contractorId) where.contractorId = contractorId;
    if (assetId) where.assetId = assetId;
    if (mandatoryOnly === 'true') where.isMandatory = true;
    if (overdueOnly === 'true') {
      where.status = { [Op.ne]: 'done' };
      where.plannedDate = { [Op.lt]: new Date().toISOString().slice(0, 10) };
    }
    if (from || to) {
      where.plannedDate = { ...(where.plannedDate || {}) };
      if (from) where.plannedDate[Op.gte] = from;
      if (to) where.plannedDate[Op.lte] = to;
    }

    const rows = await WhMaintenanceOrder.findAll({
      where,
      include: [
        {
          model: WhAsset, as: 'asset',
          attributes: ['id', 'inventoryNumber', 'name', 'model', 'status', 'roomId'],
          include: [{
            model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'],
            include: [{ model: WhDepartment, as: 'department', attributes: ['id', 'name'] }],
          }],
        },
        { model: WhContractor, as: 'contractor', attributes: ['id', 'name'] },
        { model: User, as: 'engineer', attributes: userAttrs },
      ],
      order: [['plannedDate', 'ASC']],
      limit: 1000,
    });

    const today = new Date().toISOString().slice(0, 10);
    const items = rows.map(o => {
      const plain = o.toJSON();
      // Отклонение в днях: план-факт из режима 1 отчёта № 6. Считаем здесь, а не
      // на клиенте, чтобы XLSX и экран показывали одно и то же число.
      const base = o.factDate || today;
      plain.deviationDays = Math.round(
        (new Date(base) - new Date(o.plannedDate)) / 86400000
      );
      plain.isOverdue = !o.factDate && o.plannedDate < today && o.status !== 'done';
      return plain;
    });

    res.json({
      total: items.length,
      items,
      summary: {
        done: items.filter(i => i.status === 'done').length,
        onTime: items.filter(i => i.status === 'done' && i.deviationDays <= 0).length,
        deviated: items.filter(i => i.status === 'done' && i.deviationDays > 0).length,
        overdue: items.filter(i => i.isOverdue).length,
        totalCost: items.reduce((s, i) => s + Number(i.cost || 0), 0),
        downtimeHours: items.reduce((s, i) => s + Number(i.downtimeHours || 0), 0),
      },
    });
  } catch (err) {
    console.error('GET warehouse/maintenance error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/maintenance', authenticate, requireWarehouse('canMaintenance'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const b = req.body;
    if (!b.assetId || !b.plannedDate) {
      await t.rollback();
      return res.status(400).json({ error: 'Нужны актив и плановая дата' });
    }
    const number = await generateMaintenanceNumber({ transaction: t });
    const row = await WhMaintenanceOrder.create({
      number, assetId: b.assetId, type: b.type || 'maintenance',
      plannedDate: b.plannedDate, contractorId: b.contractorId || null,
      isMandatory: Boolean(b.isMandatory), engineerUserId: b.engineerUserId || null,
      cost: b.cost || 0,
    }, { transaction: t });

    // Держим nextMaintenanceDate актуальным: он печатается на этикетке и светится
    // на дашборде кабинета, поэтому не должен отставать от нарядов.
    const asset = await WhAsset.findByPk(b.assetId, { transaction: t });
    if (asset && (!asset.nextMaintenanceDate || asset.nextMaintenanceDate > b.plannedDate)) {
      await asset.update({ nextMaintenanceDate: b.plannedDate }, { transaction: t });
    }

    await t.commit();
    res.status(201).json(row);
  } catch (err) {
    await t.rollback();
    console.error('POST warehouse/maintenance error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Закрытие наряда. Здесь же пересчитывается следующая дата ТО по интервалу —
 * иначе график пришлось бы вести руками, и он немедленно отстал бы от факта.
 */
router.patch('/maintenance/:id/close', authenticate, requireWarehouse('canMaintenance'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const order = await WhMaintenanceOrder.findByPk(req.params.id, { transaction: t });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ error: 'Наряд не найден' });
    }
    const { factDate, result, resultNote, cost, downtimeHours } = req.body;

    await order.update({
      factDate: factDate || new Date().toISOString().slice(0, 10),
      status: 'done',
      result: result || 'normal',
      resultNote: resultNote || null,
      cost: cost ?? order.cost,
      downtimeHours: downtimeHours ?? order.downtimeHours,
    }, { transaction: t });

    const asset = await WhAsset.findByPk(order.assetId, { transaction: t });
    if (asset) {
      const patch = { lastActivityAt: new Date() };
      if (asset.maintenanceIntervalMonths) {
        const next = new Date(order.factDate || Date.now());
        next.setMonth(next.getMonth() + asset.maintenanceIntervalMonths);
        patch.nextMaintenanceDate = next.toISOString().slice(0, 10);
      }
      if (asset.status === 'maintenance') patch.status = 'in_use';
      await asset.update(patch, { transaction: t });
    }

    await t.commit();
    res.json(order);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

// ── Ремонты ──────────────────────────────────────────────────────────────────
router.post('/repairs', authenticate, requireWarehouse('canMaintenance'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const b = req.body;
    if (!b.assetId || !b.startedAt) {
      await t.rollback();
      return res.status(400).json({ error: 'Нужны актив и дата начала' });
    }
    const number = await generateRepairNumber({ transaction: t });
    const row = await WhRepair.create({
      number, assetId: b.assetId, startedAt: b.startedAt,
      description: b.description || null, contractorId: b.contractorId || null,
      cost: b.cost || 0, createdBy: req.user.id,
    }, { transaction: t });

    await WhAsset.update(
      { status: 'repair', lastActivityAt: new Date() },
      { where: { id: b.assetId }, transaction: t }
    );

    await t.commit();
    res.status(201).json(row);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.patch('/repairs/:id/close', authenticate, requireWarehouse('canMaintenance'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const row = await WhRepair.findByPk(req.params.id, { transaction: t });
    if (!row) {
      await t.rollback();
      return res.status(404).json({ error: 'Ремонт не найден' });
    }
    const { finishedAt, result, cost, downtimeHours, description } = req.body;
    const finish = finishedAt || new Date().toISOString().slice(0, 10);

    await row.update({
      finishedAt: finish, result: result || 'repaired',
      cost: cost ?? row.cost,
      // Если простой не указан, считаем по календарю: 8 рабочих часов на день.
      downtimeHours: downtimeHours ?? Math.max(
        0, Math.round((new Date(finish) - new Date(row.startedAt)) / 86400000) * 8
      ),
      description: description ?? row.description,
    }, { transaction: t });

    // «Не подлежит ремонту» — это списание, а не возврат в работу.
    const nextStatus = result === 'written_off' ? 'written_off' : 'in_use';
    await WhAsset.update(
      { status: nextStatus, isArchived: nextStatus === 'written_off', lastActivityAt: new Date() },
      { where: { id: row.assetId }, transaction: t }
    );

    await t.commit();
    res.json(row);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

// ── Инвентаризация ───────────────────────────────────────────────────────────
router.get('/inventory', authenticate, requireWarehouse(), async (req, res) => {
  const rows = await WhInventorySession.findAll({
    include: [
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'] },
      { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
      { model: User, as: 'chairman', attributes: userAttrs },
      { model: User, as: 'responsible', attributes: userAttrs },
    ],
    order: [['createdAt', 'DESC']],
    limit: 100,
  });
  res.json(rows);
});

/**
 * Открытие описи. Ожидаемые количества снимаются сразу при открытии: если брать их
 * в момент закрытия, любое движение во время пересчёта попадёт в расхождение и
 * будет выглядеть как недостача.
 */
router.post('/inventory', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { roomId, departmentId, basis, chairmanUserId, members, responsibleUserId } = req.body;
    if (!roomId && !departmentId) {
      await t.rollback();
      return res.status(400).json({ error: 'Нужен кабинет или отделение' });
    }

    const number = await generateDocumentNumber({ type: 'inventory', transaction: t });
    const session = await WhInventorySession.create({
      number,
      scope: roomId ? 'room' : 'department',
      roomId: roomId || null, departmentId: departmentId || null,
      basis: basis || null,
      status: 'counting',
      chairmanUserId: chairmanUserId || req.user.id,
      members: Array.isArray(members) ? members : [],
      responsibleUserId: responsibleUserId || null,
      startedAt: new Date(),
      createdBy: req.user.id,
    }, { transaction: t });

    const roomIds = roomId
      ? [roomId]
      : (await WhRoom.findAll({ where: { departmentId, isActive: true }, attributes: ['id'], transaction: t })).map(r => r.id);

    const assets = await WhAsset.findAll({
      where: { roomId: { [Op.in]: roomIds }, isArchived: false },
      attributes: ['id'], transaction: t,
    });
    const stock = await WhStock.findAll({
      where: { quantity: { [Op.gt]: 0 } },
      include: [{ model: WhStorage, as: 'storage', required: true, where: { roomId: { [Op.in]: roomIds } }, attributes: ['id'] }],
      transaction: t,
    });

    await WhInventoryItem.bulkCreate([
      ...assets.map(a => ({ sessionId: session.id, assetId: a.id, expectedQty: 1 })),
      ...stock.map(s => ({
        sessionId: session.id, nomenclatureId: s.nomenclatureId, batchId: s.batchId,
        storageId: s.storageId, expectedQty: s.quantity,
      })),
    ], { transaction: t });

    await t.commit();
    res.status(201).json({ session, items: assets.length + stock.length });
  } catch (err) {
    await t.rollback();
    console.error('POST warehouse/inventory error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/inventory/:id', authenticate, requireWarehouse(), async (req, res) => {
  const session = await WhInventorySession.findByPk(req.params.id, {
    include: [
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'] },
      { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
      { model: User, as: 'chairman', attributes: userAttrs },
      { model: User, as: 'responsible', attributes: userAttrs },
      {
        model: WhInventoryItem, as: 'items',
        include: [
          { model: WhAsset, as: 'asset', attributes: ['id', 'inventoryNumber', 'name', 'model', 'status'] },
          { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
          { model: WhBatch, as: 'batch', attributes: ['id', 'batchNumber', 'expiryDate'] },
          { model: WhStorage, as: 'storage', attributes: ['id', 'name'] },
        ],
      },
    ],
  });
  if (!session) return res.status(404).json({ error: 'Опись не найдена' });

  const items = session.items || [];
  const counted = items.filter(i => i.actualQty !== null);
  res.json({
    session,
    stats: {
      total: items.length,
      counted: counted.length,
      byQr: counted.filter(i => i.scanMethod === 'qr').length,
      manual: counted.filter(i => i.scanMethod === 'manual').length,
      shortage: items.filter(i => i.actualQty !== null && Number(i.actualQty) < Number(i.expectedQty)).length,
      surplus: items.filter(i => i.actualQty !== null && Number(i.actualQty) > Number(i.expectedQty)).length,
      locationPath: session.roomId ? await roomPath(session.roomId) : null,
    },
  });
});

/**
 * Отметка позиции при пересчёте. Работает и от сканера (scanMethod = 'qr'), и от
 * ручного ввода — доля ручного ввода потом показывает качество маркировки.
 */
router.post('/inventory/:id/count', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  try {
    const session = await WhInventorySession.findByPk(req.params.id);
    if (!session) return res.status(404).json({ error: 'Опись не найдена' });
    if (session.status === 'closed') return res.status(409).json({ error: 'Опись уже закрыта' });

    const { code, assetId, itemId, actualQty, scanMethod, note } = req.body;

    let item = null;
    if (itemId) {
      item = await WhInventoryItem.findOne({ where: { id: itemId, sessionId: session.id } });
    } else if (assetId || code) {
      const token = code && code.includes('/') ? code.split('/').filter(Boolean).pop() : code;
      const asset = assetId
        ? await WhAsset.findByPk(assetId)
        : await WhAsset.findOne({ where: { [Op.or]: [{ publicToken: token }, { inventoryNumber: code }] } });
      if (!asset) return res.status(404).json({ error: 'Актив по коду не найден' });

      item = await WhInventoryItem.findOne({ where: { sessionId: session.id, assetId: asset.id } });

      // Актива нет в описи — это излишек: числится в другом кабинете или вообще
      // не на учёте. Такую строку надо создать, а не молча проигнорировать: именно
      // из неё получается ИНВ-18 и документ оприходования.
      if (!item) {
        item = await WhInventoryItem.create({
          sessionId: session.id, assetId: asset.id,
          expectedQty: 0, actualQty: 1,
          scanMethod: scanMethod || 'qr', scannedAt: new Date(), scannedBy: req.user.id,
          note: note || `Излишек: числится в другом месте (${asset.roomId ? await roomPath(asset.roomId) : 'без размещения'})`,
        });
        return res.status(201).json({ item, surplus: true });
      }
    } else {
      return res.status(400).json({ error: 'Нужен код, актив или строка описи' });
    }

    if (!item) return res.status(404).json({ error: 'Строка описи не найдена' });

    await item.update({
      actualQty: actualQty ?? 1,
      scanMethod: scanMethod || 'manual',
      scannedAt: new Date(),
      scannedBy: req.user.id,
      note: note ?? item.note,
    });
    res.json({ item });
  } catch (err) {
    console.error('POST warehouse/inventory/count error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Закрытие описи. Незаполненные строки трактуются как ненайденные (факт 0) —
 * иначе «не дошли до шкафа Б» и «в шкафу Б пусто» выглядели бы одинаково.
 */
router.patch('/inventory/:id/close', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const session = await WhInventorySession.findByPk(req.params.id, {
      include: [{ model: WhInventoryItem, as: 'items' }], transaction: t,
    });
    if (!session) {
      await t.rollback();
      return res.status(404).json({ error: 'Опись не найдена' });
    }

    const items = session.items || [];
    for (const it of items) {
      if (it.actualQty === null) {
        await it.update({ actualQty: 0, note: it.note || 'Не найдено при пересчёте' }, { transaction: t });
      }
    }

    const finishedAt = new Date();
    await session.update({
      status: 'closed',
      finishedAt,
      durationMinutes: session.startedAt
        ? Math.round((finishedAt - new Date(session.startedAt)) / 60000)
        : null,
      members: Array.isArray(req.body.members) ? req.body.members : session.members,
    }, { transaction: t });

    await t.commit();

    // Документы по итогам (оприходование излишков, списание недостач) специально
    // НЕ создаются автоматически: это решение комиссии, а не следствие пересчёта.
    // Отчёт № 9 показывает расхождения, оформление идёт отдельным действием.
    res.json({ ok: true, session });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

/**
 * Оформление материальных расхождений после решения комиссии. Излишки и
 * недостачи проводятся двумя документами в одной транзакции: либо проходят оба,
 * либо опись и остатки остаются нетронутыми. Расхождения по ОС не списываются
 * автоматически — для них нужен отдельный акт и решение ответственного лица.
 */
router.post('/inventory/:id/post-differences', authenticate, requireWarehouse('canIssue'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Блокировка описи и подгрузка позиций разнесены по двум запросам намеренно:
    // include даёт LEFT OUTER JOIN, а PostgreSQL не умеет FOR UPDATE по nullable-стороне
    // такого join и валит запрос («FOR UPDATE cannot be applied to the nullable side of
    // an outer join»). Блокируем только саму опись — этого достаточно, чтобы двое не
    // оформили расхождения одновременно; строки описи после закрытия уже не меняются.
    const session = await WhInventorySession.findByPk(req.params.id, {
      transaction: t, lock: t.LOCK.UPDATE,
    });
    if (!session) {
      await t.rollback();
      return res.status(404).json({ error: 'Опись не найдена' });
    }
    if (session.status !== 'closed') {
      await t.rollback();
      return res.status(409).json({ error: 'Сначала закройте инвентаризацию' });
    }
    if (session.differencesPostedAt) {
      await t.rollback();
      return res.status(409).json({ error: 'Расхождения по этой описи уже оформлены' });
    }

    const items = await WhInventoryItem.findAll({
      where: { sessionId: session.id }, transaction: t,
    });

    const surplusLines = [];
    const shortageLines = [];
    const assetDifferences = [];
    for (const item of items) {
      const diff = Number(item.actualQty) - Number(item.expectedQty);
      if (!diff) continue;
      if (item.assetId) {
        assetDifferences.push({ itemId: item.id, assetId: item.assetId, difference: diff });
        continue;
      }
      if (!item.nomenclatureId || !item.storageId) continue;
      const stock = await WhStock.findOne({
        where: {
          nomenclatureId: item.nomenclatureId, storageId: item.storageId,
          batchId: item.batchId || null,
        }, transaction: t,
      });
      const line = {
        nomenclatureId: item.nomenclatureId, batchId: item.batchId || null,
        quantity: Math.abs(diff), unitCost: Number(stock?.unitCost || 0),
        reasonCode: 'inventory', reasonText: `По описи ${session.number}`,
      };
      if (diff > 0) surplusLines.push({ ...line, toStorageId: item.storageId });
      else shortageLines.push({ ...line, fromStorageId: item.storageId });
    }

    const posted = [];
    if (surplusLines.length) {
      const result = await createDocument({
        type: 'surplus', lines: surplusLines, user: req.user, sign: true,
        reasonCode: 'inventory', reasonText: `Излишки по инвентаризации ${session.number}`,
        comment: req.body.comment || null,
      }, { transaction: t });
      posted.push({ type: 'surplus', id: result.document.id, number: result.document.number });
    }
    if (shortageLines.length) {
      const result = await createDocument({
        type: 'writeoff', lines: shortageLines, user: req.user, sign: true,
        reasonCode: 'inventory', reasonText: `Недостачи по инвентаризации ${session.number}`,
        comment: req.body.comment || null,
      }, { transaction: t });
      posted.push({ type: 'writeoff', id: result.document.id, number: result.document.number });
    }

    await session.update({ differencesPostedAt: new Date(), differencesPostedBy: req.user.id }, { transaction: t });
    await t.commit();
    res.json({ ok: true, documents: posted, assetDifferences });
  } catch (err) {
    await t.rollback();
    const businessError = /Недостаточно|просроч|заблокирован|уже оформлены/i.test(err.message);
    if (!businessError) console.error('POST warehouse/inventory/post-differences error:', err);
    res.status(businessError ? 400 : 500).json({ error: err.message });
  }
});

// ── Котировки ────────────────────────────────────────────────────────────────
router.get('/rfq', authenticate, requireWarehouse(), async (req, res) => {
  const rows = await WhRfq.findAll({
    include: [
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'] },
      { model: WhContractor, as: 'decidedContractor', attributes: ['id', 'name'] },
      { model: WhRfqItem, as: 'items', include: [{ model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] }] },
      { model: WhRfqQuote, as: 'quotes', include: [{ model: WhContractor, as: 'contractor' }] },
    ],
    order: [['createdAt', 'DESC']],
    limit: 100,
  });
  res.json(rows);
});

router.post('/rfq', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { items, reason, roomId, dueAt } = req.body;
    if (!Array.isArray(items) || !items.length) {
      await t.rollback();
      return res.status(400).json({ error: 'Нужны позиции' });
    }
    const number = await generateRfqNumber({ transaction: t });
    const rfq = await WhRfq.create({
      number, reason: reason || null, roomId: roomId || null,
      dueAt: dueAt ? new Date(dueAt) : null, createdBy: req.user.id,
    }, { transaction: t });

    await WhRfqItem.bulkCreate(items.map(i => ({
      rfqId: rfq.id, nomenclatureId: i.nomenclatureId, quantity: i.quantity || 1,
    })), { transaction: t });

    await t.commit();
    res.status(201).json(rfq);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.post('/rfq/:id/quotes', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const { contractorId, deliveryDays, paymentTerms, prices, comment } = req.body;
    if (!contractorId) return res.status(400).json({ error: 'Нужен контрагент' });
    const [row] = await WhRfqQuote.upsert({
      rfqId: req.params.id, contractorId,
      deliveryDays: deliveryDays ?? null, paymentTerms: paymentTerms || null,
      prices: prices || {}, comment: comment || null, respondedAt: new Date(),
    }, { returning: true });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Сравнение котировок с оценкой. Веса формулы берутся из настроек, а не зашиты в
 * код: их будут крутить, и каждый раз править исходник для этого неправильно.
 */
router.get('/rfq/:id/comparison', authenticate, requireWarehouse(), requireReport('RPT-RFQ-COMPARE'), async (req, res) => {
  try {
    const { Setting } = require('../../models');
    const setting = await Setting.findByPk('warehouse.rfqScoreWeights');
    const weights = setting?.value || { price: 0.45, delivery: 0.35, rating: 0.20 };

    const rfq = await WhRfq.findByPk(req.params.id, {
      include: [
        { model: WhRfqItem, as: 'items', include: [{ model: WhNomenclature, as: 'nomenclature' }] },
        { model: WhRfqQuote, as: 'quotes', include: [{ model: WhContractor, as: 'contractor' }] },
        { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'] },
      ],
    });
    if (!rfq) return res.status(404).json({ error: 'Запрос не найден' });

    const quotes = (rfq.quotes || []).map(q => {
      let total = 0;
      const lines = (rfq.items || []).map(item => {
        const unit = Number(q.prices?.[item.id] || 0);
        const sum = unit * Number(item.quantity);
        total += sum;
        return { itemId: item.id, nomenclature: item.nomenclature, quantity: Number(item.quantity), unitPrice: unit, amount: sum };
      });
      const vat = (rfq.items || []).reduce((s, item) => {
        const unit = Number(q.prices?.[item.id] || 0);
        return s + unit * Number(item.quantity) * (Number(item.nomenclature?.vatPercent ?? 20) / 100);
      }, 0);
      return {
        id: q.id, contractor: q.contractor, deliveryDays: q.deliveryDays,
        paymentTerms: q.paymentTerms, respondedAt: q.respondedAt, comment: q.comment,
        lines,
        totalNet: round2(total),
        vat: round2(vat),
        totalGross: round2(total + vat),
      };
    }).filter(q => q.totalNet > 0);

    // Нормируем: лучшая цена и лучший срок дают 1, худшие — 0. Рейтинг делим на 5.
    const prices = quotes.map(q => q.totalNet);
    const days = quotes.map(q => q.deliveryDays ?? 99);
    const minP = Math.min(...prices), maxP = Math.max(...prices);
    const minD = Math.min(...days), maxD = Math.max(...days);

    for (const q of quotes) {
      const pScore = maxP === minP ? 1 : (maxP - q.totalNet) / (maxP - minP);
      const dScore = maxD === minD ? 1 : (maxD - (q.deliveryDays ?? 99)) / (maxD - minD);
      const rScore = (Number(q.contractor?.rating) || 0) / 5;
      q.score = round2(weights.price * pScore + weights.delivery * dScore + weights.rating * rScore);
      q.accreditationWarning = q.contractor?.accreditationUntil
        ? new Date(q.contractor.accreditationUntil) < new Date(Date.now() + 90 * 86400000)
        : false;
    }
    quotes.sort((a, b) => b.score - a.score);

    const best = quotes[0] || null;
    const cheapest = quotes.slice().sort((a, b) => a.totalNet - b.totalNet)[0] || null;

    res.json({
      rfq: { id: rfq.id, number: rfq.number, status: rfq.status, reason: rfq.reason, dueAt: rfq.dueAt, room: rfq.room },
      items: rfq.items,
      quotes,
      weights,
      recommendation: best && cheapest ? {
        contractorId: best.contractor?.id,
        contractorName: best.contractor?.name,
        // Обоснование текстом, потому что «score 0,91» само по себе никого не убеждает.
        rationale: best.id === cheapest.id
          ? `${best.contractor?.name} — и самая низкая цена, и лучшая оценка по совокупности условий.`
          : `${best.contractor?.name} дороже минимальной цены на ${round2(best.totalNet - cheapest.totalNet)} ₽ ` +
            `(+${round2(((best.totalNet - cheapest.totalNet) / cheapest.totalNet) * 100)} %), ` +
            `но поставит за ${best.deliveryDays} дн. вместо ${cheapest.deliveryDays}.`,
      } : null,
    });
  } catch (err) {
    console.error('GET warehouse/rfq/:id/comparison error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/rfq/:id/decide', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  const rfq = await WhRfq.findByPk(req.params.id);
  if (!rfq) return res.status(404).json({ error: 'Запрос не найден' });
  await rfq.update({
    status: 'decided',
    decidedContractorId: req.body.contractorId || null,
    decidedAt: new Date(),
    decisionNote: req.body.note || null,
  });
  // Выгрузки «Заказ поставщику» в 1С нет: обмен выключен. Заказ фиксируется в
  // портале, отправка поставщику — отдельным письмом через emailService.
  res.json(rfq);
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = router;
