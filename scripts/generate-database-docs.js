#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const docsDir = path.join(projectDir, 'docs', 'database');
const metadataPath = path.join(docsDir, 'production-metadata.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

const domains = [
  {
    name: 'Пользователи и доступ',
    description: 'Учётные записи, роли, сессии, устройства и разграничение доступа.',
    tables: ['users', 'roles', 'user_roles', 'user_med_centers', 'med_centers', 'user_sessions', 'user_devices', 'structural_divisions', 'division_access', 'rb_user_permissions'],
  },
  {
    name: 'Wiki и контент',
    description: 'Страницы базы знаний, структура меню, файлы, поиск и журнал изменений.',
    tables: ['folders', 'pages', 'page_history', 'media', 'user_favorites', 'sidebar_items', 'search_index', 'announcements', 'release_notes', 'release_note_reads', 'analysis_page_notes', 'service_page_notes'],
  },
  {
    name: 'Чаты и боты',
    description: 'Чаты, сообщения, реакции, подписчики и интеграции ботов.',
    tables: ['chats', 'chat_members', 'messages', 'message_reactions', 'bot_tokens', 'bot_updates', 'bot_subscribers', 'telegram_subscribers', 'form_subscriptions'],
  },
  {
    name: 'Курсы',
    description: 'Учебные курсы, уроки, вопросы, прогресс и правила доступа.',
    tables: ['courses', 'lessons', 'test_questions', 'course_progress', 'course_roles', 'course_medcenters', 'course_users'],
  },
  {
    name: 'Канбан',
    description: 'Доски, задачи и права доступа к ним.',
    tables: ['kanban_boards', 'kanban_tasks', 'board_permissions'],
  },
  {
    name: 'Отзывы',
    description: 'Сбор, синхронизация и обработка отзывов из внешних источников.',
    tables: ['review_boards', 'reviews', 'review_platforms', 'review_history', 'review_board_permissions', 'review_board_roles', 'review_sync_configs'],
  },
  {
    name: 'МИС и медицинские справочники',
    description: 'Данные МИС, услуги, анализы, врачи, аккредитации и медицинская номенклатура.',
    tables: ['mis_appointments', 'mis_payments', 'analyses', 'services', 'nomenclature_804n', 'partner_service_cache', 'doctor_cards', 'doctor_service_durations', 'accreditations', 'accreditation_files'],
  },
  {
    name: 'Зарплата и реферальные бонусы',
    description: 'Начисления, выплаты, расходники, отчёты и настройки расчёта.',
    tables: ['referral_bonuses', 'performed_service_bonuses', 'service_consumables', 'referral_reports', 'salary_records', 'cash_payments', 'executor_settings', 'rb_employees', 'rb_activity_log', 'rb_excel_sources', 'rb_doctor_headers'],
  },
  {
    name: 'Расписания и нормы',
    description: 'Расписания врачей, нормы времени, табели, кабинеты и праздники.',
    tables: ['doctor_schedules', 'rb_schedule_categories', 'rb_schedule_cabinets', 'mis_schedule_category_map', 'rb_holidays', 'hour_norms', 'role_norms', 'category_norms', 'tabel_records', 'tabel_record_doctors'],
  },
  {
    name: 'Сравнение цен',
    description: 'Источники конкурентов, география, услуги, цены и сопоставления.',
    tables: ['price_comparisons', 'price_comparison_items', 'competitor_sources', 'competitor_locations', 'competitor_services', 'competitor_prices', 'competitor_service_matches'],
  },
  {
    name: 'Публичный API и формы',
    description: 'API-клиенты, аудит запросов, формы и доставка результатов.',
    tables: ['api_clients', 'api_request_logs', 'submissions', 'submission_deliveries', 'int_id_map'],
  },
  {
    name: 'Email',
    description: 'Шаблоны, журнал рассылок и пользовательское избранное.',
    tables: ['email_templates', 'email_logs', 'email_favorite_templates', 'email_favorite_recipients'],
  },
  {
    name: 'Реестры и отчёты',
    description: 'Операционные журналы, реестры и специализированные медицинские отчёты.',
    tables: ['ambulance_report_entries', 'certificate_registry_entries', 'doctor_day_report_entries', 'operations_report_entries', 'gynecology_report_entries', 'therapy_report_entries', 'surgery_report_entries', 'discount_report_entries'],
  },
  {
    name: 'Прочее и системные данные',
    description: 'Календарь, акции, транспорт, карта, настройки и учёт миграций.',
    tables: ['calendar_events', 'promotions', 'vehicles', 'vehicle_files', 'map_markers', 'directories_meta', 'settings', 'schema_migrations'],
  },
];

const descriptions = {
  accreditation_files: 'Файлы, прикреплённые к записям об аккредитации.',
  accreditations: 'Реестр аккредитаций медицинских работников.',
  ambulance_report_entries: 'Строки отчёта по работе скорой медицинской помощи.',
  analyses: 'Справочник лабораторных анализов и связанных wiki-страниц.',
  analysis_page_notes: 'Примечания к анализам в контексте отдельных wiki-страниц.',
  announcements: 'Объявления, показываемые пользователям системы.',
  api_clients: 'Клиенты публичного API и их параметры доступа.',
  api_request_logs: 'Технический журнал обращений к публичному API.',
  board_permissions: 'Права пользователей на канбан-доски.',
  bot_subscribers: 'Подписчики внутренних ботов и параметры доставки уведомлений.',
  bot_tokens: 'Токены и настройки подключённых ботов.',
  bot_updates: 'Очередь и журнал входящих обновлений от ботов.',
  calendar_events: 'События общего и персонального календаря.',
  cash_payments: 'Денежные выплаты, связанные с зарплатными начислениями.',
  category_norms: 'Нормы рабочего времени по категориям расписания.',
  certificate_registry_entries: 'Реестр выданных сертификатов.',
  chat_members: 'Участники чатов, их роли и персональные настройки.',
  chats: 'Диалоги, групповые чаты и служебные каналы.',
  competitor_locations: 'Филиалы и географические точки медицинских организаций-конкурентов.',
  competitor_prices: 'Полученные цены конкурентов на медицинские услуги.',
  competitor_service_matches: 'Сопоставления услуг конкурентов с внутренним справочником.',
  competitor_services: 'Нормализованный каталог услуг конкурентов.',
  competitor_sources: 'Источники данных о ценах и услугах конкурентов.',
  course_medcenters: 'Медицинские центры, которым разрешён доступ к курсу.',
  course_progress: 'Прогресс пользователей по урокам и курсам.',
  course_roles: 'Роли пользователей, которым разрешён доступ к курсу.',
  course_users: 'Индивидуальные разрешения пользователей на доступ к курсам.',
  courses: 'Учебные курсы и параметры их публикации.',
  directories_meta: 'Метаданные справочников и время их обновления.',
  discount_report_entries: 'Строки отчёта по предоставленным скидкам.',
  division_access: 'Доступ пользователей к структурным подразделениям.',
  doctor_cards: 'Карточки врачей для публикации и внутренних процессов.',
  doctor_day_report_entries: 'Строки ежедневного отчёта врача.',
  doctor_schedules: 'Рабочие смены и интервалы расписания врачей.',
  doctor_service_durations: 'Продолжительность услуг для конкретных врачей и клиник.',
  email_favorite_recipients: 'Избранные получатели email для пользователя.',
  email_favorite_templates: 'Избранные email-шаблоны для пользователя.',
  email_logs: 'История отправки email-сообщений.',
  email_templates: 'Переиспользуемые шаблоны email-сообщений.',
  executor_settings: 'Персональные настройки исполнителей для расчётов и отчётов.',
  folders: 'Иерархия папок базы знаний.',
  form_subscriptions: 'Подписки чатов и пользователей на события публичных форм.',
  gynecology_report_entries: 'Строки гинекологического отчёта.',
  hour_norms: 'Месячные и периодические нормы рабочих часов.',
  int_id_map: 'Соответствие внешних целочисленных идентификаторов внутренним UUID.',
  kanban_boards: 'Канбан-доски медицинских центров.',
  kanban_tasks: 'Задачи канбан-досок, исполнители и вложения.',
  lessons: 'Уроки, входящие в учебные курсы.',
  map_markers: 'Метки и объекты, отображаемые на карте.',
  med_centers: 'Справочник медицинских центров.',
  media: 'Метаданные загруженных файлов и изображений.',
  message_reactions: 'Реакции пользователей на сообщения.',
  messages: 'Сообщения чатов, вложения, пересылки и опросы.',
  mis_appointments: 'Записи пациентов на приём, импортированные из МИС.',
  mis_payments: 'Платежи и оплаты, импортированные из МИС.',
  mis_schedule_category_map: 'Сопоставление категорий расписания с обозначениями МИС.',
  nomenclature_804n: 'Медицинская номенклатура по приказу №804н.',
  operations_report_entries: 'Строки отчёта о проведённых операциях.',
  page_history: 'Версии и журнал изменений wiki-страниц.',
  pages: 'Страницы базы знаний и их содержимое.',
  partner_service_cache: 'Кэш услуг и цен внешних партнёров.',
  performed_service_bonuses: 'Бонусные начисления за оказанные услуги.',
  price_comparison_items: 'Строки и показатели одного сравнения цен.',
  price_comparisons: 'Сохранённые наборы сравнения цен.',
  promotions: 'Маркетинговые акции и сроки их действия.',
  rb_activity_log: 'Аудит действий в модуле реферальных бонусов и зарплаты.',
  rb_doctor_headers: 'Пользовательские заголовки и группировка врачей в отчётах.',
  rb_employees: 'Сотрудники, участвующие в расчётах реферальных бонусов.',
  rb_excel_sources: 'Excel-источники данных для зарплатных отчётов.',
  rb_holidays: 'Праздничные и нерабочие дни для расчёта расписаний.',
  rb_schedule_cabinets: 'Кабинеты, используемые в расписаниях.',
  rb_schedule_categories: 'Категории смен и записей расписания.',
  rb_user_permissions: 'Специализированные права пользователя в зарплатном модуле.',
  referral_bonuses: 'Начисления реферальных бонусов врачам и клиникам.',
  referral_reports: 'Сформированные отчёты по реферальным бонусам.',
  release_note_reads: 'Факты прочтения заметок о релизах пользователями.',
  release_notes: 'Заметки об изменениях версий приложения.',
  review_board_permissions: 'Индивидуальные права пользователей на доски отзывов.',
  review_board_roles: 'Права ролей на доски отзывов.',
  review_boards: 'Доски для группировки и обработки отзывов.',
  review_history: 'История изменения статусов и содержимого отзывов.',
  review_platforms: 'Внешние площадки, с которых собираются отзывы.',
  review_sync_configs: 'Настройки автоматической синхронизации отзывов.',
  reviews: 'Отзывы клиентов и состояние их обработки.',
  role_norms: 'Нормы рабочего времени для ролей сотрудников.',
  roles: 'Роли пользователей и наборы разрешений.',
  salary_records: 'Расчётные строки заработной платы.',
  schema_migrations: 'Технический журнал применённых миграций БД.',
  search_index: 'Материализованные данные для полнотекстового поиска.',
  service_consumables: 'Расходные материалы и себестоимость медицинских услуг.',
  service_page_notes: 'Примечания к услугам в контексте отдельных wiki-страниц.',
  services: 'Справочник медицинских услуг и связанных wiki-страниц.',
  settings: 'Глобальные настройки приложения в формате ключ–значение.',
  sidebar_items: 'Элементы и порядок навигационного меню.',
  structural_divisions: 'Справочник структурных подразделений.',
  submission_deliveries: 'Попытки доставки данных формы конечным получателям.',
  submissions: 'Полученные через публичный API данные форм.',
  surgery_report_entries: 'Строки отчёта о хирургических вмешательствах.',
  tabel_record_doctors: 'Связь строк табеля с врачами.',
  tabel_records: 'Строки табеля рабочего времени.',
  telegram_subscribers: 'Подписчики Telegram-уведомлений.',
  test_questions: 'Контрольные вопросы учебных курсов.',
  therapy_report_entries: 'Строки терапевтического отчёта.',
  user_devices: 'Устройства пользователей и push-токены.',
  user_favorites: 'Избранные wiki-страницы пользователей.',
  user_med_centers: 'Связь пользователей с доступными медицинскими центрами.',
  user_roles: 'Связь пользователей с назначенными ролями.',
  user_sessions: 'Сессии входа и refresh-токены пользователей.',
  users: 'Учётные записи, профиль и индивидуальные разрешения пользователей.',
  vehicle_files: 'Файлы, прикреплённые к транспортным средствам.',
  vehicles: 'Реестр транспортных средств.',
};

const fieldDescriptions = {
  id: 'Уникальный идентификатор записи.',
  createdAt: 'Дата и время создания записи.',
  updatedAt: 'Дата и время последнего изменения записи.',
  deletedAt: 'Дата и время мягкого удаления записи.',
  created_at: 'Дата и время создания записи.',
  updated_at: 'Дата и время последнего изменения записи.',
  deleted_at: 'Дата и время мягкого удаления записи.',
  name: 'Наименование.',
  title: 'Заголовок или название.',
  description: 'Текстовое описание.',
  comment: 'Комментарий.',
  notes: 'Дополнительные примечания.',
  content: 'Основное содержимое записи.',
  status: 'Текущий статус записи.',
  type: 'Тип или категория записи.',
  code: 'Код записи во внутреннем или внешнем справочнике.',
  slug: 'Человекочитаемый идентификатор для URL.',
  sortOrder: 'Порядок отображения.',
  allDay: 'Признак события на весь день.',
  archived: 'Признак нахождения записи в архиве.',
  bypassPeriodLock: 'Разрешение обходить блокировку расчётного периода.',
  canAccessSalary: 'Разрешение доступа к зарплатному модулю.',
  canAccessStatistics: 'Разрешение доступа к статистике.',
  canAccessTopSalary: 'Разрешение просмотра рейтинга зарплат.',
  canEditAnalyses: 'Разрешение редактировать анализы.',
  canEditServices: 'Разрешение редактировать услуги.',
  canManagePromotions: 'Разрешение управлять акциями.',
  deprecated: 'Признак устаревшей записи.',
  isActive: 'Признак активной записи.',
  isAdmin: 'Признак администратора.',
  isAutoImported: 'Признак автоматического импорта.',
  isBot: 'Признак учётной записи бота.',
  isDeleted: 'Признак удаления записи.',
  is_deleted: 'Признак удаления записи.',
  isEdited: 'Признак редактирования записи.',
  isEnabled: 'Признак включённой записи или функции.',
  isExpanded: 'Признак развёрнутого состояния в интерфейсе.',
  isFavorite: 'Признак добавления в избранное.',
  isHidden: 'Признак скрытой записи.',
  isNotificationMuted: 'Признак отключённых уведомлений.',
  isPinned: 'Признак закреплённой записи.',
  pinned: 'Признак закреплённой записи.',
  isPublished: 'Признак публикации.',
  isReadOnly: 'Признак режима только для чтения.',
  isRecurring: 'Признак повторяющегося события.',
  isStopped: 'Признак остановленного процесса.',
  isSystem: 'Признак системной записи.',
  isVisible: 'Признак отображения записи.',
  is_company: 'Признак юридического лица.',
  is_refund: 'Признак возвратной операции.',
  processed: 'Признак завершённой обработки.',
  seededBaseline: 'Признак автоматически созданного базового значения.',
  subscribeAccreditations: 'Настройка подписки на события аккредитаций.',
  subscribeVehicles: 'Настройка подписки на события транспорта.',
  subscribedToAccreditations: 'Признак подписки на события аккредитаций.',
  subscribedToVehicles: 'Признак подписки на события транспорта.',
  reminded7: 'Признак отправки напоминания за 7 дней.',
  reminded14: 'Признак отправки напоминания за 14 дней.',
  reminded30: 'Признак отправки напоминания за 30 дней.',
  reminded60: 'Признак отправки напоминания за 60 дней.',
  reminded90: 'Признак отправки напоминания за 90 дней.',
  remindedTO: 'Признак отправки напоминания о техническом обслуживании.',
  displayName: 'Отображаемое имя.',
  fullName: 'Полное имя человека.',
  firstName: 'Имя.',
  lastName: 'Фамилия.',
  doctorName: 'ФИО врача.',
  doctor_name: 'ФИО врача.',
  patientName: 'ФИО пациента.',
  serviceName: 'Наименование медицинской услуги.',
  serviceCode: 'Код медицинской услуги.',
  searchText: 'Нормализованный текст для поиска.',
  createdBy: 'Идентификатор пользователя, создавшего запись.',
  updatedBy: 'Идентификатор пользователя, последним изменившего запись.',
  position: 'Позиция или должность — в зависимости от контекста таблицы.',
  specialty: 'Медицинская специальность.',
  gender: 'Пол.',
  bio: 'Краткая биографическая информация.',
  year: 'Год, к которому относится запись.',
  month: 'Месяц, к которому относится запись.',
  color: 'Цвет для отображения в интерфейсе.',
  icon: 'Идентификатор или путь к иконке.',
  category: 'Категория записи.',
  role: 'Роль в рамках данной сущности.',
  source: 'Источник получения данных.',
  token: 'Технический токен идентификации или доступа.',
  ip: 'IP-адрес источника запроса.',
  userAgent: 'Значение HTTP-заголовка User-Agent.',
  lat: 'Географическая широта.',
  lon: 'Географическая долгота.',
  email: 'Адрес электронной почты.',
  phone: 'Номер телефона.',
  username: 'Имя пользователя для входа.',
  password: 'Хеш пароля пользователя.',
  avatar: 'Путь или URL изображения профиля.',
  filename: 'Имя файла в хранилище.',
  originalName: 'Исходное имя загруженного файла.',
  mimeType: 'MIME-тип файла.',
  size: 'Размер файла в байтах.',
  path: 'Путь к ресурсу в хранилище.',
  url: 'URL внешнего или внутреннего ресурса.',
  metadata: 'Дополнительные структурированные метаданные.',
  settings: 'Структурированные настройки записи.',
  permissions: 'Набор разрешений.',
  payload: 'Структурированное содержимое события или запроса.',
  error: 'Описание возникшей ошибки.',
  errorMessage: 'Текст сообщения об ошибке.',
  response: 'Ответ внешней или внутренней системы.',
  request: 'Параметры исходного запроса.',
  amount: 'Денежная сумма или количественное значение.',
  price: 'Цена.',
  costPrice: 'Себестоимость.',
  quantity: 'Количество единиц.',
  date: 'Календарная дата записи.',
  startDate: 'Дата начала периода.',
  endDate: 'Дата окончания периода.',
  startTime: 'Время начала.',
  endTime: 'Время окончания.',
  publishedAt: 'Дата и время публикации.',
  completedAt: 'Дата и время завершения.',
  expiresAt: 'Дата и время окончания срока действия.',
  lastSeen: 'Дата и время последней активности.',
};

const domainByTable = new Map();
for (const domain of domains) {
  for (const table of domain.tables) {
    if (domainByTable.has(table)) throw new Error(`Таблица ${table} указана в двух доменах`);
    domainByTable.set(table, domain);
  }
}

const tablesByName = new Map(metadata.tables.map(table => [table.name, table]));
const columnsByTable = new Map();
for (const column of metadata.columns) {
  if (!columnsByTable.has(column.table)) columnsByTable.set(column.table, []);
  columnsByTable.get(column.table).push(column);
}
const constraintsByTable = new Map();
for (const constraint of metadata.constraints) {
  if (!constraintsByTable.has(constraint.table)) constraintsByTable.set(constraint.table, []);
  constraintsByTable.get(constraint.table).push(constraint);
}

const missingDomains = metadata.tables.map(t => t.name).filter(name => !domainByTable.has(name));
const unknownTables = [...domainByTable.keys()].filter(name => !tablesByName.has(name));
if (missingDomains.length || unknownTables.length) {
  throw new Error(`Некорректная карта доменов. Не распределены: ${missingDomains.join(', ')}. Не найдены: ${unknownTables.join(', ')}`);
}

function escapeCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function code(value) {
  if (value === null || value === undefined || value === '') return '—';
  const escaped = String(value)
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
  return `\`${escaped}\``;
}

function anchor(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё_\s-]/g, '')
    .replace(/\s+/g, '-');
}

function prettyName(value) {
  return value
    .replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
}

function tableDescription(table) {
  return table.comment || descriptions[table.name] || `Данные модуля «${prettyName(table.name)}».`;
}

function foreignKeyFor(table, columnName) {
  return (constraintsByTable.get(table) || []).find(
    item => item.type === 'foreign_key' && item.columns.includes(columnName),
  );
}

function fieldDescription(column) {
  if (column.comment) return column.comment;
  const fk = foreignKeyFor(column.table, column.name);
  if (fk) {
    const position = fk.columns.indexOf(column.name);
    return `Ссылка на \`${fk.referencedTable}.${fk.referencedColumns[position]}\`.`;
  }
  if (fieldDescriptions[column.name]) return fieldDescriptions[column.name];
  if (/Id$/.test(column.name) || /_id$/.test(column.name)) {
    return `Идентификатор связанной сущности «${prettyName(column.name.replace(/Id$|_id$/, ''))}».`;
  }
  if (/^(is|has|can)[A-Z_]/.test(column.name) || column.type === 'boolean') {
    return `Признак «${prettyName(column.name)}».`;
  }
  if (/(At|_at)$/.test(column.name) || column.type.startsWith('timestamp')) {
    return `Дата и время события «${prettyName(column.name.replace(/At$|_at$/, ''))}».`;
  }
  if (/(Date|_date)$/.test(column.name) || column.type === 'date') {
    return `Дата события «${prettyName(column.name.replace(/Date$|_date$/, ''))}».`;
  }
  if (/(Count|Attempts|Order|Number|Year|Month|Day|Hours|Minutes|Duration)$/.test(column.name)) {
    return `Числовое значение «${prettyName(column.name)}».`;
  }
  if (column.type === 'json' || column.type === 'jsonb') {
    return `Структурированные данные «${prettyName(column.name)}» в JSON.`;
  }
  if (column.type.endsWith('[]')) {
    return `Список значений «${prettyName(column.name)}».`;
  }
  return `Значение поля «${prettyName(column.name)}».`;
}

function keyLabels(table, column) {
  const labels = [];
  for (const constraint of constraintsByTable.get(table) || []) {
    if (!constraint.columns.includes(column.name)) continue;
    if (constraint.type === 'primary_key') labels.push('PK');
    if (constraint.type === 'foreign_key') labels.push('FK');
    if (constraint.type === 'unique') {
      labels.push(constraint.columns.length === 1 ? 'UQ' : 'UQ*');
    }
  }
  return labels.length ? labels.join(', ') : '—';
}

function mermaidKeyLabels(table, column) {
  const labels = [];
  for (const constraint of constraintsByTable.get(table) || []) {
    if (!constraint.columns.includes(column.name)) continue;
    if (constraint.type === 'primary_key') labels.push('PK');
    if (constraint.type === 'foreign_key') labels.push('FK');
    if (constraint.type === 'unique' && constraint.columns.length === 1) labels.push('UK');
  }
  return [...new Set(labels)].join(',');
}

function primaryKey(table) {
  const pk = (constraintsByTable.get(table) || []).find(item => item.type === 'primary_key');
  return pk ? pk.columns.map(code).join(', ') : '—';
}

function foreignKeyCount(table) {
  return (constraintsByTable.get(table) || []).filter(item => item.type === 'foreign_key').length;
}

function nullableLabel(column) {
  return column.nullable ? 'Да' : 'Нет';
}

function mermaidType(type) {
  if (type.includes('uuid')) return 'uuid';
  if (type.includes('timestamp')) return 'timestamp';
  if (type === 'date') return 'date';
  if (type === 'boolean') return 'boolean';
  if (type.includes('int')) return 'integer';
  if (type.includes('numeric') || type.includes('double') || type.includes('real')) return 'numeric';
  if (type.includes('json')) return 'jsonb';
  return 'string';
}

function mermaidForDomain(domain) {
  const tableSet = new Set(domain.tables);
  const relationships = metadata.constraints.filter(
    item => item.type === 'foreign_key' && tableSet.has(item.table),
  );
  const entityNames = new Set(domain.tables);
  for (const fk of relationships) entityNames.add(fk.referencedTable);
  const lines = ['```mermaid', 'erDiagram'];

  for (const fk of relationships) {
    const columns = columnsByTable.get(fk.table) || [];
    const nullable = fk.columns.some(name => columns.find(column => column.name === name)?.nullable);
    const unique = (constraintsByTable.get(fk.table) || []).some(
      item => ['primary_key', 'unique'].includes(item.type)
        && item.columns.length === fk.columns.length
        && item.columns.every(name => fk.columns.includes(name)),
    );
    const parentSide = nullable ? '|o' : '||';
    const childSide = unique ? 'o|' : 'o{';
    lines.push(`    ${fk.referencedTable} ${parentSide}--${childSide} ${fk.table} : "${fk.columns.join(', ')}"`);
  }

  for (const tableName of [...entityNames].sort()) {
    const keyColumns = (columnsByTable.get(tableName) || []).filter(column => {
      const labels = keyLabels(tableName, column);
      return labels.includes('PK') || labels.includes('FK');
    });
    if (!keyColumns.length) continue;
    lines.push(`    ${tableName} {`);
    for (const column of keyColumns) {
      lines.push(`      ${mermaidType(column.type)} ${column.name} ${mermaidKeyLabels(tableName, column)}`);
    }
    lines.push('    }');
  }
  lines.push('```');
  return lines.join('\n');
}

const capturedAt = new Date(metadata.databaseInfo.capturedAt);
const capturedText = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Moscow',
}).format(capturedAt);
const fkCount = metadata.constraints.filter(item => item.type === 'foreign_key').length;
const pkCount = metadata.constraints.filter(item => item.type === 'primary_key').length;

const readme = `# Документация production-БД Alfa-Wiki

Снимок получен напрямую из системных каталогов production PostgreSQL **${capturedText} (MSK)**. Пользовательские строки при выгрузке не читались.

## Паспорт

| Параметр | Значение |
|---|---|
| База данных | \`${escapeCell(metadata.databaseInfo.database)}\` |
| Схема | \`${escapeCell(metadata.databaseInfo.schema)}\` |
| PostgreSQL | ${escapeCell(metadata.databaseInfo.serverVersion)} |
| Таблиц | ${metadata.tables.length} |
| Полей | ${metadata.columns.length} |
| Первичных ключей | ${pkCount} |
| Внешних ключей | ${fkCount} |
| Индексов | ${metadata.indexes.length} |
| Enum-типов | ${metadata.enums.length} |
| Расширения | ${metadata.extensions.map(item => `${code(item.name)} ${escapeCell(item.version)}`).join(', ')} |

## Состав документации

- [ERD по функциональным доменам](ERD.md)
- [Каталог таблиц](TABLES.md)
- [Словарь полей](FIELDS.md)
- [Исходный снимок метаданных](production-metadata.json)

## Как читать описания

Комментарии, заданные непосредственно в PostgreSQL, имеют приоритет. Там, где комментариев нет, назначение таблиц и полей восстановлено по именам, связям, ограничениям, Sequelize-моделям и модулям приложения. Такие описания являются документационными, а не ограничениями БД.

Обозначения: **PK** — первичный ключ, **FK** — внешний ключ, **UQ** — уникальное ограничение одного поля, **UQ\*** — поле входит в составное уникальное ограничение. Значение «Допускает NULL: Да» означает, что поле необязательное.

## Функциональные области

| Область | Назначение | Таблиц |
|---|---|---:|
${domains.map(domain => `| [${domain.name}](ERD.md#${anchor(domain.name)}) | ${domain.description} | ${domain.tables.length} |`).join('\n')}
`;

const tableDocs = [`# Каталог таблиц production-БД`, '', `Актуально на **${capturedText} (MSK)**. Всего таблиц: **${metadata.tables.length}**.`, ''];
for (const domain of domains) {
  tableDocs.push(`## ${domain.name}`, '', domain.description, '', '| Таблица | Назначение | Полей | PK | FK |', '|---|---|---:|---|---:|');
  for (const tableName of domain.tables) {
    const table = tablesByName.get(tableName);
    tableDocs.push(`| [\`${tableName}\`](FIELDS.md#${anchor(tableName)}) | ${escapeCell(tableDescription(table))} | ${(columnsByTable.get(tableName) || []).length} | ${primaryKey(tableName)} | ${foreignKeyCount(tableName)} |`);
  }
  tableDocs.push('');
}

const fieldDocs = [
  '# Словарь полей production-БД',
  '',
  `Актуально на **${capturedText} (MSK)**. Таблиц: **${metadata.tables.length}**, полей: **${metadata.columns.length}**.`,
  '',
  'Для каждого поля указаны фактические тип, допустимость `NULL`, значение по умолчанию и ключевые ограничения production PostgreSQL.',
  '',
];
for (const domain of domains) {
  fieldDocs.push(`## ${domain.name}`, '');
  for (const tableName of domain.tables) {
    const table = tablesByName.get(tableName);
    fieldDocs.push(
      `### ${tableName}`,
      '',
      tableDescription(table),
      '',
      '| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |',
      '|---|---|:---:|---|:---:|---|',
    );
    for (const column of columnsByTable.get(tableName) || []) {
      fieldDocs.push(`| ${code(column.name)} | ${code(column.type)} | ${nullableLabel(column)} | ${code(column.default)} | ${keyLabels(tableName, column)} | ${escapeCell(fieldDescription(column))} |`);
    }
    fieldDocs.push('');
  }
}

const erdDocs = [
  '# ERD production-БД',
  '',
  `Диаграммы построены по **${fkCount} фактическим внешним ключам** production PostgreSQL на ${capturedText} (MSK). Для читаемости схема разделена на функциональные области; внешние сущности, на которые ссылается область, также показаны в соответствующей диаграмме.`,
  '',
  'В блоках сущностей приведены только поля PK/FK. Полный состав полей находится в [словаре полей](FIELDS.md).',
  '',
];
for (const domain of domains) {
  erdDocs.push(`## ${domain.name}`, '', domain.description, '', mermaidForDomain(domain), '');
}

const combinedContents = ['- [ERD](#erd)'];
for (const domain of domains) {
  combinedContents.push(`  - [${domain.name}](#erd-${anchor(domain.name)})`);
}
combinedContents.push('- [Каталог таблиц](#catalog)');
for (const domain of domains) {
  combinedContents.push(`  - [${domain.name}](#catalog-${anchor(domain.name)}) — ${domain.tables.length} табл.`);
}
combinedContents.push('- [Словарь полей](#fields)');
for (const domain of domains) {
  combinedContents.push(`  - [${domain.name}](#fields-${anchor(domain.name)})`);
  for (const tableName of domain.tables) {
    combinedContents.push(`    - [\`${tableName}\`](#table-${anchor(tableName)})`);
  }
}

const combinedDocs = [
  '# Production-БД Alfa-Wiki: ERD и словарь данных',
  '',
  '## Паспорт',
  '',
  '| Параметр | Значение |',
  '|---|---|',
  `| База данных | ${code(metadata.databaseInfo.database)} |`,
  `| Схема | ${code(metadata.databaseInfo.schema)} |`,
  `| PostgreSQL | ${escapeCell(metadata.databaseInfo.serverVersion)} |`,
  `| Таблиц | ${metadata.tables.length} |`,
  `| Полей | ${metadata.columns.length} |`,
  `| Первичных ключей | ${pkCount} |`,
  `| Внешних ключей | ${fkCount} |`,
  `| Индексов | ${metadata.indexes.length} |`,
  `| Enum-типов | ${metadata.enums.length} |`,
  `| Расширения | ${metadata.extensions.map(item => `${code(item.name)} ${escapeCell(item.version)}`).join(', ')} |`,
  '',
  '## Содержание',
  '',
  ...combinedContents,
  '',
  '<a id="erd"></a>',
  '## 1. ERD',
  '',
  `Диаграммы построены на основании **${fkCount} фактического внешнего ключа**. Для читаемости схема разделена на функциональные области; внешние сущности, на которые ссылается область, также показаны на соответствующей диаграмме. В блоках сущностей приведены только поля PK/FK.`,
  '',
];

domains.forEach((domain, index) => {
  combinedDocs.push(
    `<a id="erd-${anchor(domain.name)}"></a>`,
    `### 1.${index + 1}. ${domain.name}`,
    '',
    domain.description,
    '',
    mermaidForDomain(domain),
    '',
  );
});

combinedDocs.push(
  '<a id="catalog"></a>',
  '## 2. Каталог таблиц',
  '',
  'В каталоге приведено краткое назначение каждой таблицы. Название таблицы ведёт к её полному словарю полей ниже в этом же документе.',
  '',
);

domains.forEach((domain, index) => {
  combinedDocs.push(
    `<a id="catalog-${anchor(domain.name)}"></a>`,
    `### 2.${index + 1}. ${domain.name}`,
    '',
    domain.description,
    '',
    '| Таблица | Назначение | Полей | PK | FK |',
    '|---|---|---:|---|---:|',
  );
  for (const tableName of domain.tables) {
    const table = tablesByName.get(tableName);
    combinedDocs.push(`| [\`${tableName}\`](#table-${anchor(tableName)}) | ${escapeCell(tableDescription(table))} | ${(columnsByTable.get(tableName) || []).length} | ${primaryKey(tableName)} | ${foreignKeyCount(tableName)} |`);
  }
  combinedDocs.push('');
});

combinedDocs.push(
  '<a id="fields"></a>',
  '## 3. Словарь полей',
  '',
  'Для каждого поля указаны фактические тип PostgreSQL, допустимость `NULL`, значение по умолчанию, ключевые ограничения и описание.',
  '',
);

domains.forEach((domain, domainIndex) => {
  combinedDocs.push(
    `<a id="fields-${anchor(domain.name)}"></a>`,
    `### 3.${domainIndex + 1}. ${domain.name}`,
    '',
  );
  domain.tables.forEach((tableName, tableIndex) => {
    const table = tablesByName.get(tableName);
    combinedDocs.push(
      `<a id="table-${anchor(tableName)}"></a>`,
      `#### 3.${domainIndex + 1}.${tableIndex + 1}. ${tableName}`,
      '',
      tableDescription(table),
      '',
      '| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |',
      '|---|---|:---:|---|:---:|---|',
    );
    for (const column of columnsByTable.get(tableName) || []) {
      combinedDocs.push(`| ${code(column.name)} | ${code(column.type)} | ${nullableLabel(column)} | ${code(column.default)} | ${keyLabels(tableName, column)} | ${escapeCell(fieldDescription(column))} |`);
    }
    combinedDocs.push('');
  });
});

fs.writeFileSync(path.join(docsDir, 'README.md'), `${readme.trim()}\n`);
fs.writeFileSync(path.join(docsDir, 'TABLES.md'), `${tableDocs.join('\n').trim()}\n`);
fs.writeFileSync(path.join(docsDir, 'FIELDS.md'), `${fieldDocs.join('\n').trim()}\n`);
fs.writeFileSync(path.join(docsDir, 'ERD.md'), `${erdDocs.join('\n').trim()}\n`);
fs.writeFileSync(path.join(projectDir, 'docs', 'DATABASE_PRODUCTION.md'), `${combinedDocs.join('\n').trim()}\n`);

console.log(`Документация создана в ${docsDir}`);
console.log(`Единый документ: ${path.join(projectDir, 'docs', 'DATABASE_PRODUCTION.md')}`);
console.log(`Таблиц: ${metadata.tables.length}; полей: ${metadata.columns.length}; FK: ${fkCount}`);
