/**
 * Сигналы «посмотри сейчас» в колокольчик портала.
 *
 * ── Чем это отличается от рассылки ───────────────────────────────────────────
 *
 * Почта несёт регламентный отчёт со вложением по расписанию ТЗ — её читают утром
 * и не спеша. Сокет несёт одно короткое событие, у которого есть срок годности:
 * знать о нём через сутки уже поздно. Дублировать одно другим бессмысленно.
 *
 * Отсюда и правило отбора: сюда попадает только то, что случилось ПРЯМО СЕЙЧАС и
 * из-за чьего-то действия. Просрочка, например, не событие — партия не портится в
 * ответ на нажатие кнопки, — и живёт в утренней рассылке. А вот «выдали, и
 * перчаток осталось меньше минимума» — событие ровно этой минуты, и человек,
 * который только что провёл документ, ещё стоит у полки и может сразу заказать.
 *
 * ── Кому ─────────────────────────────────────────────────────────────────────
 *
 * Не по правам, а по ответственности: МОЛ кабинета и заведующий отделением. Это
 * тот же принцип, что в области видимости (services/warehouse/access.js) — «за
 * что человек отвечает» — и он же отвечает на вопрос, кому чинить.
 *
 * Отправка никогда не роняет операцию, которая её вызвала: документ проведён,
 * остаток изменён, и падение уведомления не повод откатывать склад.
 */

const { Op } = require('sequelize');
const { WhStock, WhReorderRule, WhNomenclature, WhRoom, WhStorage, WhDepartment } = require('../../models');

/** Событие в сокете. Слушатель — SocketContext на клиенте. */
const EVENT = 'warehouse:alert';

function emitTo(userIds, payload) {
  if (!userIds.length) return;
  try {
    const { getIo } = require('../notificationService');
    const io = getIo();
    if (!io) return;
    for (const id of new Set(userIds)) {
      io.to(`user:${id}`).emit(EVENT, { ...payload, at: new Date().toISOString() });
    }
  } catch (err) {
    console.error('warehouse alert emit:', err.message);
  }
}

/**
 * Минимум, действующий для пары «позиция + место»: точнее заданное побеждает.
 * Тот же порядок, что в дашборде кабинета и в отчёте по остаткам.
 */
async function minimumFor(nomenclatureId, storageId, roomId) {
  const rules = await WhReorderRule.findAll({
    where: {
      nomenclatureId,
      [Op.or]: [
        { storageId },
        { roomId },
        { storageId: null, roomId: null },
      ],
    },
  });
  if (!rules.length) return null;
  // Место хранения → кабинет → общее правило.
  return rules.sort((a, b) => {
    const rank = r => (r.storageId ? 0 : r.roomId ? 1 : 2);
    return rank(a) - rank(b);
  })[0];
}

/**
 * Проверяет строки только что проведённого документа и сигналит по тем, что
 * ушли ниже минимума.
 *
 * @param {object[]} movements  движения из createDocument
 */
async function checkBelowMinimum(movements) {
  const outgoing = (movements || []).filter(m => m.nomenclatureId && m.fromStorageId);
  if (!outgoing.length) return;

  // Одна позиция могла уехать несколькими партиями — сигналить надо один раз.
  const places = new Map();
  for (const m of outgoing) places.set(`${m.nomenclatureId}@${m.fromStorageId}`, m);

  for (const m of places.values()) {
    try {
      const storage = await WhStorage.findByPk(m.fromStorageId, { attributes: ['id', 'name', 'roomId'] });
      if (!storage) continue;

      const rule = await minimumFor(m.nomenclatureId, storage.id, storage.roomId);
      if (!rule) continue;

      // Остаток по позиции в этом месте — по всем партиям сразу: минимум задан на
      // позицию, а не на конкретную коробку.
      const left = Number(await WhStock.sum('quantity', {
        where: { nomenclatureId: m.nomenclatureId, storageId: storage.id },
      }) || 0);
      if (left >= Number(rule.minQty)) continue;

      const [nom, room] = await Promise.all([
        WhNomenclature.findByPk(m.nomenclatureId, { attributes: ['name', 'unit'] }),
        WhRoom.findByPk(storage.roomId, {
          attributes: ['id', 'number', 'name', 'responsibleUserId', 'departmentId'],
        }),
      ]);
      const department = room?.departmentId
        ? await WhDepartment.findByPk(room.departmentId, { attributes: ['headUserId'] })
        : null;

      emitTo(
        [room?.responsibleUserId, department?.headUserId].filter(Boolean),
        {
          kind: 'below_minimum',
          level: left <= 0 ? 'critical' : 'warning',
          title: left <= 0 ? 'Позиция закончилась' : 'Остаток ниже минимума',
          text: `${nom?.name || 'Позиция'} — осталось ${left} ${nom?.unit || ''}`.trim()
            + ` при минимуме ${Number(rule.minQty)}. Кабинет ${room?.number || '—'}, «${storage.name}»`,
          roomId: room?.id || null,
          link: room?.id ? `/warehouse?room=${room.id}` : '/warehouse?tab=stock',
        },
      );
    } catch (err) {
      console.error('warehouse checkBelowMinimum:', err.message);
    }
  }
}

module.exports = { EVENT, emitTo, checkBelowMinimum };
