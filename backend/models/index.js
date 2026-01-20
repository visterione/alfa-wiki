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
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  lastLogin: { type: DataTypes.DATE },
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
      kanban: false      // Канбан-доска
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
  contentType: { type: DataTypes.ENUM('wysiwyg', 'html'), defaultValue: 'wysiwyg' },
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
  size: { type: DataTypes.INTEGER },
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
  isNotificationMuted: { type: DataTypes.BOOLEAN, defaultValue: false }
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
  replyToId: { type: DataTypes.UUID }
}, { tableName: 'messages', timestamps: true });

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
    type: DataTypes.INTEGER,
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
    type: DataTypes.INTEGER,
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
    { fields: ['medCenter'] },
    { fields: ['serviceCode'] },
    { fields: ['serviceName'] },
    { fields: ['isStopped'] },
    { fields: ['misServiceId'] }
  ]
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

// ═══════════════════════════════════════════════════════════════
// RELATIONSHIPS
// ═══════════════════════════════════════════════════════════════

// User & Role (старая связь - оставляем для обратной совместимости, но устарела)
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });

// User & Role (новаяMany-to-Many связь)
User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId', as: 'roles' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'roleId', as: 'usersWithRole' });

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

// AccreditationFile relationships
AccreditationFile.belongsTo(Accreditation, { foreignKey: 'accreditationId', as: 'accreditation' });
AccreditationFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
Accreditation.hasMany(AccreditationFile, { foreignKey: 'accreditationId', as: 'files', onDelete: 'CASCADE' });

// VehicleFile relationships
VehicleFile.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });
VehicleFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
Vehicle.hasMany(VehicleFile, { foreignKey: 'vehicleId', as: 'files', onDelete: 'CASCADE' });

module.exports = {
  sequelize,
  Sequelize,
  Role,
  User,
  Folder,
  Page,
  UserFavorite,
  SidebarItem,
  Media,
  SearchIndex,
  Setting,
  Chat,
  ChatMember,
  Message,
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
  Analysis,
  CalendarEvent,
  MedCenter,
  UserMedCenter,
  UserRole,
  KanbanBoard,
  BoardPermission,
  KanbanTask
};