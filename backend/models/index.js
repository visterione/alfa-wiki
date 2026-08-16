const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();
const { buildDatabaseRuntimeConfig } = require('../utils/databaseRuntimeConfig');

const databaseRuntimeConfig = buildDatabaseRuntimeConfig();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: databaseRuntimeConfig.pool,
    timezone: '+00:00', // Храним в UTC
    dialectOptions: databaseRuntimeConfig.dialectOptions,
  }
);

// === ROLE MODEL ===
const Role = sequelize.define('Role', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  description: { type: DataTypes.TEXT },
  permissions: { 
    type: DataTypes.JSONB, 
    defaultValue: { pages: { read: true, write: false, delete: false, admin: false } }
  },
  isSystem: { type: DataTypes.BOOLEAN, defaultValue: false },
  chatBadgeIcon: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Имя lucide-иконки метки в чате'
  },
  chatBadgeLabel: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'Подпись метки (tooltip); пусто — берётся название иконки'
  },
  badgePriority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Чем больше, тем важнее роль при выборе иконки у мультиролевого сотрудника'
  }
}, { tableName: 'roles', timestamps: true });

// === USER MODEL (С 2FA) ===
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  displayName: { type: DataTypes.STRING(100) },
  email: { type: DataTypes.STRING(255) },
  avatar: { type: DataTypes.STRING(500) },
  // Вычисляется services/userChatBadge.js из ролей, клиник и chatBadgeOverride.
  // Напрямую из API не пишется — все запросы чата читают именно это поле.
  chatBadge: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Вычисленная метка в чате: { type, value, color, label }'
  },
  chatBadgeOverride: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Ручное переопределение метки: { value, color, label }'
  },
  phone: { type: DataTypes.STRING(50) },
  position: { type: DataTypes.STRING(100) },
  specialty: { type: DataTypes.STRING(200) },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'ID сотрудника в МИС для персональных разделов врача'
  },
  gender: { type: DataTypes.STRING(10) },
  birthDate: { type: DataTypes.DATEONLY, field: 'birth_date' },
  bio: { type: DataTypes.TEXT },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  lastLogin: { type: DataTypes.DATE },
  lastSeen: { type: DataTypes.DATE, comment: 'Время последнего выхода из сети' },
  settings: { type: DataTypes.JSONB, defaultValue: {} },

  // Admin access control (granular permissions for admin sections)
  adminAccess: {
    type: DataTypes.JSONB,
    defaultValue: {
      pages: false,      // Управление страницами
      sidebar: false,    // Меню навигации
      users: false,      // Пользователи
      roles: false,      // Роли и права
      media: false,      // Медиафайлы
      backup: false,     // Резервные копии
      settings: false,   // Настройки
      courses: false,    // Курсы
      // Модуль «Задачи» (ver. 6.75), пришёл на смену канбану. Флаг решает
      // только одно: видит ли человек раздел. Кто чью загрузку видит —
      // определяют команды (TaskTeam), а не этот переключатель.
      tasks: false,
      journal: false,    // Журнал страниц
      reviews: false,    // Отзывы
      parser: false,     // Парсер цен конкурентов
      // Справочник медцентров: юрлица, адреса, графики, главврачи, логотипы.
      // Отдельно от roles намеренно — иначе, чтобы дать человеку поправить адрес
      // филиала, пришлось бы выдать ему всю систему прав.
      medCenters: false,
      // Складской учёт (ver. 6.68). Внутри модуля есть свои уровни (зав. складом,
      // зав. отделением, наблюдатель) — они выводятся из ролей и из того, где
      // человек назначен ответственным, см. services/warehouse/access.js.
      // Этот флаг решает только одно: видит ли он раздел вообще.
      warehouse: false
    },
    comment: 'Гранулярный доступ к админ-разделам'
  },
  
  // 2FA поля
  twoFactorEnabled: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false,
    comment: 'Включена ли 2FA для этого пользователя' 
  },
  twoFactorCode: { 
    type: DataTypes.STRING(6),
    comment: 'Временный код для 2FA' 
  },
  twoFactorCodeExpires: { 
    type: DataTypes.DATE,
    comment: 'Время истечения кода 2FA' 
  },
  twoFactorAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Количество неудачных попыток ввода кода'
  },

  // Доступ к редактированию карточек врачей
  canEditDoctorCards: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Разрешение на создание, редактирование и удаление карточек врачей'
  },

  // Доступ к редактированию анализов
  canEditAnalyses: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Разрешение на редактирование и удаление анализов'
  },

  // Доступ к редактированию услуг
  canEditServices: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Разрешение на редактирование и удаление услуг'
  },

  // Доступ к разделу зарплаты (Referral Bonuses)
  canAccessSalary: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Разрешение на доступ к разделу зарплаты и бонусов'
  },

  // Доступ к разделу статистики
  canAccessStatistics: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Разрешение на доступ к разделу статистики'
  },

  // Доступ к секретной клинике «АУП» (зарплаты верхушки).
  // Ортогонален isAdmin — админ БЕЗ этого флага АУП не видит.
  canAccessTopSalary: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Доступ к секретной клинике АУП (скрыта даже от админов без флага)'
  },

  // Флаг системного бота (Ассистент)
  isBot: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Системный бот-пользователь (Ассистент для уведомлений)'
  },

  // Доступ к управлению акциями
  canManagePromotions: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Разрешение на создание, редактирование и удаление акций медцентров'
  },

  taskWorkSchedule: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null,
    comment: 'Недельное рабочее расписание по дням и границы смен'
  },

  // Мягкое удаление (корзина)
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    comment: 'Время перемещения пользователя в корзину (null = активен)'
  },
  deletedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    defaultValue: null,
    comment: 'ID администратора, переместившего пользователя в корзину'
  }
}, { tableName: 'users', timestamps: true });

// === FOLDER MODEL ===
const Folder = sequelize.define('Folder', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  slug: { type: DataTypes.STRING(255), allowNull: true },
  icon: { type: DataTypes.STRING(50), defaultValue: 'folder' },
  parentId: { type: DataTypes.UUID, allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  description: { type: DataTypes.TEXT },
  createdBy: { type: DataTypes.UUID },
  allowedRoles: { type: DataTypes.ARRAY(DataTypes.UUID), defaultValue: [] }
}, {
  tableName: 'folders',
  timestamps: true,
  indexes: [
    { fields: ['parentId'] },
    { fields: ['sortOrder'] },
    { fields: ['slug'] }
  ]
});

// === PAGE MODEL ===
const Page = sequelize.define('Page', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  title: { type: DataTypes.STRING(500), allowNull: false },
  content: { type: DataTypes.TEXT },
  contentType: { type: DataTypes.ENUM('wysiwyg', 'html', 'spreadsheet', 'file'), defaultValue: 'wysiwyg' },
  description: { type: DataTypes.TEXT },
  keywords: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  searchContent: { type: DataTypes.TEXT },
  icon: { type: DataTypes.STRING(50) },
  folderId: { type: DataTypes.UUID, allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  isPublished: { type: DataTypes.BOOLEAN, defaultValue: false },
  isFavorite: { type: DataTypes.BOOLEAN, defaultValue: false },
  allowedRoles: { type: DataTypes.ARRAY(DataTypes.UUID), defaultValue: [] },
  customCss: { type: DataTypes.TEXT },
  customJs: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSONB, defaultValue: {} },
  mediaId: { type: DataTypes.UUID, allowNull: true },
  createdBy: { type: DataTypes.UUID },
  updatedBy: { type: DataTypes.UUID }
}, {
  tableName: 'pages',
  timestamps: true,
  indexes: [
    { fields: ['slug'] },
    { fields: ['title'] },
    { fields: ['folderId'] },
    { type: 'GIN', fields: ['keywords'] }
  ]
});

// === PAGE HISTORY MODEL ===
const PageHistory = sequelize.define('PageHistory', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  pageId: { type: DataTypes.UUID, allowNull: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  action: {
    type: DataTypes.ENUM('created', 'updated', 'published', 'unpublished'),
    allowNull: false,
    comment: 'Тип действия: created - создание, updated - редактирование, published/unpublished - изменение статуса публикации'
  },
  changesSummary: {
    type: DataTypes.TEXT,
    comment: 'Краткое описание изменений (опционально)'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Дополнительные данные: измененные поля, старые/новые значения и т.д.'
  }
}, {
  tableName: 'page_history',
  timestamps: true,
  updatedAt: false, // Отключаем updatedAt, т.к. история не должна меняться
  indexes: [
    { fields: ['pageId'] },
    { fields: ['userId'] },
    { fields: ['createdAt'] },
    { fields: ['action'] }
  ]
});

// === USER FAVORITE MODEL ===
const UserFavorite = sequelize.define('UserFavorite', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  pageId: { type: DataTypes.UUID, allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 }
}, { 
  tableName: 'user_favorites', 
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'pageId'] }
  ]
});

// === SIDEBAR ITEM MODEL ===
const SidebarItem = sequelize.define('SidebarItem', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type: { type: DataTypes.ENUM('page', 'folder', 'header', 'link', 'divider'), defaultValue: 'page' },
  title: { type: DataTypes.STRING(255) },
  icon: { type: DataTypes.STRING(50) },
  pageId: { type: DataTypes.UUID },
  folderId: { type: DataTypes.UUID },
  externalUrl: { type: DataTypes.STRING(1000) },
  parentId: { type: DataTypes.UUID },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  isExpanded: { type: DataTypes.BOOLEAN, defaultValue: true },
  allowedRoles: { type: DataTypes.ARRAY(DataTypes.UUID), defaultValue: [] },
  isVisible: { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'sidebar_items', timestamps: true });

// === MEDIA MODEL ===
const Media = sequelize.define('Media', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  filename: { type: DataTypes.STRING(255), allowNull: false },
  originalName: { type: DataTypes.STRING(255) },
  mimeType: { type: DataTypes.STRING(100) },
  size: { type: DataTypes.BIGINT },
  path: { type: DataTypes.STRING(1000), allowNull: false },
  thumbnailPath: { type: DataTypes.STRING(1000) },
  alt: { type: DataTypes.STRING(500) },
  description: { type: DataTypes.TEXT },
  uploadedBy: { type: DataTypes.UUID }
}, { tableName: 'media', timestamps: true });

// === SEARCH INDEX MODEL ===
const SearchIndex = sequelize.define('SearchIndex', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entityType: { type: DataTypes.STRING(50), allowNull: false },
  entityId: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.STRING(500) },
  content: { type: DataTypes.TEXT },
  keywords: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  url: { type: DataTypes.STRING(1000) },
  metadata: { type: DataTypes.JSONB, defaultValue: {} }
}, { 
  tableName: 'search_index', 
  timestamps: true,
  indexes: [
    { fields: ['entityType', 'entityId'], unique: true },
    { type: 'GIN', fields: ['keywords'] }
  ]
});

// === SETTINGS MODEL ===
const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING(100), primaryKey: true },
  value: { type: DataTypes.JSONB },
  description: { type: DataTypes.TEXT }
}, { tableName: 'settings', timestamps: true });

// === CHAT MODEL ===
const Chat = sequelize.define('Chat', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(255) },
  type: { type: DataTypes.ENUM('private', 'group'), defaultValue: 'private' },
  avatar: { type: DataTypes.STRING(500) },
  lastMessage: { type: DataTypes.TEXT },
  lastMessageAt: { type: DataTypes.DATE },
  createdBy: { type: DataTypes.UUID }
}, { tableName: 'chats', timestamps: true });

// === CHAT MEMBER MODEL ===
const ChatMember = sequelize.define('ChatMember', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  chatId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'member'), defaultValue: 'member' },
  lastReadAt: { type: DataTypes.DATE },
  isNotificationMuted: { type: DataTypes.BOOLEAN, defaultValue: false },
  isHidden: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Чат скрыт у пользователя' },
  isPinned: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Чат закреплён у пользователя' },
  pinnedOrder: { type: DataTypes.INTEGER, allowNull: true, comment: 'Порядок среди закреплённых чатов' },
  isReadOnly: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Участнику запрещено отправлять сообщения' }
}, {
  tableName: 'chat_members',
  timestamps: true,
  indexes: [{ unique: true, fields: ['chatId', 'userId'] }]
});

// === MESSAGE MODEL ===
const Message = sequelize.define('Message', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  chatId: { type: DataTypes.UUID, allowNull: false },
  senderId: { type: DataTypes.UUID, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  // 'voice' — голосовое сообщение, рисуется плеером, а не карточкой файла
  type: { type: DataTypes.ENUM('text', 'image', 'file', 'system', 'voice', 'poll'), defaultValue: 'text' },
  attachments: { type: DataTypes.JSONB, defaultValue: [] },
  mentions: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Снимок адресатов упоминания: targetId, label, userIds'
  },
  poll: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Опрос: вопрос, варианты, настройки и карта голосов'
  },
  // Кнопки действий под сообщением — их ставят боты на заявки с сайта
  // (создать пациента в МИС, открыть реестр справок). Формат и смысл —
  // в migrations/ver. 6.51 message-actions.sql
  actions: { type: DataTypes.JSONB, defaultValue: [] },
  isEdited: { type: DataTypes.BOOLEAN, defaultValue: false },
  replyToId: { type: DataTypes.UUID },
  forwardedFrom: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
  telegramMsgId: { type: DataTypes.BIGINT, allowNull: true, comment: 'ID обновления в таблице bot_updates (для Telegram Bot API совместимости)' }
}, { tableName: 'messages', timestamps: true });

// === MESSAGE REACTION MODEL ===
const MessageReaction = require('./messageReaction')(sequelize, DataTypes);

// === ACCREDITATION MODEL ===
const Accreditation = sequelize.define('Accreditation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  medCenter: {
    // Был ENUM со своим, отдельным от med_centers списком. Стал строкой: состав
    // клиник задаёт справочник, а держать его копию в типе БД — гарантированный
    // способ получить расхождение (см. ver. 6.67).
    type: DataTypes.STRING(100),
    allowNull: false
  },
  fullName: { type: DataTypes.STRING(255), allowNull: false },
  specialty: { type: DataTypes.STRING(255), allowNull: false },
  series: { type: DataTypes.STRING(50), allowNull: true, comment: 'Серия аккредитации (буквы/цифры, необязательно)' },
  number: { type: DataTypes.STRING(50), allowNull: true, comment: 'Номер аккредитации (буквы/цифры, необязательно)' },
  expirationDate: { type: DataTypes.DATEONLY, allowNull: false },
  comment: { type: DataTypes.TEXT },
  medCenters: { type: DataTypes.JSONB, allowNull: true, comment: 'Медцентры, на которые распространяется аккредитация (массив). medCenter = первый из них (для совместимости)' },
  misUserId: { type: DataTypes.INTEGER, allowNull: true, comment: 'ID сотрудника в МИС (источник ФИО/специальности/клиник)' },
  supersededById: { type: DataTypes.UUID, allowNull: true, comment: 'ID новой версии аккредитации, заменившей эту (для архива/истории)' },
  isArchived: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Запись перенесена в архив' },
  reminded90: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded60: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded30: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded14: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded7: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
  tableName: 'accreditations',
  timestamps: true,
  indexes: [
    { fields: ['medCenter'] },
    { fields: ['fullName'] },
    { fields: ['specialty'] },
    { fields: ['expirationDate'] },
    { fields: ['misUserId'] }
  ]
});

// === ACCREDITATION FILE MODEL ===
const AccreditationFile = sequelize.define('AccreditationFile', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  accreditationId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID аккредитации, к которой прикреплен файл'
  },
  filename: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Имя файла на сервере'
  },
  originalName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Оригинальное имя файла'
  },
  mimeType: {
    type: DataTypes.STRING(100),
    comment: 'MIME тип файла'
  },
  size: {
    type: DataTypes.BIGINT,
    comment: 'Размер файла в байтах'
  },
  path: {
    type: DataTypes.STRING(1000),
    allowNull: false,
    comment: 'Путь к файлу на сервере'
  },
  uploadedBy: {
    type: DataTypes.UUID,
    comment: 'ID пользователя, загрузившего файл'
  }
}, {
  tableName: 'accreditation_files',
  timestamps: true,
  indexes: [
    { fields: ['accreditationId'] },
    { fields: ['uploadedBy'] }
  ]
});

// === TELEGRAM SUBSCRIBER MODEL ===
const TelegramSubscriber = sequelize.define('TelegramSubscriber', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  chatId: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  username: { type: DataTypes.STRING(100) },
  firstName: { type: DataTypes.STRING(100) },
  lastName: { type: DataTypes.STRING(100) },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  subscribedToAccreditations: { type: DataTypes.BOOLEAN, defaultValue: true },
  subscribedToVehicles: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'telegram_subscribers',
  timestamps: true
});

// === PATIENT BOT SUBSCRIBER MODEL ===
// Подписчики клиентских ботов (Telegram / MAX) по 6 организациям.
// Категория в МИС зависит ТОЛЬКО от платформы (2 категории), organization — разрез для статистики.
const BotSubscriber = sequelize.define('BotSubscriber', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  platform: { type: DataTypes.STRING(20), allowNull: false },        // 'telegram' | 'max'
  organization: { type: DataTypes.STRING(50), allowNull: false },     // ключ организации ('alfa', 'alfa-deti', ...)
  externalUserId: { type: DataTypes.STRING(50), allowNull: false },   // chatId / user_id в мессенджере
  username: { type: DataTypes.STRING(100) },
  firstName: { type: DataTypes.STRING(100) },
  lastName: { type: DataTypes.STRING(100) },
  phone: { type: DataTypes.STRING(30) },                              // после share contact (нормализованный)
  patientIds: { type: DataTypes.JSONB, defaultValue: [] },            // найденные patient_id (семьи -> несколько)
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'started' }, // started | identified | tagged
  source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'bot' },      // bot | import (Fromni backfill)
  startedAt: { type: DataTypes.DATE },
  identifiedAt: { type: DataTypes.DATE },
  taggedAt: { type: DataTypes.DATE }
}, {
  tableName: 'bot_subscribers',
  timestamps: true,
  indexes: [
    // Уникальность на (платформа, организация, пользователь): один человек может быть
    // подписан на боты нескольких медцентров — считаем его в каждом.
    { unique: true, fields: ['platform', 'organization', 'externalUserId'] },
    { fields: ['organization'] },
    { fields: ['status'] }
  ]
});

// === VEHICLE MODEL ===
const Vehicle = sequelize.define('Vehicle', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  organization: { type: DataTypes.STRING(255), allowNull: false },
  carBrand: { type: DataTypes.STRING(255), allowNull: false },
  licensePlate: { type: DataTypes.STRING(20), allowNull: false },
  carYear: { type: DataTypes.INTEGER, allowNull: false },
  mileage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextTO: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  insuranceDate: { type: DataTypes.DATEONLY, allowNull: false },
  condition: {
    type: DataTypes.ENUM('Хорошее', 'Удовлетворительное', 'Плохое'),
    defaultValue: 'Хорошее'
  },
  comment: { type: DataTypes.TEXT },
  isArchived: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Запись перенесена в архив' },
  reminded30: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded14: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded7: { type: DataTypes.BOOLEAN, defaultValue: false },
  remindedTO: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
  tableName: 'vehicles',
  timestamps: true,
  indexes: [
    { fields: ['organization'] },
    { fields: ['licensePlate'] },
    { fields: ['insuranceDate'] }
  ]
});

// === VEHICLE FILE MODEL ===
const VehicleFile = sequelize.define('VehicleFile', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  vehicleId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID транспортного средства, к которому прикреплен файл'
  },
  filename: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Имя файла на сервере'
  },
  originalName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Оригинальное имя файла'
  },
  mimeType: {
    type: DataTypes.STRING(100),
    comment: 'MIME тип файла'
  },
  size: {
    type: DataTypes.BIGINT,
    comment: 'Размер файла в байтах'
  },
  path: {
    type: DataTypes.STRING(1000),
    allowNull: false,
    comment: 'Путь к файлу на сервере'
  },
  uploadedBy: {
    type: DataTypes.UUID,
    comment: 'ID пользователя, загрузившего файл'
  }
}, {
  tableName: 'vehicle_files',
  timestamps: true,
  indexes: [
    { fields: ['vehicleId'] },
    { fields: ['uploadedBy'] }
  ]
});

// === ANALYSIS MODEL ===
// Добавь этот код в models/index.js после модели Vehicle и перед модулем exports

const Analysis = sequelize.define('Analysis', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  lab: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Лаборатория (Альфа, Кидс, Проф, Линия, Смайл, 3К)'
  },
  serviceCode: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Код услуги из МИС'
  },
  serviceName: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Название анализа'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Стоимость анализа'
  },
  isStopped: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Анализ временно не выполняется'
  },
  preparationLink: {
    type: DataTypes.STRING(1000),
    comment: 'Ссылка на файл с подготовкой к анализу'
  },
  comment: { type: DataTypes.TEXT },
  misServiceId: {
    type: DataTypes.STRING(50),
    comment: 'ID услуги в МИС для обновления цен'
  },
  lastPriceUpdate: {
    type: DataTypes.DATE,
    comment: 'Время последнего обновления цены из МИС'
  }
}, {
  tableName: 'analyses',
  timestamps: true,
  indexes: [
    { fields: ['lab'] },
    { fields: ['serviceCode'] },
    { fields: ['serviceName'] },
    { fields: ['isStopped'] },
    { fields: ['misServiceId'] }
  ]
});

// === ANALYSIS PAGE NOTES MODEL ===
const AnalysisPageNote = sequelize.define('AnalysisPageNote', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  pageSlug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  notes: { type: DataTypes.TEXT },
  updatedBy: { type: DataTypes.UUID }
}, {
  tableName: 'analysis_page_notes',
  timestamps: true
});

// === SERVICE MODEL ===
const Service = sequelize.define('Service', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  pageSlug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Slug страницы wiki, к которой привязаны услуги'
  },
  medCenter: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Медицинский центр (Альфа, Кидс, Проф, Линия, Смайл, 3К)'
  },
  serviceCode: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Код услуги из МИС'
  },
  serviceName: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Название услуги'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Стоимость услуги'
  },
  isStopped: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Услуга временно не выполняется'
  },
  preparationLink: {
    type: DataTypes.STRING(1000),
    comment: 'Ссылка на файл с подготовкой к услуге'
  },
  comment: { type: DataTypes.TEXT },
  misServiceId: {
    type: DataTypes.STRING(50),
    comment: 'ID услуги в МИС для обновления цен'
  },
  lastPriceUpdate: {
    type: DataTypes.DATE,
    comment: 'Время последнего обновления цены из МИС'
  }
}, {
  tableName: 'services',
  timestamps: true,
  indexes: [
    { fields: ['pageSlug'] },
    { fields: ['medCenter'] },
    { fields: ['serviceCode'] },
    { fields: ['serviceName'] },
    { fields: ['isStopped'] },
    { fields: ['misServiceId'] }
  ]
});

// === SERVICE PAGE NOTES MODEL ===
const ServicePageNote = sequelize.define('ServicePageNote', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  pageSlug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  notes: { type: DataTypes.TEXT },
  updatedBy: { type: DataTypes.UUID }
}, {
  tableName: 'service_page_notes',
  timestamps: true
});

// === ORGANIZATION MODEL ===
// Юрлицо, которому принадлежат медцентры. Отдельно от MedCenter, потому что ООО и
// филиал — разные вещи: одно юрлицо держит несколько МЦ, а «ИП Микаелян» вообще
// другая организационная форма. Реквизиты отсюда нужны справкам и договорам.
const Organization = sequelize.define('Organization', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(255), allowNull: false, comment: 'Полное наименование: ООО «...»' },
  shortName: { type: DataTypes.STRING(100), comment: 'Короткое имя для интерфейса' },
  inn: { type: DataTypes.STRING(12), comment: 'ИНН: 10 цифр у ООО, 12 у ИП' },
  kpp: { type: DataTypes.STRING(9) },
  ogrn: { type: DataTypes.STRING(15) },
  legalAddress: { type: DataTypes.STRING(500) },
  directorName: { type: DataTypes.STRING(255) },
  directorTitle: { type: DataTypes.STRING(120), comment: 'Должность подписанта: «Генеральный директор», «Индивидуальный предприниматель»' },
  phone: { type: DataTypes.STRING(50) },
  email: { type: DataTypes.STRING(255) },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 }
}, {
  tableName: 'organizations',
  timestamps: true
});

// === MED CENTER MODEL ===
// Единый справочник клиник. До ver. 6.67 клиника существовала в четырёх не
// связанных между собой видах (UUID здесь, clinic_id из МИС, название строкой в
// услугах и акциях, ключ организации у ботов) плюс девять копий списка с цветами
// в коде. Всё новое ссылается сюда; МИС-модули связываются через misClinicIds.
const MedCenter = sequelize.define('MedCenter', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    // Был ENUM. Переименование клиники требовало ALTER TYPE ... RENAME VALUE, а новая
    // клиника — ADD VALUE, который нельзя выполнить в транзакции. Для справочника
    // на десяток строк это неоправданно дорого.
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: 'Короткое название медицинского центра'
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true,
    comment: 'Латинский идентификатор (alfa, kids, prof…). В отличие от name не меняется при переименовании'
  },
  displayName: {
    type: DataTypes.STRING(100),
    comment: 'Полное название для отображения'
  },
  description: { type: DataTypes.TEXT },
  // Общая схема медцентра используется по умолчанию, когда помещения не
  // разбиты по корпусам и этажам. Иерархия склада остаётся необязательной.
  warehousePlan: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  organizationId: { type: DataTypes.UUID, allowNull: true, comment: 'Юрлицо, которому принадлежит медцентр' },
  // Мост между справочником и всем МИС-блоком (расписание, зарплата, бонусы,
  // платежи). Массив, потому что у Сукко исторически два id (11 и 12) — раньше это
  // лечилось картой CLINIC_ID_ALIASES в clinicUtils.js. Строки, а не числа: портал
  // использует псевдо-id «ip» и «aup» в том же пространстве, да и большинство
  // таблиц хранят clinicId как varchar.
  misClinicIds: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: false,
    defaultValue: [],
    comment: 'ID этой клиники в МИС'
  },
  botOrgKey: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Ключ организации у пациентских ботов (Fromni), см. backend/bot/patient/config.js'
  },
  // Как клинику называют в импортируемых Excel («альфа kids», «альфа линия»).
  // Раньше это была карта CLINIC_EXCEL_MAP в коде фронта, из-за чего переименование
  // клиники требовало правки ещё и там. name с displayName проверяются всегда,
  // перечислять их здесь не нужно.
  importAliases: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: false,
    defaultValue: [],
    comment: 'Текстовые варианты названия для сопоставления при импорте'
  },
  color: {
    type: DataTypes.STRING(7),
    allowNull: true,
    comment: 'Фирменный (акцентный) цвет #rrggbb — им красится метка сотрудника в чате и колонки в отчётах'
  },
  logoUrl: { type: DataTypes.STRING(500), allowNull: true },
  logoSquareUrl: { type: DataTypes.STRING(500), allowNull: true, comment: 'Квадратный вариант для кружков и аватарок' },
  address: { type: DataTypes.STRING(500) },
  city: { type: DataTypes.STRING(120) },
  lat: { type: DataTypes.DOUBLE },
  lng: { type: DataTypes.DOUBLE },
  phones: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: 'Массив телефонов: [{ label, value }]' },
  email: { type: DataTypes.STRING(255) },
  site: { type: DataTypes.STRING(255) },
  workingHours: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: 'График: {"mon":{"from":"08:00","to":"20:00"}, …, "sun":null}. null — выходной'
  },
  workingHoursNote: { type: DataTypes.STRING(255), comment: 'Приписка к графику: «приём по записи», «обед 13:00–14:00»' },
  chiefDoctorUserId: { type: DataTypes.UUID, allowNull: true, comment: 'Главврач как сотрудник портала' },
  chiefDoctorName: { type: DataTypes.STRING(255), comment: 'ФИО главврача, когда у него нет учётной записи' },
  isVirtual: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Служебная группировка, а не настоящий медцентр («Направители», «АУП»)'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    // Удалять нельзя: на медцентр ссылаются история, зарплата и аккредитации.
    comment: 'Закрытый медцентр гасится флагом, а не удаляется'
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 100,
    comment: 'Чем меньше, тем приоритетнее клиника при выборе цвета метки и в списках'
  }
}, {
  tableName: 'med_centers',
  timestamps: true
});

// === PRICE COMPARISON MODEL ===
const PriceComparison = sequelize.define('PriceComparison', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Название сравнения (напр. "Сравнение цен январь 2026")'
  },
  description: {
    type: DataTypes.TEXT,
    comment: 'Описание сравнения'
  },
  createdBy: {
    type: DataTypes.UUID,
    comment: 'ID пользователя-создателя'
  },
  comparisonType: {
    type: DataTypes.STRING(20),
    defaultValue: 'external',
    comment: 'Тип сравнения: external (с конкурентами) или internal (внутреннее по клиникам)'
  },
  competitors: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Массив названий конкурентов: ["Неомед", "МедГрад", "АйКлиник"]'
  },
  // Имя колонки — только подпись для человека; какие цены в неё попадают,
  // решает id клиники в парсере. Раньше это была связь по совпадению строк,
  // из-за чего у клиники приходилось держать второе, «правильное» название.
  competitorBindings: {
    type: DataTypes.JSONB,
    defaultValue: {},
    allowNull: false,
    comment: 'Колонка → клиника парсера: {"Неомед — Красная": {"parserSourceId": 12, "filialId": 3}}'
  },
  ownMedCenters: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Массив своих медцентров для сравнения: ["Альфа", "Кидс"]'
  },
  // Порядок колонок человек расставляет сам, перетаскивая заголовки: рядом
  // ставят то, что сравнивают глазами, и общего правила для этого нет.
  // Пустой массив — порядок по умолчанию (эталон первым, дальше как пришли).
  columnOrder: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Порядок колонок в таблице: ["Альфа", "Неомед", "Кидс"]'
  }
}, {
  tableName: 'price_comparisons',
  timestamps: true,
  indexes: [
    { fields: ['createdBy'] },
    { fields: ['name'] }
  ]
});

// === PRICE COMPARISON ITEM MODEL ===
const PriceComparisonItem = sequelize.define('PriceComparisonItem', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  comparisonId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID сравнения'
  },
  serviceCode: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Код услуги (артикул)'
  },
  serviceName: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Название услуги'
  },
  misServiceId: {
    type: DataTypes.STRING(50),
    comment: 'ID услуги в МИС'
  },
  prices: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Объект с ценами: {"Альфа": 300, "Неомед": 330, "МедГрад": 290}'
  },
  priceHistory: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'История изменений цен: {"Неомед": [{price: 330, userId: "uuid", username: "Иванов И.И.", changedAt: "2026-02-06T10:00:00Z"}]}'
  },
  priceSources: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Помечены только цены, проставленные парсером: {"Неомед": {source, matchId, filialName, syncedAt}}. '
      + 'Всё непомеченное считается введённым человеком и парсером не перезаписывается'
  },
  costPrices: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Себестоимость услуги по медцентрам: {"Альфа": 120, "Кидс": 100}'
  },
  lab: {
    type: DataTypes.STRING(255),
    defaultValue: '',
    comment: 'Лаборатория, выполняющая анализ'
  },
  // Лист лабораторий собран по коду 804н, а артикул у каждой лаборатории свой:
  // у A09.05.042 это ALFA03-001 у «Альфа» и 8 у «Инвитро». В таблице артикул
  // не нужен, а для файла импорта в МИС он единственный ключ обновления.
  // Массив на лабораторию — потому что у одного кода 804н их бывает несколько
  // (обычная услуга и профосмотровая): такие позиции выгрузка пропускает,
  // и чтобы сказать об этом человеку, надо знать, что их несколько.
  misRefs: {
    type: DataTypes.JSONB,
    defaultValue: {},
    allowNull: false,
    comment: 'Услуги МИС за колонкой: {"CL-LAB": [{code, serviceId, title, categoryPath}]}'
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Порядок сортировки в списке'
  }
}, {
  tableName: 'price_comparison_items',
  timestamps: true,
  indexes: [
    { fields: ['comparisonId'] },
    { fields: ['serviceCode'] },
    { fields: ['sortOrder'] }
  ]
});

// === COMPETITOR PRICES (зеркало alfa-parser) ===
// Парсер обходит сайты конкурентов и хранит прайсы у себя, вики ночью забирает
// текущие цены. Своя копия нужна для автосопоставления: в price_comparison_items
// лежат только уже отобранные позиции, и подбирать соответствие там не с чем.
const CompetitorSource = sequelize.define('CompetitorSource', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  parserSourceId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    comment: 'ID источника в парсере — по нему идёт сопоставление при синхронизации'
  },
  name: { type: DataTypes.STRING(255), allowNull: false, comment: 'Напр. "clinic23-krd"' },
  baseUrl: { type: DataTypes.TEXT, allowNull: false },
  city: {
    type: DataTypes.STRING(150),
    comment: 'Города разведены на уровне источника: у сети в каждом городе свой прайс'
  },
  servicesTotal: { type: DataTypes.INTEGER, defaultValue: 0, allowNull: false },
  lastRunAt: { type: DataTypes.DATE, comment: 'Когда парсер последний раз обходил сайт' },
  lastRunStatus: { type: DataTypes.STRING(16), comment: 'ok | partial | failed | running' },
  syncedAt: { type: DataTypes.DATE, comment: 'Когда мы последний раз забирали данные' },
  syncStatus: {
    type: DataTypes.STRING(16),
    defaultValue: 'pending',
    allowNull: false,
    comment: 'pending | ok | failed'
  },
  syncError: { type: DataTypes.TEXT },
  displayName: {
    type: DataTypes.STRING(255),
    comment: 'Человеческое название с сайта клиники; name — это домен и в списке нечитаем'
  },
  logoUrl: { type: DataTypes.TEXT, comment: 'Откуда взят значок — чтобы не тянуть его заново' },
  logoData: {
    type: DataTypes.BLOB,
    comment: 'Значок байтами: страница сравнения не должна ходить за картинкой на чужой сайт'
  },
  logoContentType: { type: DataTypes.STRING(100) },
  logoIsCustom: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
    comment: 'Значок загружен человеком — автосбор с сайта его не перезаписывает'
  }
}, {
  tableName: 'competitor_sources',
  timestamps: true
});

const CompetitorService = sequelize.define('CompetitorService', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sourceId: { type: DataTypes.UUID, allowNull: false },
  parserServiceId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    comment: 'ID услуги в парсере, сквозной по всем источникам'
  },
  externalId: { type: DataTypes.STRING(255), comment: 'Артикул на сайте конкурента' },
  name: { type: DataTypes.TEXT, allowNull: false },
  nameNormalized: {
    type: DataTypes.TEXT,
    comment: 'Название под триграммный поиск; заполняется при синхронизации (normalizeName)'
  },
  url: { type: DataTypes.TEXT },
  category: { type: DataTypes.TEXT, comment: 'Путь по дереву разделов строкой' },
  categoryPath: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: "['Стоматология','Терапевтический прием']"
  },
  turnaround: { type: DataTypes.STRING(255), comment: 'Срок выполнения' },
  codes: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Коды приказа 804н — основа автосопоставления с нашими услугами'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    comment: 'Пропала из прайса — гасим, но не удаляем: на неё могут ссылаться сопоставления'
  },
  lastSeenAt: { type: DataTypes.DATE }
}, {
  tableName: 'competitor_services',
  timestamps: true,
  indexes: [
    { fields: ['sourceId'] },
    { fields: ['sourceId', 'isActive'] }
  ]
});

// Точка клиники на карте. Отдельно от филиала намеренно: филиал в прайсе —
// измерение цены, а точка — место, куда человек придёт. У лаборатории филиалов
// в смысле прайса нет вовсе, а пункт забора с адресом есть.
const CompetitorLocation = sequelize.define('CompetitorLocation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sourceId: { type: DataTypes.UUID, allowNull: false },
  parserLocationId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  name: { type: DataTypes.STRING(255), comment: "Напр. 'Клиника на Сормовской'" },
  address: { type: DataTypes.TEXT, allowNull: false },
  city: {
    type: DataTypes.STRING(150),
    comment: 'Пусто, если на сайте не указан: выдуманный город хуже отсутствующего'
  },
  origin: {
    type: DataTypes.STRING(16),
    defaultValue: 'text',
    allowNull: false,
    comment: 'jsonld | text | manual — вписанному руками веры больше'
  },
  parserFilialId: {
    type: DataTypes.INTEGER,
    comment: 'Филиал в парсере, если точку удалось связать с ценами'
  },
  // Парсер связывает адрес с филиалом далеко не всегда, а без связи цену
  // к точке на карте привязать нечем. Поле отдельное от parserFilialId:
  // тот приходит из парсера и перезаписывается при каждом обновлении точек.
  filialIdManual: {
    type: DataTypes.INTEGER,
    comment: 'Филиал прайса, указанный человеком; перекрывает parserFilialId'
  },
  lat: { type: DataTypes.DECIMAL(9, 6), comment: 'Широта; NULL — адрес ещё не геокодирован' },
  lon: { type: DataTypes.DECIMAL(9, 6) },
  geoOrigin: {
    type: DataTypes.STRING(16),
    comment: 'nominatim | manual — выправленное мышью автопрогон не трогает'
  },
  geocodedAt: { type: DataTypes.DATE }
}, {
  tableName: 'competitor_locations',
  timestamps: true,
  indexes: [{ fields: ['sourceId'] }, { fields: ['city'] }]
});

// Три значения цены, а не одно: конкуренты отдают вилку {min, base, max}, и base —
// самостоятельная величина, а не середина. Именно его показывают клиенту на сайте.
const CompetitorPrice = sequelize.define('CompetitorPrice', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  serviceId: { type: DataTypes.UUID, allowNull: false },
  filialId: {
    type: DataTypes.INTEGER,
    comment: 'ID филиала в парсере; NULL — у лабораторий филиалов нет'
  },
  filialName: {
    type: DataTypes.STRING(255),
    comment: 'Денормализовано: отдельная таблица филиалов дала бы join без новых возможностей'
  },
  price: { type: DataTypes.DECIMAL(12, 2), comment: 'Цена, которую клиника показывает клиенту' },
  priceMin: { type: DataTypes.DECIMAL(12, 2) },
  priceMax: { type: DataTypes.DECIMAL(12, 2) },
  priceDiscount: { type: DataTypes.DECIMAL(12, 2) },
  currency: { type: DataTypes.STRING(3), defaultValue: 'RUB', allowNull: false },
  observedAt: { type: DataTypes.DATE, comment: 'Когда парсер видел эту цену' }
}, {
  tableName: 'competitor_prices',
  timestamps: true,
  indexes: [
    { fields: ['serviceId'] }
  ]
});

// Соответствие «наша позиция в сравнении ↔ услуга конкурента».
// Связь именно с позицией сравнения, а не с каталогом целиком: сравнения
// собираются под задачу, и в разных сравнениях одна услуга значит разное.
const CompetitorServiceMatch = sequelize.define('CompetitorServiceMatch', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  itemId: { type: DataTypes.UUID, allowNull: false, comment: 'Позиция сравнения цен' },
  competitorServiceId: { type: DataTypes.UUID, allowNull: false },
  status: {
    type: DataTypes.STRING(16),
    defaultValue: 'suggested',
    allowNull: false,
    comment: 'suggested — ждёт человека; confirmed — принято; rejected — отказано, больше не предлагать'
  },
  method: {
    type: DataTypes.STRING(16),
    defaultValue: 'name',
    allowNull: false,
    comment: 'code804 | name | manual — коду можно верить, названию только доверять с проверкой'
  },
  score: { type: DataTypes.DECIMAL(4, 3), comment: 'Насколько похоже: 1.000 для совпадения по коду' },
  confirmedBy: { type: DataTypes.UUID },
  confirmedAt: { type: DataTypes.DATE }
}, {
  tableName: 'competitor_service_matches',
  timestamps: true,
  indexes: [
    // повторный автоподбор не должен плодить дубли и обязан видеть прежний отказ
    { unique: true, fields: ['itemId', 'competitorServiceId'] },
    { fields: ['itemId', 'status'] },
    { fields: ['status'] }
  ]
});

// === USER-MEDCENTER MODEL (Many-to-Many) ===
const UserMedCenter = sequelize.define('UserMedCenter', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  medCenterId: { type: DataTypes.UUID, allowNull: false }
}, {
  tableName: 'user_med_centers',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'medCenterId'] }
  ]
});

// === USER-ROLE MODEL (Many-to-Many) ===
const UserRole = sequelize.define('UserRole', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  roleId: { type: DataTypes.UUID, allowNull: false }
}, {
  tableName: 'user_roles',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'roleId'] }
  ]
});

// === CALENDAR EVENT MODEL ===
// Добавить после модели Analysis и перед MapMarker

const CalendarEvent = sequelize.define('CalendarEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { 
    type: DataTypes.STRING(255), 
    allowNull: false,
    comment: 'Название события'
  },
  description: { 
    type: DataTypes.TEXT,
    comment: 'Описание события'
  },
  startTime: { 
    type: DataTypes.DATE, 
    allowNull: false,
    comment: 'Время начала события'
  },
  endTime: { 
    type: DataTypes.DATE, 
    allowNull: false,
    comment: 'Время окончания события'
  },
  allDay: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false,
    comment: 'Событие на весь день'
  },
  eventType: { 
    type: DataTypes.STRING(50), 
    allowNull: false,
    defaultValue: 'personal',
    comment: 'Тип события: personal, meeting, deadline, reminder, accreditation, vehicle_service, doctor_schedule'
  },
  priority: { 
    type: DataTypes.STRING(20), 
    defaultValue: 'medium',
    comment: 'Приоритет: low, medium, high, urgent'
  },
  status: { 
    type: DataTypes.STRING(20), 
    defaultValue: 'planned',
    comment: 'Статус: planned, in_progress, completed, cancelled'
  },
  color: { 
    type: DataTypes.STRING(20), 
    defaultValue: '#4a90e2',
    comment: 'Цвет события в календаре'
  },
  location: { 
    type: DataTypes.STRING(500),
    comment: 'Место проведения'
  },
  isRecurring: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false,
    comment: 'Повторяющееся событие'
  },
  recurrenceRule: {
    type: DataTypes.JSONB,
    comment: 'Правила повторения: {frequency, interval, endDate, daysOfWeek}'
  },
  exceptions: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Массив дат (ISO строк) когда повторяющееся событие НЕ должно происходить'
  },
  parentEventId: {
    type: DataTypes.UUID,
    comment: 'ID родительского события для экземпляров повторяющихся событий'
  },
  participants: { 
    type: DataTypes.JSONB, 
    defaultValue: [],
    comment: 'Участники: [{userId, status: accepted|declined|pending}]'
  },
  reminders: { 
    type: DataTypes.JSONB, 
    defaultValue: [],
    comment: 'Напоминания: [{type: notification|email|telegram, minutesBefore}]'
  },
  linkedEntityType: { 
    type: DataTypes.STRING(50),
    comment: 'Тип связанной сущности: page, doctor, vehicle, accreditation'
  },
  linkedEntityId: { 
    type: DataTypes.UUID,
    comment: 'ID связанной сущности'
  },
  createdBy: { 
    type: DataTypes.UUID,
    comment: 'ID пользователя-создателя'
  },
  // Уровни видимости расширены модулем «Задачи» (ver. 6.75). Существующие
  // значения не переименовывались: у shared свой механизм — явный список
  // sharedWith, и ломать его ради стройности перечисления нельзя.
  //
  // Содержимое событий с уровнями private и busy не отдаётся ни одному запросу
  // от имени другого пользователя — включая владельца пространства и
  // администратора филиала. Обещание держится не в интерфейсе, а в одной
  // функции-фильтре, через которую проходит любая отдача события наружу.
  visibility: {
    type: DataTypes.STRING(20),
    defaultValue: 'private',
    comment: 'private (только я), busy (занято, без названия), team (участникам команд), shared (список sharedWith), public (вся компания)'
  },
  sharedWith: { 
    type: DataTypes.JSONB, 
    defaultValue: [],
    comment: 'Список ID пользователей/ролей для shared видимости'
  },
  lastReminderSent: {
    type: DataTypes.DATE,
    comment: 'Время последней отправки напоминания'
  },
  sentReminders: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Отправленные напоминания: [{minutesBefore, recipientId, sentAt}]'
  },

  // --- Модуль «Задачи» (ver. 6.75) ---
  // Загрузка дня — это сумма часов по событиям календаря. Отдельной таблицы
  // рабочих блоков нет намеренно: иначе у сотрудника два календаря, и ни один
  // из них не отвечает на вопрос «чем я занят в четверг».
  taskPartId: {
    type: DataTypes.UUID,
    comment: 'Часть задачи, из которой порождён блок. Снимается вместе с ней'
  },
  // У плавающего блока есть день и длительность, но нет времени начала:
  // «2,4 часа в четверг» — честная формулировка для работы, тогда как встреча
  // стоит в 14:00 и двигается только по согласованию. Делать вид, что человек
  // знает, во сколько сядет за отчёт, значит заполнять календарь выдуманными
  // интервалами.
  //
  // День-вью обязан рисовать такие события отдельной дорожкой «план дня»,
  // иначе блок с началом в 00:00 уедет в ночь.
  isFloating: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Плавающий рабочий блок: есть день и длительность, времени начала нет'
  },
  dayOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Порядок плавающих блоков внутри дня — времени у них нет, а последовательность есть'
  }
}, {
  tableName: 'calendar_events',
  timestamps: true,
  indexes: [
    { fields: ['startTime'] },
    { fields: ['endTime'] },
    { fields: ['createdBy'] },
    { fields: ['eventType'] },
    { fields: ['status'] },
    { fields: ['isRecurring'] },
    { fields: ['linkedEntityType', 'linkedEntityId'] },
    { fields: ['parentEventId'] },
    { fields: ['taskPartId'] },
    { fields: ['isFloating', 'startTime'] }
  ]
});

// === MAP MARKER MODEL ===
const MapMarker = sequelize.define('MapMarker', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  lat: { type: DataTypes.DOUBLE, allowNull: false },
  lng: { type: DataTypes.DOUBLE, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  color: { type: DataTypes.STRING(20), defaultValue: '#4a90e2' },
  media: { type: DataTypes.JSONB, defaultValue: [] },
  category: { type: DataTypes.STRING(100) },
  createdBy: { type: DataTypes.UUID }
}, { 
  tableName: 'map_markers', 
  timestamps: true,
  indexes: [
    { fields: ['lat', 'lng'] },
    { fields: ['color'] },
    { fields: ['category'] }
  ]
});

// === DOCTOR CARD MODEL ===
const DoctorCard = sequelize.define('DoctorCard', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  pageSlug: { 
    type: DataTypes.STRING(255), 
    allowNull: false,
    comment: 'Slug страницы wiki, к которой привязаны карточки'
  },
  fullName: { type: DataTypes.STRING(255), allowNull: false },
  specialty: { type: DataTypes.STRING(255) },
  experience: { type: DataTypes.STRING(100) },
  profileUrl: { 
    type: DataTypes.STRING(1000),
    comment: 'Ссылка на страницу врача (wiki или внешняя)'
  },
  photo: { type: DataTypes.STRING(1000) },
  description: { type: DataTypes.TEXT },
  phones: { 
    type: DataTypes.JSONB, 
    defaultValue: [],
    comment: 'Массив телефонов: [{type: "internal", number: "123"}]'
  },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  metadata: { type: DataTypes.JSONB, defaultValue: {} }
}, { 
  tableName: 'doctor_cards', 
  timestamps: true,
  indexes: [
    { fields: ['pageSlug'] },
    { fields: ['fullName'] },
    { fields: ['specialty'] },
    { fields: ['sortOrder'] }
  ]
});

// === DOCTOR SERVICE DURATION MODEL ===
// Фактическая длительность онлайн-приёма зависит не только от услуги, но и от
// врача и клиники. Храним её отдельно от презентационных настроек карточки
// (псевдоним, справка, порядок), потому что у врача может быть несколько карточек.
const DoctorServiceDuration = sequelize.define('DoctorServiceDuration', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: { type: DataTypes.STRING(50), allowNull: false, comment: 'ID врача/сотрудника в МИС' },
  clinicId: { type: DataTypes.STRING(50), allowNull: false, comment: 'Актуальный clinic_id из МИС' },
  serviceId: { type: DataTypes.STRING(50), allowNull: false, comment: 'service_id из МИС' },
  durationMinutes: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 }, comment: 'Фактическая длительность в минутах' },
  sourceCardId: { type: DataTypes.UUID, allowNull: true, comment: 'Карточка, из которой значение редактировали/мигрировали' },
  updatedBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'doctor_service_durations',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['misUserId', 'clinicId', 'serviceId'] },
    { fields: ['misUserId'] },
    { fields: ['serviceId'] }
  ]
});

// === COURSE MODEL ===
const Course = sequelize.define('Course', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  icon: { type: DataTypes.STRING(50), defaultValue: 'book-open' },
  estimatedDuration: { 
    type: DataTypes.INTEGER,
    comment: 'Примерное время прохождения в минутах'
  },
  createdBy: { type: DataTypes.UUID },
  isPublished: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { 
  tableName: 'courses', 
  timestamps: true,
  indexes: [
    { fields: ['title'] },
    { fields: ['isPublished'] }
  ]
});

// === LESSON MODEL ===
const Lesson = sequelize.define('Lesson', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  courseId: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  content: { type: DataTypes.TEXT, comment: 'TipTap HTML контент' },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 }
}, { 
  tableName: 'lessons', 
  timestamps: true,
  indexes: [
    { fields: ['courseId'] },
    { fields: ['sortOrder'] }
  ]
});

// === TEST QUESTION MODEL ===
const TestQuestion = sequelize.define('TestQuestion', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  courseId: { type: DataTypes.UUID, allowNull: false },
  question: { type: DataTypes.TEXT, allowNull: false },
  options: { 
    type: DataTypes.JSONB, 
    allowNull: false,
    comment: 'Массив вариантов ответа: ["Вариант 1", "Вариант 2", ...]'
  },
  correctAnswer: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    comment: 'Индекс правильного ответа (0-based)'
  },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 }
}, { 
  tableName: 'test_questions', 
  timestamps: true,
  indexes: [
    { fields: ['courseId'] },
    { fields: ['sortOrder'] }
  ]
});

// === COURSE PROGRESS MODEL ===
const CourseProgress = sequelize.define('CourseProgress', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  courseId: { type: DataTypes.UUID, allowNull: false },
  completedLessons: { 
    type: DataTypes.JSONB, 
    defaultValue: [],
    comment: 'Массив ID завершенных уроков'
  },
  currentLessonId: { type: DataTypes.UUID },
  testScore: { 
    type: DataTypes.INTEGER,
    comment: 'Процент правильных ответов (0-100)'
  },
  testAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
  completedAt: { type: DataTypes.DATE }
}, { 
  tableName: 'course_progress', 
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'courseId'] },
    { fields: ['completedAt'] }
  ]
});

// === COURSE-ROLE MODEL (Many-to-Many) ===
const CourseRole = sequelize.define('CourseRole', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  courseId: { type: DataTypes.UUID, allowNull: false },
  roleId: { type: DataTypes.UUID, allowNull: false }
}, {
  tableName: 'course_roles',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['courseId', 'roleId'] },
    { fields: ['courseId'] },
    { fields: ['roleId'] }
  ]
});

// === COURSE-MEDCENTER MODEL (Many-to-Many) ===
const CourseMedCenter = sequelize.define('CourseMedCenter', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  courseId: { type: DataTypes.UUID, allowNull: false },
  medCenterId: { type: DataTypes.UUID, allowNull: false }
}, {
  tableName: 'course_medcenters',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['courseId', 'medCenterId'] },
    { fields: ['courseId'] },
    { fields: ['medCenterId'] }
  ]
});

// === COURSE-USER MODEL (Many-to-Many for individual access) ===
const CourseUser = sequelize.define('CourseUser', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  courseId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false }
}, {
  tableName: 'course_users',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['courseId', 'userId'] },
    { fields: ['courseId'] },
    { fields: ['userId'] }
  ]
});

// === REFERRAL BONUS MODEL ===
const ReferralBonus = sequelize.define('ReferralBonus', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'ID врача-направителя в МИС'
  },
  doctorName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'ФИО врача-направителя'
  },
  serviceCode: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Код услуги из МИС'
  },
  serviceName: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Название услуги'
  },
  bonusPercent: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Размер бонуса в процентах (если указан процент)'
  },
  bonusRub: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Размер бонуса в рублях (если фиксированная сумма)'
  },
  clinicId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: '',
    comment: 'ID клиники (пусто = общий бонус для всех клиник)'
  },
  createdBy: {
    type: DataTypes.UUID,
    comment: 'ID пользователя, создавшего запись'
  }
}, {
  tableName: 'referral_bonuses',
  timestamps: true,
  indexes: [
    { fields: ['misUserId'] },
    { fields: ['serviceCode'] },
    { unique: true, fields: ['misUserId', 'serviceCode', 'clinicId'] }
  ]
});

// === HOUR NORM MODEL (нормы часов по специальностям за период) ===
const HourNorm = sequelize.define('HourNorm', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  professionTitle: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Название специальности (из МИС)'
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '1-12'
  },
  normHours: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Норма часов за период'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'hour_norms',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['professionTitle', 'year', 'month'] }
  ]
});

// === REFERRAL REPORT MODEL (archive of generated reports) ===
const ReferralReport = sequelize.define('ReferralReport', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  reportType: {
    type: DataTypes.ENUM('single', 'bulk'),
    allowNull: false,
    defaultValue: 'single',
    comment: 'single = один врач, bulk = сводный по нескольким'
  },
  title: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Заголовок отчёта (напр. "Иванов И.И. — Янв-Мар 2026")'
  },
  doctorName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'ФИО врача (только для single)'
  },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'ID врача в МИС (только для single)'
  },
  dateFrom: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Начало периода'
  },
  dateTo: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Конец периода'
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Итоговая сумма бонусов'
  },
  reportData: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Данные отчёта в формате JSON'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'referral_reports',
  timestamps: true,
  indexes: [
    { fields: ['reportType'] },
    { fields: ['misUserId'] },
    { fields: ['dateFrom', 'dateTo'] },
    { fields: ['createdAt'] }
  ]
});

// === EXECUTOR SETTINGS MODEL ===
const ExecutorSettings = sequelize.define('ExecutorSettings', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'ID врача-исполнителя в МИС'
  },
  doctorName: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Настройки исполнителя: расходники, материалы, оплата, оклад, дополнительно'
  },
  updatedBy: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'executor_settings',
  timestamps: true
});

// === RB EMPLOYEE REGISTRY MODEL ===
// Локальное зеркало сотрудников из МИС. Живой список врачей эфемерен (тянется из МИС на каждый
// заход), а наши данные (настройки, история зарплат) привязаны к misUserId и должны переживать
// увольнение. Реестр хранит последний снимок метаданных + жизненный цикл, чтобы:
//   1) подсвечивать новых сотрудников (появились после baseline и ещё не заполнены);
//   2) не терять уволенных из статистики (Сводка/Отчёт получают их снимок, а не пустоту).
const RbEmployee = sequelize.define('RbEmployee', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'ID сотрудника в МИС'
  },
  name:        { type: DataTypes.STRING(255), allowNull: true, comment: 'Последний известный ФИО' },
  professions: { type: DataTypes.JSONB, defaultValue: [], comment: 'Снимок профессий из МИС' },
  roles:       { type: DataTypes.JSONB, defaultValue: [], comment: 'Снимок ролей из МИС' },
  clinics:     { type: DataTypes.JSONB, defaultValue: [], comment: 'Снимок клиник (сырые id из МИС)' },
  status: {
    type: DataTypes.STRING(10),
    defaultValue: 'active',
    allowNull: false,
    comment: 'active | archived'
  },
  seededBaseline: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
    comment: 'true = существовал на момент первичного засева реестра (не считается новым)'
  },
  firstSeenAt: { type: DataTypes.DATE, allowNull: true, comment: 'Когда впервые увидели в МИС' },
  lastSeenAt:  { type: DataTypes.DATE, allowNull: true, comment: 'Когда в последний раз видели в МИС' },
  archivedAt:  { type: DataTypes.DATE, allowNull: true, comment: 'Когда перевели в архив' },
}, {
  tableName: 'rb_employees',
  timestamps: true
});

// === PERFORMED SERVICE BONUS MODEL ===
// Бонусы за выполненные услуги (врач получает за свои собственные выполненные услуги)
const PerformedServiceBonus = sequelize.define('PerformedServiceBonus', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'ID врача-исполнителя в МИС'
  },
  doctorName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'ФИО врача-исполнителя'
  },
  serviceCode: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Код услуги из МИС'
  },
  serviceName: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Название услуги'
  },
  clinicId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: '',
    comment: 'ID клиники из МИС (пустая строка = общий бонус для всех клиник)'
  },
  cabinetId: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: '',
    comment: 'Название кабинета (пустая строка = бонус для всех кабинетов)'
  },
  bonusPercent: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Размер бонуса в процентах от стоимости услуги'
  },
  bonusRub: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Фиксированный бонус в рублях за выполнение услуги'
  },
  createdBy: {
    type: DataTypes.UUID,
    comment: 'ID пользователя, создавшего запись'
  }
}, {
  tableName: 'performed_service_bonuses',
  timestamps: true,
  indexes: [
    { fields: ['misUserId'] },
    { fields: ['serviceCode'] },
    { unique: true, fields: ['misUserId', 'serviceCode', 'clinicId', 'cabinetId'] }
  ]
});

// === SERVICE CONSUMABLES MODEL ===
const ServiceConsumable = sequelize.define('ServiceConsumable', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'ID врача в МИС'
  },
  doctorName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: '',
    comment: 'ФИО врача'
  },
  serviceCode: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Код услуги из МИС'
  },
  serviceName: {
    type: DataTypes.STRING(500),
    allowNull: false,
    defaultValue: '',
    comment: 'Название услуги'
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Название расходника'
  },
  quantity: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    defaultValue: 1,
    comment: 'Количество единиц'
  },
  costPerUnit: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Стоимость за единицу в рублях'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'ID пользователя, создавшего запись'
  }
}, {
  tableName: 'service_consumables',
  timestamps: true,
  indexes: [
    { fields: ['misUserId'] },
    { fields: ['serviceCode'] },
    { fields: ['misUserId', 'serviceCode'] }
  ]
});

// === ROLE NORM MODEL ===
const RoleNorm = sequelize.define('RoleNorm', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  roleTitle: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Название роли (Врач, Медсестра и т.д.)'
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '1-12'
  },
  normHours: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Норма часов за период'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'role_norms',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['roleTitle', 'year', 'month'] }
  ]
});

// === CATEGORY NORM MODEL ===
const CategoryNorm = sequelize.define('CategoryNorm', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  categoryId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID категории расписания'
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '1-12'
  },
  normHours: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Норма часов за период'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'category_norms',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['categoryId', 'year', 'month'] }
  ]
});

// === RB USER PERMISSION MODEL ===
const RbUserPermission = sequelize.define('RbUserPermission', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true, comment: 'ID пользователя wiki' },
  clinics: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: [],
    allowNull: false,
    comment: 'Список ID медцентров (пусто = все)'
  },
  tab1:         { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabWorkTime:  { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabHourNorms: { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabSchedule:  { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tab2:         { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tab3:          { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tab4:             { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabArchive:       { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabArchiveHistory:{ type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabArchiveKassa:  { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabArchiveTabel:  { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabSummary:       { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  tabKpi:           { type: DataTypes.STRING(10), defaultValue: 'edit', allowNull: false },
  bypassPeriodLock: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, comment: 'Обход блокировки закрытых периодов (Расписание / Учёт рабочего времени)' },
  defaultClinic:    { type: DataTypes.STRING(16), allowNull: true, comment: 'Клиника по умолчанию во вкладке Сотрудники: auto (первая доступная) / global / <clinicId>' },
}, { tableName: 'rb_user_permissions', timestamps: true });

// === EMAIL TEMPLATE MODEL ===
// === EMAIL FAVORITE RECIPIENTS MODEL ===
const EmailFavoriteRecipient = sequelize.define('EmailFavoriteRecipient', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  displayName: { type: DataTypes.STRING(200) }
}, {
  tableName: 'email_favorite_recipients',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'email'] },
    { fields: ['userId'] }
  ]
});

// === EMAIL FAVORITE TEMPLATES MODEL ===
const EmailFavoriteTemplate = sequelize.define('EmailFavoriteTemplate', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  templateId: { type: DataTypes.UUID, allowNull: false }
}, {
  tableName: 'email_favorite_templates',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'templateId'] },
    { fields: ['userId'] }
  ]
});

const EmailTemplate = sequelize.define('EmailTemplate', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: 'Название шаблона письма'
  },
  subject: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Тема письма'
  },
  htmlContent: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'HTML содержимое письма'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID пользователя-создателя шаблона'
  },
  isPublic: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Публичный шаблон (доступен всем) или личный'
  }
}, {
  tableName: 'email_templates',
  timestamps: true,
  indexes: [
    { fields: ['createdBy'] },
    { fields: ['isPublic'] }
  ]
});

// === EMAIL LOG MODEL ===
const EmailLog = sequelize.define('EmailLog', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  subject: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Тема письма'
  },
  htmlContent: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'HTML содержимое письма'
  },
  recipients: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Массив получателей: [{email, userId, displayName}]'
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Массив вложений: [{name, path, size, mimeType}]'
  },
  sentBy: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID пользователя, отправившего рассылку'
  },
  sentAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: 'Время отправки'
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'sent',
    comment: 'Статус отправки: sent (успешно), failed (ошибка), partial (частично)'
  },
  errorDetails: {
    type: DataTypes.TEXT,
    comment: 'JSON с деталями ошибок отправки'
  }
}, {
  tableName: 'email_logs',
  timestamps: true,
  indexes: [
    { fields: ['sentBy'] },
    { fields: ['sentAt'] },
    { fields: ['status'] }
  ]
});

// ═══════════════════════════════════════════════════════════════
// RELATIONSHIPS
// ═══════════════════════════════════════════════════════════════

// User self-reference: кто переместил в корзину
User.belongsTo(User, { foreignKey: 'deletedBy', as: 'deletedByUser' });

// User & Role (старая связь - оставляем для обратной совместимости, но устарела)
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });

// User & Role (новаяMany-to-Many связь)
User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId', as: 'roles' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'roleId', as: 'usersWithRole' });

// User & RbUserPermission
RbUserPermission.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(RbUserPermission, { foreignKey: 'userId', as: 'rbPermission' });

// User & MedCenter (Many-to-Many)
User.belongsToMany(MedCenter, { through: UserMedCenter, foreignKey: 'userId', as: 'medCenters' });
MedCenter.belongsToMany(User, { through: UserMedCenter, foreignKey: 'medCenterId', as: 'users' });

// Organization & MedCenter. SET NULL при удалении: юрлицо могут закрыть или
// переоформить, медцентр при этом остаётся и просто ждёт новой привязки.
Organization.hasMany(MedCenter, { foreignKey: 'organizationId', as: 'medCenters', onDelete: 'SET NULL' });
MedCenter.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });

// Главврач медцентра.
MedCenter.belongsTo(User, { foreignKey: 'chiefDoctorUserId', as: 'chiefDoctor' });

// Folder hierarchy (self-referencing)
Folder.belongsTo(Folder, { foreignKey: 'parentId', as: 'parent' });
Folder.hasMany(Folder, { foreignKey: 'parentId', as: 'children' });
Folder.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Page & Folder
Page.belongsTo(Folder, { foreignKey: 'folderId', as: 'folder' });
Folder.hasMany(Page, { foreignKey: 'folderId', as: 'pages' });

// Page & User
Page.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });
Page.belongsTo(User, { foreignKey: 'updatedBy', as: 'editor' });

// Page & Media (file pages)
Page.belongsTo(Media, { foreignKey: 'mediaId', as: 'mediaFile' });
Media.hasMany(Page, { foreignKey: 'mediaId', as: 'filePages' });

// PageHistory relationships
PageHistory.belongsTo(Page, { foreignKey: 'pageId', as: 'page' });
PageHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Page.hasMany(PageHistory, { foreignKey: 'pageId', as: 'history', onDelete: 'CASCADE' });
User.hasMany(PageHistory, { foreignKey: 'userId', as: 'pageHistory' });

// SidebarItem relationships
SidebarItem.belongsTo(Page, { foreignKey: 'pageId', as: 'page' });
SidebarItem.belongsTo(Folder, { foreignKey: 'folderId', as: 'folder' });
SidebarItem.belongsTo(SidebarItem, { foreignKey: 'parentId', as: 'parent' });
SidebarItem.hasMany(SidebarItem, { foreignKey: 'parentId', as: 'children' });

// Media
Media.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });

// User Favorites
UserFavorite.belongsTo(User, { foreignKey: 'userId', as: 'user' });
UserFavorite.belongsTo(Page, { foreignKey: 'pageId', as: 'page' });
User.hasMany(UserFavorite, { foreignKey: 'userId', as: 'favorites' });
Page.hasMany(UserFavorite, { foreignKey: 'pageId', as: 'favoritedBy' });

// Chat relationships
Chat.hasMany(ChatMember, { foreignKey: 'chatId', as: 'members' });
Chat.hasMany(Message, { foreignKey: 'chatId', as: 'messages' });
ChatMember.belongsTo(Chat, { foreignKey: 'chatId', as: 'chat' });
ChatMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Message.belongsTo(Chat, { foreignKey: 'chatId', as: 'chat' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });
Message.belongsTo(Message, { foreignKey: 'replyToId', as: 'replyTo' });

// Message & MessageReaction
Message.hasMany(MessageReaction, { foreignKey: 'messageId', as: 'reactions', onDelete: 'CASCADE' });
MessageReaction.belongsTo(Message, { foreignKey: 'messageId', as: 'message' });
MessageReaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(MessageReaction, { foreignKey: 'userId', as: 'messageReactions' });

// MapMarker & User
MapMarker.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Course relationships
Course.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
Course.hasMany(Lesson, { foreignKey: 'courseId', as: 'lessons', onDelete: 'CASCADE' });
Course.hasMany(TestQuestion, { foreignKey: 'courseId', as: 'testQuestions', onDelete: 'CASCADE' });
Course.hasMany(CourseProgress, { foreignKey: 'courseId', as: 'progress', onDelete: 'CASCADE' });

Lesson.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

TestQuestion.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

CourseProgress.belongsTo(User, { foreignKey: 'userId', as: 'user' });
CourseProgress.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });
CourseProgress.belongsTo(Lesson, { foreignKey: 'currentLessonId', as: 'currentLesson' });

// Course & Role (Many-to-Many for access control)
Course.belongsToMany(Role, { through: CourseRole, foreignKey: 'courseId', as: 'allowedRoles' });
Role.belongsToMany(Course, { through: CourseRole, foreignKey: 'roleId', as: 'courses' });

// Course & MedCenter (Many-to-Many for access control)
Course.belongsToMany(MedCenter, { through: CourseMedCenter, foreignKey: 'courseId', as: 'allowedMedCenters' });
MedCenter.belongsToMany(Course, { through: CourseMedCenter, foreignKey: 'medCenterId', as: 'courses' });

// Course & User (Many-to-Many for individual access control)
Course.belongsToMany(User, { through: CourseUser, foreignKey: 'courseId', as: 'allowedUsers' });
User.belongsToMany(Course, { through: CourseUser, foreignKey: 'userId', as: 'allowedCourses' });

// CalendarEvent relationships
CalendarEvent.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
CalendarEvent.belongsTo(CalendarEvent, { foreignKey: 'parentEventId', as: 'parentEvent' });
CalendarEvent.hasMany(CalendarEvent, { foreignKey: 'parentEventId', as: 'instances' });

// === МОДУЛЬ «ЗАДАЧИ» (ver. 6.75) ===
// Пришёл на смену канбан-доске. Отличий от неё три, и схема следует из них:
// задача состоит из частей (исполнитель, оценка, срок — у части, не у задачи);
// срок согласовывается, а не назначается; загрузка считается в часах от личной
// нормы. Рабочие блоки времени лежат в CalendarEvent, своей таблицы у них нет.

// Справочник проектов — сквозной, без привязки к медцентру: проект чаще всего и
// есть то общее, что связывает филиалы.
const TaskProject = sequelize.define('TaskProject', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(160),
    allowNull: false,
    comment: 'Название проекта'
  },
  color: {
    type: DataTypes.STRING(20),
    comment: 'Цвет метки проекта'
  },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
  isArchived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  createdBy: { type: DataTypes.UUID }
}, {
  tableName: 'task_projects',
  timestamps: true,
  indexes: [
    { fields: ['isArchived'] },
    { fields: ['sortOrder'] }
  ]
});

// Команда — не папка, а граница видимости. Досок как сущности в модуле нет:
// доска это представление поверх всех задач, а кто чью загрузку видит, решает
// команда. Поэтому BoardPermission не переделан, а заменён этой парой моделей.
const TaskTeam = sequelize.define('TaskTeam', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(160),
    allowNull: false,
    comment: 'Название команды'
  },
  medCenterId: {
    type: DataTypes.UUID,
    comment: 'Филиал из справочника медцентров (ver. 6.67)'
  },
  access: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'members',
    validate: { isIn: [['members']] },
    comment: 'Фиксированная закрытая область: участники и наблюдатели'
  },
  // Скрытая команда не показывается как «нет доступа» — для того, кому она не
  // открыта, её не существует вовсе. Разница принципиальная: сама строка «нет
  // доступа» сообщает, что команда есть, а этого хватает, чтобы понять, что в
  // компании идёт найм или реорганизация.
  isHidden: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Не показывается в списках, поиске и фильтрах у посторонних'
  },
  ownerId: { type: DataTypes.UUID }
}, {
  tableName: 'task_teams',
  timestamps: true,
  indexes: [
    { fields: ['medCenterId'] },
    { fields: ['isHidden'] }
  ]
});

// Участники и смотрящие одной таблицей: «может смотреть, не будучи участником»
// отличается от участия ровно одним полем, и разводить это по двум таблицам
// значит дублировать все выборки прав.
const TaskTeamMember = sequelize.define('TaskTeamMember', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  teamId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'member',
    validate: { isIn: [['member', 'viewer', 'lead']] },
    comment: 'member — участник, viewer — смотрит загрузку, lead — ставит задачи и меняет нормы'
  }
}, {
  tableName: 'task_team_members',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { unique: true, fields: ['teamId', 'userId'] }
  ]
});

// Ссылка-приглашение не раскрывает состав скрытой команды: до принятия по
// токену отдаётся только название, роль и срок действия.
const TaskTeamInvite = sequelize.define('TaskTeamInvite', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  teamId: { type: DataTypes.UUID, allowNull: false },
  token: { type: DataTypes.STRING(96), allowNull: false, unique: true },
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'member',
    validate: { isIn: [['member', 'viewer', 'lead']] }
  },
  expiresAt: { type: DataTypes.DATE },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  useCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: 'task_team_invites',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['token'] },
    { fields: ['teamId'] },
    { fields: ['expiresAt'] }
  ]
});

// Задача-контейнер: ни исполнителя, ни срока, ни оценки здесь нет — всё это
// принадлежит частям.
//
// Статуса тоже нет, и это не упущение. Статус задачи выводится из статусов её
// частей (все done → готово; есть stuck → анализируется; есть work → в работе).
// Хранить его рядом с частями значит завести два источника правды, которые
// разойдутся на первом же переносе.
const Task = sequelize.define('Task', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(500), allowNull: false },
  description: { type: DataTypes.TEXT },
  projectId: { type: DataTypes.UUID },
  authorId: { type: DataTypes.UUID, allowNull: false },
  attachments: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'Файлы задачи: [{id, filename, path, size, uploadedAt, uploadedBy}]'
  },
  isArchived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  archivedAt: { type: DataTypes.DATE }
}, {
  tableName: 'tasks',
  timestamps: true,
  indexes: [
    { fields: ['authorId'] },
    { fields: ['projectId'] },
    { fields: ['isArchived'] }
  ]
});

// Часть — то, у чего есть исполнитель, оценка и срок. Один исполнитель это одна
// часть, а не особый случай в схеме. Формат задачи (одна на всех / разделена /
// смешанная) не хранится: он выводится из того, сколько у частей исполнителей.
const TaskPart = sequelize.define('TaskPart', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.STRING(500), allowNull: false },
  // «Одна на всех» означает, что эти часы тратит каждый участник: 2 ч на троих
  // — это 2 ч в календаре у каждого и 6 ч трудозатрат.
  estimateHours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    comment: 'Оценка в часах на одного исполнителя'
  },
  dueDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Срок, предложенный автором. Меняется при согласовании — след в TaskHistory'
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'new',
    validate: { isIn: [['new', 'plan', 'work', 'review', 'done', 'stuck']] },
    comment: 'new — не разобрана исполнителем, stuck — переносится третий раз и требует решения'
  },
  // На этом счётчике держится правило, ради которого модуль и затевался: после
  // третьего переноса кнопки «перенести ещё раз» больше нет — система просит
  // решение: разбить, передоговориться или отменить.
  moveCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Сколько раз часть переносили'
  },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: 'task_parts',
  timestamps: true,
  indexes: [
    { fields: ['taskId'] },
    { fields: ['status'] },
    { fields: ['dueDate'] }
  ]
});

// Связи «после»: часть не предлагается исполнителю в календарь, пока предыдущая
// не готова. Отдельной таблицей, а не массивом в JSONB, потому что по этим
// рёбрам строится схема и проверяется отсутствие циклов.
const TaskPartDep = sequelize.define('TaskPartDep', {
  partId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
  afterPartId: { type: DataTypes.UUID, allowNull: false, primaryKey: true }
}, {
  tableName: 'task_part_deps',
  timestamps: false
});

// Исполнители части. Своя строка на человека, а не массив id, потому что
// состояние у каждого своё: в общей задаче один участник уже поставил её в план
// на четверг, второй ещё не разобрал. Массив этого выразить не может.
const TaskPartAssignee = sequelize.define('TaskPartAssignee', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  // NULL — человек ещё не поставил часть в план, она висит у него во входящих.
  // Именно это отличает «не обработана» от «работа идёт».
  plannedDate: {
    type: DataTypes.DATEONLY,
    comment: 'День, на который исполнитель поставил часть. NULL — лежит во входящих'
  },
  declinedAt: {
    type: DataTypes.DATE,
    comment: 'Когда исполнитель вернул часть автору с пометкой «не моя зона»'
  }
}, {
  tableName: 'task_part_assignees',
  timestamps: true,
  indexes: [
    { fields: ['userId', 'plannedDate'] },
    { unique: true, fields: ['partId', 'userId'] }
  ]
});

// «Срок — согласование, а не поле, поэтому у него есть история». Сюда же
// ложится обязательное объяснение, когда автор продавливает задачу в день, где
// она не помещается: обойти проверку можно всегда, но не молча.
const TaskHistory = sequelize.define('TaskHistory', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false },
  partId: { type: DataTypes.UUID },
  userId: { type: DataTypes.UUID },
  action: {
    type: DataTypes.STRING(40),
    allowNull: false,
    comment: 'created, planned, proposed_date, accepted_date, declined, moved, split, forced, status_changed, cancelled'
  },
  payload: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: 'Старый и новый срок, текст объяснения при forced, занятость на момент предложения'
  }
}, {
  tableName: 'task_history',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['taskId', 'createdAt'] }
  ]
});

// Норму меняет руководитель, и это разговор с человеком, а не тихая настройка:
// в интерфейсе должно быть видно, кому и когда её правили.
const TaskNormChange = sequelize.define('TaskNormChange', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  oldValue: { type: DataTypes.DECIMAL(4, 2) },
  newValue: { type: DataTypes.DECIMAL(4, 2) },
  changedBy: { type: DataTypes.UUID }
}, {
  tableName: 'task_norm_changes',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['userId', 'createdAt'] }
  ]
});

const TaskScheduleChange = sequelize.define('TaskScheduleChange', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  oldSchedule: { type: DataTypes.JSONB },
  newSchedule: { type: DataTypes.JSONB },
  changedBy: { type: DataTypes.UUID }
}, {
  tableName: 'task_schedule_changes', timestamps: true, updatedAt: false,
  indexes: [{ fields: ['userId', 'createdAt'] }]
});

// Связи модуля «Задачи»
TaskProject.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

TaskTeam.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
TaskTeam.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
TaskTeam.hasMany(TaskTeamMember, { foreignKey: 'teamId', as: 'members', onDelete: 'CASCADE' });
TaskTeamMember.belongsTo(TaskTeam, { foreignKey: 'teamId', as: 'team' });
TaskTeamMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TaskTeam.hasMany(TaskTeamInvite, { foreignKey: 'teamId', as: 'invites', onDelete: 'CASCADE' });
TaskTeamInvite.belongsTo(TaskTeam, { foreignKey: 'teamId', as: 'team' });
TaskTeamInvite.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

Task.belongsTo(User, { foreignKey: 'authorId', as: 'author' });
Task.belongsTo(TaskProject, { foreignKey: 'projectId', as: 'project' });
Task.hasMany(TaskPart, { foreignKey: 'taskId', as: 'parts', onDelete: 'CASCADE' });
Task.hasMany(TaskHistory, { foreignKey: 'taskId', as: 'history', onDelete: 'CASCADE' });

TaskPart.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });
TaskPart.hasMany(TaskPartAssignee, { foreignKey: 'partId', as: 'assignees', onDelete: 'CASCADE' });
TaskPartAssignee.belongsTo(TaskPart, { foreignKey: 'partId', as: 'part' });
TaskPartAssignee.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Обе стороны связи «после» смотрят на части, поэтому псевдонимы обязательны:
// без них Sequelize свяжет TaskPartDep с TaskPart дважды под одним именем.
TaskPartDep.belongsTo(TaskPart, { foreignKey: 'partId', as: 'part' });
TaskPartDep.belongsTo(TaskPart, { foreignKey: 'afterPartId', as: 'afterPart' });

TaskHistory.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });
TaskHistory.belongsTo(TaskPart, { foreignKey: 'partId', as: 'part' });
TaskHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });

TaskNormChange.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TaskNormChange.belongsTo(User, { foreignKey: 'changedBy', as: 'changedByUser' });
TaskScheduleChange.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TaskScheduleChange.belongsTo(User, { foreignKey: 'changedBy', as: 'changedByUser' });

// Рабочий блок в календаре снимается вместе с частью: если задачу отменили,
// время обязано вернуться в свободное, а не остаться висеть в дне.
CalendarEvent.belongsTo(TaskPart, { foreignKey: 'taskPartId', as: 'taskPart' });
TaskPart.hasMany(CalendarEvent, { foreignKey: 'taskPartId', as: 'blocks', onDelete: 'CASCADE' });

// === REVIEW MODULE MODELS ===

// ReviewPlatform model - справочник площадок (ПроДокторов, Яндекс, 2ГИС и т.д.)
const ReviewPlatform = sequelize.define('ReviewPlatform', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: 'Название площадки'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Площадка активна'
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Порядок сортировки'
  }
}, {
  tableName: 'review_platforms',
  timestamps: true,
  indexes: [
    { fields: ['isActive'] },
    { fields: ['sortOrder'] }
  ]
});

// ReviewBoard model - доска отзывов (соответствует медцентру)
const ReviewBoard = sequelize.define('ReviewBoard', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Название доски (медицинский центр)'
  },
  description: {
    type: DataTypes.TEXT,
    comment: 'Описание доски'
  },
  ownerId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID владельца доски'
  },
  archived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Доска в архиве'
  },
  notificationSettings: {
    type: DataTypes.JSONB,
    defaultValue: {
      newReview: { roles: ['creator'], users: [] },
      statusChange: { roles: ['creator', 'negative_handler'], users: [] },
      assignment: { roles: [], users: [] }
    },
    comment: 'Настройки уведомлений'
  },
  workflowConfig: {
    type: DataTypes.JSONB,
    defaultValue: { nodes: [], edges: [] },
    comment: 'Сценарии автоматизации жизненного цикла отзывов (React Flow graph)'
  },
  columnNames: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Кастомные названия столбцов Kanban { statusId: label }'
  },
  columnSettings: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Настройки столбцов Kanban { statusId: { visibleUserIds: [] } } — пустой массив = показывать всех'
  }
}, {
  tableName: 'review_boards',
  timestamps: true,
  indexes: [
    { fields: ['ownerId'] },
    { fields: ['archived'] }
  ]
});

// ReviewBoardPermission model - доступ к доскам отзывов
const ReviewBoardPermission = sequelize.define('ReviewBoardPermission', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  boardId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID доски'
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID пользователя'
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      isIn: [['owner', 'editor', 'viewer']]
    },
    comment: 'Роль: owner, editor, viewer'
  }
}, {
  tableName: 'review_board_permissions',
  timestamps: true,
  indexes: [
    { fields: ['boardId'] },
    { fields: ['userId'] },
    { unique: true, fields: ['boardId', 'userId'] }
  ]
});

// ReviewBoardRole model - бизнес-роли на доске (создатель, обработчик негатива и т.д.)
const ReviewBoardRole = sequelize.define('ReviewBoardRole', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  boardId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID доски'
  },
  roleName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    validate: {
      isIn: [['creator', 'negative_handler', 'reviewer', 'publisher']]
    },
    comment: 'Роль: creator, negative_handler, reviewer, publisher'
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID пользователя с этой ролью'
  }
}, {
  tableName: 'review_board_roles',
  timestamps: true,
  indexes: [
    { fields: ['boardId'] },
    { fields: ['roleName'] },
    { fields: ['userId'] },
    { unique: true, fields: ['boardId', 'roleName', 'userId'] }
  ]
});

// Review model - отзыв
const Review = sequelize.define('Review', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  boardId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID доски'
  },
  patientName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'ФИО пациента'
  },
  reviewDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Дата отзыва'
  },
  platformId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID площадки'
  },
  doctorName: {
    type: DataTypes.STRING(255),
    comment: 'ФИО врача'
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 },
    comment: 'Оценка от 1 до 5'
  },
  reviewText: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Текст отзыва'
  },
  additionalInfo: {
    type: DataTypes.TEXT,
    comment: 'Дополнительная информация'
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'new',
    comment: 'Статус: new, in_progress, request_info, verification_done, final'
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Прикрепленные файлы'
  },
  createdBy: {
    type: DataTypes.UUID,
    comment: 'ID создателя'
  },
  assigneeIds: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'ID назначенных на этап "Запрос сведений"'
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Порядок сортировки'
  },
  archived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'В архиве'
  },
  archivedAt: {
    type: DataTypes.DATE,
    comment: 'Дата архивации'
  },
  decisionCategory: {
    type: DataTypes.STRING(50),
    comment: 'Категория решения: resolved, compensation, refund, clarification, other'
  },
  decisionDescription: {
    type: DataTypes.TEXT,
    comment: 'Описание решения'
  },
  finalizedAt: {
    type: DataTypes.DATE,
    comment: 'Дата финализации'
  },
  finalizedBy: {
    type: DataTypes.UUID,
    comment: 'ID финализировавшего'
  },
  reportPdfPath: {
    type: DataTypes.STRING(1000),
    comment: 'Путь к PDF отчету'
  },
  // Поля автоимпорта (ver. 1.44)
  externalId: {
    type: DataTypes.STRING(500),
    comment: 'ID отзыва во внешней системе (GetLoyalty)'
  },
  externalUrl: {
    type: DataTypes.TEXT,
    comment: 'Ссылка на оригинал отзыва на площадке'
  },
  isAutoImported: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Импортирован автоматически'
  },
  syncedAt: {
    type: DataTypes.DATE,
    comment: 'Дата последней синхронизации этого отзыва'
  },
  importSource: {
    type: DataTypes.STRING(50),
    comment: 'Источник импорта: getloyalty'
  },
  syncMeta: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Метаданные синхронизации: sourceHashKey для ответа через GetLoyalty'
  }
}, {
  tableName: 'reviews',
  timestamps: true,
  paranoid: true,  // Мягкое удаление: destroy() ставит deletedAt вместо физического удаления
  indexes: [
    { fields: ['boardId'] },
    { fields: ['status'] },
    { fields: ['platformId'] },
    { fields: ['rating'] },
    { fields: ['doctorName'] },
    { fields: ['reviewDate'] },
    { fields: ['archived'] },
    { fields: ['sortOrder'] },
    { fields: ['createdBy'] },
    { fields: ['externalId'] },
    { fields: ['isAutoImported'] }
  ]
});

// ReviewHistory model - история действий по отзыву
const ReviewHistory = sequelize.define('ReviewHistory', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  reviewId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID отзыва'
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID пользователя'
  },
  action: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Действие: created, status_change, comment, file_upload, assignment, finalized'
  },
  oldValue: {
    type: DataTypes.TEXT,
    comment: 'Предыдущее значение'
  },
  newValue: {
    type: DataTypes.TEXT,
    comment: 'Новое значение'
  },
  comment: {
    type: DataTypes.TEXT,
    comment: 'Комментарий'
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Прикрепленные файлы'
  }
}, {
  tableName: 'review_history',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['reviewId'] },
    { fields: ['userId'] },
    { fields: ['action'] },
    { fields: ['createdAt'] }
  ]
});

// ReviewBoard relationships
ReviewBoard.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
ReviewBoard.hasMany(Review, { foreignKey: 'boardId', as: 'reviews', onDelete: 'CASCADE' });
ReviewBoard.hasMany(ReviewBoardPermission, { foreignKey: 'boardId', as: 'permissions', onDelete: 'CASCADE' });
ReviewBoard.hasMany(ReviewBoardRole, { foreignKey: 'boardId', as: 'roles', onDelete: 'CASCADE' });

// ReviewBoardPermission relationships
ReviewBoardPermission.belongsTo(ReviewBoard, { foreignKey: 'boardId', as: 'board' });
ReviewBoardPermission.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// ReviewBoardRole relationships
ReviewBoardRole.belongsTo(ReviewBoard, { foreignKey: 'boardId', as: 'board' });
ReviewBoardRole.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Review relationships
Review.belongsTo(ReviewBoard, { foreignKey: 'boardId', as: 'board' });
Review.belongsTo(ReviewPlatform, { foreignKey: 'platformId', as: 'platform' });
Review.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
Review.belongsTo(User, { foreignKey: 'finalizedBy', as: 'finalizer' });
Review.hasMany(ReviewHistory, { foreignKey: 'reviewId', as: 'history', onDelete: 'CASCADE' });

// ReviewHistory relationships
ReviewHistory.belongsTo(Review, { foreignKey: 'reviewId', as: 'review' });
ReviewHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// ReviewSyncConfig model - настройки синхронизации отзывов (одна запись = одна площадка на доску)
const ReviewSyncConfig = sequelize.define('ReviewSyncConfig', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  boardId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'ID доски'
  },
  provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Провайдер: google | yandex | prodoctorov | docdoc | napopravku | 2gis | doctu'
  },
  isEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Синхронизация включена'
  },
  credentials: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Credentials площадки (API-ключи, токены, ID объекта)'
  },
  lastSyncAt: {
    type: DataTypes.DATE,
    comment: 'Время последней синхронизации'
  },
  lastSyncStatus: {
    type: DataTypes.STRING(20),
    comment: 'Статус: success | error | running'
  },
  lastSyncError: {
    type: DataTypes.TEXT,
    comment: 'Текст ошибки последней синхронизации'
  },
  lastSyncCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Кол-во импортированных отзывов при последней синхронизации'
  }
}, {
  tableName: 'review_sync_configs',
  timestamps: true,
  indexes: [
    { fields: ['boardId'] },
    { fields: ['isEnabled'] },
    { unique: true, fields: ['boardId', 'provider'] }
  ]
});

ReviewSyncConfig.belongsTo(ReviewBoard, { foreignKey: 'boardId', as: 'board' });
ReviewBoard.hasMany(ReviewSyncConfig, { foreignKey: 'boardId', as: 'syncConfigs', onDelete: 'CASCADE' });

// === INT ID MAP MODEL (UUID → stable integer ID для Telegram Bot API) ===
// BIGSERIAL гарантирует уникальные монотонно растущие ID без коллизий
const IntIdMap = sequelize.define('IntIdMap', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, comment: 'Стабильный целочисленный ID (Telegram integer id)' },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, comment: 'UUID объекта (user или chat)' },
  entityType: { type: DataTypes.STRING(20), allowNull: false, comment: 'Тип: user | chat' }
}, {
  tableName: 'int_id_map',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['uuid'] },
    { fields: ['entityType'] }
  ]
});

// === BOT TOKEN MODEL (Telegram Bot API compatibility) ===
const BotToken = sequelize.define('BotToken', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  token: { type: DataTypes.STRING(150), allowNull: false, unique: true, comment: 'Токен бота (формат: числа:строка)' },
  name: { type: DataTypes.STRING(100), allowNull: false, comment: 'Отображаемое имя бота' },
  username: { type: DataTypes.STRING(100), allowNull: false, unique: true, comment: 'Username бота без @' },
  description: { type: DataTypes.TEXT, defaultValue: '', comment: 'Описание бота' },
  userId: { type: DataTypes.UUID, allowNull: false, comment: 'ID связанного User-записи бота' },
  webhookUrl: { type: DataTypes.TEXT, allowNull: true, comment: 'URL для доставки обновлений через webhook' },
  webhookSecretToken: { type: DataTypes.STRING(256), allowNull: true, comment: 'Секретный токен для X-Telegram-Bot-Api-Secret-Token' },
  allowedUpdates: { type: DataTypes.ARRAY(DataTypes.TEXT), defaultValue: [], comment: 'Список типов обновлений для webhook' },
  maxConnections: { type: DataTypes.INTEGER, defaultValue: 40, comment: 'Максимальное число webhook соединений' },
  commands: { type: DataTypes.JSONB, defaultValue: [], comment: 'Список команд бота [{command, description}]' },
  servesForms: { type: DataTypes.JSONB, defaultValue: [], comment: 'Типы форм публичного API, которые доставляет бот' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, comment: 'Бот активен' },
  lastUpdateId: { type: DataTypes.BIGINT, defaultValue: 0, comment: 'Последний полученный update_id (для getUpdates)' }
}, {
  tableName: 'bot_tokens',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['token'] },
    { unique: true, fields: ['username'] },
    { fields: ['userId'] },
    { fields: ['isActive'] }
  ]
});

// === BOT UPDATE MODEL (очередь обновлений) ===
const BotUpdate = sequelize.define('BotUpdate', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, comment: 'update_id в Telegram Bot API' },
  botId: { type: DataTypes.UUID, allowNull: false, comment: 'ID бота' },
  updateType: { type: DataTypes.STRING(50), allowNull: false, comment: 'Тип: message, edited_message, callback_query и т.д.' },
  updateData: { type: DataTypes.JSONB, defaultValue: {}, comment: 'Полный объект обновления' },
  processed: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Обновление обработано (через getUpdates или webhook)' }
}, {
  tableName: 'bot_updates',
  timestamps: true,
  indexes: [
    { fields: ['botId'] },
    { fields: ['processed'] },
    { fields: ['botId', 'processed'] },
    { fields: ['createdAt'] }
  ]
});

// === API CLIENT MODEL (внешняя система, которой разрешено слать нам данные) ===
// Не пользователь, а интегрируемая система: сайт клиники, лендинг, партнёрский сервис.
// Сам ключ в БД не хранится — только префикс (для поиска строки) и sha256-хеш.
const ApiClient = sequelize.define('ApiClient', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(150), allowNull: false, comment: 'Название системы, напр. «Сайт medcentralfa.ru»' },
  keyType: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'secret', comment: 'secret — вызывает бэкенд; public — вызывает браузер' },
  keyPrefix: { type: DataTypes.STRING(32), allowNull: false, unique: true, comment: 'Начало ключа, по нему ищем строку' },
  keyHash: { type: DataTypes.STRING(64), allowNull: false, comment: 'sha256 полного ключа' },
  scopes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: "Разрешённые действия, напр. ['forms:patient-registration']" },
  allowedOrigins: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: 'Белый список Origin — обязателен для keyType=public' },
  allowedIps: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: 'Белый список IP — опционально для keyType=secret' },
  rateLimitPerMin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60, comment: 'Лимит запросов в минуту' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true },
  updatedBy: { type: DataTypes.UUID, allowNull: true, comment: 'Кто последним менял права ключа' }
}, {
  tableName: 'api_clients',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['keyPrefix'] },
    { fields: ['isActive'] }
  ]
});

// === SUBMISSION MODEL (заявка, принятая публичным API) ===
// Универсальная: новая форма = новый formType, без миграции.
// Источник правды — эта таблица; сообщение в чате лишь доставка.
const Submission = sequelize.define('Submission', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  formType: { type: DataTypes.STRING(50), allowNull: false, comment: 'Тип формы, напр. patient-registration' },
  clientId: { type: DataTypes.UUID, allowNull: true, comment: 'ID api_clients, от кого пришло' },
  payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: 'Поля формы после нормализации' },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'new', comment: 'new | in_progress | done | spam' },
  deliveryStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', comment: 'pending | sent | failed' },
  deliveryAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  deliveryError: { type: DataTypes.TEXT, allowNull: true },
  deliveredMsgId: { type: DataTypes.BIGINT, allowNull: true, comment: 'message_id доставленного сообщения в чате' },
  deliveredAt: { type: DataTypes.DATE, allowNull: true },
  assignedUserId: { type: DataTypes.UUID, allowNull: true },
  sourceIp: { type: DataTypes.STRING(64), allowNull: true },
  userAgent: { type: DataTypes.TEXT, allowNull: true },
  idempotencyKey: { type: DataTypes.STRING(100), allowNull: true, comment: 'Защита от дублей при ретраях клиента' }
}, {
  tableName: 'submissions',
  timestamps: true,
  indexes: [
    { fields: ['deliveryStatus'] },
    { fields: ['formType', 'createdAt'] }
  ]
});

// === API REQUEST LOG MODEL (аудит публичного API) ===
// Тело запроса НЕ логируем — там персональные данные.
const ApiRequestLog = sequelize.define('ApiRequestLog', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  clientId: { type: DataTypes.UUID, allowNull: true },
  method: { type: DataTypes.STRING(10), allowNull: false },
  path: { type: DataTypes.TEXT, allowNull: false },
  statusCode: { type: DataTypes.INTEGER, allowNull: false },
  errorCode: { type: DataTypes.STRING(50), allowNull: true },
  durationMs: { type: DataTypes.INTEGER, allowNull: true },
  ip: { type: DataTypes.STRING(64), allowNull: true }
}, {
  tableName: 'api_request_logs',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['clientId', 'createdAt'] },
    { fields: ['createdAt'] }
  ]
});

// === FORM SUBSCRIPTION MODEL (какой чат какие формы получает) ===
// Заменяет переменные PUBLIC_FORM_<ТИП>_CHAT_ID в .env. Строка заводится сама,
// когда бота добавляют в чат, и удаляется, когда его убирают — как в Telegram.
const FormSubscription = sequelize.define('FormSubscription', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  botId: { type: DataTypes.UUID, allowNull: false, comment: 'Бот, который доставляет' },
  chatId: { type: DataTypes.UUID, allowNull: false, comment: 'Чат-получатель' },
  formType: { type: DataTypes.STRING(50), allowNull: false, comment: 'Тип формы' },
  filters: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: '{clientId} — принимать только от этого клиента' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.UUID, allowNull: true, comment: 'Кто подписал; NULL — автоподписка при входе бота' }
}, {
  tableName: 'form_subscriptions',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['botId', 'chatId', 'formType'] },
    { fields: ['formType'] },
    { fields: ['chatId'] }
  ]
});

// === SUBMISSION DELIVERY MODEL (доставка заявки в конкретный чат) ===
// Заявка уходит в несколько чатов сразу, у каждого свой статус и свои попытки:
// сбой в одном чате не должен ни теряться, ни приводить к дублям в остальных.
const SubmissionDelivery = sequelize.define('SubmissionDelivery', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  submissionId: { type: DataTypes.UUID, allowNull: false },
  chatId: { type: DataTypes.UUID, allowNull: false },
  botId: { type: DataTypes.UUID, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', comment: 'pending | sent | failed' },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  error: { type: DataTypes.TEXT, allowNull: true },
  messageId: { type: DataTypes.BIGINT, allowNull: true, comment: 'message_id в чате вики' },
  deliveredAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'submission_deliveries',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['submissionId', 'chatId'] },
    { fields: ['status', 'attempts'] }
  ]
});

// === CASH PAYMENT MODEL (выдача из кассы) ===
const CashPayment = sequelize.define('CashPayment', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  salaryRecordId: { type: DataTypes.UUID, allowNull: true },
  misUserId: { type: DataTypes.STRING(50), allowNull: false },
  doctorName: { type: DataTypes.STRING(255), allowNull: false },
  periodLabel: { type: DataTypes.STRING(100), allowNull: true },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  issuedByUserId: { type: DataTypes.UUID, allowNull: true },
  financistName: { type: DataTypes.STRING(100), allowNull: true },
  note: { type: DataTypes.TEXT, allowNull: true },
  editHistory: { type: DataTypes.JSONB, defaultValue: [] },
}, {
  tableName: 'cash_payments',
  timestamps: true,
  indexes: [
    { fields: ['salaryRecordId'] },
    { fields: ['misUserId'] },
    { fields: ['issuedAt'] },
  ],
});

// === SALARY RECORD MODEL (история зарплат) ===
const SalaryRecord = sequelize.define('SalaryRecord', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId: { type: DataTypes.STRING(50), allowNull: false },
  doctorName: { type: DataTypes.STRING(255), allowNull: false },
  dateFrom: { type: DataTypes.DATEONLY, allowNull: true },
  dateTo: { type: DataTypes.DATEONLY, allowNull: true },
  periodLabel: { type: DataTypes.STRING(100), allowNull: true },
  reportData: { type: DataTypes.JSONB, allowNull: true },
  excelData: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'salary_records',
  timestamps: true,
  indexes: [
    { fields: ['misUserId'] },
    { fields: ['dateFrom'] }
  ]
});

// === RB EXCEL SOURCE MODEL (хранилище Excel-источников для отчётов) ===
const RbExcelSource = sequelize.define('RbExcelSource', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  dateFrom:    { type: DataTypes.DATEONLY, allowNull: false },
  dateTo:      { type: DataTypes.DATEONLY, allowNull: false },
  periodLabel: { type: DataTypes.STRING(255), allowNull: true },
  fileName:    { type: DataTypes.STRING(500), allowNull: false },
  fileData:    { type: DataTypes.TEXT, allowNull: false },   // base64-encoded Excel
  uploadedBy:  { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: 'rb_excel_sources',
  timestamps: true,
  indexes: [
    { fields: ['dateFrom'] },
    { fields: ['dateTo'] },
  ],
});

// === PROMOTION MODEL ===
const Promotion = sequelize.define('Promotion', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  medCenter: {
    type: DataTypes.ENUM('Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К', 'Сукко', 'ИП Микаелян'),
    allowNull: false
  },
  dateFrom: { type: DataTypes.DATEONLY, allowNull: true, comment: 'Дата начала акции (опционально)' },
  deadline: { type: DataTypes.DATEONLY, allowNull: true, comment: 'null = постоянная акция' },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'promotions',
  timestamps: true,
  indexes: [
    { fields: ['medCenter'] },
    { fields: ['deadline'] }
  ]
});

// === AMBULANCE REPORT ENTRY MODEL ===
const AmbulanceReportEntry = sequelize.define('AmbulanceReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entryType: {
    type: DataTypes.ENUM('calls', 'refusals', 'caddy', 'patientCalls'),
    allowNull: false
  },
  seqNumber: { type: DataTypes.INTEGER, allowNull: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: true },
  entryTime: { type: DataTypes.STRING(5), allowNull: true },
  patientName: { type: DataTypes.STRING(255), allowNull: true },
  sourceCallId: { type: DataTypes.UUID, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'ambulance_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryType'] },
    { fields: ['entryDate'] },
    { fields: ['patientName'] },
    { fields: ['sourceCallId'] },
    { fields: ['createdAt'] }
  ]
});

// === CERTIFICATE REGISTRY MODEL (Реестр справок) ===
// org — организация (престиж / лабгрупп / алекс); структура таблицы одинакова
const CertificateRegistryEntry = sequelize.define('CertificateRegistryEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  org: {
    type: DataTypes.ENUM('prestige', 'labgroup', 'alex'),
    allowNull: false
  },
  year: { type: DataTypes.INTEGER, allowNull: true, comment: 'Год реестра — вкладка (лист исходного Excel)' },
  seqNumber: { type: DataTypes.INTEGER, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'certificate_registry_entries',
  timestamps: true,
  indexes: [
    { fields: ['org'] },
    { fields: ['org', 'year'] },
    { fields: ['createdAt'] }
  ]
});

// === DOCTOR DAY REPORT MODEL (Отчёт по врачам за месяц) ===
// Строка = врач на конкретном месяце (вкладка = год + месяц, как лист Excel).
// days — суммы и комментарии по числам месяца: { "1": { sum, info }, ... }.
// Итоги по строке и по столбцу считаются на лету и в БД не хранятся.
// Порядок строк тоже не хранится — список всегда сортируется по алфавиту ФИО,
// поэтому добавленный врач сразу встаёт на своё место.
const DoctorDayReportEntry = sequelize.define('DoctorDayReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  year: { type: DataTypes.INTEGER, allowNull: false },
  month: { type: DataTypes.INTEGER, allowNull: false, comment: 'Месяц 1–12 — вкладка (лист исходного Excel)' },
  doctorName: { type: DataTypes.TEXT, allowNull: false },
  days: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'doctor_day_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['year', 'month'] },
    { fields: ['doctorName'] }
  ]
});

// === OPERATIONS REPORT MODEL ===
const OperationsReportEntry = sequelize.define('OperationsReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'operations_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryDate'] },
    { fields: ['createdAt'] }
  ]
});

// === GYNECOLOGY REPORT MODEL ===
const GynecologyReportEntry = sequelize.define('GynecologyReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'gynecology_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryDate'] },
    { fields: ['createdAt'] }
  ]
});

// === THERAPY REPORT MODEL ===
const TherapyReportEntry = sequelize.define('TherapyReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'therapy_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryDate'] },
    { fields: ['createdAt'] }
  ]
});

// === SURGERY REPORT MODEL ===
const SurgeryReportEntry = sequelize.define('SurgeryReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'surgery_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryDate'] },
    { fields: ['createdAt'] }
  ]
});

// === DISCOUNT REPORT MODEL (скидки 100%) ===
const DiscountReportEntry = sequelize.define('DiscountReportEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entryDate: { type: DataTypes.DATEONLY, allowNull: true },
  searchText: { type: DataTypes.TEXT, allowNull: true },
  data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'discount_report_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryDate'] },
    { fields: ['createdAt'] }
  ]
});

// === PARTNER SERVICE CACHE MODEL ===
const PartnerServiceCache = sequelize.define('PartnerServiceCache', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  clinicId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'ID клиники из МИС (1,2,3,4,6,7)'
  },
  serviceId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'ID услуги в МИС'
  },
  code: { type: DataTypes.STRING(100), comment: 'Артикул' },
  subCode: { type: DataTypes.STRING(100), comment: 'Код 804н' },
  title: { type: DataTypes.STRING(500), allowNull: false, comment: 'Название услуги' },
  categoryId: { type: DataTypes.INTEGER, comment: 'ID категории' },
  categoryTitle: { type: DataTypes.STRING(500), comment: 'Название категории' },
  categoryPath: { type: DataTypes.TEXT, comment: 'Полный путь категории (для дерева)' },
  price: { type: DataTypes.DECIMAL(10, 2), comment: 'Стоимость' },
  costPrice: { type: DataTypes.DECIMAL(10, 2), comment: 'Себестоимость' },
  duration: { type: DataTypes.INTEGER, comment: 'Длительность в минутах' },
  lab: { type: DataTypes.STRING(255), comment: 'Лаборатория' },
  isHidden: { type: DataTypes.BOOLEAN, defaultValue: false },
  isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  syncedAt: { type: DataTypes.DATE, comment: 'Время последней синхронизации' }
}, {
  tableName: 'partner_service_cache',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['clinicId', 'serviceId'], name: 'partner_service_clinic_service_unique' },
    { fields: ['clinicId'] },
    { fields: ['categoryId'] },
    { fields: ['title'], name: 'partner_service_title_idx' }
  ]
});

// === NOMENCLATURE 804н MODEL (справочник эталонных названий по коду) ===
const Nomenclature804n = sequelize.define('Nomenclature804n', {
  code: { type: DataTypes.STRING(100), primaryKey: true, comment: 'Нормализованный код 804н (A01.01.001)' },
  name: { type: DataTypes.STRING(500), allowNull: false, comment: 'Эталонное название (актуальная редакция)' },
  nameAlt: { type: DataTypes.STRING(500), comment: 'Название в редакции 2017 (если отличается)' },
  deprecated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: 'Код упразднён' },
  edition: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '2.10', comment: 'Версия справочника-источника' }
}, {
  tableName: 'nomenclature_804n',
  timestamps: true,
  createdAt: false,
  updatedAt: 'updatedAt'
});

// BotToken relationships
BotToken.belongsTo(User, { foreignKey: 'userId', as: 'botUser' });
User.hasMany(BotToken, { foreignKey: 'userId', as: 'botTokens' });

// BotUpdate relationships
BotUpdate.belongsTo(BotToken, { foreignKey: 'botId', as: 'bot' });
BotToken.hasMany(BotUpdate, { foreignKey: 'botId', as: 'updates', onDelete: 'CASCADE' });

// FormSubscription relationships
FormSubscription.belongsTo(BotToken, { foreignKey: 'botId', as: 'bot' });
FormSubscription.belongsTo(Chat, { foreignKey: 'chatId', as: 'chat' });
BotToken.hasMany(FormSubscription, { foreignKey: 'botId', as: 'formSubscriptions', onDelete: 'CASCADE' });
Chat.hasMany(FormSubscription, { foreignKey: 'chatId', as: 'formSubscriptions', onDelete: 'CASCADE' });

// SubmissionDelivery relationships
SubmissionDelivery.belongsTo(Submission, { foreignKey: 'submissionId', as: 'submission' });
SubmissionDelivery.belongsTo(Chat, { foreignKey: 'chatId', as: 'chat' });
Submission.hasMany(SubmissionDelivery, { foreignKey: 'submissionId', as: 'deliveries', onDelete: 'CASCADE' });

// AccreditationFile relationships
AccreditationFile.belongsTo(Accreditation, { foreignKey: 'accreditationId', as: 'accreditation' });
AccreditationFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
Accreditation.hasMany(AccreditationFile, { foreignKey: 'accreditationId', as: 'files', onDelete: 'CASCADE' });

// VehicleFile relationships
VehicleFile.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });
VehicleFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
Vehicle.hasMany(VehicleFile, { foreignKey: 'vehicleId', as: 'files', onDelete: 'CASCADE' });

// PriceComparison relationships
PriceComparison.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
PriceComparison.hasMany(PriceComparisonItem, { foreignKey: 'comparisonId', as: 'items', onDelete: 'CASCADE' });
PriceComparisonItem.belongsTo(PriceComparison, { foreignKey: 'comparisonId', as: 'comparison' });

// Competitor prices relationships (зеркало alfa-parser)
CompetitorSource.hasMany(CompetitorService, { foreignKey: 'sourceId', as: 'services', onDelete: 'CASCADE' });
CompetitorService.belongsTo(CompetitorSource, { foreignKey: 'sourceId', as: 'source' });
CompetitorService.hasMany(CompetitorPrice, { foreignKey: 'serviceId', as: 'prices', onDelete: 'CASCADE' });
CompetitorPrice.belongsTo(CompetitorService, { foreignKey: 'serviceId', as: 'service' });
CompetitorSource.hasMany(CompetitorLocation, { foreignKey: 'sourceId', as: 'locations', onDelete: 'CASCADE' });
CompetitorLocation.belongsTo(CompetitorSource, { foreignKey: 'sourceId', as: 'source' });

PriceComparisonItem.hasMany(CompetitorServiceMatch, { foreignKey: 'itemId', as: 'competitorMatches', onDelete: 'CASCADE' });
CompetitorServiceMatch.belongsTo(PriceComparisonItem, { foreignKey: 'itemId', as: 'item' });
CompetitorService.hasMany(CompetitorServiceMatch, { foreignKey: 'competitorServiceId', as: 'matches', onDelete: 'CASCADE' });
CompetitorServiceMatch.belongsTo(CompetitorService, { foreignKey: 'competitorServiceId', as: 'competitorService' });

// EmailTemplate relationships
EmailTemplate.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(EmailTemplate, { foreignKey: 'createdBy', as: 'emailTemplates' });

// EmailLog relationships
EmailLog.belongsTo(User, { foreignKey: 'sentBy', as: 'sender' });
User.hasMany(EmailLog, { foreignKey: 'sentBy', as: 'sentEmails' });

// EmailFavoriteRecipient relationships
EmailFavoriteRecipient.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(EmailFavoriteRecipient, { foreignKey: 'userId', as: 'favoriteRecipients' });

// EmailFavoriteTemplate relationships
EmailFavoriteTemplate.belongsTo(User, { foreignKey: 'userId', as: 'user' });
EmailFavoriteTemplate.belongsTo(EmailTemplate, { foreignKey: 'templateId', as: 'template' });
User.hasMany(EmailFavoriteTemplate, { foreignKey: 'userId', as: 'favoriteTemplates' });
EmailTemplate.hasMany(EmailFavoriteTemplate, { foreignKey: 'templateId', as: 'favorites' });

// === RB SCHEDULE DICTIONARIES ===
const RbScheduleCategory = sequelize.define('RbScheduleCategory', {
  id:    { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:  { type: DataTypes.STRING(100), allowNull: false },
  color: { type: DataTypes.STRING(20),  allowNull: false, defaultValue: '#94a3b8' },
}, {
  tableName: 'rb_schedule_categories',
  timestamps: true,
});

const RbScheduleCabinet = sequelize.define('RbScheduleCabinet', {
  id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:     { type: DataTypes.STRING(100), allowNull: false },
  clinicId: { type: DataTypes.STRING(50),  allowNull: false, field: 'clinic_id' },
}, {
  tableName: 'rb_schedule_cabinets',
  timestamps: true,
});

RbScheduleCategory.hasMany(CategoryNorm, { foreignKey: 'categoryId', as: 'norms' });
CategoryNorm.belongsTo(RbScheduleCategory, { foreignKey: 'categoryId', as: 'category' });

// === DOCTOR SCHEDULE MODEL ===
const DoctorSchedule = sequelize.define('DoctorSchedule', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId:  { type: DataTypes.STRING(100), allowNull: false },
  clinicId:   { type: DataTypes.STRING(50),  allowNull: false },
  dateFrom:   { type: DataTypes.DATEONLY,    allowNull: false },
  dateTo:     { type: DataTypes.DATEONLY,    allowNull: false },
  pattern:    { type: DataTypes.JSONB,       allowNull: false, defaultValue: {} },
  timeFrom:   { type: DataTypes.STRING(5),   allowNull: false, defaultValue: '09:00' },
  timeTo:     { type: DataTypes.STRING(5),   allowNull: false, defaultValue: '18:00' },
  exceptions: { type: DataTypes.JSONB,       allowNull: false, defaultValue: [] },
  categoryId: { type: DataTypes.UUID,        allowNull: true, field: 'category_id' },
  cabinetId:  { type: DataTypes.UUID,        allowNull: true, field: 'cabinet_id' },
  roleTitle:  { type: DataTypes.STRING(200), allowNull: true, field: 'role_title' },
  source:     { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'manual' },
  misData:    { type: DataTypes.JSONB,       allowNull: true,  field: 'mis_data' },
  createdBy:  { type: DataTypes.UUID },
}, {
  tableName: 'doctor_schedules',
  timestamps: true,
  indexes: [
    { fields: ['misUserId'], name: 'idx_doctor_schedules_mis_user' },
    { fields: ['dateFrom', 'dateTo'], name: 'idx_doctor_schedules_dates' },
  ],
});

// === TABEL RECORD MODELS (табели учёта рабочего времени) ===
const TabelRecord = sequelize.define('TabelRecord', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  month:       { type: DataTypes.SMALLINT, allowNull: false },
  year:        { type: DataTypes.SMALLINT, allowNull: false },
  orgName:     { type: DataTypes.STRING(255), field: 'org_name' },
  subdivision: { type: DataTypes.STRING(255) },
  docNumber:   { type: DataTypes.STRING(50),  field: 'doc_number' },
  userName:    { type: DataTypes.STRING(255), field: 'user_name' },
  tabelType:   { type: DataTypes.STRING(20),  field: 'tabel_type', defaultValue: 'standard' },
  createdBy:   { type: DataTypes.UUID, field: 'created_by' },
}, {
  tableName: 'tabel_records',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['year', 'month'], name: 'idx_tabel_records_year_month' },
  ],
});

const TabelRecordDoctor = sequelize.define('TabelRecordDoctor', {
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tabelRecordId: { type: DataTypes.UUID, allowNull: false, field: 'tabel_record_id' },
  misUserId:     { type: DataTypes.STRING(100), allowNull: false, field: 'mis_user_id' },
  doctorName:    { type: DataTypes.STRING(255), field: 'doctor_name' },
  entries:       { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  payData:       { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'pay_data' },
}, {
  tableName: 'tabel_record_doctors',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tabel_record_id'], name: 'idx_tabel_record_doctors_rec' },
    { fields: ['mis_user_id'],     name: 'idx_tabel_record_doctors_user' },
  ],
});

TabelRecord.hasMany(TabelRecordDoctor, { foreignKey: 'tabelRecordId', as: 'doctors' });
TabelRecordDoctor.belongsTo(TabelRecord, { foreignKey: 'tabelRecordId', as: 'tabelRecord' });

// === STRUCTURAL DIVISIONS ===
const StructuralDivision = sequelize.define('StructuralDivision', {
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:      { type: DataTypes.STRING(255), allowNull: false },
  doctorIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'doctor_ids' },
  rates:     { type: DataTypes.JSONB, allowNull: true,  defaultValue: [], field: 'rates' },
  createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by', references: { model: 'users', key: 'id' } },
}, {
  tableName: 'structural_divisions',
  timestamps: true,
  underscored: true,
});

const DivisionAccess = sequelize.define('DivisionAccess', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  divisionId: { type: DataTypes.UUID, allowNull: false, field: 'division_id' },
  userId:     { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
  permission: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'read' },
}, {
  tableName: 'division_access',
  timestamps: true,
  underscored: true,
});

// StructuralDivision & DivisionAccess associations
StructuralDivision.hasMany(DivisionAccess, { foreignKey: 'divisionId', as: 'accesses' });
DivisionAccess.belongsTo(StructuralDivision, { foreignKey: 'divisionId' });
DivisionAccess.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(DivisionAccess, { foreignKey: 'userId' });

// === PUBLIC HOLIDAYS ===
const RbHoliday = sequelize.define('RbHoliday', {
  id:   { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  date: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
  name: { type: DataTypes.STRING(200), allowNull: true },
}, {
  tableName: 'rb_holidays',
  timestamps: true,
  underscored: true,
});

// === DOCTOR HEADERS (tabelNumber etc.) ===
const RbDoctorHeader = sequelize.define('RbDoctorHeader', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misUserId:   { type: DataTypes.STRING(100), allowNull: false, unique: true, field: 'mis_user_id' },
  tabelNumber: { type: DataTypes.STRING(50),  allowNull: true, field: 'tabel_number' },
}, {
  tableName: 'rb_doctor_headers',
  timestamps: true,
  underscored: true,
});

// === MIS SCHEDULE CATEGORY MAPPING ===
const MisScheduleCategoryMap = sequelize.define('MisScheduleCategoryMap', {
  id:            { type: DataTypes.UUID,    defaultValue: DataTypes.UUIDV4, primaryKey: true },
  misCategoryId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'mis_category_id' },
  rbCategoryId:  { type: DataTypes.UUID,    allowNull: true,  field: 'rb_category_id' },
}, {
  tableName: 'mis_schedule_category_map',
  timestamps: true,
  underscored: true,
});

MisScheduleCategoryMap.belongsTo(RbScheduleCategory, { foreignKey: 'rbCategoryId', as: 'rbCategory' });

// === RB ACTIVITY LOG ===
const RbActivityLog = sequelize.define('RbActivityLog', {
  id:         { type: DataTypes.UUID,    defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:     { type: DataTypes.UUID,    allowNull: true,  field: 'user_id' },
  tab:        { type: DataTypes.STRING(50),  allowNull: false },
  action:     { type: DataTypes.STRING(50),  allowNull: false },
  entityType: { type: DataTypes.STRING(100), allowNull: true,  field: 'entity_type' },
  entityId:   { type: DataTypes.STRING(255), allowNull: true,  field: 'entity_id' },
  doctorName: { type: DataTypes.STRING(255), allowNull: true,  field: 'doctor_name' },
  misUserId:  { type: DataTypes.STRING(100), allowNull: true,  field: 'mis_user_id' },
  clinicId:   { type: DataTypes.STRING(100), allowNull: true,  field: 'clinic_id' },
  summary:    { type: DataTypes.TEXT,        allowNull: false },
  diff:       { type: DataTypes.JSONB,       allowNull: true },
}, {
  tableName:   'rb_activity_log',
  timestamps:  true,
  updatedAt:   false,
  underscored: true,
});

RbActivityLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// === RB RESET BACKUPS ===
// Точка возврата для выборочного сброса на вкладке «Сотрудники». В payload лежит
// settings целиком по каждой строке executor_settings, которую сброс переписывает:
// откат должен возвращать состояние ровно на момент снимка, а не пересобирать его
// из тех же правил, по которым сброс данные и удалял.
const RbResetBackup = sequelize.define('RbResetBackup', {
  id:            { type: DataTypes.UUID,       defaultValue: DataTypes.UUIDV4, primaryKey: true },
  kind:          { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'reset' },
  userId:        { type: DataTypes.UUID,       allowNull: true,  field: 'user_id' },
  clinicIds:     { type: DataTypes.JSONB,      allowNull: false, defaultValue: [], field: 'clinic_ids' },
  employeeCount: { type: DataTypes.INTEGER,    allowNull: false, defaultValue: 0,  field: 'employee_count' },
  changeCount:   { type: DataTypes.INTEGER,    allowNull: false, defaultValue: 0,  field: 'change_count' },
  payload:       { type: DataTypes.JSONB,      allowNull: false, defaultValue: {} },
  restoredAt:    { type: DataTypes.DATE,       allowNull: true,  field: 'restored_at' },
  restoredBy:    { type: DataTypes.UUID,       allowNull: true,  field: 'restored_by' },
}, {
  tableName:   'rb_reset_backups',
  timestamps:  true,
  updatedAt:   false,
  underscored: true,
});

RbResetBackup.belongsTo(User, { foreignKey: 'userId',     as: 'author' });
RbResetBackup.belongsTo(User, { foreignKey: 'restoredBy', as: 'restorer' });

// ── MIS Appointments ──────────────────────────────────────────────────────────
const MisAppointment = sequelize.define('MisAppointment', {
  id:          { type: DataTypes.INTEGER,     autoIncrement: true, primaryKey: true },
  apptId:      { type: DataTypes.INTEGER,     allowNull: false, unique: true, field: 'appt_id' },
  clinicId:    { type: DataTypes.SMALLINT,    allowNull: true,  field: 'clinic_id' },
  room:        { type: DataTypes.STRING(100), allowNull: true },
  doctorId:    { type: DataTypes.INTEGER,     allowNull: true,  field: 'doctor_id' },
  patientId:   { type: DataTypes.INTEGER,     allowNull: true,  field: 'patient_id' },
  timeStart:   { type: DataTypes.DATE,        allowNull: true,  field: 'time_start' },
  timeEnd:     { type: DataTypes.DATE,        allowNull: true,  field: 'time_end' },
  statusId:    { type: DataTypes.SMALLINT,    allowNull: true,  field: 'status_id' },
  status:      { type: DataTypes.STRING(20),  allowNull: true },
  dateCreated: { type: DataTypes.DATE,        allowNull: true,  field: 'date_created' },
  dateUpdated: { type: DataTypes.DATE,        allowNull: true,  field: 'date_updated' },
  data:        { type: DataTypes.JSONB,       allowNull: false, defaultValue: {} },
  syncedAt:    { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.NOW, field: 'synced_at' },
}, {
  tableName:  'mis_appointments',
  timestamps: false,
  indexes: [
    { fields: ['clinic_id'] },
    { fields: ['room'] },
    { fields: ['time_start'] },
    { fields: ['doctor_id'] },
    { fields: ['patient_id'] },
    { fields: ['status_id'] },
  ],
});

// ── MIS Payments (списания getPayments, type=2; возвраты помечены is_refund) ────
const MisPayment = sequelize.define('MisPayment', {
  id:             { type: DataTypes.INTEGER,      autoIncrement: true, primaryKey: true },
  opDate:         { type: DataTypes.DATE,         allowNull: true,  field: 'op_date' },
  value:          { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  type:           { type: DataTypes.SMALLINT,     allowNull: true },
  typeName:       { type: DataTypes.STRING(255),  allowNull: true,  field: 'type_name' },
  isRefund:       { type: DataTypes.BOOLEAN,      allowNull: false, defaultValue: false, field: 'is_refund' },
  incomeType:     { type: DataTypes.SMALLINT,     allowNull: true,  field: 'income_type' },
  incomeTypeName: { type: DataTypes.STRING(255),  allowNull: true,  field: 'income_type_name' },
  invoiceNumber:  { type: DataTypes.STRING(100),  allowNull: true,  field: 'invoice_number' },
  title:          { type: DataTypes.STRING(500),  allowNull: true },
  patientId:      { type: DataTypes.INTEGER,      allowNull: true,  field: 'patient_id' },
  patient:        { type: DataTypes.STRING(500),  allowNull: true },
  clinicId:       { type: DataTypes.SMALLINT,     allowNull: true,  field: 'clinic_id' },
  clinicName:     { type: DataTypes.STRING(255),  allowNull: true,  field: 'clinic_name' },
  isCompany:      { type: DataTypes.BOOLEAN,      allowNull: false, defaultValue: false, field: 'is_company' },
  authorId:       { type: DataTypes.INTEGER,      allowNull: true,  field: 'author_id' },
  authorName:     { type: DataTypes.STRING(255),  allowNull: true,  field: 'author_name' },
  device:         { type: DataTypes.STRING(100),  allowNull: true },
  isDeleted:      { type: DataTypes.BOOLEAN,      allowNull: false, defaultValue: false, field: 'is_deleted' },
  data:           { type: DataTypes.JSONB,        allowNull: false, defaultValue: {} },
  syncedAt:       { type: DataTypes.DATE,         allowNull: false, defaultValue: DataTypes.NOW, field: 'synced_at' },
}, {
  tableName:  'mis_payments',
  timestamps: false,
  indexes: [
    { fields: ['op_date'] },
    { fields: ['clinic_id'] },
    { fields: ['author_id'] },
    { fields: ['is_refund'] },
    { fields: ['type_name'] },
  ],
});

// === DIRECTORIES META MODEL (ручные поля для справочника филиалов/кабинетов/врачей) ===
const DirectoriesMeta = sequelize.define('DirectoriesMeta', {
  id:         { type: DataTypes.UUID,         defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entityType: { type: DataTypes.STRING(50),   allowNull: false, field: 'entity_type' },
  entityId:   { type: DataTypes.STRING(255),  allowNull: false, field: 'entity_id' },
  data:       { type: DataTypes.JSONB,        allowNull: false, defaultValue: {} },
}, {
  tableName: 'directories_meta',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['entity_type', 'entity_id'] },
  ],
});

// === RELEASE NOTES MODULE (Центр обновлений) ===
const ReleaseNote = sequelize.define('ReleaseNote', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false, defaultValue: '', comment: 'HTML-контент (совместим с Editor/ContentRenderer)' },
  version: { type: DataTypes.STRING(50), allowNull: true, comment: 'Версия релиза, напр. "5.57"' },
  severity: {
    type: DataTypes.ENUM('info', 'important'),
    allowNull: false,
    defaultValue: 'info',
    comment: 'important → показывать модалкой при входе'
  },
  targetRoleIds: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'ID ролей-получателей. Пустой массив = все роли'
  },
  targetMedCenterIds: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'ID медцентров-получателей. Пустой массив = все МЦ'
  },
  isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  publishedAt: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'release_notes',
  timestamps: true,
  indexes: [
    { fields: ['isPublished'] },
    { fields: ['publishedAt'] }
  ]
});

const ReleaseNoteRead = sequelize.define('ReleaseNoteRead', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  releaseNoteId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  readAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
  tableName: 'release_note_reads',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['releaseNoteId', 'userId'] },
    { fields: ['userId'] }
  ]
});

ReleaseNote.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });
ReleaseNote.hasMany(ReleaseNoteRead, { foreignKey: 'releaseNoteId', as: 'reads', onDelete: 'CASCADE' });
ReleaseNoteRead.belongsTo(ReleaseNote, { foreignKey: 'releaseNoteId', as: 'releaseNote' });
ReleaseNoteRead.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// === USER DEVICE MODEL (push-уведомления) ===
// Одна строка — один установленный экземпляр приложения. У пользователя их может
// быть несколько (телефон + планшет), поэтому уникален токен, а не userId.
//
// platform и provider намеренно разведены: сегодня iOS живёт без APNs (нет платной
// подписки Apple) и уведомления получает только через сокет, пока приложение открыто.
// Когда APNs появится — iOS-устройства начнут регистрироваться с provider='apns',
// а таблица и логика рассылки останутся прежними.
const UserDevice = sequelize.define('UserDevice', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  token: {
    type: DataTypes.STRING(512),
    allowNull: false,
    unique: true,
    comment: 'FCM registration token / APNs device token'
  },
  platform: { type: DataTypes.ENUM('android', 'ios', 'web'), allowNull: false },
  provider: {
    type: DataTypes.ENUM('fcm', 'apns', 'webpush'),
    allowNull: false,
    defaultValue: 'fcm',
    comment: 'Через какой шлюз слать. iOS до покупки APNs сюда не попадает'
  },
  appVersion: { type: DataTypes.STRING(50), allowNull: true },
  deviceName: { type: DataTypes.STRING(120), allowNull: true, comment: 'Для списка «мои устройства»' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  lastSeenAt: { type: DataTypes.DATE, allowNull: true, comment: 'Обновляется при каждой регистрации токена' },
  failureCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Подряд неудачных отправок. FCM UNREGISTERED сразу гасит устройство'
  }
}, {
  tableName: 'user_devices',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['token'] },
    { fields: ['userId'] },
    { fields: ['userId', 'isActive'] }
  ]
});

UserDevice.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });
User.hasMany(UserDevice, { foreignKey: 'userId', as: 'devices', onDelete: 'CASCADE' });

// === USER SESSION MODEL (реестр выданных токенов) ===
// Одна строка — один выданный при входе JWT. До этой таблицы токен было
// невозможно отозвать: мобильный живёт 365 дней, и потерянный телефон означал
// год доступа. Теперь в payload лежит `sid`, а middleware сверяется с этой
// строкой — снятая сессия перестаёт работать сразу, не дожидаясь exp.
const UserSession = sequelize.define('UserSession', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  platform: {
    type: DataTypes.ENUM('web', 'mobile', 'desktop'),
    allowNull: false,
    defaultValue: 'web',
    comment: 'Откуда вошли. Мобильным выдаётся токен на 365 дней, остальным — на 7'
  },
  deviceName: { type: DataTypes.STRING(200), allowNull: true, comment: 'Для списка «мои устройства»' },
  ip: { type: DataTypes.STRING(64), allowNull: true },
  userAgent: { type: DataTypes.STRING(512), allowNull: true },
  lastActivityAt: { type: DataTypes.DATE, allowNull: true, comment: 'Обновляется троттлингом, раз в 5 минут' },
  expiresAt: { type: DataTypes.DATE, allowNull: false, comment: 'Совпадает с exp токена' },
  revokedAt: { type: DataTypes.DATE, allowNull: true },
  revokedReason: {
    type: DataTypes.ENUM('logout', 'logout_all', 'admin', 'password_change'),
    allowNull: true
  }
}, {
  tableName: 'user_sessions',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['userId', 'revokedAt'] },
    { fields: ['expiresAt'] }
  ]
});

UserSession.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });
User.hasMany(UserSession, { foreignKey: 'userId', as: 'sessions', onDelete: 'CASCADE' });

// === WAREHOUSE MODULE (ver. 6.68) ===
// Модели складского учёта живут в отдельном файле: их 29, и внутри этого файла
// они бы просто утонули. Экземпляр sequelize передаём свой — второго подключения
// к базе не появляется. Ассоциации объявляются здесь, потому что им нужны уже
// определённые User, MedCenter и StructuralDivision.
const {
  models: warehouseModels,
  associateWarehouse,
} = require('./warehouse')(sequelize, DataTypes);

associateWarehouse({ User, MedCenter, StructuralDivision });

module.exports = {
  sequelize,
  Sequelize,
  ...warehouseModels,
  Role,
  User,
  Folder,
  Page,
  PageHistory,
  UserFavorite,
  SidebarItem,
  Media,
  SearchIndex,
  Setting,
  Chat,
  ChatMember,
  Message,
  MessageReaction,
  Accreditation,
  AccreditationFile,
  TelegramSubscriber,
  BotSubscriber,
  Vehicle,
  VehicleFile,
  MapMarker,
  DoctorCard,
  DoctorServiceDuration,
  Course,
  Lesson,
  TestQuestion,
  CourseProgress,
  CourseRole,
  CourseMedCenter,
  CourseUser,
  Analysis,
  AnalysisPageNote,
  Service,
  ServicePageNote,
  CalendarEvent,
  Organization,
  MedCenter,
  UserMedCenter,
  UserRole,
  // Модуль «Задачи» (ver. 6.75)
  TaskProject,
  TaskTeam,
  TaskTeamMember,
  TaskTeamInvite,
  Task,
  TaskPart,
  TaskPartDep,
  TaskPartAssignee,
  TaskHistory,
  TaskNormChange,
  TaskScheduleChange,
  PriceComparison,
  PriceComparisonItem,
  CompetitorSource,
  CompetitorService,
  CompetitorPrice,
  CompetitorLocation,
  CompetitorServiceMatch,
  // Reviews module
  ReviewPlatform,
  ReviewBoard,
  ReviewBoardPermission,
  ReviewBoardRole,
  Review,
  ReviewHistory,
  ReviewSyncConfig,
  // Email module
  EmailTemplate,
  EmailLog,
  EmailFavoriteRecipient,
  EmailFavoriteTemplate,
  // Referral bonuses module
  HourNorm,
  RoleNorm,
  CategoryNorm,
  ReferralBonus,
  ReferralReport,
  RbUserPermission,
  SalaryRecord,
  CashPayment,
  // Executor settings module
  ExecutorSettings,
  // Employee registry (mirror of MIS staff)
  RbEmployee,
  // Performed service bonuses module
  PerformedServiceBonus,
  // Service consumables module
  ServiceConsumable,
  // Telegram Bot API compatibility
  IntIdMap,
  BotToken,
  BotUpdate,
  // Публичный API для внешних интеграций
  ApiClient,
  Submission,
  ApiRequestLog,
  FormSubscription,
  SubmissionDelivery,
  // Promotions module
  Promotion,
  // Ambulance reports module
  AmbulanceReportEntry,
  CertificateRegistryEntry,
  DoctorDayReportEntry,
  // Partner services cache
  PartnerServiceCache,
  // Nomenclature 804н reference
  Nomenclature804n,
  // Schedule dictionaries
  RbScheduleCategory,
  RbScheduleCabinet,
  // Doctor schedules
  DoctorSchedule,
  // Tabel records
  TabelRecord,
  TabelRecordDoctor,
  // Structural divisions
  StructuralDivision,
  DivisionAccess,
  // Public holidays + doctor headers
  RbHoliday,
  RbDoctorHeader,
  // MIS schedule category mapping
  MisScheduleCategoryMap,
  // RB Activity Log
  RbActivityLog,
  RbResetBackup,
  // RB Excel Sources
  RbExcelSource,
  // MIS Appointments cache
  MisAppointment,
  // MIS Payments cache (списания/возвраты)
  MisPayment,
  // Directories manual data
  DirectoriesMeta,
  // Operations reports module
  OperationsReportEntry,
  // Gynecology reports module
  GynecologyReportEntry,
  // Therapy reports module
  TherapyReportEntry,
  // Surgery reports module
  SurgeryReportEntry,
  // Discount reports module (скидки 100%)
  DiscountReportEntry,
  // Release notes module (Центр обновлений)
  ReleaseNote,
  ReleaseNoteRead,
  // Push-уведомления: зарегистрированные устройства
  UserDevice,
  // Реестр сессий (отзыв токенов, «мои устройства»)
  UserSession,
};
