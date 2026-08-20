/**
 * Заморозка кабинета на время пересчёта.
 *
 * Инвентаризация снимает ожидаемые количества при ОТКРЫТИИ описи, а разницу
 * проводит после решения комиссии — то есть опирается на то, что между снятием
 * снимка и пересчётом остаток не двигался.
 *
 * Пока этого правила не было, выдача во время описи ломала обе стороны сразу:
 * комиссия видела на полке меньше, чем в снимке, и разница списывалась ВТОРОЙ
 * раз поверх уже проведённой выдачи. Обратный случай так же плох — приход во
 * время пересчёта превращался в излишек, который потом оприходовали ещё раз.
 *
 * Так работает и бумажная инвентаризация: на время пересчёта операции по объекту
 * останавливают. Запрет снимается ЗАКРЫТИЕМ описи, а не оформлением расхождений:
 * после пересчёта движения снова законны и ложатся поверх разницы.
 */

const { Op } = require('sequelize');
const { WhInventorySession, WhRoom } = require('../../models');

/**
 * Открытые описи, накрывающие эти кабинеты: Map(roomId → сессия).
 *
 * @param {string[]} roomIds
 * @param {object}   [options] { transaction }
 */
async function openCountByRoom(roomIds, options = {}) {
  const wanted = [...new Set((roomIds || []).filter(Boolean))];
  if (!wanted.length) return new Map();

  const sessions = await WhInventorySession.findAll({
    where: { status: 'counting' },
    attributes: ['id', 'number', 'scope', 'roomId', 'departmentId'],
    transaction: options.transaction,
  });
  if (!sessions.length) return new Map();

  const byRoom = new Map();
  for (const session of sessions) {
    if (session.roomId && wanted.includes(session.roomId)) byRoom.set(session.roomId, session);
  }

  // Опись по отделению накрывает все его кабинеты — иначе описью отделения можно
  // было бы пренебречь, оформив документ на конкретный кабинет внутри него.
  const departmentIds = [...new Set(sessions.map(s => s.departmentId).filter(Boolean))];
  if (departmentIds.length) {
    const rooms = await WhRoom.findAll({
      where: { id: { [Op.in]: wanted }, departmentId: { [Op.in]: departmentIds } },
      attributes: ['id', 'departmentId'],
      transaction: options.transaction,
    });
    for (const room of rooms) {
      if (byRoom.has(room.id)) continue;
      const session = sessions.find(s => s.departmentId === room.departmentId);
      if (session) byRoom.set(room.id, session);
    }
  }
  return byRoom;
}

/**
 * Бросает 409, если хоть один кабинет сейчас пересчитывают. Текст называет номер
 * описи: человеку надо знать не «нельзя», а к кому идти.
 */
async function assertNotCounting(roomIds, options = {}) {
  const counting = await openCountByRoom(roomIds, options);
  if (!counting.size) return;
  const session = [...counting.values()][0];
  throw Object.assign(
    new Error(`По кабинету идёт инвентаризация ${session.number} — операции возобновятся после её закрытия`),
    { status: 409 },
  );
}

module.exports = { openCountByRoom, assertNotCounting };
