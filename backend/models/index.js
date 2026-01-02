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
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
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

// === USER MODEL ===
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
  settings: { type: DataTypes.JSONB, defaultValue: {} }
}, { tableName: 'users', timestamps: true });

// === FOLDER MODEL ===
const Folder = sequelize.define('Folder', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  icon: { type: DataTypes.STRING(50), defaultValue: 'folder' },
  parentId: { type: DataTypes.UUID, allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  description: { type: DataTypes.TEXT },
  createdBy: { type: DataTypes.UUID }
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
  metadata: { type: DataTypes.JSONB, defaultValue: {} }
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
  description: { type: DataTypes.TEXT }
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

// === TELEGRAM SUBSCRIBER MODEL ===
const TelegramSubscriber = sequelize.define('TelegramSubscriber', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  chatId: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  username: { type: DataTypes.STRING(100) },
  firstName: { type: DataTypes.STRING(100) },
  lastName: { type: DataTypes.STRING(100) },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, { 
  tableName: 'telegram_subscribers', 
  timestamps: true 
});

// === VEHICLE MODEL ===
const Vehicle = sequelize.define('Vehicle', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  organization: { type: DataTypes.STRING(255), allowNull: false },
  carBrand: { type: DataTypes.STRING(255), allowNull: false },
  licensePlate: { type: DataTypes.STRING(50), allowNull: false },
  carYear: { type: DataTypes.INTEGER, allowNull: false },
  mileage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextTO: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  insuranceDate: { type: DataTypes.DATEONLY, allowNull: false },
  condition: { 
    type: DataTypes.ENUM('Хорошее', 'Удовлетворительное', 'Плохое'), 
    allowNull: false 
  },
  comment: { type: DataTypes.TEXT },
  reminded90: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded60: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded30: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded14: { type: DataTypes.BOOLEAN, defaultValue: false },
  reminded7: { type: DataTypes.BOOLEAN, defaultValue: false },
  remindedTO: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { 
  tableName: 'vehicles', 
  timestamps: true,
  indexes: [
    { fields: ['organization'] },
    { fields: ['carBrand'] },
    { fields: ['licensePlate'] },
    { fields: ['insuranceDate'] },
    { fields: ['condition'] },
    { fields: ['mileage'] },
    { fields: ['nextTO'] }
  ]
});

// === MAP MARKER MODEL === (NEW)
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

// === RELATIONSHIPS ===

// User & Role
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });

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

// MapMarker & User (NEW)
MapMarker.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

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
  TelegramSubscriber,
  Vehicle,
  MapMarker // NEW
};