const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    timezone: '+00:00', // Храним в UTC
    dialectOptions: {
      timezone: 'Etc/GMT'
    }
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
  isSystem: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'roles', timestamps: true });

// === USER MODEL (С 2FA) ===
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  displayName: { type: DataTypes.STRING(100) },
  email: { type: DataTypes.STRING(255) },
  avatar: { type: DataTypes.STRING(500) },
  phone: { type: DataTypes.STRING(50) },
  position: { type: DataTypes.STRING(100) },
  specialty: { type: DataTypes.STRING(200) },
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
      kanban: false,     // Канбан-доска
      journal: false,    // Журнал страниц
      reviews: false     // Отзывы
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

  // Мягкое удаление (корзина)
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    comment: 'Время перемещения пользователя в корзину (null = активен)'
  }
}, { tableName: 'users', timestamps: true });

// === FOLDER MODEL ===
const Folder = sequelize.define('Folder', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
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
    { fields: ['sortOrder'] }
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
  type: { type: DataTypes.ENUM('text', 'image', 'file', 'system'), defaultValue: 'text' },
  attachments: { type: DataTypes.JSONB, defaultValue: [] },
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
    type: DataTypes.ENUM('Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К'),
    allowNull: false
  },
  fullName: { type: DataTypes.STRING(255), allowNull: false },
  specialty: { type: DataTypes.STRING(255), allowNull: false },
  expirationDate: { type: DataTypes.DATEONLY, allowNull: false },
  comment: { type: DataTypes.TEXT },
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
    { fields: ['expirationDate'] }
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

// === MED CENTER MODEL ===
const MedCenter = sequelize.define('MedCenter', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.ENUM('Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К'),
    allowNull: false,
    unique: true,
    comment: 'Название медицинского центра'
  },
  displayName: {
    type: DataTypes.STRING(100),
    comment: 'Полное название для отображения'
  },
  description: { type: DataTypes.TEXT }
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
  ownMedCenters: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Массив своих медцентров для сравнения: ["Альфа", "Кидс"]'
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
  visibility: { 
    type: DataTypes.STRING(20), 
    defaultValue: 'private',
    comment: 'Видимость: private, shared, public'
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
    { fields: ['parentEventId'] }
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

// === KANBAN TASK MODEL ===
// KanbanBoard model - represents a Kanban board
const KanbanBoard = sequelize.define('KanbanBoard', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Название доски'
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
  }
}, {
  tableName: 'kanban_boards',
  timestamps: true,
  indexes: [
    { fields: ['ownerId'] },
    { fields: ['archived'] }
  ]
});

// BoardPermission model - represents access permissions to boards
const BoardPermission = sequelize.define('BoardPermission', {
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
    comment: 'Роль пользователя: owner, editor, viewer'
  }
}, {
  tableName: 'board_permissions',
  timestamps: true,
  indexes: [
    { fields: ['boardId'] },
    { fields: ['userId'] },
    { fields: ['role'] },
    { unique: true, fields: ['boardId', 'userId'] }
  ]
});

const KanbanTask = sequelize.define('KanbanTask', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Название задачи'
  },
  description: {
    type: DataTypes.TEXT,
    comment: 'Подробное описание задачи'
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'backlog',
    comment: 'Статус задачи: backlog, todo, in_progress, review, done'
  },
  priority: {
    type: DataTypes.STRING(20),
    defaultValue: 'medium',
    comment: 'Приоритет: low, medium, high, urgent'
  },
  assigneeIds: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Массив ID исполнителей задачи'
  },
  createdBy: {
    type: DataTypes.UUID,
    comment: 'ID пользователя-создателя задачи'
  },
  boardId: {
    type: DataTypes.UUID,
    comment: 'ID доски Kanban'
  },
  tags: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Теги задачи: ["тег1", "тег2"]'
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Прикрепленные файлы: [{id, filename, path, size, uploadedAt, uploadedBy}]'
  },
  subtasks: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Подзадачи: [{id, text, completed}]'
  },
  dueDate: {
    type: DataTypes.DATE,
    comment: 'Срок выполнения задачи'
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Порядок сортировки внутри колонки'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Дополнительные данные задачи'
  },
  archived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Задача в архиве'
  },
  archivedAt: {
    type: DataTypes.DATE,
    comment: 'Дата архивации задачи'
  },
  completedAt: {
    type: DataTypes.DATE,
    comment: 'Дата завершения задачи (переход в статус done)'
  }
}, {
  tableName: 'kanban_tasks',
  timestamps: true,
  indexes: [
    { fields: ['status'] },
    { fields: ['createdBy'] },
    { fields: ['boardId'] },
    { fields: ['priority'] },
    { fields: ['sortOrder'] },
    { fields: ['dueDate'] },
    { fields: ['archived'] },
    { fields: ['completedAt'] }
  ]
});

// KanbanBoard relationships
KanbanBoard.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
KanbanBoard.hasMany(KanbanTask, { foreignKey: 'boardId', as: 'tasks', onDelete: 'CASCADE' });
KanbanBoard.hasMany(BoardPermission, { foreignKey: 'boardId', as: 'permissions', onDelete: 'CASCADE' });

// BoardPermission relationships
BoardPermission.belongsTo(KanbanBoard, { foreignKey: 'boardId', as: 'board' });
BoardPermission.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// KanbanTask relationships
KanbanTask.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
KanbanTask.belongsTo(KanbanBoard, { foreignKey: 'boardId', as: 'board' });

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
    type: DataTypes.ENUM('Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К'),
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

// BotToken relationships
BotToken.belongsTo(User, { foreignKey: 'userId', as: 'botUser' });
User.hasMany(BotToken, { foreignKey: 'userId', as: 'botTokens' });

// BotUpdate relationships
BotUpdate.belongsTo(BotToken, { foreignKey: 'botId', as: 'bot' });
BotToken.hasMany(BotUpdate, { foreignKey: 'botId', as: 'updates', onDelete: 'CASCADE' });

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

module.exports = {
  sequelize,
  Sequelize,
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
  Vehicle,
  VehicleFile,
  MapMarker,
  DoctorCard,
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
  MedCenter,
  UserMedCenter,
  UserRole,
  KanbanBoard,
  BoardPermission,
  KanbanTask,
  PriceComparison,
  PriceComparisonItem,
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
  // Performed service bonuses module
  PerformedServiceBonus,
  // Service consumables module
  ServiceConsumable,
  // Telegram Bot API compatibility
  IntIdMap,
  BotToken,
  BotUpdate,
  // Promotions module
  Promotion,
  // Partner services cache
  PartnerServiceCache,
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
  // RB Excel Sources
  RbExcelSource,
};