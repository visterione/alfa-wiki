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

// Пометка на документе и движениях уточнения партии. По ней ОСВ исключает пару
// из оборотов: количество не двигалось, двигалась только его принадлежность
// партии, и показывать это приходом и расходом значит выдумывать движение.
const BATCH_ATTACH = 'batch_attach';

// Типы, увеличивающие остаток в точке «куда», и уменьшающие в точке «откуда».
const INCOMING = new Set(['receipt', 'return', 'surplus', 'repair_in']);
const OUTGOING = new Set(['issue', 'writeoff', 'repair_out']);

/**
 * Нарушение бизнес-правила, а не сбой. Маршруты отдают такое четырёхсотым с
 * текстом наружу: раньше они отличали одно от другого регулярным выражением по
 * тексту ошибки, и каждая новая проверка молча становилась пятисотой, пока
 * кто-нибудь не вспоминал дописать в неё слово.
 */
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Количество и деньги приходят из формы строками — берём число и проверяем. */
function positiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw fail(`${label} должно быть больше нуля`);
  return n;
}

function nonNegativeNumber(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  // Отрицательная цена уезжает в стоимость кабинета и в суммовые отчёты со
  // знаком минус, и найти её там потом не за что: строка остатка выглядит
  // обычной, а итог по кабинету меньше, чем сумма его полок.
  if (!Number.isFinite(n) || n < 0) throw fail(`${label} не может быть отрицательной`);
  return n;
}

/**
 * Прибавляет (delta > 0) или убавляет (delta < 0) остаток в конкретном месте
 * хранения. Строка остатка создаётся при первом поступлении.
 */
async function adjustStock({ nomenclatureId, batchId, storageId, delta, unitCost, transaction }) {
  const where = { nomenclatureId, storageId, batchId: batchId || null };

  let row = await WhStock.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });

  if (!row) {
    if (delta < 0) {
      throw fail('Списание с места хранения, где позиции нет на остатке');
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
    throw fail(
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
 * Привязка партии к уже лежащему остатку: «на коробке написан срок годности».
 *
 * Обычно партия попадает на остаток при приходе. Но всё, что поставлено на учёт
 * по ведомости 1С, лежит без партии — сроков в файле нет
 * (services/warehouse/osvMaterialize.js), — и проставить срок было нечем: партия
 * из справочника к лежащей строке не цепляется, а приход по новой партии рисует
 * вторую строку рядом с первой.
 *
 * Количество при этом не меняется — меняется только то, к какой партии остаток
 * отнесён. Но в журнал это всё равно пишется парой движений: расход из «без
 * партии» и приход в партию, оба в том же месте хранения. Без них контрольная
 * сверка (reconcileStock) увидит остаток, которого нет в журнале, и объявит, что
 * склад правили в обход модуля, — то есть соврёт. Пара сходится в ноль по
 * каждому месту хранения, поэтому на сальдо она не влияет, а из оборотов ОСВ
 * исключается по reasonCode.
 */
async function attachBatchToStock({ stockId, batchNumber, expiryDate, user, scopedRoomIds = null }, options = {}) {
  const run = async (transaction) => {
    const stock = await WhStock.findByPk(stockId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!stock) throw fail('Строка остатка не найдена', 404);

    const storage = await WhStorage.findByPk(stock.storageId, { transaction });
    if (scopedRoomIds !== null && !scopedRoomIds.includes(storage?.roomId)) {
      throw fail('Кабинет не в вашей зоне ответственности', 403);
    }

    // Номера серии на упаковке может не быть — бывает одна дата. Пустым номер
    // оставить нельзя (он обязателен и уникален в паре с номенклатурой), поэтому
    // собираем его из самой даты: одинаковый у всех коробок с тем же сроком, и
    // на экране читается как есть.
    const number = String(batchNumber || '').trim() || `б/н до ${ruDate(expiryDate)}`;

    const [batch, isNew] = await WhBatch.findOrCreate({
      where: { nomenclatureId: stock.nomenclatureId, batchNumber: number },
      defaults: { expiryDate: expiryDate || null, unitCost: stock.unitCost },
      transaction,
    });
    if (!isNew && expiryDate && String(batch.expiryDate) !== String(expiryDate)) {
      await batch.update({ expiryDate }, { transaction });
    }

    // Раз у позиции появился срок годности, дальше она учитывается по партиям:
    // иначе следующий приход снова ляжет строкой без партии, и FEFO обойдёт
    // коробку с ближайшим сроком.
    await WhNomenclature.update(
      { tracksBatch: true },
      { where: { id: stock.nomenclatureId }, transaction },
    );

    const qty = Number(stock.quantity);
    if (stock.batchId === batch.id || qty <= 0) {
      // Партия та же (правили только дату) либо остаток нулевой — двигать нечего.
      if (stock.batchId !== batch.id) await stock.update({ batchId: batch.id }, { transaction });
      return { batch, moved: 0 };
    }

    const unitCost = Number(stock.unitCost);
    const from = { nomenclatureId: stock.nomenclatureId, storageId: stock.storageId, transaction };

    // Через adjustStock, а не UPDATE по строке: если такая партия уже лежит в
    // этом месте хранения отдельной строкой, две строки обязаны слиться — второй
    // их не пустит частичный уникальный индекс warehouse_stock_key_batch.
    await adjustStock({ ...from, batchId: stock.batchId, delta: -qty, transaction });
    await adjustStock({ ...from, batchId: batch.id, delta: qty, unitCost, transaction });

    const doc = await WhDocument.create({
      number: await generateDocumentNumber({ type: 'transfer', transaction }),
      type: 'transfer',
      date: new Date(),
      status: 'signed',
      fromRoomId: storage?.roomId || null,
      toRoomId: storage?.roomId || null,
      reasonCode: BATCH_ATTACH,
      reasonText: `Уточнение партии и срока годности: ${number}`,
      createdBy: user?.id || null,
      signedBy: user?.id || null,
      signedAt: new Date(),
      oneCStatus: 'disabled',
    }, { transaction });

    // Два движения, а не одно с «откуда» и «куда»: движение несёт одну партию, а
    // смысл операции ровно в том, что партия у количества меняется.
    const common = {
      documentId: doc.id, type: 'transfer',
      nomenclatureId: stock.nomenclatureId,
      quantity: qty, unitCost, amount: qty * unitCost,
      reasonCode: BATCH_ATTACH,
      reasonText: doc.reasonText,
      initiatorUserId: user?.id || null,
      occurredAt: doc.date,
    };
    await WhMovement.create({
      ...common, batchId: stock.batchId || null,
      fromStorageId: stock.storageId, fromRoomId: storage?.roomId || null,
    }, { transaction });
    await WhMovement.create({
      ...common, batchId: batch.id,
      toStorageId: stock.storageId, toRoomId: storage?.roomId || null,
    }, { transaction });

    return { batch, moved: qty };
  };

  return options.transaction ? run(options.transaction) : sequelize.transaction(run);
}

const ruDate = (iso) => {
  const [year, month, day] = String(iso || '').split('-');
  return day ? `${day}.${month}.${year}` : 'без срока';
};

/**
 * Подбор партий под расход по FEFO. Возвращает список {batchId, quantity,
 * unitCost}. Просроченные и заблокированные партии не берутся — их выдача
 * запрещена, и молча подставлять их нельзя.
 *
 * ── Что значит batchId ───────────────────────────────────────────────────────
 *
 * В форме операции пустая партия означает «подбери сам», и обходить ради этого
 * FEFO нельзя. Но есть второй случай, где пусто значит буквально пусто: строка
 * остатка БЕЗ партии — та, что легла по ведомости 1С без срока годности. Её
 * пересчитывает инвентаризация, и списывать по ней надо ровно её.
 *
 * Раньше эти два случая не различались, и оба читались как «любая партия».
 * Недостача, найденная на непартионной строке, уходила по FEFO в коробку с
 * ближайшим сроком: партия обнулялась, а фантом на непартионной строке
 * оставался. Поэтому решение вынесено отдельным флагом, а не выведено из
 * значения:
 *
 *   exactBatch = false — batchId это подсказка: пусто «подбери», иначе «эта»;
 *   exactBatch = true  — batchId это адрес строки остатка, включая «без партии».
 */
async function pickBatchesFefo({
  nomenclatureId, storageId, quantity, transaction, allowExpired = false,
  batchId = null, exactBatch = false,
}) {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await WhStock.findAll({
    where: {
      nomenclatureId, storageId, quantity: { [Op.gt]: 0 },
      ...(exactBatch ? { batchId: batchId || null } : (batchId ? { batchId } : {})),
    },
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
    throw fail(
      `Недостаточно годного остатка: «${nom?.name}», доступно ${total}, требуется ${quantity}. ` +
      'Просроченные и заблокированные партии к выдаче не берутся'
    );
  }
  return picks;
}

/**
 * Создаёт документ вместе со строками и сразу проводит его.
 *
 * lines: [{ nomenclatureId | assetId, batchId?, exactBatch?, quantity, unitCost?,
 *           fromStorageId?, toStorageId?, doctorUserId?, serviceCode?, reasonText? }]
 *
 * Документ и движения пишутся одной транзакцией: половина проведённого документа
 * хуже, чем непроведённый.
 *
 * Черновиков здесь нет. Раньше параметр sign управлял только полем status, а
 * остатки двигались в любом случае — то есть документ, помеченный в журнале
 * «черновик», склад уже изменил, и ни провести, ни отменить его было нечем.
 * Отложенное проведение — это отдельный механизм с хранением строк до подписи,
 * а не флаг; пока его нет, документ всегда проведён.
 */
async function createDocument({
  type, lines, user, comment, reasonCode, reasonText,
  contractorId, fromRoomId, toRoomId, device, occurredAt,
}, options = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw fail('Документ без строк');
  }

  // Дата задним числом законна — документ оформляют не в ту же секунду, — а
  // будущим числом нет: остаток меняется сейчас, и движение, датированное
  // следующим месяцем, выпадает из отчёта за текущий, оставив расхождение между
  // складом и журналом там, где его никто не ищет.
  //
  // Запас в сутки, а не в минуту: поле datetime-local часового пояса не несёт, и
  // строка «2026-08-20T14:30» разбирается здесь как местное время сервера. Пока
  // сервер и браузер в одном поясе, разницы нет, но закладываться на это ради
  // проверки, которая ловит документы, датированные следующим месяцем, незачем.
  const date = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(date.getTime())) throw fail('Неверная дата документа');
  if (date.getTime() > Date.now() + 24 * 3600 * 1000) {
    throw fail('Дата документа не может быть в будущем');
  }

  const run = async (transaction) => {
    const number = await generateDocumentNumber({ type, transaction });

    const doc = await WhDocument.create({
      number, type,
      date,
      status: 'signed',
      fromRoomId: fromRoomId || null,
      toRoomId: toRoomId || null,
      contractorId: contractorId || null,
      reasonCode: reasonCode || null,
      reasonText: reasonText || null,
      comment: comment || null,
      createdBy: user?.id || null,
      signedBy: user?.id || null,
      signedAt: new Date(),
      device: device || null,
      oneCStatus: 'disabled',
    }, { transaction });

    const created = [];

    for (const line of lines) {
      // ── Основное средство: количество всегда 1, меняется размещение и МОЛ ──
      if (line.assetId) {
        const asset = await WhAsset.findByPk(line.assetId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!asset) throw fail('Актив не найден');

        // Списанный актив выведен из оборота, и это не «состояние, из которого
        // можно продолжить»: раньше по нему проходило второе списание — на ту же
        // стоимость вторым движением, — перемещение и возврат из ремонта, в
        // который его не отдавали.
        const label = `«${asset.inventoryNumber || asset.name}»`;
        if (asset.isArchived || asset.status === 'written_off') {
          throw fail(`Актив ${label} списан — операции с ним больше не проводятся`);
        }
        if (type === 'repair_in' && asset.status !== 'repair') {
          throw fail(`Актив ${label} не числится в ремонте — возвращать из ремонта нечего`);
        }
        if (type === 'repair_out' && asset.status === 'repair') {
          throw fail(`Актив ${label} уже в ремонте`);
        }

        if (type === 'transfer') {
          const targetRoomId = line.toRoomId || toRoomId;
          if (!targetRoomId || !line.toStorageId) {
            throw fail('Перемещение оборудования требует кабинет и место хранения назначения');
          }
          const targetStorage = await WhStorage.findByPk(line.toStorageId, { transaction });
          if (!targetStorage || targetStorage.roomId !== targetRoomId) {
            throw fail('Место хранения назначения не относится к выбранному кабинету');
          }
          // Перемещение туда, где актив и стоит, — это пустая запись в ленте его
          // жизни. Смена одного только МОЛ на месте — законный случай и остаётся
          // разрешённой: переезжает ответственность, а не вещь.
          const samePlace = asset.roomId === targetRoomId && asset.storageId === line.toStorageId;
          const sameResponsible = !line.toResponsibleId
            || line.toResponsibleId === asset.responsibleUserId;
          if (samePlace && sameResponsible) {
            throw fail(`Актив ${label} уже стоит в этом месте, и МОЛ не меняется`);
          }
        }

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
          patch.roomId = line.toRoomId || toRoomId;
          patch.storageId = line.toStorageId;
          if (line.toResponsibleId) patch.responsibleUserId = line.toResponsibleId;
        } else if (type === 'repair_out' || type === 'repair_in') {
          patch.status = type === 'repair_out' ? 'repair' : 'in_use';
          /**
           * Ремонт не только меняет статус, но и увозит вещь (ver. 7.47).
           *
           * До этого прибор в ремонте продолжал числиться в своём кабинете:
           * МОЛ отвечал за то, чего у него нет, а в описи кабинета он выходил
           * недостачей. Теперь уход в ремонт перемещает актив в склад «Ремонт»
           * своего медцентра, а возврат — обратно в кабинет, откуда забрали;
           * куда именно, знает движение (services/warehouse/servicePlaces.js).
           *
           * Кабинет назначения необязателен: тем же типом операции пользуются
           * старые формы, где ремонт был только статусом. Без него поведение
           * прежнее — статус меняется, вещь остаётся на месте.
           */
          const repairRoomId = line.toRoomId || toRoomId;
          if (repairRoomId) {
            patch.roomId = repairRoomId;
            if (line.toStorageId) patch.storageId = line.toStorageId;
          }
        } else if (type === 'writeoff') {
          patch.status = 'written_off';
          patch.isArchived = true;
        }
        await asset.update(patch, { transaction });
        continue;
      }

      // ── Материалы ─────────────────────────────────────────────────────────
      if (!line.nomenclatureId) throw fail('В строке нет ни актива, ни номенклатуры');
      const qty = positiveNumber(line.quantity, 'Количество в строке');
      const lineCost = nonNegativeNumber(line.unitCost, 'Цена в строке');
      const exactBatch = Boolean(line.exactBatch);

      const fromStorageId = line.fromStorageId || null;
      const toStorageId   = line.toStorageId || null;

      if (type === 'transfer') {
        if (!fromStorageId || !toStorageId) throw fail('Перемещение требует и «откуда», и «куда»');
        // Из полки в неё же: остаток не меняется, а в оборотах появляется пара
        // «приход и расход» на всё количество — сверка сходится, а обороты врут.
        if (fromStorageId === toStorageId) {
          throw fail('Перемещение в то же место хранения ничего не меняет');
        }
        const picks = await pickBatchesFefo({
          nomenclatureId: line.nomenclatureId, storageId: fromStorageId,
          quantity: qty, transaction, batchId: line.batchId || null, exactBatch,
        });

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
        if (!toStorageId) throw fail('Поступление требует места хранения «куда»');
        await adjustStock({
          nomenclatureId: line.nomenclatureId, batchId: line.batchId, storageId: toStorageId,
          delta: qty, unitCost: lineCost, transaction,
        });
        created.push(await WhMovement.create({
          documentId: doc.id, type,
          nomenclatureId: line.nomenclatureId, batchId: line.batchId || null,
          quantity: qty, unitCost: lineCost, amount: qty * lineCost,
          toStorageId, toRoomId: await storageRoom(toStorageId, transaction),
          reasonCode: line.reasonCode || reasonCode || null,
          reasonText: line.reasonText || reasonText || null,
          initiatorUserId: user?.id || null,
          occurredAt: doc.date,
        }, { transaction }));
        continue;
      }

      if (OUTGOING.has(type)) {
        if (!fromStorageId) throw fail('Расход требует места хранения «откуда»');
        // При списании просрочку разрешаем: её для этого и списывают.
        const picks = await pickBatchesFefo({
          nomenclatureId: line.nomenclatureId, storageId: fromStorageId, quantity: qty,
          transaction, allowExpired: type === 'writeoff',
          batchId: line.batchId || null, exactBatch,
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

      throw fail(`Тип документа ${type} не поддерживает строки с материалами`);
    }

    return { document: doc, movements: created };
  };
  return options.transaction ? run(options.transaction) : sequelize.transaction(run);
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
  attachBatchToStock,
  BATCH_ATTACH,
  pickBatchesFefo,
  createDocument,
  reconcileStock,
  INCOMING,
  OUTGOING,
};
