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
const { reconcileStock, attachBatchToStock } = require('../../services/warehouse/stock');
const { assertNotCounting } = require('../../services/warehouse/inventory');
const { searchWhere } = require('../../services/warehouse/search');

/**
 * Потолок списка остатков.
 *
 * Список читают глазами и фильтруют — выгружают его отчётом, а не этой ручкой,
 * поэтому потолок остаётся. Важно другое: он применяется к найденному, а не к
 * тому, среди чего ищут (см. поиск ниже), и о том, что упёрлись, экран говорит
 * вслух.
 */
const STOCK_LIMIT = 2000;

// ── Категории ────────────────────────────────────────────────────────────────
router.get('/categories', authenticate, requireWarehouse(), async (req, res) => {
  const rows = await WhCategory.findAll({ order: [['kind', 'ASC'], ['sortOrder', 'ASC'], ['name', 'ASC']] });
  res.json(rows);
});

router.post('/categories', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
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
router.get('/contractors', authenticate, requireWarehouse(), async (req, res) => {
  const { kind, q } = req.query;
  const where = { isActive: true };
  if (kind) where.kind = { [Op.in]: [kind, 'both'] };
  if (q) where.name = { [Op.iLike]: `%${q}%` };
  const rows = await WhContractor.findAll({ where, order: [['name', 'ASC']] });
  res.json(rows);
});

router.post('/contractors', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
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

router.put('/contractors/:id', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
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
router.get('/nomenclature', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { q, categoryId, isMedicine, page = 1, limit = 100 } = req.query;
    const where = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (isMedicine === 'true') where.isMedicine = true;
    const found = searchWhere(q, ['WhNomenclature.name', 'WhNomenclature.code']);
    if (found) Object.assign(where, found);
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

router.post('/nomenclature', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const b = req.body;
    if (!b.name?.trim()) return res.status(400).json({ error: 'Нужно наименование' });

    // Код можно не задавать (ver. 7.25). Он нужен справочнику для сверки с
    // бухгалтерией, но человеку, заводящему позицию стоя в кабинете, придумать
    // его неоткуда: разбор ведомости и тот выводит код из строки 1С. Поэтому
    // при пустом коде выдаём свой — того же вида, что у позиций из ведомости,
    // только с другой приставкой, чтобы происхождение было видно.
    const code = b.code?.trim()
      || `Н-${Date.now().toString(36).toUpperCase().slice(-6)}${
        Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;

    const row = await WhNomenclature.create({
      code, name: b.name.trim(), categoryId: b.categoryId || null,
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

router.put('/nomenclature/:id', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
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
router.get('/batches', authenticate, requireWarehouse(), async (req, res) => {
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

router.post('/batches', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
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
router.patch('/batches/:id/block', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  const row = await WhBatch.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Партия не найдена' });
  await row.update({
    isBlocked: req.body.isBlocked !== false,
    blockReason: req.body.reason || null,
  });
  res.json(row);
});

// ── Остатки ──────────────────────────────────────────────────────────────────
router.get('/stock', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { roomId, storageId, nomenclatureId, belowMinimum, includeZero, q } = req.query;

    const scoped = await req.warehouse.scopedRoomIds();
    const roomFilter = [];
    if (roomId) roomFilter.push(roomId);
    if (scoped !== null) roomFilter.push(...scoped);

    const where = {};
    if (nomenclatureId) where.nomenclatureId = nomenclatureId;
    if (storageId) where.storageId = storageId;
    if (includeZero !== 'true') where.quantity = { [Op.gt]: 0 };

    /**
     * Поиск считает база, а не экран (ver. 7.49).
     *
     * Раньше сюда приходили первые две тысячи строк остатка, а искал по ним
     * фильтр на клиенте. На реальной базе строк больше, и человек, набравший
     * «компьютер», видел только те совпадения, что попали в загруженный кусок:
     * позиции пропадали без всякой причины — ни опечатки, ни фильтра.
     *
     * Ограничение осталось (список читают глазами, а не выгружают), но теперь
     * оно применяется к НАЙДЕННОМУ, а не к тому, среди чего ищут.
     */
    const found = searchWhere(q, ['nomenclature.name', 'nomenclature.code']);

    const rows = await WhStock.findAll({
      where,
      include: [
        {
          model: WhNomenclature, as: 'nomenclature',
          attributes: ['id', 'code', 'name', 'unit', 'packUnit', 'isMedicine', 'isSterile'],
          required: Boolean(found),
          where: found || undefined,
        },
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
      limit: STOCK_LIMIT,
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
      // Список упёрся в потолок — значит показано не всё. Молчать об этом
      // нельзя: именно так и выглядела пропажа позиций из поиска.
      truncated: rows.length >= STOCK_LIMIT,
      limit: STOCK_LIMIT,
      items,
    });
  } catch (err) {
    console.error('GET warehouse/stock error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Срок годности на уже лежащем остатке.
 *
 * Партия в модуле привязывается к остатку в момент прихода, и для всего, что
 * приехало из ОСВ 1С, срока годности не существует: в файле его нет, позиции
 * создаются без партий (services/warehouse/osvMaterialize.js). Проставить его
 * потом было нечем — завести партию в справочнике мало, она не цепляется к
 * лежащей строке остатка, а приход по новой партии рисует вторую строку рядом с
 * первой. Отсюда эта ручка: она правит привязку существующей строки, не трогая
 * количество.
 *
 * Партия ищется по номеру, а не создаётся всегда новой: одна и та же серия
 * приходит в несколько кабинетов, и плодить по партии на кабинет значит потерять
 * возможность заблокировать её разом при отзыве производителем.
 */
router.patch('/stock/:id/batch', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const expiryDate = req.body.expiryDate || null;
    const batchNumber = String(req.body.batchNumber || '').trim();
    if (!expiryDate && !batchNumber) {
      return res.status(400).json({ error: 'Нужен срок годности или номер серии' });
    }

    // Привязка партии переносит количество между строками остатка — для открытой
    // описи это движение под руками у комиссии, ровно то, от чего её защищает
    // заморозка кабинета (services/warehouse/inventory.js).
    const stock = await WhStock.findByPk(req.params.id, { attributes: ['id', 'storageId'] });
    if (!stock) return res.status(404).json({ error: 'Строка остатка не найдена' });
    const storage = await WhStorage.findByPk(stock.storageId, { attributes: ['roomId'] });
    await assertNotCounting([storage?.roomId]);

    const result = await attachBatchToStock({
      stockId: req.params.id,
      expiryDate, batchNumber,
      user: req.user,
      scopedRoomIds: await req.warehouse.scopedRoomIds(),
    });
    res.json({ batch: result.batch, moved: result.moved });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH warehouse/stock/:id/batch error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Контрольная сверка остатков с журналом движений. Ручной запуск: расхождение
 * означает, что остатки правили в обход сервиса, и это надо увидеть, а не
 * прятать в ночном логе.
 */
router.get('/stock/reconcile', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const diffs = await reconcileStock();
    res.json({ ok: diffs.length === 0, discrepancies: diffs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Минимальные остатки ──────────────────────────────────────────────────────
router.get('/reorder-rules', authenticate, requireWarehouse(), async (req, res) => {
  const rows = await WhReorderRule.findAll({
    include: [
      { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name', 'isService'] },
      { model: WhStorage, as: 'storage', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
  });
  res.json(rows);
});

/**
 * Минимум по одной позиции. Правила те же, что и у массовой постановки ниже, и
 * разойтись им нельзя: пачка дедуплицировала пару «позиция + место» и проверяла
 * значения, а поштучная ручка не делала ни того, ни другого — через неё
 * появлялись вторые минимумы на ту же позицию, и дефицит считался по тому из
 * них, который нашёлся первым.
 */
router.post('/reorder-rules', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const { nomenclatureId, roomId, storageId, minQty, maxQty, autoRfq } = req.body;
    if (!nomenclatureId || minQty === undefined) {
      return res.status(400).json({ error: 'Нужны номенклатура и минимум' });
    }
    const bad = checkReorderQty(minQty, maxQty);
    if (bad) return res.status(400).json({ error: bad });

    const where = { nomenclatureId, roomId: roomId || null, storageId: storageId || null };
    const patch = { minQty, maxQty: maxQty ?? null, autoRfq: Boolean(autoRfq) };

    const existing = await WhReorderRule.findOne({ where });
    if (existing) {
      await existing.update(patch);
      return res.json(existing);
    }
    const row = await WhReorderRule.create({ ...where, ...patch });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST warehouse/catalog/reorder-rules error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Минимум и максимум запаса. Максимум ниже минимума — правило, которое нельзя
 * выполнить: остаток обязан быть одновременно и не меньше первого, и не больше
 * второго.
 */
function checkReorderQty(minQty, maxQty) {
  const min = Number(minQty);
  if (!Number.isFinite(min) || min < 0) return 'Минимальный остаток не может быть отрицательным';
  if (maxQty === undefined || maxQty === null || maxQty === '') return null;
  const max = Number(maxQty);
  if (!Number.isFinite(max) || max < 0) return 'Максимальный остаток не может быть отрицательным';
  if (max < min) return `Максимальный остаток ${max} меньше минимального ${min}`;
  return null;
}

/**
 * Минимумы пачкой: одно значение сразу на набор позиций.
 *
 * Позиций номенклатуры 1785, и заводить правило на каждую через модалку — работа
 * на неделю, которую никто не сделает. Между тем минимум по своей природе
 * задаётся не позиции, а классу вещей: «перчаток всегда держим коробку»,
 * «шприцев — две». Поэтому здесь принимается либо явный список позиций, либо
 * категория целиком.
 *
 * Повторное правило на ту же пару «позиция + место» не создаётся вторым, а
 * обновляется: два минимума на одну позицию означали бы, что дефицит считается
 * по тому из них, который нашёлся первым.
 */
router.post('/reorder-rules/bulk', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const {
      nomenclatureIds = null, categoryId = null,
      roomId = null, storageId = null,
      minQty, maxQty = null, autoRfq = false,
      skipExisting = false,
    } = req.body || {};

    if (minQty === undefined || minQty === null) {
      return res.status(400).json({ error: 'Нужен минимальный остаток' });
    }
    const badQty = checkReorderQty(minQty, maxQty);
    if (badQty) return res.status(400).json({ error: badQty });
    if (!categoryId && (!Array.isArray(nomenclatureIds) || !nomenclatureIds.length)) {
      return res.status(400).json({ error: 'Выберите позиции или категорию' });
    }

    const where = { isActive: true };
    if (Array.isArray(nomenclatureIds) && nomenclatureIds.length) {
      where.id = { [Op.in]: nomenclatureIds };
    } else {
      where.categoryId = categoryId;
    }
    const positions = await WhNomenclature.findAll({ where, attributes: ['id'] });
    if (!positions.length) {
      return res.status(400).json({ error: 'По этому условию не нашлось ни одной позиции' });
    }

    const ids = positions.map(p => p.id);
    const existing = await WhReorderRule.findAll({
      where: {
        nomenclatureId: { [Op.in]: ids },
        roomId: roomId || null,
        storageId: storageId || null,
      },
    });
    const byNomenclature = new Map(existing.map(r => [r.nomenclatureId, r]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    await sequelize.transaction(async (t) => {
      for (const id of ids) {
        const current = byNomenclature.get(id);
        if (current) {
          // «Не трогать уже настроенные» — для случая, когда пачкой закрывают
          // хвост, а точечно выставленные минимумы должны остаться как есть.
          if (skipExisting) { skipped += 1; continue; }
          await current.update({
            minQty, maxQty: maxQty ?? null, autoRfq: Boolean(autoRfq),
          }, { transaction: t });
          updated += 1;
        } else {
          await WhReorderRule.create({
            nomenclatureId: id,
            roomId: roomId || null,
            storageId: storageId || null,
            minQty,
            maxQty: maxQty ?? null,
            autoRfq: Boolean(autoRfq),
          }, { transaction: t });
          created += 1;
        }
      }
    });

    res.json({ created, updated, skipped, total: ids.length });
  } catch (err) {
    console.error('POST warehouse/catalog/reorder-rules/bulk error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reorder-rules/:id', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  const row = await WhReorderRule.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Правило не найдено' });
  await row.destroy();
  res.json({ ok: true });
});

// ── Нормы расхода ────────────────────────────────────────────────────────────
router.get('/norms', authenticate, requireWarehouse(), async (req, res) => {
  const rows = await WhConsumptionNorm.findAll({
    include: [
      { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
      { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
      { model: WhRoom, as: 'room', attributes: ['id', 'number', 'name', 'isService'] },
    ],
    order: [['createdAt', 'DESC']],
  });
  res.json(rows);
});

router.post('/norms', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
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

router.delete('/norms/:id', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  const row = await WhConsumptionNorm.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Норма не найдена' });
  await row.destroy();
  res.json({ ok: true });
});

module.exports = router;
