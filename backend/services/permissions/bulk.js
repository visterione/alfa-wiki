'use strict';

/**
 * Слияние разреженных правок прав (ver. 8.31).
 *
 * Здесь живёт единственное обещание массовой правки: меняется ровно то, что
 * названо в патче, всё остальное у человека остаётся как было. Обещание это
 * проверяемое, поэтому функции чистые и лежат отдельно от маршрута — тест
 * (tests/bulkPermissions.test.js) гоняет их без базы.
 *
 * Разреженность держится на одном правиле: «ключа нет» и «ключ со значением» —
 * разные вещи, и первое значит «не трогать». Объект-состояние целиком (как в
 * поимённом сохранении прав зарплаты, где несказанное поле значит edit) сюда
 * приезжать не должен вовсе — от него и уходили: он стирает настроенное.
 */

const LEVELS = ['block', 'read', 'edit'];

// Колонки самого пользователя, которые дерево прав показывает обычными пунктами.
// Перечислены поимённо: патч приходит из браузера, и запись «любого поля,
// которое пришло» открыла бы через эту ручку правку чего угодно, включая isAdmin
// и password.
const USER_FLAGS = new Set([
  'canEditServices', 'canEditDoctorCards', 'canEditAnalyses',
  'canAccessSalary', 'canAccessStatistics', 'canAccessTopSalary',
]);

const asBool = (value) => value === true || value === 'true';
const asLevel = (value) => (LEVELS.includes(value) ? value : null);

/**
 * Правки полей самого пользователя: adminAccess, маркетинг, колонки, статистика.
 *
 * @param {object} user   текущий пользователь (нужны adminAccess и statisticsTabs)
 * @param {object} patch  разреженный патч из браузера
 * @returns {object}      что передать в user.update(); пустой объект — менять нечего
 */
function mergeUserChanges(user, patch = {}) {
  const changes = {};

  // Объект пересобирается целиком, потому что JSONB в Sequelize меняется только
  // заменой значения. Но исходный разворачивается первым, поэтому ключи, которых
  // в патче нет, доезжают нетронутыми — в этом весь смысл.
  const adminAccess = { ...(user.adminAccess || {}) };
  let adminTouched = false;

  for (const [key, value] of Object.entries(patch.adminAccess || {})) {
    adminAccess[key] = asBool(value);
    adminTouched = true;
  }

  // Маркетинг — вложенный объект с тремя уровнями, и сливается он своим шагом:
  // разворот верхнего уровня заменил бы его целиком, и правка одних «Акций»
  // снесла бы настроенные «Анонсы».
  const marketing = { ...(adminAccess.marketing || {}) };
  let marketingTouched = false;
  for (const [key, value] of Object.entries(patch.marketing || {})) {
    const level = asLevel(value);
    if (!level) continue;
    marketing[key] = level;
    marketingTouched = true;
  }
  if (marketingTouched) {
    adminAccess.marketing = marketing;
    adminTouched = true;
  }

  if (adminTouched) changes.adminAccess = adminAccess;

  for (const [key, value] of Object.entries(patch.flags || {})) {
    if (USER_FLAGS.has(key)) changes[key] = asBool(value);
  }

  if (patch.statisticsTabs && Object.keys(patch.statisticsTabs).length) {
    const tabs = { ...(user.statisticsTabs || {}) };
    for (const [key, value] of Object.entries(patch.statisticsTabs)) tabs[key] = asBool(value);
    changes.statisticsTabs = tabs;
  }

  return changes;
}

/**
 * Правки строки прав зарплаты (RbUserPermission).
 *
 * @param {object} row        текущая строка (нужны поля вкладок и clinics)
 * @param {object} patch      разреженный патч
 * @param {Set<string>} known имена колонок модели: неизвестный ключ Sequelize
 *                            молча проглотит, и правка «применилась» бы, ничего
 *                            не изменив
 */
function mergeSalaryChanges(row, patch = {}, known) {
  const changes = {};

  for (const [key, value] of Object.entries(patch.salaryTabs || {})) {
    const level = asLevel(value);
    if (level && (!known || known.has(key))) changes[key] = level;
  }

  // Клиники — список, и правится он добавлением и убиранием, а не заменой:
  // «дать регистраторам ещё один филиал» не должно отнимать те, что уже есть.
  if (patch.salaryClinics) {
    const current = new Set(Array.isArray(row?.clinics) ? row.clinics.map(String) : []);
    for (const id of (patch.salaryClinics.add || [])) current.add(String(id));
    for (const id of (patch.salaryClinics.remove || [])) current.delete(String(id));
    changes.clinics = [...current];
  }

  return changes;
}

/** Карта прав склада после слияния, или null — если склад патч не трогает. */
function mergeWarehousePerms(row, patch = {}) {
  if (!patch.warehousePerms || !Object.keys(patch.warehousePerms).length) return null;

  const next = { ...(row?.perms || {}) };
  for (const [key, value] of Object.entries(patch.warehousePerms)) {
    const level = asLevel(value);
    if (level) next[key] = level;
  }
  return next;
}

/** Область видимости склада после слияния, или null — если патч её не трогает. */
function mergeWarehouseCenters(row, patch = {}) {
  if (!patch.warehouseCenters) return null;

  const current = new Set(Array.isArray(row?.medCenterIds) ? row.medCenterIds.map(String) : []);
  for (const id of (patch.warehouseCenters.add || [])) current.add(String(id));
  for (const id of (patch.warehouseCenters.remove || [])) current.delete(String(id));
  return [...current];
}

/** Трогает ли патч зарплату или склад — от этого зависит требуемый уровень прав. */
const touchesSalary = (patch = {}) => !!(patch.salaryTabs || patch.salaryClinics);
const touchesWarehouse = (patch = {}) => !!(patch.warehousePerms || patch.warehouseCenters);

module.exports = {
  LEVELS,
  USER_FLAGS,
  mergeUserChanges,
  mergeSalaryChanges,
  mergeWarehousePerms,
  mergeWarehouseCenters,
  touchesSalary,
  touchesWarehouse,
};
