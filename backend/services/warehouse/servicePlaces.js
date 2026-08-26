/**
 * Склады медцентра: «Склад», «Ремонт» и то, что заведут после них (ver. 7.47).
 *
 * ── Почему это кабинет, а не отдельная сущность ──────────────────────────────
 *
 * Весь модуль отвечает на вопросы через roomId: где лежит остаток (через место
 * хранения), где стоит карточка, откуда и куда прошло движение, чья это зона
 * ответственности, что накрыто описью, как сгруппирован отчёт. Заведи склад
 * отдельной таблицей — и каждый из этих путей пришлось бы написать во второй
 * раз, а разошлись бы они на первой же нестандартной операции.
 *
 * Поэтому склад — строка warehouse_rooms с isService = true. Отличий ровно два,
 * и оба следуют из того, что физического помещения за ним нет:
 *
 *   • этажа у него не бывает (floorId пуст, на плане не рисуется);
 *   • в аналитику посещаемости он не входит — приёмов в нём ноль, и его ноль
 *     испортил бы средние по сети.
 *
 * ── Почему общие на медцентр ─────────────────────────────────────────────────
 *
 * Резерв в медцентре один. Делить его по этажам значило бы выдумывать границу,
 * которой в жизни нет: человек берёт запасной прибор со склада, а не «со склада
 * третьего этажа». Между медцентрами склады, наоборот, не общие — имущество
 * принадлежит своему юрлицу и своему МОЛ.
 *
 * ── Почему заводятся сами ────────────────────────────────────────────────────
 *
 * Ремонт обязан куда-то перемещать актив, и отказывать в открытии ремонта из-за
 * того, что кто-то удалил склад «Ремонт», — наказание не тому. Поэтому место
 * создаётся по требованию: это не догадка о данных, а восстановление того, что
 * должно быть у каждого медцентра по определению.
 */

const { Op } = require('sequelize');
const { WhRoom, WhStorage, WhMovement } = require('../../models');
const qr = require('./qr');

/**
 * Виды складов, к которым ведут быстрые действия. Всё, что человек заведёт
 * сверх них, — тоже склад, но без своей кнопки: serviceKind у него пуст.
 */
const SERVICE_KINDS = {
  warehouse: { name: 'Склад', number: 'Склад', sortOrder: 10 },
  repair: { name: 'Ремонт', number: 'Ремонт', sortOrder: 20 },
};

/** Склад медцентра по виду, если он заведён. */
async function findServicePlace(medCenterId, serviceKind, options = {}) {
  if (!medCenterId || !SERVICE_KINDS[serviceKind]) return null;
  return WhRoom.findOne({
    where: { medCenterId, serviceKind, isService: true, isActive: true },
    transaction: options.transaction,
  });
}

/**
 * Склад медцентра по виду; заводится, если его ещё нет.
 *
 * Вместе с местом хранения: без него в склад нельзя положить материал, а
 * карточка оборудования требует storageId при создании. Место одно и называется
 * так же — полки внутри склада человек заведёт сам, когда они ему понадобятся.
 */
async function ensureServicePlace(medCenterId, serviceKind, options = {}) {
  const spec = SERVICE_KINDS[serviceKind];
  if (!medCenterId || !spec) return null;

  const existing = await findServicePlace(medCenterId, serviceKind, options);
  const room = existing || await WhRoom.create({
    medCenterId,
    floorId: null,
    number: spec.number,
    name: spec.name,
    // Вид помещения остаётся складским: он попадает в отчёты и в подписи, и
    // заводить под каждый склад собственный вид кабинета незачем.
    kind: 'storage',
    isService: true,
    serviceKind,
    capacityHours: 0,
    publicToken: qr.generateToken(),
  }, { transaction: options.transaction });

  const storage = await WhStorage.findOne({
    where: { roomId: room.id, isActive: true },
    transaction: options.transaction,
  });
  if (!storage) {
    await WhStorage.create({
      roomId: room.id,
      name: spec.name,
      // Помещение целиком, а не шкаф: полок на складе может не быть вовсе, и
      // выдумывать «Шкаф 1» значит заводить место, которого никто не видел.
      kind: 'room',
      sortOrder: 10,
    }, { transaction: options.transaction });
  }

  return room;
}

/** Склады всех медцентров разом — для дерева локаций и списков. */
async function listServicePlaces(options = {}) {
  return WhRoom.findAll({
    where: { isService: true, isActive: true },
    order: [['serviceKind', 'ASC'], ['name', 'ASC']],
    transaction: options.transaction,
  });
}

/**
 * Подпись места: у кабинета это номер, у склада — название.
 *
 * Вынесено сюда, потому что «Каб. Склад» получается само собой везде, где
 * подпись собирают из номера, а таких мест в модуле десяток.
 */
function roomLabel(room) {
  if (!room) return '';
  if (room.isService) return room.name || room.number;
  return `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`;
}

/** Идентификаторы складов: аналитике посещаемости они не интересны. */
async function serviceRoomIds(options = {}) {
  const rows = await WhRoom.findAll({
    where: { isService: true },
    attributes: ['id'],
    transaction: options.transaction,
  });
  return rows.map(r => r.id);
}

/** Где актив стоял до ухода в ремонт: последнее движение, увёзшее его отсюда. */
async function lastRoomBefore(assetId, roomId, options = {}) {
  const movement = await WhMovement.findOne({
    where: { assetId, toRoomId: roomId, fromRoomId: { [Op.ne]: null } },
    order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']],
    transaction: options.transaction,
  });
  return movement?.fromRoomId || null;
}

module.exports = {
  SERVICE_KINDS,
  findServicePlace,
  ensureServicePlace,
  listServicePlaces,
  serviceRoomIds,
  roomLabel,
  lastRoomBefore,
};
