/**
 * Роли и матрица доступа складского модуля.
 *
 * ТЗ задаёт доступ пофамильно по должностям: у каждого отчёта свой список ролей,
 * а у зав. отделением ещё и оговорка «в рамках своего отделения». Первая версия
 * модуля сводила это к четырём выведенным уровням (admin / warehouse / department /
 * viewer) — этого достаточно, чтобы никого лишнего не пустить, но недостаточно,
 * чтобы настроить «эпидемиолог видит только сроки годности, а фининдиректор —
 * только амортизацию и котировки». Поэтому здесь матрица в явном виде.
 *
 * ── Два вида ролей, и это важно ──────────────────────────────────────────────
 *
 * **Назначаемые** (kind: 'assigned') выдаются роли портала: бухгалтер, экономист,
 * инженер, аудитор и так далее. Хранятся в roles.permissions.warehouse.roles —
 * существующий механизм прав портала, отдельного реестра не заводим.
 *
 * **Выводимые** (kind: 'derived') не назначаются вообще, они следуют из данных:
 * зав. отделением — тот, кто указан головой отделения; МОЛ — ответственный за
 * кабинет или актив; председатель комиссии — тот, кто ведёт опись. Выдавать их
 * руками было бы ошибкой: сегодня человек ведёт кабинет, завтра нет, и права
 * должны меняться вместе с этим фактом, а не отдельной заявкой.
 *
 * ── Про ограничение по локациям ──────────────────────────────────────────────
 *
 * Роль может быть «сетевой» (видит всё) или «локальной» (только свои кабинеты).
 * Если у человека несколько ролей, берётся самая широкая: бухгалтер, который
 * заодно ведёт кабинет, остаётся бухгалтером по всей сети.
 */

const WAREHOUSE_ROLES = {
  // ── Назначаемые ролью портала ──────────────────────────────────────────────
  module_admin: {
    label: 'Администратор модуля', kind: 'assigned', scope: 'network',
    hint: 'Настройка локаций, планов, номенклатуры и прав',
  },
  warehouse_head: {
    label: 'Заведующий складом', kind: 'assigned', scope: 'network',
    hint: 'Движения, закупки, маркировка, вся сеть',
  },
  accountant: {
    label: 'Бухгалтер', kind: 'assigned', scope: 'network',
    hint: 'Остатки, амортизация, сверка, инвентаризационные описи',
  },
  economist: {
    label: 'Экономист', kind: 'assigned', scope: 'network',
    hint: 'Расход материалов и амортизация',
  },
  finance_director: {
    label: 'Финансовый директор', kind: 'assigned', scope: 'network',
    hint: 'Амортизация и решения по закупкам',
  },
  chief_doctor: {
    label: 'Главный врач', kind: 'assigned', scope: 'network',
    hint: 'Расход по подразделениям, исполнение ТО, загрузка',
  },
  engineer: {
    label: 'Инженер', kind: 'assigned', scope: 'network',
    hint: 'График ТО, ремонты, надёжность оборудования',
  },
  head_nurse: {
    label: 'Старшая медсестра', kind: 'assigned', scope: 'department',
    hint: 'Сроки годности и остатки своих кабинетов',
  },
  epidemiologist: {
    label: 'Эпидемиолог', kind: 'assigned', scope: 'network',
    hint: 'Только сроки годности и стерильные материалы',
  },
  auditor: {
    label: 'Аудитор', kind: 'assigned', scope: 'network',
    hint: 'Чтение всего аудиторского следа, без права правки',
  },
  procurement: {
    label: 'Менеджер по закупкам', kind: 'assigned', scope: 'network',
    hint: 'Запросы котировок и сравнение поставщиков',
  },

  // ── Выводимые из данных ────────────────────────────────────────────────────
  department_head: {
    label: 'Заведующий отделением', kind: 'derived', scope: 'department',
    hint: 'Назначается в карточке отделения (поле «Заведующий»)',
  },
  responsible: {
    label: 'Материально ответственное лицо', kind: 'derived', scope: 'department',
    hint: 'Назначается в карточке кабинета или актива',
  },
  commission_chair: {
    label: 'Председатель комиссии', kind: 'derived', scope: 'department',
    hint: 'Назначается при открытии инвентаризационной описи',
  },
};

/**
 * Матрица «экран или отчёт → кто видит». Списки ролей взяты из ТЗ дословно;
 * где ТЗ говорит «все сотрудники кабинета», это МОЛ и зав. отделением.
 *
 * write — кто может не только смотреть, но и менять данные экрана.
 */
const ACCESS_MATRIX = {
  'RPT-TURNOVER': {
    title: 'Оборотно-сальдовая ведомость',
    read: ['accountant', 'warehouse_head', 'department_head', 'auditor', 'module_admin'],
    write: [],
  },
  'RPT-MOVEMENT': {
    title: 'Движение активов и материалов',
    read: ['department_head', 'warehouse_head', 'accountant', 'auditor', 'module_admin'],
    write: ['warehouse_head', 'department_head'],
  },
  'RPT-CONSUMPTION': {
    title: 'Расход материалов по локациям',
    read: ['department_head', 'economist', 'warehouse_head', 'chief_doctor', 'module_admin'],
    write: [],
  },
  'RPT-CONSUMPTION-2': {
    title: 'Расход материалов по врачам',
    // Отдельной строкой: рейтинг врачей чувствителен, и ТЗ само предупреждает,
    // что он не оценка качества работы. Зав. складом здесь не нужен.
    read: ['chief_doctor', 'economist', 'department_head', 'module_admin'],
    write: [],
  },
  'RPT-EXPIRING': {
    title: 'Просроченные и истекающие позиции',
    read: ['warehouse_head', 'head_nurse', 'department_head', 'epidemiologist', 'module_admin'],
    write: ['warehouse_head', 'head_nurse'],
  },
  'RPT-DEPRECIATION': {
    title: 'Ведомость амортизации',
    read: ['accountant', 'economist', 'finance_director', 'module_admin'],
    write: [],
  },
  'RPT-MAINTENANCE': {
    title: 'Исполнение графика ТО',
    read: ['engineer', 'department_head', 'chief_doctor', 'auditor', 'module_admin'],
    write: ['engineer', 'module_admin'],
  },
  'RPT-MAINTENANCE-3': {
    title: 'Отказы и надёжность по моделям',
    read: ['engineer', 'chief_doctor', 'finance_director', 'module_admin'],
    write: [],
  },
  'RPT-ROOM-DASH': {
    title: 'Дашборд кабинета',
    read: ['responsible', 'department_head', 'warehouse_head', 'head_nurse', 'chief_doctor', 'module_admin'],
    write: [],
  },
  'RPT-HEATMAP': {
    title: 'Тепловая карта загрузки',
    read: ['chief_doctor', 'department_head', 'warehouse_head', 'module_admin'],
    write: [],
  },
  'RPT-INVENTORY': {
    title: 'Инвентаризационная опись',
    read: ['commission_chair', 'accountant', 'responsible', 'department_head',
           'warehouse_head', 'auditor', 'module_admin'],
    write: ['commission_chair', 'warehouse_head', 'department_head'],
  },
  'RPT-1C-RECON': {
    title: 'Сверка с 1С',
    read: ['accountant', 'module_admin'],
    write: [],
  },
  // Ведомость 1С отделена от сверки: сверка сопоставляет два учёта и адресована
  // бухгалтерии, а сама ведомость — это справочник «что вообще стоит на балансе»,
  // и он нужен куда более широкому кругу, вплоть до зав. отделением, который
  // ищет в ней своё оборудование.
  'RPT-OSV': {
    title: 'Оборотно-сальдовая ведомость 1С',
    read: ['accountant', 'warehouse_head', 'economist', 'finance_director',
           'department_head', 'auditor', 'module_admin'],
    write: [],
  },
  'RPT-RFQ-COMPARE': {
    title: 'Сравнение котировок',
    read: ['procurement', 'finance_director', 'warehouse_head', 'module_admin'],
    write: ['procurement', 'warehouse_head'],
  },
  'RPT-IDLE': {
    title: 'Простаивающее оборудование',
    read: ['chief_doctor', 'warehouse_head', 'engineer', 'finance_director', 'module_admin'],
    write: [],
  },
};

/**
 * Возможности модуля — что человек может делать, а не только смотреть.
 * Отделено от отчётов: «видит ведомость» и «может выдать материалы» — разные вещи.
 */
const CAPABILITY_MATRIX = {
  canEditLocations: { title: 'Настройка локаций и планов', roles: ['module_admin'] },
  canEditPlans:     { title: 'Редактор поэтажных планов', roles: ['module_admin'] },
  canManageAssets:  { title: 'Ведение карточек оборудования', roles: ['module_admin', 'warehouse_head', 'engineer'] },
  canManageCatalog: { title: 'Номенклатура, контрагенты, партии', roles: ['module_admin', 'warehouse_head'] },
  canIssue:         { title: 'Выдача, перемещение, списание', roles: ['module_admin', 'warehouse_head', 'department_head', 'head_nurse'] },
  canInventory:     { title: 'Проведение инвентаризации', roles: ['module_admin', 'warehouse_head', 'department_head', 'commission_chair'] },
  canMaintenance:   { title: 'Наряды ТО и ремонты', roles: ['module_admin', 'engineer', 'warehouse_head'] },
  canProcure:       { title: 'Запросы котировок и решения по ним', roles: ['module_admin', 'procurement', 'warehouse_head'] },
  canPrintLabels:   { title: 'Печать этикеток и QR', roles: ['module_admin', 'warehouse_head', 'engineer'] },
  canSeeCosts:      { title: 'Просмотр сумм и стоимости', roles: ['module_admin', 'warehouse_head', 'accountant', 'economist', 'finance_director', 'chief_doctor', 'auditor'] },
  // Загрузка ведомости из 1С — узкое право: принятый снимок становится базой
  // сверки на весь месяц, и загрузить не тот файл здесь дороже, чем ошибиться в
  // любом другом месте модуля.
  canImportOsv:     { title: 'Загрузка ведомости из 1С', roles: ['module_admin', 'accountant', 'warehouse_head'] },
  canManageAccess:  { title: 'Настройка прав модуля', roles: ['module_admin'] },
};

/**
 * Роли, назначенные пользователю через роли портала.
 * Читается из roles.permissions.warehouse.roles — существующий механизм прав.
 */
function assignedRoles(user) {
  const out = new Set();
  if (!user) return out;

  // Полный администратор портала получает администратора модуля: иначе после
  // выката некому будет раздать права, и модуль окажется заперт сам от себя.
  if (user.isAdmin) out.add('module_admin');

  const roles = [];
  if (Array.isArray(user.roles)) roles.push(...user.roles);
  if (user.role) roles.push(user.role);

  for (const role of roles) {
    const list = role?.permissions?.warehouse?.roles;
    if (Array.isArray(list)) {
      for (const key of list) if (WAREHOUSE_ROLES[key]) out.add(key);
    }
    // Обратная совместимость с ver. 6.68: роль «Склад» из миграции описана как
    // {warehouse:{read,write,delete,admin}} без списка ролей.
    const legacy = role?.permissions?.warehouse;
    if (legacy && !Array.isArray(legacy.roles)) {
      if (legacy.admin) out.add('module_admin');
      else if (legacy.write && legacy.delete) out.add('warehouse_head');
    }
  }
  return out;
}

/** Самая широкая область видимости среди набора ролей. */
function widestScope(roleKeys) {
  for (const key of roleKeys) {
    if (WAREHOUSE_ROLES[key]?.scope === 'network') return 'network';
  }
  return roleKeys.size || roleKeys.length ? 'department' : 'none';
}

function canRead(roleKeys, code) {
  const entry = ACCESS_MATRIX[code];
  if (!entry) return false;
  return entry.read.some(r => roleKeys.has(r));
}

function canWrite(roleKeys, code) {
  const entry = ACCESS_MATRIX[code];
  if (!entry) return false;
  return entry.write.some(r => roleKeys.has(r));
}

function capabilities(roleKeys) {
  const out = {};
  for (const [key, def] of Object.entries(CAPABILITY_MATRIX)) {
    out[key] = def.roles.some(r => roleKeys.has(r));
  }
  return out;
}

/** Отчёты, доступные набору ролей, в порядке матрицы. */
function readableReports(roleKeys) {
  return Object.entries(ACCESS_MATRIX)
    .filter(([code]) => canRead(roleKeys, code))
    .map(([code, def]) => ({ code, title: def.title }));
}

module.exports = {
  WAREHOUSE_ROLES,
  ACCESS_MATRIX,
  CAPABILITY_MATRIX,
  assignedRoles,
  widestScope,
  canRead,
  canWrite,
  capabilities,
  readableReports,
};
