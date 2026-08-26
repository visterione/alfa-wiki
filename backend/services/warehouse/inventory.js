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
 *
 * Запрет именно запрещает, а не откладывает. Разница не умозрительная: в
 * ver. 7.45 раскладка по кабинету сохранялась как намерение и применялась
 * следующим разбором — человек видел «успешно», в кабинете не появлялось ничего,
 * а через день туда приезжало всё накопленное разом. Поэтому проверка стоит
 * ПЕРЕД записью намерения, а не перед его исполнением.
 */

const { Op } = require('sequelize');
const { WhInventorySession, WhRoom } = require('../../models');

/**
 * Кабинеты описи списком.
 *
 * С ver. 7.36 их может быть несколько, и спрашивать «какие кабинеты накрыты»
 * надо одним способом: у описи по одному кабинету roomIds содержит тот же
 * единственный id. Старые описи, заведённые до миграции, отвечают через roomId —
 * поэтому запасной путь остаётся, а не убран как избыточный.
 *
 * У описи по отделению список пуст: её область — само отделение, вместе с
 * кабинетами, которые в нём ещё появятся.
 */
function sessionRoomIds(session) {
  const list = Array.isArray(session?.roomIds) ? session.roomIds.filter(Boolean) : [];
  if (list.length) return [...new Set(list)];
  return session?.roomId ? [session.roomId] : [];
}

/**
 * Область описи полями записи: scope, roomId, roomIds.
 *
 * Правило одно и живёт в одном месте, потому что от него зависят три разных
 * ответа: что заморожено (roomIds), что показывают списком (roomId у описи по
 * одному кабинету) и что попадёт в шапку ИНВ-1 (scope).
 *
 * Область из одного кабинета остаётся 'room', а не превращается в список из
 * одного элемента: так её показывают журнал, отчёт и мобильный экран, и менять
 * вид всех уже открытых описей ради единообразия записи не за что.
 */
function inventoryScopeOf(roomIds, departmentId) {
  const rooms = [...new Set((roomIds || []).filter(Boolean))];
  if (departmentId) {
    // Список пуст намеренно: область описи по отделению — само отделение,
    // вместе с кабинетами, которые в нём ещё появятся.
    return { scope: 'department', roomId: null, roomIds: [], departmentId };
  }
  return {
    scope: rooms.length > 1 ? 'rooms' : 'room',
    roomId: rooms.length === 1 ? rooms[0] : null,
    roomIds: rooms,
    departmentId: null,
  };
}

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
    attributes: ['id', 'number', 'scope', 'roomId', 'roomIds', 'departmentId'],
    transaction: options.transaction,
  });
  if (!sessions.length) return new Map();

  const byRoom = new Map();
  for (const session of sessions) {
    for (const roomId of sessionRoomIds(session)) {
      if (wanted.includes(roomId) && !byRoom.has(roomId)) byRoom.set(roomId, session);
    }
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
 *
 * Формулировка выбрана после разбора случая на бою. Раньше здесь стояло
 * «операции возобновятся после её закрытия», и читалось это как обещание: люди
 * понимали, что их размещение применится само, когда опись закроют, и повторяли
 * его снова и снова. Поэтому первым словом теперь идёт результат — операции НЕ
 * произошло, — и только потом причина.
 */
async function assertNotCounting(roomIds, options = {}) {
  const counting = await openCountByRoom(roomIds, options);
  if (!counting.size) return;
  const session = [...counting.values()][0];
  throw Object.assign(
    new Error(`Операция не выполнена: по кабинету идёт инвентаризация ${session.number}. `
      + 'Повторите после того, как опись закроют.'),
    { status: 409 },
  );
}

/**
 * Кабинеты описи с номерами — для подписи области в списке описей, в шапке
 * пересчёта и в ИНВ-1. Запрос один на опись, поэтому вызывать его на список
 * описей построчно нельзя: для списка есть roomsBySession.
 */
async function sessionRooms(session, options = {}) {
  const ids = sessionRoomIds(session);
  if (!ids.length) return [];
  const rooms = await WhRoom.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'number', 'name'],
    transaction: options.transaction,
  });
  // Порядок номеров, а не порядок выбора: «305, 307, 310» читается как область
  // из приказа, а «307, 305, 310» выглядит как чей-то путь по коридору.
  return rooms.sort((a, b) => String(a.number).localeCompare(String(b.number), 'ru', { numeric: true }));
}

/** Кабинеты сразу для нескольких описей: Map(sessionId → [{id, number, name}]). */
async function roomsBySession(sessions, options = {}) {
  const wanted = [...new Set(sessions.flatMap(s => sessionRoomIds(s)))];
  if (!wanted.length) return new Map();
  const rooms = await WhRoom.findAll({
    where: { id: { [Op.in]: wanted } },
    attributes: ['id', 'number', 'name'],
    transaction: options.transaction,
  });
  const byId = new Map(rooms.map(r => [r.id, r]));
  const out = new Map();
  for (const session of sessions) {
    const own = sessionRoomIds(session).map(id => byId.get(id)).filter(Boolean);
    own.sort((a, b) => String(a.number).localeCompare(String(b.number), 'ru', { numeric: true }));
    out.set(session.id, own);
  }
  return out;
}

module.exports = {
  sessionRoomIds, sessionRooms, roomsBySession, inventoryScopeOf,
  openCountByRoom, assertNotCounting,
};
