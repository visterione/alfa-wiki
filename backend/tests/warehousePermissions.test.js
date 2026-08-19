/**
 * Права складского модуля: каталог и вывод возможностей.
 *
 * Проверяется не «работает ли Sequelize», а то, что легко сломать правкой
 * каталога: что ключ права и код отчёта не разъехались, что уровень read не
 * выдаёт права на изменение и что пустой набор действительно ничего не открывает.
 * Прежний тест проверял матрицу должностей, которой больше нет.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const perms = require('../services/warehouse/permissions');

test('каталог: у каждого права есть название, ключи не пересекаются', () => {
  const cat = perms.catalogue();
  assert.deepEqual(cat.levels, ['block', 'read', 'edit']);

  for (const item of [...cat.sections, ...cat.reports]) {
    assert.ok(item.key, 'право без ключа');
    assert.ok(item.label, `у права ${item.key} нет названия`);
  }

  const keys = [...cat.sections, ...cat.reports].map(i => i.key);
  assert.equal(new Set(keys).size, keys.length, 'ключи прав повторяются');
  assert.equal(keys.length, perms.ALL_KEYS.length);
});

test('пустой набор не открывает ничего', () => {
  const empty = perms.emptyPerms();
  assert.equal(perms.hasAnything(empty), false);
  for (const value of Object.values(perms.capabilities(empty))) assert.equal(value, false);
  for (const value of Object.values(perms.visibleTabs(empty))) assert.equal(value, false);
  assert.deepEqual(perms.readableReports(empty), []);
});

test('полный набор открывает всё', () => {
  const full = perms.fullPerms();
  assert.equal(perms.hasAnything(full), true);
  for (const value of Object.values(perms.capabilities(full))) assert.equal(value, true);
  for (const value of Object.values(perms.visibleTabs(full))) assert.equal(value, true);
  assert.equal(perms.readableReports(full).length, Object.keys(perms.REPORTS).length);
});

test('read не даёт права на изменение', () => {
  const p = perms.normalize({ assets: 'read', operations: 'read', stock: 'read' });
  const caps = perms.capabilities(p);
  assert.equal(caps.canManageAssets, false, 'read по оборудованию не должен пускать к правке карточек');
  assert.equal(caps.canIssue, false, 'read по операциям не должен пускать к выдаче');
  assert.equal(caps.canManageCatalog, false);
  // При этом вкладки видно — иначе право «только смотреть» не имело бы смысла.
  assert.equal(perms.visibleTabs(p).assets, true);
  assert.equal(perms.visibleTabs(p).operations, true);
});

test('суммы и этикетки открываются уже на уровне read', () => {
  const p = perms.normalize({ costs: 'read', labels: 'read' });
  const caps = perms.capabilities(p);
  assert.equal(caps.canSeeCosts, true);
  assert.equal(caps.canPrintLabels, true);
});

test('право на отчёт выдаётся поштучно', () => {
  const p = perms.normalize({ reports: 'read', 'RPT-EXPIRING': 'read' });
  assert.equal(perms.canReadReport(p, 'RPT-EXPIRING'), true);
  assert.equal(perms.canWriteReport(p, 'RPT-EXPIRING'), false);
  assert.equal(perms.canReadReport(p, 'RPT-DEPRECIATION'), false,
    'амортизация не должна приезжать вместе со сроками годности');
  assert.deepEqual(perms.readableReports(p).map(r => r.code), ['RPT-EXPIRING']);
});

test('normalize отбрасывает неизвестные ключи и уровни', () => {
  const p = perms.normalize({ assets: 'superuser', bogusKey: 'edit', stock: 'edit' });
  assert.equal(p.assets, 'block', 'неизвестный уровень должен становиться block');
  assert.equal(p.bogusKey, undefined, 'неизвестный ключ не должен попадать в права');
  assert.equal(p.stock, 'edit');
  assert.equal(perms.normalize(null).assets, 'block');
  assert.equal(perms.normalize('строка').assets, 'block');
});

test('каждая возможность привязана к какому-то праву', () => {
  const caps = Object.keys(perms.capabilities(perms.fullPerms()));
  for (const name of ['canEditPlans', 'canEditLocations', 'canManageAssets',
    'canManageCatalog', 'canIssue', 'canInventory', 'canMaintenance', 'canProcure',
    'canPrintLabels', 'canSeeCosts', 'canImportOsv']) {
    assert.ok(caps.includes(name), `возможность ${name} потеряна в каталоге`);
    assert.notEqual(perms.capabilityTitle(name), name, `у ${name} нет человеческого названия`);
  }
});
