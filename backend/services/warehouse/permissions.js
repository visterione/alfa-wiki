/**
 * Права складского модуля (ver. 7.03).
 *
 * ── Что здесь изменилось и почему ────────────────────────────────────────────
 *
 * До этого права модуля выдавались ролям портала: в модуле жила своя матрица из
 * одиннадцати должностей (бухгалтер, экономист, эпидемиолог, инженер…), каждой
 * должности сопоставлялся набор отчётов и возможностей, а должность вешалась на
 * роль портала. Чтобы дать человеку один отчёт, надо было найти должность, в
 * которую этот отчёт входит, проверить, что вместе с ним не приедет лишнее,
 * и сопоставить её с ролью портала. Настройка через два справочника вместо
 * одного, и ни один из них не отвечал на прямой вопрос «что откроет Иванова».
 *
 * Теперь права выставляются человеку поимённо в дереве прав админки — тем же
 * механизмом, что у зарплатного модуля (RbUserPermission). Должностей нет,
 * сопоставлять ничего не нужно: в карточке пользователя видно ровно то, что он
 * получит.
 *
 * ── Три состояния, а не галочка ──────────────────────────────────────────────
 *
 * block / read / edit, как в зарплате. Разница между «видит остатки» и «выдаёт
 * материалы» — основная в складском учёте, и одной галочкой она не описывается.
 *
 * ── Почему один JSONB, а не колонка на право ─────────────────────────────────
 *
 * В зарплате под каждую вкладку своя колонка, и добавление вкладки требует
 * миграции. Здесь прав двадцать восемь (тринадцать разделов и пятнадцать
 * отчётов), и список будет расти вместе с отчётами — колонка на каждое право
 * превратила бы любой новый отчёт в миграцию схемы. Ключи хранятся в JSONB,
 * а этот файл остаётся единственным местом, где они перечислены.
 *
 * ── Что осталось от выводимых ролей ──────────────────────────────────────────
 *
 * Ничего в правах и всё в области видимости. МОЛ и заведующий отделением — это
 * не права, это факт: человек записан ответственным за кабинет или головой
 * отделения. На то, какие отчёты он открывает, это больше не влияет (влияет
 * дерево), а на то, чьи кабинеты он в них видит, — влияет по-прежнему.
 */

/** Допустимые значения права. Порядок важен: он же порядок в переключателе. */
const LEVELS = ['block', 'read', 'edit'];

/**
 * Разделы модуля. Ключ права → что он открывает.
 *
 * `capability` — имя возможности, которую даёт уровень edit. Имена оставлены
 * прежними: на них стоят 68 проверок на сервере и 42 на клиенте, и переименование
 * ничего бы не улучшило, зато переписало бы весь модуль.
 *
 * `viewCapability` — возможность, которую даёт уже уровень read (для прав, где
 * «смотреть» и есть всё содержание: суммы, этикетки).
 *
 * `tab` — вкладка модуля, которая скрывается при block.
 */
const SECTIONS = {
  map: {
    label: 'Карта и планы этажей', tab: 'map',
    hint: 'read — смотреть карту и планы, edit — рисовать планы и контуры',
    capability: 'canEditPlans',
  },
  locations: {
    label: 'Структура сети',
    hint: 'Медцентры, корпуса, этажи, кабинеты и места хранения',
    capability: 'canEditLocations',
  },
  rooms: {
    label: 'Кабинеты', tab: 'rooms',
    hint: 'Список кабинетов и дашборд кабинета',
  },
  assets: {
    label: 'Оборудование', tab: 'assets',
    hint: 'read — карточки основных средств, edit — постановка на учёт и правка',
    capability: 'canManageAssets',
  },
  stock: {
    label: 'Материалы и справочники', tab: 'stock',
    hint: 'read — остатки и сроки годности, edit — номенклатура, партии, контрагенты',
    capability: 'canManageCatalog',
  },
  operations: {
    label: 'Операции', tab: 'operations',
    hint: 'read — журнал документов, edit — выдача, перемещение, списание',
    capability: 'canIssue',
  },
  inventory: {
    label: 'Инвентаризация', tab: 'inventory',
    hint: 'read — описи, edit — проведение и оформление расхождений',
    capability: 'canInventory',
  },
  maintenance: {
    label: 'ТО и ремонты',
    hint: 'read — наряды и графики, edit — создание и закрытие нарядов',
    capability: 'canMaintenance',
  },
  procurement: {
    label: 'Закупки и котировки',
    hint: 'read — запросы и предложения, edit — создание запросов и решения',
    capability: 'canProcure',
  },
  osv: {
    label: 'Импорт из 1С', tab: 'osv',
    hint: 'read — ведомость и разбор, edit — загрузка XLSX и приём снимка',
    capability: 'canImportOsv',
  },
  labels: {
    label: 'Этикетки и QR',
    hint: 'Печать этикеток и QR-кодов — отдельным правом, потому что печатают их не те, кто ведёт учёт',
    viewCapability: 'canPrintLabels',
  },
  costs: {
    label: 'Суммы и стоимость',
    hint: 'Закупочные цены, остаточная стоимость, суммы в отчётах. Без права цифры скрыты, а сами экраны открыты',
    viewCapability: 'canSeeCosts',
  },
  reports: {
    label: 'Раздел «Отчёты»', tab: 'reports',
    hint: 'Доступ к самой вкладке. Какие отчёты внутри — ниже, по одному',
  },
};

/**
 * Отчёты. Ключ права совпадает с кодом отчёта: тот же код стоит в маршрутах
 * (requireReport) и в описании отчётов на клиенте, и разводить два обозначения
 * одного отчёта означало бы гарантированно их рассинхронизировать.
 */
const REPORTS = {
  'RPT-TURNOVER':     { label: 'Оборотно-сальдовая ведомость' },
  'RPT-MOVEMENT':     { label: 'Движение активов и материалов' },
  'RPT-CONSUMPTION':  {
    label: 'Расход материалов по локациям и ABC/XYZ',
    hint: 'Два отчёта под одним кодом: расход по локациям и ABC/XYZ-анализ номенклатуры',
  },
  'RPT-CONSUMPTION-2':{ label: 'Расход материалов по врачам', hint: 'Рейтинг врачей — чувствительный отчёт' },
  'RPT-EXPIRING':     { label: 'Просроченные и истекающие позиции' },
  'RPT-DEPRECIATION': { label: 'Ведомость амортизации' },
  'RPT-MAINTENANCE':  { label: 'Исполнение графика ТО' },
  'RPT-MAINTENANCE-3':{ label: 'Отказы и надёжность по моделям' },
  'RPT-ROOM-DASH':    { label: 'Дашборд кабинета' },
  'RPT-HEATMAP':      { label: 'Тепловая карта загрузки' },
  'RPT-INVENTORY':    { label: 'Инвентаризационная опись' },
  'RPT-OSV':          { label: 'Оборотно-сальдовая ведомость 1С' },
  'RPT-RFQ-COMPARE':  { label: 'Сравнение котировок' },
  'RPT-IDLE':         { label: 'Простаивающее оборудование' },
};

/** Все ключи прав — для проверки входящих данных. */
const ALL_KEYS = [...Object.keys(SECTIONS), ...Object.keys(REPORTS)];

/** Полный набор прав: всё разрешено. Для администратора портала. */
function fullPerms() {
  const out = {};
  for (const key of ALL_KEYS) out[key] = 'edit';
  return out;
}

/** Пустой набор: ничего не разрешено. Значение по умолчанию для нового человека. */
function emptyPerms() {
  const out = {};
  for (const key of ALL_KEYS) out[key] = 'block';
  return out;
}

/** Приводит произвольный объект к валидному набору прав. */
function normalize(raw) {
  const out = emptyPerms();
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ALL_KEYS) {
    if (LEVELS.includes(raw[key])) out[key] = raw[key];
  }
  return out;
}

const atLeastRead = level => level === 'read' || level === 'edit';

/**
 * Возможности из набора прав. Форма ответа та же, что была у матрицы ролей,
 * поэтому все проверки requireWarehouse('canX') и весь клиент работают как есть.
 */
function capabilities(perms) {
  const out = {};
  for (const [key, def] of Object.entries(SECTIONS)) {
    if (def.capability) out[def.capability] = perms[key] === 'edit';
    if (def.viewCapability) out[def.viewCapability] = atLeastRead(perms[key]);
  }
  return out;
}

/** Обратное отображение «возможность → ключ права» — только для текста ошибок. */
const CAPABILITY_TO_KEY = {};
for (const [key, def] of Object.entries(SECTIONS)) {
  if (def.capability) CAPABILITY_TO_KEY[def.capability] = key;
  if (def.viewCapability) CAPABILITY_TO_KEY[def.viewCapability] = key;
}

/** Заголовок возможности — для текста ошибки «Недостаточно прав: …». */
function capabilityTitle(name) {
  return SECTIONS[CAPABILITY_TO_KEY[name]]?.label || name;
}

function canReadReport(perms, code) {
  return atLeastRead(perms[code]);
}

function canWriteReport(perms, code) {
  return perms[code] === 'edit';
}

/** Отчёты, доступные набору прав, в порядке каталога. */
function readableReports(perms) {
  return Object.entries(REPORTS)
    .filter(([code]) => canReadReport(perms, code))
    .map(([code, def]) => ({ code, title: def.label }));
}

/** Вкладки, которые человеку видно. Ключ вкладки → показывать ли. */
function visibleTabs(perms) {
  const out = {};
  for (const [key, def] of Object.entries(SECTIONS)) {
    if (def.tab) out[def.tab] = atLeastRead(perms[key]);
  }
  return out;
}

/** Есть ли хоть одно право: без этого человеку в модуле делать нечего. */
function hasAnything(perms) {
  return ALL_KEYS.some(key => atLeastRead(perms[key]));
}

/**
 * Каталог для дерева прав в админке. Отдаётся клиенту, чтобы список прав
 * существовал в одном месте — на сервере, а не дублировался в вёрстке.
 */
function catalogue() {
  return {
    levels: LEVELS,
    sections: Object.entries(SECTIONS).map(([key, def]) => ({
      key, label: def.label, hint: def.hint || null, tab: def.tab || null,
    })),
    reports: Object.entries(REPORTS).map(([code, def]) => ({
      key: code, label: def.label, hint: def.hint || null,
    })),
  };
}

module.exports = {
  LEVELS,
  SECTIONS,
  REPORTS,
  ALL_KEYS,
  fullPerms,
  emptyPerms,
  normalize,
  capabilities,
  capabilityTitle,
  canReadReport,
  canWriteReport,
  readableReports,
  visibleTabs,
  hasAnything,
  catalogue,
};
