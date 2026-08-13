const test = require('node:test');
const assert = require('node:assert/strict');

const roles = require('../services/warehouse/roles');

/**
 * Матрица доступа складского модуля против списков ролей из ТЗ.
 *
 * Проверяется не «код что-то возвращает», а конкретные утверждения ТЗ: кто видит
 * оборотно-сальдовую ведомость, кому закрыта амортизация, почему эпидемиолог не
 * попадает в отчёт по врачам. Эти списки — договорённость с заказчиком, и молча
 * разъехаться с ними нельзя.
 */

const set = (...keys) => new Set(keys);

test('роли ТЗ описаны в справочнике', () => {
  const expected = [
    'accountant', 'economist', 'finance_director', 'warehouse_head',
    'department_head', 'engineer', 'head_nurse', 'epidemiologist',
    'auditor', 'chief_doctor', 'procurement', 'commission_chair',
    'responsible', 'module_admin',
  ];
  for (const key of expected) {
    assert.ok(roles.WAREHOUSE_ROLES[key], `нет роли ${key}`);
    assert.ok(roles.WAREHOUSE_ROLES[key].label, `у роли ${key} нет названия`);
  }
});

test('каждый отчёт из матрицы ссылается только на существующие роли', () => {
  for (const [code, def] of Object.entries(roles.ACCESS_MATRIX)) {
    for (const key of [...def.read, ...def.write]) {
      assert.ok(roles.WAREHOUSE_ROLES[key], `отчёт ${code} ссылается на несуществующую роль ${key}`);
    }
    // Право на правку без права на чтение — бессмыслица: человек изменил бы то,
    // чего не видит.
    for (const key of def.write) {
      assert.ok(def.read.includes(key), `${code}: роль ${key} может писать, но не читать`);
    }
  }
});

test('оборотно-сальдовую ведомость видят бухгалтер, зав. складом, зав. отделением и аудитор', () => {
  for (const role of ['accountant', 'warehouse_head', 'department_head', 'auditor']) {
    assert.equal(roles.canRead(set(role), 'RPT-TURNOVER'), true, role);
  }
  // Инженеру ведомость по ТЗ не положена.
  assert.equal(roles.canRead(set('engineer'), 'RPT-TURNOVER'), false);
});

test('амортизация закрыта для всех, кроме бухгалтера, экономиста и фининдиректора', () => {
  for (const role of ['accountant', 'economist', 'finance_director']) {
    assert.equal(roles.canRead(set(role), 'RPT-DEPRECIATION'), true, role);
  }
  for (const role of ['engineer', 'head_nurse', 'epidemiologist', 'warehouse_head', 'department_head']) {
    assert.equal(roles.canRead(set(role), 'RPT-DEPRECIATION'), false, role);
  }
});

test('эпидемиолог видит только сроки годности', () => {
  assert.equal(roles.canRead(set('epidemiologist'), 'RPT-EXPIRING'), true);
  for (const code of Object.keys(roles.ACCESS_MATRIX)) {
    if (code === 'RPT-EXPIRING') continue;
    assert.equal(roles.canRead(set('epidemiologist'), code), false, code);
  }
});

test('рейтинг врачей закрыт от зав. складом и старшей медсестры', () => {
  assert.equal(roles.canRead(set('chief_doctor'), 'RPT-CONSUMPTION-2'), true);
  assert.equal(roles.canRead(set('economist'), 'RPT-CONSUMPTION-2'), true);
  // Расход по кабинетам зав. складом видит, а поимённый рейтинг врачей — нет.
  assert.equal(roles.canRead(set('warehouse_head'), 'RPT-CONSUMPTION'), true);
  assert.equal(roles.canRead(set('warehouse_head'), 'RPT-CONSUMPTION-2'), false);
  assert.equal(roles.canRead(set('head_nurse'), 'RPT-CONSUMPTION-2'), false);
});

test('сверка с 1С доступна только бухгалтеру и администратору модуля', () => {
  assert.equal(roles.canRead(set('accountant'), 'RPT-1C-RECON'), true);
  assert.equal(roles.canRead(set('module_admin'), 'RPT-1C-RECON'), true);
  assert.equal(roles.canRead(set('auditor'), 'RPT-1C-RECON'), false);
});

test('котировки — закупки и финансы, но не инженер', () => {
  assert.equal(roles.canRead(set('procurement'), 'RPT-RFQ-COMPARE'), true);
  assert.equal(roles.canRead(set('finance_director'), 'RPT-RFQ-COMPARE'), true);
  assert.equal(roles.canRead(set('engineer'), 'RPT-RFQ-COMPARE'), false);
  // Решение по котировке принимает закупщик, а не финдиректор-наблюдатель.
  assert.equal(roles.canWrite(set('procurement'), 'RPT-RFQ-COMPARE'), true);
  assert.equal(roles.canWrite(set('finance_director'), 'RPT-RFQ-COMPARE'), false);
});

test('область видимости: зав. отделением ограничен, бухгалтер — нет', () => {
  assert.equal(roles.widestScope(set('department_head')), 'department');
  assert.equal(roles.widestScope(set('responsible')), 'department');
  assert.equal(roles.widestScope(set('accountant')), 'network');
  // Самая широкая роль побеждает: бухгалтер, ведущий кабинет, остаётся сетевым.
  assert.equal(roles.widestScope(set('department_head', 'accountant')), 'network');
});

test('возможности: суммы видят не все', () => {
  assert.equal(roles.capabilities(set('accountant')).canSeeCosts, true);
  assert.equal(roles.capabilities(set('head_nurse')).canSeeCosts, false);
  assert.equal(roles.capabilities(set('epidemiologist')).canSeeCosts, false);
  // Выдавать материалы может старшая медсестра, но не эпидемиолог-наблюдатель.
  assert.equal(roles.capabilities(set('head_nurse')).canIssue, true);
  assert.equal(roles.capabilities(set('epidemiologist')).canIssue, false);
  // Настройка прав — только администратор модуля.
  assert.equal(roles.capabilities(set('warehouse_head')).canManageAccess, false);
  assert.equal(roles.capabilities(set('module_admin')).canManageAccess, true);
});

test('аудитор только читает: ни одного права на запись', () => {
  const caps = roles.capabilities(set('auditor'));
  for (const key of ['canIssue', 'canInventory', 'canManageAssets', 'canManageCatalog',
                     'canEditLocations', 'canProcure', 'canManageAccess']) {
    assert.equal(caps[key], false, key);
  }
  // Но читает он много: аудиторский след — это его работа.
  assert.equal(roles.canRead(set('auditor'), 'RPT-MOVEMENT'), true);
  assert.equal(roles.canRead(set('auditor'), 'RPT-INVENTORY'), true);
});

test('пустой набор ролей не открывает ничего', () => {
  const empty = set();
  for (const code of Object.keys(roles.ACCESS_MATRIX)) {
    assert.equal(roles.canRead(empty, code), false, code);
  }
  const caps = roles.capabilities(empty);
  assert.equal(Object.values(caps).some(Boolean), false);
});

test('роли модуля выдаются ролью портала', () => {
  const user = {
    isAdmin: false,
    roles: [{ permissions: { warehouse: { roles: ['accountant', 'auditor'] } } }],
  };
  const got = roles.assignedRoles(user);
  assert.equal(got.has('accountant'), true);
  assert.equal(got.has('auditor'), true);
  assert.equal(got.has('module_admin'), false);
});

test('несуществующие ключи ролей игнорируются, а не ломают расчёт', () => {
  const user = { roles: [{ permissions: { warehouse: { roles: ['accountant', 'нет-такой'] } } }] };
  const got = roles.assignedRoles(user);
  assert.deepEqual([...got], ['accountant']);
});

test('роль «Склад» из миграции ver. 6.68 продолжает работать', () => {
  // Старый формат: без списка ролей, только read/write/delete/admin.
  const legacyHead = {
    roles: [{ permissions: { warehouse: { read: true, write: true, delete: true } } }],
  };
  assert.equal(roles.assignedRoles(legacyHead).has('warehouse_head'), true);

  const legacyAdmin = { roles: [{ permissions: { warehouse: { admin: true } } }] };
  assert.equal(roles.assignedRoles(legacyAdmin).has('module_admin'), true);
});

test('полный администратор портала получает администратора модуля', () => {
  assert.equal(roles.assignedRoles({ isAdmin: true }).has('module_admin'), true);
});

test('администратор модуля видит все отчёты', () => {
  const admin = set('module_admin');
  for (const code of Object.keys(roles.ACCESS_MATRIX)) {
    assert.equal(roles.canRead(admin, code), true, code);
  }
});

test('список доступных отчётов совпадает с матрицей', () => {
  const list = roles.readableReports(set('engineer'));
  const codes = list.map(r => r.code).sort();
  assert.deepEqual(codes, ['RPT-IDLE', 'RPT-MAINTENANCE', 'RPT-MAINTENANCE-3'].sort());
  for (const item of list) assert.ok(item.title, `у ${item.code} нет названия`);
});
