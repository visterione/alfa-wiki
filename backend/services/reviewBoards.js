/**
 * Доски отзывов заводятся вместе с филиалами (ver. 8.56).
 *
 * До этого доску создавали руками кнопкой «Создать доску», а филиал у неё жил
 * в названии строкой. Так модуль и работал с запуска: он появился раньше
 * справочника медцентров. Результат — доска существовала отдельно от филиала,
 * которому она и есть, и связь между ними приходилось поддерживать вручную.
 *
 * Теперь доска — следствие филиала: добавили медцентр, появилась доска.
 * Служебные подразделения (isVirtual: АУП, «Направители», ИП Микаелян) доски
 * не получают — отзывов о них не бывает.
 */

const { ReviewBoard, ReviewBoardPermission, MedCenter } = require('../models');

/**
 * Кому доступ на новой доске.
 *
 * Берём тех, кто есть на всех существующих досках, — это и есть сетевой состав
 * обработки отзывов, в отличие от людей, добавленных на доску одного филиала.
 * Роль — как у большинства: на одной доске человек может оказаться
 * наблюдателем там, где на остальных он редактор, и это исключение, а не
 * правило для нового филиала.
 *
 * Почему не «только владелец». Доска нового филиала с пустым списком доступа
 * не видна никому, кроме владельца, — и первый негативный отзыв пролежал бы на
 * ней незамеченным ровно до того дня, когда кто-нибудь вспомнит про настройки.
 */
async function defaultBoardAccess() {
  const boards = await ReviewBoard.findAll({ attributes: ['id'] });
  if (boards.length === 0) return [];

  const permissions = await ReviewBoardPermission.findAll({
    attributes: ['boardId', 'userId', 'role']
  });

  const byUser = new Map();
  for (const p of permissions) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, []);
    byUser.get(p.userId).push(p.role);
  }

  const access = [];
  for (const [userId, roles] of byUser) {
    if (roles.length < boards.length) continue;  // есть не везде — значит, не сетевой

    const counts = roles.reduce((acc, role) => ({ ...acc, [role]: (acc[role] || 0) + 1 }), {});
    const [role] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    access.push({ userId, role });
  }

  return access;
}

/**
 * Завести доску филиалу. Возвращает созданную доску или null, если доска уже
 * есть или филиал служебный.
 *
 * ownerId — кто станет владельцем. Обычно это тот, кто добавил филиал; при
 * разовом заполнении миграция передаёт владельца существующих досок.
 */
async function createBoardForMedCenter(medCenter, ownerId) {
  if (!medCenter || medCenter.isVirtual) return null;

  const existing = await ReviewBoard.findOne({ where: { medCenterId: medCenter.id } });
  if (existing) return null;

  const access = await defaultBoardAccess();

  const board = await ReviewBoard.create({
    medCenterId: medCenter.id,
    ownerId,
    archived: false
  });

  // Владелец обязан быть в списке доступа — на нём держится проверка прав.
  const rows = [{ userId: ownerId, role: 'owner' }];
  for (const entry of access) {
    if (entry.userId !== ownerId) rows.push(entry);
  }
  await ReviewBoardPermission.bulkCreate(
    rows.map(r => ({ boardId: board.id, userId: r.userId, role: r.role }))
  );

  return board;
}

/**
 * Проверить, что у каждого действующего непрофильного филиала есть доска.
 * Используется разовым заполнением и при снятии с филиала признака служебного.
 */
async function ensureBoardsForMedCenters(ownerId) {
  const medCenters = await MedCenter.findAll({ where: { isVirtual: false } });

  const created = [];
  for (const medCenter of medCenters) {
    const board = await createBoardForMedCenter(medCenter, ownerId);
    if (board) created.push({ id: board.id, name: medCenter.name });
  }

  return created;
}

module.exports = { createBoardForMedCenter, ensureBoardsForMedCenters, defaultBoardAccess };
