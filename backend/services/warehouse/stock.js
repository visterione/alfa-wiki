/**
 * Движение остатков.
 *
 * Единственное место, где меняется warehouse_stock. Прямые UPDATE из маршрутов
 * запрещены: остаток и журнал движений должны меняться одной транзакцией, иначе
 * при первом же сбое склад разойдётся с историей, и понять, где правда, будет
 * нельзя.
 *
 * Списание партий идёт по FEFO (first expired, first out), а не FIFO: в клинике
 * важен не порядок поступления, а срок годности — иначе на полке останется
 * партия, которую уже нельзя применить, и её придётся выбросить.
 */

const { Op } = require('sequelize');
const {
  sequelize, WhStock, WhBatch, WhMovement, WhDocument, WhNomenclature,
  WhStorage, WhRoom, WhAsset,
} = require('../../models');
const { generateDocumentNumber } = require('./numbering');

// Типы, увеличивающие остаток в точке «куда», и уменьшающие в точке «откуда».
const INCOMING = new Set(['receipt', 'surplus', 'repair_in']);
const OUTGOING = new Set(['issue', 'writeoff', 'repair_out']);

/**
 * Прибавляет (delta > 0) или убавляет (delta < 0) остаток в конкретном месте
 * хранения. Строка остатка создаётся при первом поступлении.
 */
async function adjustStock({ nomenclatureId, batchId, storageId, delta, unitCost, transaction }) {
  const where = { nomenclatureId, storageId, batchId: batchId || null };

  let row = await WhStock.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });

  if (!row) {
    if (delta < 0) {
      throw new Error('Списание с места хранения, где позиции нет на остатке');
    }
    return WhStock.create({
      nomenclatureId, batchId: batchId || null, storageId,
      quantity: delta,
      unitCost: unitCost || 0,
    }, { transaction });
  }

  const next = Number(row.quantity) + Number(delta);
  if (next < 0) {
    const nom = await WhNomenclature.findByPk(nomenclatureId, { transaction });
    throw new Error(
      `Недостаточно остатка: «${nom?.name || nomenclatureId}», есть ${row.quantity}, требуется ${Math.abs(delta)}`
    );
  }

  // Себестоимость пересчитываем средневзвешенной только при поступлении: при
  // расходе цена партии не меняется, а средняя по складу — не наше дело, её
  // считает бухгалтерия.
  const patch = { quantity: next };
  if (delta > 0 && unitCost) {
    const oldQty = Number(row.quantity);
    patch.unitCost = oldQty + Number(delta) === 0
      ? unitCost
      : (oldQty * Number(row.unitCost) + Number(delta) * Number(unitCost)) / (oldQty + Number(delta));
  }
  await row.update(patch, { transaction });
  return row;
}

/**
 * Подбор партий под расход по FEFO. Возвращает список {batchId, quantity,
 * unitCost}. Просроченные и заблокированные партии не берутся — их выдача
 * запрещена, и молча подставлять их нельзя.
 */
async function pickBatchesFefo({ nomenclatureId, storageId, quantity, transaction, allowExpired = false }) {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await WhStock.findAll({
    where: { nomenclatureId, storageId, quantity: { [Op.gt]: 0 } },
    include: [{ model: WhBatch, as: 'batch', required: false }],
    transaction,
  });

  const usable = rows.filter(r => {
    if (!r.batch) return true;                       // непартионный учёт
    if (r.batch.isBlocked) return false;
    if (!allowExpired && r.batch.expiryDate && r.batch.expiryDate < today) return false;
    return true;
  });

  // Сначала то, что истекает раньше. Партии без срока — в конец: их можно
  // держать сколько угодно, а вот срочные надо расходовать первыми.
  usable.sort((a, b) => {
    const ea = a.batch?.expiryDate || '9999-12-31';
    const eb = b.batch?.expiryDate || '9999-12-31';
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });

  const picks = [];
  let left = Number(quantity);
  for (const r of usable) {
    if (left <= 0) break;
    const take = Math.min(left, Number(r.quantity));
    picks.push({ batchId: r.batchId, quantity: take, unitCost: Number(r.unitCost) });
    left -= take;
  }

  if (left > 0) {
    const nom = await WhNomenclature.findByPk(nomenclatureId, { transaction });
    const total = usable.reduce((s, r) => s + Number(r.quantity), 0);
    throw new Error(
      `Недостаточно годного остатка: «${nom?.name}», доступно ${total}, требуется ${quantity}. ` +
      'Просроченные и заблокированные партии к выдаче не берутся'
    );
  }
  return picks;
}

/**
 * Создаёт документ вместе со строками и сразу проводит его.
 *
 * lines: [{ nomenclatureId | assetId, batchId?, quantity, unitCost?, fromStorageId?,
 *           toStorageId?, doctorUserId?, serviceCode?, reasonText? }]
 *
 * Документ и движения пишутся одной транзакцией: половина проведённого документа
 * хуже, чем непроведённый.
 */
async function createDocument({
  type, lines, user, comment, reasonCode, reasonText,
  contractorId, fromRoomId, toRoomId, device, sign = true, occurredAt,
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Документ без строк');
  }

  return sequelize.transaction(async (transaction) => {
    const number = await generateDocumentNumber({ type, transaction });

    const doc = await WhDocument.create({
      number, type,
      date: occurredAt ? new Date(occurredAt) : new Date(),
      status: sign ? 'signed' : 'draft',
      fromRoomId: fromRoomId || null,
      toRoomId: toRoomId || null,
      contractorId: contractorId || null,
      reasonCode: reasonCode || null,
      reasonText: reasonText || null,
      comment: comment || null,
      createdBy: user?.id || null,
      signedBy: sign ? (user?.id || null) : null,
      signedAt: sign ? new Date() : null,
      device: device || null,
      oneCStatus: 'disabled',
    }, { transaction });

    const created = [];

    for (const line of lines) {
      // ── Основное средство: количество всегда 1, меняется размещение и МОЛ ──
      if (line.assetId) {
        const asset = await WhAsset.findByPk(line.assetId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!asset) throw new Error('Актив не найден');

        const mv = await WhMovement.create({
          documentId: doc.id, type,
          assetId: asset.id,
          quantity: 1,
          unitCost: asset.initialCost,
          amount: asset.initialCost,
          fromRoomId: asset.roomId,
          fromStorageId: asset.storageId,
          toRoomId: line.toRoomId || toRoomId || null,
          toStorageId: line.toStorageId || null,
          fromResponsibleId: asset.responsibleUserId,
          toResponsibleId: line.toResponsibleId || null,
          reasonCode: line.reasonCode || reasonCode || null,
          reasonText: line.reasonText || reasonText || null,
          initiatorUserId: user?.id || null,
          occurredAt: doc.date,
        }, { transaction });
        created.push(mv);

        const patch = { lastActivityAt: new Date() };
        if (type === 'transfer') {
          patch.roomId = line.toRoomId || toRoomId || asset.roomId;
          patch.storageId = line.toStorageId || null;
          if (line.toResponsibleId) patch.responsibleUserId = line.toResponsibleId;
        } else if (type === 'repair_out') {
          patch.status = 'repair';
        } else if (type === 'repair_in') {
          patch.status = 'in_use';
        } else if (type === 'writeoff') {
          patch.status = 'written_off';
          patch.isArchived = true;
        }
        await asset.update(patch, { transaction });
        continue;
      }

      // ── Материалы ─────────────────────────────────────────────────────────
      if (!line.nomenclatureId) throw new Error('В строке нет ни актива, ни номенклатуры');
      const qty = Number(line.quantity);
      if (!(qty > 0)) throw new Error('Количество в строке должно быть больше нуля');

      const fromStorageId = line.fromStorageId || null;
      const toStorageId   = line.toStorageId || null;

      if (type === 'transfer') {
        if (!fromStorageId || !toStorageId) throw new Error('Перемещение требует и «откуда», и «куда»');
        const picks = line.batchId
          ? [{ batchId: line.batchId, quantity: qty, unitCost: line.unitCost || 0 }]
          : await pickBatchesFefo({ nomenclatureId: line.nomenclatureId, storageId: fromStorageId, quantity: qty, transaction });

        for (const p of picks) {
          await adjustStock({ ...p, nomenclatureId: line.nomenclatureId, storageId: fromStorageId, delta: -p.quantity, transaction });
          await adjustStock({ ...p, nomenclatureId: line.nomenclatureId, storageId: toStorageId,   delta:  p.quantity, transaction });
          created.push(await WhMovement.create({
            documentId: doc.id, type,
            nomenclatureId: line.nomenclatureId, batchId: p.batchId,
            quantity: p.quantity, unitCost: p.unitCost, amount: p.quantity * p.unitCost,
            fromStorageId, toStorageId,
            fromRoomId: await storageRoom(fromStorageId, transaction),
            toRoomId:   await storageRoom(toStorageId, transaction),
            reasonCode: line.reasonCode || reasonCode || null,
            reasonText: line.reasonText || reasonText || null,
            initiatorUserId: user?.id || null,
            occurredAt: doc.date,
          }, { transaction }));
        }
        continue;
      }

      if (INCOMING.has(type)) {
        if (!toStorageId) throw new Error('Поступление требует места хранения «куда»');
        await adjustStock({
          nomenclatureId: line.nomenclatureId, batchId: line.batchId, storageId: toStorageId,
          delta: qty, unitCost: line.unitCost || 0, transaction,
        });
        created.push(await WhMovement.create({
          documentId: doc.id, type,
          nomenclatureId: line.nomenclatureId, batchId: line.batchId || null,
          quantity: qty, unitCost: line.unitCost || 0, amount: qty * (line.unitCost || 0),
          toStorageId, toRoomId: await storageRoom(toStorageId, transaction),
          reasonCode: line.reasonCode || reasonCode || null,
          reasonText: line.reasonText || reasonText || null,
          initiatorUserId: user?.id || null,
          occurredAt: doc.date,
        }, { transaction }));
        continue;
      }

      if (OUTGOING.has(type)) {
        if (!fromStorageId) throw new Error('Расход требует места хранения «откуда»');
        // При списании просрочку разрешаем: её для этого и списывают.
        const picks = line.batchId
          ? [{ batchId: line.batchId, quantity: qty, unitCost: line.unitCost || 0 }]
          : await pickBatchesFefo({
              nomenclatureId: line.nomenclatureId, storageId: fromStorageId, quantity: qty,
              transaction, allowExpired: type === 'writeoff',
            });

        for (const p of picks) {
          await adjustStock({ ...p, nomenclatureId: line.nomenclatureId, storageId: fromStorageId, delta: -p.quantity, transaction });
          created.push(await WhMovement.create({
            documentId: doc.id, type,
            nomenclatureId: line.nomenclatureId, batchId: p.batchId,
            quantity: p.quantity, unitCost: p.unitCost, amount: p.quantity * p.unitCost,
            fromStorageId, fromRoomId: await storageRoom(fromStorageId, transaction),
            doctorUserId: line.doctorUserId || null,
            doctorMisId: line.doctorMisId || null,
            serviceCode: line.serviceCode || null,
            reasonCode: line.reasonCode || reasonCode || null,
            reasonText: line.reasonText || reasonText || null,
            initiatorUserId: user?.id || null,
            occurredAt: doc.date,
          }, { transaction }));
        }
        continue;
      }

      throw new Error(`Тип документа ${type} не поддерживает строки с материалами`);
    }

    return { document: doc, movements: created };
  });
}

const storageRoomCache = new Map();

async function storageRoom(storageId, transaction) {
  if (!storageId) return null;
  if (storageRoomCache.has(storageId)) return storageRoomCache.get(storageId);
  const s = await WhStorage.findByPk(storageId, { attributes: ['roomId'], transaction });
  const roomId = s?.roomId || null;
  storageRoomCache.set(storageId, roomId);
  return roomId;
}

/**
 * Контрольная сверка: остаток по warehouse_stock против суммы движений.
 * Расхождение означает, что кто-то трогал остатки в обход этого сервиса.
 */
async function reconcileStock() {
  const [rows] = await sequelize.query(`
    WITH from_moves AS (
      SELECT "nomenclatureId", "batchId", "fromStorageId" AS storage, -SUM(quantity) AS qty
      FROM warehouse_movements WHERE "fromStorageId" IS NOT NULL
      GROUP BY 1,2,3
    ), to_moves AS (
      SELECT "nomenclatureId", "batchId", "toStorageId" AS storage, SUM(quantity) AS qty
      FROM warehouse_movements WHERE "toStorageId" IS NOT NULL
      GROUP BY 1,2,3
    ), calc AS (
      SELECT "nomenclatureId", "batchId", storage, SUM(qty) AS qty
      FROM (SELECT * FROM from_moves UNION ALL SELECT * FROM to_moves) u
      GROUP BY 1,2,3
    )
    SELECT n.name, s.quantity AS stock_qty, COALESCE(c.qty, 0) AS calc_qty,
           s.quantity - COALESCE(c.qty, 0) AS diff
    FROM warehouse_stock s
    JOIN warehouse_nomenclature n ON n.id = s."nomenclatureId"
    LEFT JOIN calc c
      ON c."nomenclatureId" = s."nomenclatureId"
     AND c.storage = s."storageId"
     AND c."batchId" IS NOT DISTINCT FROM s."batchId"
    WHERE s.quantity - COALESCE(c.qty, 0) <> 0
  `);
  return rows;
}

module.exports = {
  adjustStock,
  pickBatchesFefo,
  createDocument,
  reconcileStock,
  INCOMING,
  OUTGOING,
};
