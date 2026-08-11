/**
 * Справочники и остатки материалов: категории, номенклатура, контрагенты, партии,
 * остатки, минимумы, нормы расхода.
 *
 * Остатки читаются из warehouse_stock, а не пересчитываются из движений на каждый
 * запрос: их спрашивает каждый экран, а движений за год десятки тысяч. Контрольная
 * сверка остатка с журналом лежит в services/warehouse/stock.js (reconcileStock)
 * и вызывается отдельно — если она находит расхождение, значит кто-то менял
 * остатки в обход сервиса.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  sequelize, WhCategory, WhNomenclature, WhContractor, WhBatch, WhStock,
  WhStorage, WhRoom, WhDepartment, WhFloor, WhBuilding, WhReorderRule,
  WhConsumptionNorm, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse } = require('../../services/warehouse/access');
const { reconcileStock } = require('../../services/warehouse/stock');

// ── Категории ────────────────────────────────────────────────────────────────
router.get('/categories', authenticate, requireWarehouse('viewer'), async (req, res) => {
  const rows = await WhCategory.findAll({ order: [['kind', 'ASC'], ['sortOrder', 'ASC'], ['name', 'ASC']] });
  res.json(rows);
});

router.post('/categories', authenticate, requireWarehouse('admin'), async (req, res) => {
  try {
    const { name, parentId, kind, okof, depreciationGroup, defaultUsefulMonths } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Нужно название' });
    const row = await WhCategory.create({
      name: name.trim(), parentId: parentId || null, kind: kind || 'material',
      okof: okof || null, depreciationGroup: depreciationGroup || null,
      defaultUsefulMonths: defaultUsefulMonths || null,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Контрагенты ──────────────────────────────────────────────────────────────
router.get('/contractors', authenticate, requireWarehouse('viewer'), async (req, res) => {
  const { kind, q } = req.query;
  const where = { isActive: true };
  if (kind) where.kind = { [Op.in]: [kind, 'both'] };
  if (q) where.name = { [Op.iLike]: `%${q}%` };
  const rows = await WhContractor.findAll({ where, order: [['name', 'ASC']] });
  res.json(rows);
});

router.post('/contractors', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  try {
    const b = req.body;
    if (!b.name?.trim()) return res.status(400).json({ error: 'Нужно название' });
    const row = await WhContractor.create({
      name: b.name.trim(), kind: b.kind || 'supplier', inn: b.inn || null,
      phone: b.phone || null, email: b.email || null, contactPerson: b.contactPerson || null,
      rating: b.rating ?? null, deliveryFailures: b.deliveryFailures ?? 0,
      accreditationUntil: b.accreditationUntil || null, paymentTerms: b.paymentTerms || null,
      avgDeliveryDays: b.avgDeliveryDays ?? null, comment: b.comment || null,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/contractors/:id', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  const row = await WhContractor.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Контрагент не найден' });
  const fields = ['name', 'kind', 'inn', 'phone', 'email', 'contactPerson', 'rating',
    'deliveryFailures', 'accreditationUntil', 'paymentTerms', 'avgDeliveryDays', 'comment', 'isActive'];
  const patch = {};
  for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f] === '' ? null : req.body[f];
  await row.update(patch);
  res.json(row);
});

// ── Номенклатура ─────────────────────────────────────────────────────────────
router.get('/nomenclature', authenticate, requireWarehouse('viewer'), async (req, res) => {
  try {
    const { q, categoryId, isMedicine, page = 1, limit = 100 } = req.query;
    const where = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (isMedicine === 'true') where.isMedicine = true;
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { code: { [Op.iLike]: `%${q}%` } },
      ];
    }
    const rows = await WhNomenclature.findAndCountAll({
      where,
      include: [
        { model: WhCategory, as: 'category', attributes: ['id', 'name', 'kind'] },
        { model: WhContractor, as: 'defaultSupplier', attributes: ['id', 'name'] },
      ],
      order: [['name', 'ASC']],
      limit: Math.min(Number(limit) || 100, 500),
      offset: ((Number(page) || 1) - 1) * (Number(limit) || 100),
    });
    res.json({ total: rows.count, items: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nomenclature', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  try {
    const b = req.body;
    if (!b.name?.trim() || !b.code?.trim()) return res.status(400).json({ error: 'Нужны код и наименование' });
    const row = await WhNomenclature.create({
      code: b.code.trim(), name: b.name.trim(), categoryId: b.categoryId || null,
      unit: b.unit || 'шт', packUnit: b.packUnit || null, packSize: b.packSize ?? null,
      isMedicine: Boolean(b.isMedicine), isSterile: Boolean(b.isSterile),
      tracksBatch: b.tracksBatch !== false, vatPercent: b.vatPercent ?? 20,
      lastPrice: b.lastPrice ?? null, defaultSupplierId: b.defaultSupplierId || null,
      storageTempMinC: b.storageTempMinC ?? null, storageTempMaxC: b.storageTempMaxC ?? null,
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Такой код номенклатуры уже есть' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/nomenclature/:id', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  const row = await WhNomenclature.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Позиция не найдена' });
  const fields = ['name', 'categoryId', 'unit', 'packUnit', 'packSize', 'isMedicine',
    'isSterile', 'tracksBatch', 'vatPercent', 'lastPrice', 'defaultSupplierId',
    'storageTempMinC', 'storageTempMaxC', 'isActive'];
  const patch = {};
  for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f] === '' ? null : req.body[f];
  await row.update(patch);
  res.json(row);
});

// ── Партии ───────────────────────────────────────────────────────────────────
router.get('/batches', authenticate, requireWarehouse('viewer'), async (req, res) => {
  const { nomenclatureId, expiringDays } = req.query;
  const where = {};
  if (nomenclatureId) where.nomenclatureId = nomenclatureId;
  if (expiringDays) {
    const horizon = new Date(Date.now() + Number(expiringDays) * 86400000).toISOString().slice(0, 10);
    where.expiryDate = { [Op.lte]: horizon };
  }
  const rows = await WhBatch.findAll({
    where,
    include: [
      { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
      { model: WhContractor, as: 'supplier', attributes: ['id', 'name'] },
    ],
    order: [['expiryDate', 'ASC']],
    limit: 500,
  });
  res.json(rows);
});

router.post('/batches', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  try {
    const b = req.body;
    if (!b.nomenclatureId || !b.batchNumber?.trim()) {
      return res.status(400).json({ error: 'Нужны номенклатура и номер партии' });
    }
    const row = await WhBatch.create({
      nomenclatureId: b.nomenclatureId, batchNumber: b.batchNumber.trim(),
      expiryDate: b.expiryDate || null, productionDate: b.productionDate || null,
      supplierId: b.supplierId || null, unitCost: b.unitCost || 0,
      certificateNumber: b.certificateNumber || null,
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Такая партия по этой номенклатуре уже есть' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * Блокировка партии к выдаче. Нужна при отзыве производителем — просрочка
 * блокируется сама по дате, а вот отзыв руками никак иначе не оформить.
 */
router.patch('/batches/:id/block', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  const row = await WhBatch.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Партия не найдена' });
  await row.update({
    isBlocked: req.body.isBlocked !== false,
    blockReason: req.body.reason || null,
  });
  res.json(row);
});

// ── Остатки ──────────────────────────────────────────────────────────────────
router.get('/stock', authenticate, requireWarehouse('viewer'), async (req, res) => {
  try {
    const { roomId, storageId, nomenclatureId, belowMinimum, includeZero } = req.query;

    const scoped = await req.warehouse.scopedRoomIds();
    const roomFilter = [];
    if (roomId) roomFilter.push(roomId);
    if (scoped !== null) roomFilter.push(...scoped);

    const where = {};
    if (nomenclatureId) where.nomenclatureId = nomenclatureId;
    if (storageId) where.storageId = storageId;
    if (includeZero !== 'true') where.quantity = { [Op.gt]: 0 };

    const rows = await WhStock.findAll({
      where,
      include: [
        { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit', 'packUnit', 'isMedicine', 'isSterile'] },
        { model: WhBatch, as: 'batch', attributes: ['id', 'batchNumber', 'expiryDate', 'isBlocked'] },
        {
          model: WhStorage, as: 'storage',
          required: true,
          where: roomFilter.length ? { roomId: { [Op.in]: [...new Set(roomFilter)] } } : undefined,
          include: [{
            model: WhRoom, as: 'room',
            include: [
              { model: WhDepartment, as: 'department', attributes: ['id', 'name', 'color'] },
              { model: WhFloor, as: 'floor', include: [{ model: WhBuilding, as: 'building', attributes: ['id', 'name'] }] },
            ],
          }],
        },
      ],
      order: [['updatedAt', 'DESC']],
      limit: 2000,
    });

    // Минимумы подмешиваем отдельно: правило может быть задано на кабинет, на
    // место хранения или глобально, и выразить это одним JOIN'ом без дублей строк
    // не получается.
    const rules = await WhReorderRule.findAll();
    const today = new Date().toISOString().slice(0, 10);

    let items = rows.map(s => {
      const rule = rules.find(r =>
        r.nomenclatureId === s.nomenclatureId &&
        (r.storageId === s.storageId ||
         (r.roomId && r.roomId === s.storage?.roomId) ||
         (!r.roomId && !r.storageId))
      );
      const min = rule ? Number(rule.minQty) : null;
      const qty = Number(s.quantity);
      const expired = s.batch?.expiryDate ? s.batch.expiryDate < today : false;

      return {
        id: s.id,
        quantity: qty,
        unitCost: Number(s.unitCost),
        amount: Math.round(qty * Number(s.unitCost) * 100) / 100,
        nomenclature: s.nomenclature,
        batch: s.batch,
        storage: { id: s.storage.id, name: s.storage.name, kind: s.storage.kind },
        room: s.storage.room ? {
          id: s.storage.room.id, number: s.storage.room.number, name: s.storage.room.name,
          department: s.storage.room.department,
          building: s.storage.room.floor?.building?.name,
          floor: s.storage.room.floor?.number,
        } : null,
        minQty: min,
        // Светофор из отчёта № 1: ниже минимума / близко / норма.
        stockStatus: min === null ? 'unknown'
          : qty < min ? 'below'
          : qty < min * 1.2 ? 'near'
          : 'ok',
        expired,
        blocked: Boolean(s.batch?.isBlocked),
      };
    });

    if (belowMinimum === 'true') items = items.filter(i => i.stockStatus === 'below');

    res.json({
      total: items.length,
      totalValue: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100,
      items,
    });
  } catch (err) {
    console.error('GET warehouse/stock error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Контрольная сверка остатков с журналом движений. Ручной запуск: расхождение
 * означает, что остатки правили в обход сервиса, и это надо увидеть, а не
 * прятать в ночном логе.
 */
router.get('/stock/reconcile', authenticate, requireWarehouse('admin'), async (req, res) => {
  try {
    const diffs = await reconcileStock();
    res.json({ ok: diffs.length === 0, discrepancies: diffs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Минимальные остатки ──────────────────────────────────────────────────────
router.get('/reorder-rules', authenticate, requireWarehouse('viewer'), async (req, res) => {
  const rows = await WhReorderRule.findAll({
    include: [
      { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'] },
      { model: WhStorage, as: 'storage', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
  });
  res.json(rows);
});

router.post('/reorder-rules', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  try {
    const { nomenclatureId, roomId, storageId, minQty, maxQty, autoRfq } = req.body;
    if (!nomenclatureId || minQty === undefined) {
      return res.status(400).json({ error: 'Нужны номенклатура и минимум' });
    }
    const row = await WhReorderRule.create({
      nomenclatureId, roomId: roomId || null, storageId: storageId || null,
      minQty, maxQty: maxQty ?? null, autoRfq: Boolean(autoRfq),
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reorder-rules/:id', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  const row = await WhReorderRule.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Правило не найдено' });
  await row.destroy();
  res.json({ ok: true });
});

// ── Нормы расхода ────────────────────────────────────────────────────────────
router.get('/norms', authenticate, requireWarehouse('viewer'), async (req, res) => {
  const rows = await WhConsumptionNorm.findAll({
    include: [
      { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
      { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
  });
  res.json(rows);
});

router.post('/norms', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  try {
    const { nomenclatureId, departmentId, roomId, basis, normValue, comment } = req.body;
    if (!nomenclatureId || normValue === undefined) {
      return res.status(400).json({ error: 'Нужны номенклатура и значение нормы' });
    }
    const row = await WhConsumptionNorm.create({
      nomenclatureId, departmentId: departmentId || null, roomId: roomId || null,
      basis: basis || 'per_visit', normValue, comment: comment || null,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/norms/:id', authenticate, requireWarehouse('warehouse'), async (req, res) => {
  const row = await WhConsumptionNorm.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Норма не найдена' });
  await row.destroy();
  res.json({ ok: true });
});

module.exports = router;
