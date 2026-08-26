/**
 * Сторно: отмена проведённой операции встречным документом.
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * Промахнуться кабинетом на телефоне легко, и до ver. 7.50 исправление стоило
 * дороже самой ошибки: надо было уйти во вкладку «Операции», собрать встречный
 * документ из четырёх полей, снова найти кабинет в списке из сотни — и всё это
 * без всякой связи с тем, что исправляют. Админский откат размещения к делу не
 * подходил: он стирает след и работает по кабинету целиком.
 *
 * ── Почему сторно, а не удаление ─────────────────────────────────────────────
 *
 * Удалённая проводка уносит из истории и саму ошибку, и то, что её исправили.
 * Отчёт № 2 — аудиторский, и в нём обе записи обязаны быть видны: «увезли не
 * туда» и «вернули». Поэтому отмена это обычный документ со ссылкой на
 * исходный, и остаток он двигает теми же правилами, что и любой другой.
 *
 * ── Что отменяется, а что нет ────────────────────────────────────────────────
 *
 * Отменяются перемещения между местами: перемещение, выдача, возврат, уход в
 * ремонт и возврат из него. Это ровно те операции, которые делают руками у
 * прибора и в которых промахиваются.
 *
 * Приход, списание и оприходование излишков кнопкой не отменяются намеренно.
 * Приход — это появление имущества на балансе, списание — выбытие с него, и
 * решение о них принимает не тот, кто нажал кнопку: за ними стоит накладная,
 * акт или решение комиссии. Отменять их надо тем же порядком, каким завели, —
 * документом с основанием, а не встречной кнопкой.
 *
 * ── Когда отменить уже нельзя ────────────────────────────────────────────────
 *
 * Когда после операции с тем же имуществом что-то произошло. Сторно возвращает
 * вещь туда, откуда её взяли, и если она успела уехать дальше, возврат опишет
 * маршрут, которого не было. Поэтому проверяется, что документ — последнее, что
 * случилось с каждым его активом, а материала на месте назначения хватает.
 */

const {
  WhDocument, WhMovement, WhAsset, WhStock, WhStorage,
} = require('../../models');
const { createDocument } = require('./stock');
const { assertNotCounting } = require('./inventory');

/** Нарушение правила, а не сбой: маршрут отдаёт такое со своим статусом. */
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

/**
 * Чем отменяется операция каждого типа.
 *
 * Возврат из ремонта отменяется уходом в ремонт и наоборот: статус актива при
 * этом возвращается сам, потому что его меняет тип движения (stock.js).
 */
const MIRROR = {
  transfer: 'transfer',
  issue: 'return',
  return: 'issue',
  repair_out: 'repair_in',
  repair_in: 'repair_out',
};

/**
 * Куда движение кладёт материал. Отменяющая операция зеркальна по направлению,
 * и собирать строку надо по нему, а не по названию типа: у прихода назначение
 * это «куда», у расхода — «откуда», и перепутать их значит списать вместо того,
 * чтобы вернуть.
 */
const INCOMING = new Set(['receipt', 'return', 'surplus', 'repair_in']);

const NOT_REVERSIBLE = {
  receipt: 'Приход отменяется документом с основанием, а не кнопкой: имущество появилось на балансе',
  writeoff: 'Списание отменяется решением комиссии, а не кнопкой',
  surplus: 'Оприходование излишков оформляется по описи — отменяется тем же порядком',
};

/**
 * Строки встречного документа из движений исходного.
 *
 * Собираются из движений, а не из того, что прислал клиент: движение — это
 * факт, а форма отправки могла быть какой угодно, в том числе сокращённой
 * кнопкой быстрого переезда.
 */
function mirrorLines(movements, type) {
  return movements.map((mv) => {
    if (mv.assetId) {
      // Актив едет обратно ровно туда, откуда его взяли, вместе с прежним МОЛ.
      return {
        assetId: mv.assetId,
        toRoomId: mv.fromRoomId,
        toStorageId: mv.fromStorageId,
        toResponsibleId: mv.fromResponsibleId,
      };
    }
    const line = {
      nomenclatureId: mv.nomenclatureId,
      batchId: mv.batchId || null,
      // Партия та же самая, а не подобранная по FEFO: сторно возвращает ровно
      // ту коробку, которую тронули, — иначе на полке останется фантом.
      exactBatch: true,
      quantity: Number(mv.quantity),
      unitCost: Number(mv.unitCost) || 0,
    };
    if (type === 'transfer') {
      return { ...line, fromStorageId: mv.toStorageId, toStorageId: mv.fromStorageId };
    }
    // Отменяющий приход кладёт обратно на ту полку, с которой взяли; отменяющий
    // расход снимает с той, куда положили.
    if (INCOMING.has(type)) return { ...line, toStorageId: mv.fromStorageId };
    return { ...line, fromStorageId: mv.toStorageId };
  });
}

/**
 * Можно ли отменить документ прямо сейчас. Возвращает причину отказа или null.
 *
 * @param {object} document документ с подгруженными movements
 */
async function reversalBlocker(document, options = {}) {
  const { transaction } = options;

  if (document.reversalOfId) return 'Это уже сторно — отменять отмену не нужно';
  if (NOT_REVERSIBLE[document.type]) return NOT_REVERSIBLE[document.type];
  if (!MIRROR[document.type]) return 'Операции этого вида не отменяются';

  // Проведённое по описи трогать нельзя: расхождения оформляет комиссия, и
  // встречная проводка поверх них рассыпает саму опись.
  if (document.reasonCode === 'inventory') {
    return 'Расхождения по инвентаризации отменяются только пересчётом';
  }

  const already = await WhDocument.findOne({
    where: { reversalOfId: document.id },
    attributes: ['id', 'number'],
    transaction,
  });
  if (already) return `Документ уже отменён — сторно ${already.number}`;

  const movements = document.movements || [];
  if (!movements.length) return 'В документе нет движений';

  for (const mv of movements) {
    if (mv.assetId) {
      // Последнее, что случилось с активом, должно быть этим документом: если
      // он успел уехать дальше, возврат описал бы маршрут, которого не было.
      const last = await WhMovement.findOne({
        where: { assetId: mv.assetId },
        order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']],
        attributes: ['id', 'documentId'],
        transaction,
      });
      if (last && last.documentId !== document.id) {
        const asset = await WhAsset.findByPk(mv.assetId, {
          attributes: ['inventoryNumber'], transaction,
        });
        return `С активом ${asset?.inventoryNumber || ''} уже была операция после этой — `
          + 'отменять надо её, а не эту';
      }
      continue;
    }

    /**
     * Материал. Проверять есть что только тогда, когда сторно будет СНИМАТЬ:
     * то есть когда исходная операция клала (приход, возврат, перемещение).
     * Отмена выдачи, наоборот, возвращает на полку — там мешать нечему.
     */
    const takesAway = document.type === 'transfer' || INCOMING.has(document.type);
    if (!takesAway || !mv.toStorageId) continue;

    const stock = await WhStock.findOne({
      where: {
        nomenclatureId: mv.nomenclatureId,
        storageId: mv.toStorageId,
        batchId: mv.batchId || null,
      },
      attributes: ['quantity'],
      transaction,
    });
    if (Number(stock?.quantity || 0) + 0.0005 < Number(mv.quantity)) {
      return 'Материал уже израсходован или уехал дальше — отменить операцию нельзя';
    }
  }

  return null;
}

/**
 * Провести сторно. Проверки те же, что у любой операции: зона ответственности
 * считается маршрутом, заморозка кабинета — здесь.
 */
async function reverseDocument({ document, user, device }, options = {}) {
  const { transaction } = options;

  const blocker = await reversalBlocker(document, { transaction });
  if (blocker) throw fail(blocker);

  const type = MIRROR[document.type];
  const movements = document.movements || [];

  // Кабинеты обоих концов: сторно двигает остаток так же, как исходная
  // операция, и пересчёт запрещает его ровно так же.
  const roomIds = new Set();
  for (const mv of movements) {
    if (mv.fromRoomId) roomIds.add(mv.fromRoomId);
    if (mv.toRoomId) roomIds.add(mv.toRoomId);
    for (const id of [mv.fromStorageId, mv.toStorageId].filter(Boolean)) {
      const storage = await WhStorage.findByPk(id, { attributes: ['roomId'], transaction });
      if (storage?.roomId) roomIds.add(storage.roomId);
    }
  }
  await assertNotCounting([...roomIds], { transaction });

  const result = await createDocument({
    type,
    lines: mirrorLines(movements, type),
    user,
    reasonCode: 'reversal',
    reasonText: `Отмена документа ${document.number}`,
    fromRoomId: document.toRoomId || null,
    toRoomId: document.fromRoomId || null,
    device,
  }, { transaction });

  await result.document.update({ reversalOfId: document.id }, { transaction });
  return result;
}

/** Кабинеты, которых касается документ, — для проверки зоны ответственности. */
function documentRoomIds(document) {
  const rooms = new Set();
  if (document.fromRoomId) rooms.add(document.fromRoomId);
  if (document.toRoomId) rooms.add(document.toRoomId);
  for (const mv of document.movements || []) {
    if (mv.fromRoomId) rooms.add(mv.fromRoomId);
    if (mv.toRoomId) rooms.add(mv.toRoomId);
  }
  return [...rooms];
}

module.exports = {
  MIRROR, NOT_REVERSIBLE,
  mirrorLines, reversalBlocker, reverseDocument, documentRoomIds,
};
