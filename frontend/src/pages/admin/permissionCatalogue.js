/**
 * Каталог прав портала: что есть в дереве, как называется и куда пишется.
 *
 * Появился в 8.31 вместе с массовой правкой прав. До него дерево жило одним
 * куском вёрстки внутри карточки пользователя: ключ, подпись и способ записи
 * были размазаны по обработчику каждого пункта. Пока читатель был один, это
 * работало. Как только их стало двое — карточка и массовая правка, — список
 * пришлось бы набрать второй раз, и он бы разошёлся: новый модуль добавили бы в
 * карточку и забыли в массовой правке, а узнали бы об этом через полгода
 * вопросом «почему этого пункта нет в списке».
 *
 * Поэтому здесь только перечень: ключ, подпись и адрес хранения. Ни состояния,
 * ни обработчиков — их каждый читатель делает свои, они у них разные. Права
 * склада сюда не переписаны намеренно: их каталог отдаёт сервер
 * (services/warehouse/permissions.js), и вот он как раз единственный источник.
 *
 * ── Адреса хранения ──────────────────────────────────────────────────────────
 *
 * Права портала разложены по четырём местам, и это не наследие, а разные сроки
 * жизни: доступ к разделам — JSONB у пользователя, зарплата и склад — свои
 * таблицы со своими проверками на сервере. Поле `target` называет место:
 *
 *   adminAccess      → user.adminAccess[key], булево
 *   flag             → колонка самого пользователя (canEditServices и такие же)
 *   marketing        → user.adminAccess.marketing[key], три уровня
 *   statisticsTabs   → user.statisticsTabs[key], булево
 *   salary           → RbUserPermission[key], три уровня
 *   salaryClinic     → RbUserPermission.clinics, список
 *   warehouse        → WhUserPermission.perms[key], три уровня
 *   warehouseCenter  → WhUserPermission.medCenterIds, список
 */

// Список зарплатных клиник остаётся своим: модуль «Зарплата» на справочник
// медцентров (ver. 6.67) пока не переведён — решено не трогать его без
// отдельного захода, слишком велика цена ошибки в расчётах.
export const SALARY_CLINICS = [
  { id: '2',  name: 'Альфа',       color: '#de64a1' },
  { id: '3',  name: 'Кидс',        color: '#ed9121' },
  { id: '1',  name: 'Проф',        color: '#9999ff' },
  { id: '6',  name: 'Линия',       color: '#e2d1bb' },
  { id: '4',  name: '3К',          color: '#800080' },
  { id: '7',  name: 'Смайл',       color: '#999999' },
  { id: '8',  name: 'Направители', color: '#00bfff' },
  { id: '11', name: 'Сукко',       color: '#2d7055' },
  { id: '12', name: 'Нео',         color: '#008cb4' },
  { id: 'ip', name: 'ИП Микаелян', color: '#e05252' },
];

/** Разделы админки. Все пишутся одинаково — в adminAccess по своему ключу. */
export const ADMIN_SECTIONS = [
  { key: 'pages',    label: 'Проводник' },
  { key: 'roles',    label: 'Роли и права' },
  { key: 'settings', label: 'Настройки' },
  { key: 'sidebar',  label: 'Меню навигации' },
  { key: 'media',    label: 'Медиафайлы' },
  { key: 'users',    label: 'Пользователи' },
  { key: 'backup',   label: 'Резервные копии' },
  { key: 'journal',  label: 'Журнал' },
  { key: 'parser',   label: 'Парсер цен' },
  // Состав линий, тексты уведомлений всей сети и токены провайдера. Отдельно от
  // самой открытой линии ниже: рабочее окно колл-центра открыто десяткам
  // операторов, а это — совсем другой круг людей.
  { key: 'openLineAdmin', label: 'Открытая линия: настройки' },
].map(item => ({ ...item, id: item.key, target: 'adminAccess', kind: 'bool' }));

/**
 * Модули. Половина лежит в adminAccess, половина — отдельными колонками
 * пользователя: так сложилось исторически, и переезд колонок в JSONB стоил бы
 * миграции и правки всех мест, где их читают. Дереву эта разница не видна,
 * поэтому адрес назван здесь, а не угадывается по имени.
 */
export const MODULE_ITEMS = [
  { id: 'reviews',      key: 'reviews',            target: 'adminAccess', label: 'Отзывы' },
  { id: 'services',     key: 'canEditServices',    target: 'flag',        label: 'Услуги' },
  { id: 'courses',      key: 'courses',            target: 'adminAccess', label: 'Курсы' },
  // Задачи (ver. 6.75, на смену канбану). Право было заведено в модели и
  // проверяется маршрутами с самого начала, но в дерево его тогда не вывели —
  // выдать доступ из интерфейса было нечем, только правкой adminAccess в базе.
  // Флаг решает только видимость раздела: кто чью загрузку видит, определяют
  // команды (TaskTeam).
  { id: 'tasks',        key: 'tasks',              target: 'adminAccess', label: 'Задачи' },
  { id: 'doctorCards',  key: 'canEditDoctorCards', target: 'flag',        label: 'Карточки врачей' },
  { id: 'analyses',     key: 'canEditAnalyses',    target: 'flag',        label: 'Анализы' },
  { id: 'releaseNotes', key: 'releaseNotes',       target: 'adminAccess', label: 'Нововведения' },
  { id: 'medCenters',   key: 'medCenters',         target: 'adminAccess', label: 'Медцентры' },
  // Онбординг врача: флаг открывает раздел, но заявки человек увидит только там,
  // где назначен исполнителем шага.
  { id: 'onboarding',   key: 'onboarding',         target: 'adminAccess', label: 'Онбординг врача' },
  // Вакансии (ver. 8.34) — второе поколение онбординга. Флаг делает две вещи:
  // открывает раздел и вводит человека в список тех, кого можно назначить
  // исполнителем шага. Собирать сами вакансии по-прежнему может только админ.
  { id: 'vacancies',    key: 'vacancies',          target: 'adminAccess', label: 'Вакансии' },
  // Открытая линия: флаг открывает раздел, но обращения человек увидит только
  // тех линий, в состав которых заведён (OmniLineOperator). Состав и есть право
  // отвечать — здесь только видимость самого раздела.
  { id: 'openLine',     key: 'openLine',           target: 'adminAccess', label: 'Открытая линия' },
].map(item => ({ ...item, kind: 'bool' }));

/**
 * Маркетинг (ver. 8.22). Три вкладки бывших разрозненных разделов, и у каждой
 * свой уровень: акции смотрят регистраторы, чтобы отвечать пациенту по телефону,
 * а заводит их один ответственный маркетолог. Заведённую акцию нельзя ни
 * изменить, ни удалить — в API МИС нет таких методов, — поэтому цена случайной
 * правки выше обычной, и «смотреть» отделено от «заводить».
 */
export const MARKETING_TABS = [
  { key: 'promotions',    label: 'Акции' },
  { key: 'ads',           label: 'Карта реклам' },
  { key: 'announcements', label: 'Анонсы и рассылки' },
].map(item => ({ ...item, id: `mk_${item.key}`, target: 'marketing', kind: 'level' }));

/** Вкладки зарплаты. Подгруппы те же, что в карточке пользователя. */
export const SALARY_NODES = [
  { id: 'salaryClinics', label: 'Медцентры', isSubGroup: true, expandKey: 'salary_clinics',
    items: SALARY_CLINICS.map(c => ({
      id: `clinic_${c.id}`, key: c.id, target: 'salaryClinic', kind: 'bool',
      label: c.name, color: c.color,
    })) },
  { id: 'tab1', key: 'tab1', target: 'salary', kind: 'level', label: 'Сотрудники' },
  { id: 'salaryWorkTime', label: 'Учёт времени', isSubGroup: true, expandKey: 'salary_workTime',
    items: [
      { id: 'tabWorkTime',  key: 'tabWorkTime',  target: 'salary', kind: 'level', label: 'Учёт рабочего времени' },
      { id: 'tabHourNorms', key: 'tabHourNorms', target: 'salary', kind: 'level', label: 'Норма часов' },
      { id: 'tabSchedule',  key: 'tabSchedule',  target: 'salary', kind: 'level', label: 'Расписание' },
    ] },
  { id: 'tab2', key: 'tab2', target: 'salary', kind: 'level', label: 'Услуги' },
  { id: 'tab3', key: 'tab3', target: 'salary', kind: 'level', label: 'Направления' },
  { id: 'tab4', key: 'tab4', target: 'salary', kind: 'level', label: 'Отчёт' },
  { id: 'salaryArchive', label: 'Архив', isSubGroup: true, expandKey: 'salary_archive',
    items: [
      { id: 'tabArchiveHistory', key: 'tabArchiveHistory', target: 'salary', kind: 'level', label: 'Архив' },
      { id: 'tabArchiveKassa',   key: 'tabArchiveKassa',   target: 'salary', kind: 'level', label: 'Касса' },
      { id: 'tabArchiveTabel',   key: 'tabArchiveTabel',   target: 'salary', kind: 'level', label: 'Табели' },
    ] },
  { id: 'tabSummary', key: 'tabSummary', target: 'salary', kind: 'level', label: 'Сводка' },
  // АУП — секретная клиника. Флаг НЕ зависит от isAdmin: админ без него данные
  // АУП не видит (в этом весь смысл).
  { id: 'aupAccess', key: 'canAccessTopSalary', target: 'flag', kind: 'bool',
    label: 'АУП — секретная клиника', color: '#111111' },
];

/** Вкладки статистики. Все булевы, все в statisticsTabs. */
export const STATISTICS_NODES = [
  { id: 'statKpi', label: 'Аналитика', isSubGroup: true, expandKey: 'statistics_kpi',
    items: [
      { key: 'kpiGeneral',     label: 'Общая' },
      { key: 'kpiPatients',    label: 'Пациенты' },
      { key: 'kpiMargin',      label: 'Маржинальность' },
      { key: 'kpiEfficiency',  label: 'Эффективность' },
      { key: 'kpiRooms',       label: 'Кабинеты' },
      { key: 'kpiReputation',  label: 'Репутация' },
      { key: 'kpiUtilities',   label: 'Коммунальные' },
      { key: 'kpiConsumables', label: 'Расходники' },
      { key: 'kpiServiceCost', label: 'Себестоимость' },
    ] },
  { id: 'statDirectories', label: 'Справочники', isSubGroup: true, expandKey: 'statistics_directories',
    items: [
      { key: 'dirClinics',     label: 'Филиалы' },
      { key: 'dirCabinets',    label: 'Кабинеты' },
      { key: 'dirDoctors',     label: 'Врачи' },
      { key: 'dirEquipment',   label: 'Оборудование' },
      { key: 'dirUtilities',   label: 'Коммунальные' },
      { key: 'dirConsumables', label: 'Расходники' },
      { key: 'dirMarketing',   label: 'Маркетинг' },
    ] },
  { id: 'statServices', label: 'Услуги', isSubGroup: true, expandKey: 'statistics_services',
    items: [
      { key: 'svcServices',        label: 'Услуги' },
      { key: 'svcPartnerServices', label: 'Услуги партнёров' },
    ] },
].map(group => ({
  ...group,
  items: group.items.map(item => ({ ...item, id: item.key, target: 'statisticsTabs', kind: 'bool' })),
}));

/** Плоский перечень ключей подгруппы — для кнопок «включить все». */
export const nodeKeys = (nodes) => nodes.flatMap(n => (n.isSubGroup ? n.items : [n])).map(n => n.key);

/**
 * Дерево для массовой правки: то же, что в карточке, минус суперадминистратор.
 *
 * Суперадмина здесь нет намеренно. Это не «ещё одно право», а полный доступ ко
 * всему порталу вместе с выдачей прав другим, и раздавать его выборкой по роли
 * нельзя даже теоретически: одна опечатка в отборе — и права администратора
 * получает смена регистраторов. Ставится он по-прежнему поимённо в карточке.
 *
 * Родительские тумблеры разделов (доступ к зарплате, складу, статистике) в
 * массовой правке обычные пункты: они и есть обычные булевы права, просто в
 * карточке нарисованы шапкой группы.
 */
export function buildBulkTree(whCatalogue) {
  return [
    { id: 'admin', label: 'Административный доступ', items: ADMIN_SECTIONS },
    { id: 'modules', label: 'Модули', items: MODULE_ITEMS },
    { id: 'marketing', label: 'Маркетинг', items: MARKETING_TABS },
    {
      id: 'salary',
      label: 'Зарплата',
      items: [
        { id: 'canAccessSalary', key: 'canAccessSalary', target: 'flag', kind: 'bool',
          label: 'Доступ к разделу' },
        ...SALARY_NODES,
      ],
    },
    {
      id: 'warehouse',
      label: 'Складской учёт',
      items: [
        { id: 'warehouseAccess', key: 'warehouse', target: 'adminAccess', kind: 'bool',
          label: 'Доступ к разделу' },
        ...(whCatalogue?.medCenters?.length ? [{
          id: 'whCenters', label: 'Медцентры', isSubGroup: true, expandKey: 'warehouse_clinics',
          items: whCatalogue.medCenters.map(mc => ({
            id: `wh_mc_${mc.id}`, key: mc.id, target: 'warehouseCenter', kind: 'bool',
            label: mc.name, color: mc.color,
          })),
        }] : []),
        ...(whCatalogue?.sections || []).map(sec => ({
          id: `wh_${sec.key}`, key: sec.key, target: 'warehouse', kind: 'level', label: sec.label,
        })),
        ...(whCatalogue?.reports?.length ? [{
          id: 'whReports', label: `Отчёты (${whCatalogue.reports.length})`,
          isSubGroup: true, expandKey: 'warehouse_reports',
          items: whCatalogue.reports.map(rep => ({
            id: `wh_${rep.key}`, key: rep.key, target: 'warehouse', kind: 'level', label: rep.label,
          })),
        }] : []),
      ],
    },
    {
      id: 'statistics',
      label: 'Статистика',
      items: [
        { id: 'canAccessStatistics', key: 'canAccessStatistics', target: 'flag', kind: 'bool',
          label: 'Доступ к разделу' },
        ...STATISTICS_NODES,
      ],
    },
  ];
}

/** Все листья дерева подряд — по ним считается, что именно человек изменил. */
export function flattenNodes(tree) {
  return tree.flatMap(group => group.items.flatMap(item => (item.isSubGroup ? item.items : [item])));
}

/**
 * Правки из дерева → тело запроса на сервер.
 *
 * Ключевое здесь — что в теле оказывается ровно то, что человек тронул. Ни один
 * раздел не попадает в запрос «пустым»: сервер различает «ключа нет» и «ключ со
 * значением», и на этом различии стоит обещание не сбросить остальные права.
 */
export function buildPatch(tree, values) {
  const patch = {};
  const put = (section, key, value) => {
    if (!patch[section]) patch[section] = {};
    patch[section][key] = value;
  };
  const push = (section, field, value) => {
    if (!patch[section]) patch[section] = {};
    if (!patch[section][field]) patch[section][field] = [];
    patch[section][field].push(value);
  };

  for (const node of flattenNodes(tree)) {
    const value = values[node.id];
    if (value === undefined) continue;

    switch (node.target) {
      case 'adminAccess':    put('adminAccess', node.key, value); break;
      case 'flag':           put('flags', node.key, value); break;
      case 'marketing':      put('marketing', node.key, value); break;
      case 'statisticsTabs': put('statisticsTabs', node.key, value); break;
      case 'salary':         put('salaryTabs', node.key, value); break;
      case 'warehouse':      put('warehousePerms', node.key, value); break;
      case 'salaryClinic':
        push('salaryClinics', value ? 'add' : 'remove', node.key); break;
      case 'warehouseCenter':
        push('warehouseCenters', value ? 'add' : 'remove', node.key); break;
      default: break;
    }
  }

  return patch;
}
