'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeUserChanges, mergeSalaryChanges, mergeWarehousePerms, mergeWarehouseCenters,
  touchesSalary, touchesWarehouse,
} = require('../services/permissions/bulk');

/**
 * Массовая правка прав существует ради одного обещания: меняется только
 * названное. Проверяем именно его — всё остальное в этом модуле второстепенно.
 */

// Человек, которому за два года настроили права поимённо.
const user = () => ({
  adminAccess: {
    pages: true,
    journal: true,
    reviews: false,
    marketing: { promotions: 'edit', ads: 'read', announcements: 'edit' },
  },
  statisticsTabs: { kpiGeneral: true, dirDoctors: true },
  canEditServices: true,
});

// ── Главное обещание ──────────────────────────────────────────────────────

test('правка одного ключа не трогает остальные права', () => {
  const changes = mergeUserChanges(user(), { adminAccess: { vacancies: true } });

  assert.equal(changes.adminAccess.vacancies, true);
  assert.equal(changes.adminAccess.pages, true, 'настроенный ранее доступ остался');
  assert.equal(changes.adminAccess.journal, true);
  assert.equal(changes.adminAccess.reviews, false, 'выключенное осталось выключенным');
  assert.deepEqual(changes.adminAccess.marketing, {
    promotions: 'edit', ads: 'read', announcements: 'edit',
  }, 'вложенный маркетинг не потерялся');
});

test('правка одной вкладки маркетинга не сбрасывает соседние', () => {
  const changes = mergeUserChanges(user(), { marketing: { ads: 'edit' } });

  assert.deepEqual(changes.adminAccess.marketing, {
    promotions: 'edit', ads: 'edit', announcements: 'edit',
  });
  // Остальное в adminAccess тоже на месте: маркетинг лежит внутри него, и
  // небрежная сборка снесла бы соседей заодно.
  assert.equal(changes.adminAccess.pages, true);
  assert.equal(changes.adminAccess.journal, true);
});

test('пустой патч не меняет ничего', () => {
  assert.deepEqual(mergeUserChanges(user(), {}), {});
  assert.deepEqual(mergeUserChanges(user(), { adminAccess: {}, marketing: {} }), {});
});

test('одна вкладка статистики не сбрасывает остальные', () => {
  const changes = mergeUserChanges(user(), { statisticsTabs: { kpiRooms: true } });

  assert.deepEqual(changes.statisticsTabs, {
    kpiGeneral: true, dirDoctors: true, kpiRooms: true,
  });
});

// ── Границы ───────────────────────────────────────────────────────────────

test('через патч нельзя выдать себе isAdmin или подменить пароль', () => {
  const changes = mergeUserChanges(user(), {
    flags: { isAdmin: true, password: 'x', username: 'root', canEditAnalyses: true },
  });

  assert.equal(changes.isAdmin, undefined);
  assert.equal(changes.password, undefined);
  assert.equal(changes.username, undefined);
  assert.equal(changes.canEditAnalyses, true, 'разрешённая колонка при этом проходит');
});

test('несуществующий уровень доступа отбрасывается, а не пишется', () => {
  const changes = mergeUserChanges(user(), { marketing: { ads: 'superuser' } });
  assert.deepEqual(changes, {}, 'мусорный уровень не считается правкой');
});

test('человек без настроенных прав получает ровно то, что дали', () => {
  const changes = mergeUserChanges({}, { adminAccess: { vacancies: true } });
  assert.deepEqual(changes.adminAccess, { vacancies: true });
});

// ── Зарплата ──────────────────────────────────────────────────────────────

const known = new Set(['tab1', 'tab2', 'tabSummary', 'clinics']);

test('вкладка зарплаты меняется поимённо, неизвестная отбрасывается', () => {
  const row = { tab1: 'read', tab2: 'edit' };
  const changes = mergeSalaryChanges(row, { salaryTabs: { tab1: 'edit', tabНету: 'edit' } }, known);

  assert.deepEqual(changes, { tab1: 'edit' });
});

test('клиники зарплаты добавляются и убираются, а не заменяются списком', () => {
  const row = { clinics: ['2', '3'] };

  assert.deepEqual(
    mergeSalaryChanges(row, { salaryClinics: { add: ['6'] } }, known).clinics,
    ['2', '3', '6'],
    'прежние филиалы остались'
  );
  assert.deepEqual(
    mergeSalaryChanges(row, { salaryClinics: { remove: ['3'] } }, known).clinics,
    ['2']
  );
  // Повторное добавление того, что уже есть, ничего не дублирует.
  assert.deepEqual(
    mergeSalaryChanges(row, { salaryClinics: { add: ['2'] } }, known).clinics,
    ['2', '3']
  );
});

// ── Склад ─────────────────────────────────────────────────────────────────

test('право склада сливается с прежней картой', () => {
  const row = { perms: { stock: 'read', operations: 'edit' } };
  const next = mergeWarehousePerms(row, { warehousePerms: { stock: 'edit' } });

  assert.deepEqual(next, { stock: 'edit', operations: 'edit' });
});

test('склад не трогается, когда его в патче нет', () => {
  assert.equal(mergeWarehousePerms({ perms: { stock: 'read' } }, {}), null);
  assert.equal(mergeWarehouseCenters({ medCenterIds: ['a'] }, {}), null);
});

test('область видимости склада правится добавлением', () => {
  const row = { medCenterIds: ['a', 'b'] };
  assert.deepEqual(mergeWarehouseCenters(row, { warehouseCenters: { add: ['c'] } }), ['a', 'b', 'c']);
  assert.deepEqual(mergeWarehouseCenters(row, { warehouseCenters: { remove: ['a'] } }), ['b']);
});

// ── Признаки для проверки прав ────────────────────────────────────────────

test('патч без зарплаты и склада не требует прав администратора портала', () => {
  const patch = { adminAccess: { vacancies: true } };
  assert.equal(touchesSalary(patch), false);
  assert.equal(touchesWarehouse(patch), false);

  assert.equal(touchesSalary({ salaryClinics: { add: ['2'] } }), true);
  assert.equal(touchesWarehouse({ warehousePerms: { stock: 'read' } }), true);
});
