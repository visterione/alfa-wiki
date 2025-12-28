const bcrypt = require('bcryptjs');
require('dotenv').config();

const { sequelize, Role, User, Setting, Page, SidebarItem } = require('../models');

async function initializeDatabase() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Syncing models...');
    await sequelize.sync({ force: true }); // WARNING: This drops all tables!
    console.log('✅ Models synchronized');

    // Create default roles
    console.log('🔄 Creating default roles...');
    
    const adminRole = await Role.create({
      name: 'Администратор',
      description: 'Полный доступ ко всем функциям системы',
      isSystem: true,
      permissions: {
        pages: { read: true, write: true, delete: true, admin: true },
        media: { read: true, upload: true, delete: true },
        users: { read: true, write: true, delete: true },
        settings: { read: true, write: true }
      }
    });

    const editorRole = await Role.create({
      name: 'Редактор',
      description: 'Создание и редактирование страниц',
      permissions: {
        pages: { read: true, write: true, delete: false, admin: false },
        media: { read: true, upload: true, delete: false },
        users: { read: false, write: false, delete: false },
        settings: { read: false, write: false }
      }
    });

    const readerRole = await Role.create({
      name: 'Читатель',
      description: 'Только просмотр страниц',
      permissions: {
        pages: { read: true, write: false, delete: false, admin: false },
        media: { read: true, upload: false, delete: false },
        users: { read: false, write: false, delete: false },
        settings: { read: false, write: false }
      }
    });

    console.log('✅ Roles created');

    // Create admin user
    console.log('🔄 Creating admin user...');
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    await User.create({
      username: 'admin',
      password: hashedPassword,
      displayName: 'Администратор',
      email: 'admin@example.com',
      isAdmin: true,
      isActive: true,
      roleId: adminRole.id
    });
    console.log('✅ Admin user created (login: admin, password: admin123)');

    // Create default settings
    console.log('🔄 Creating default settings...');
    const defaultSettings = [
      { key: 'siteName', value: 'Alfa Wiki', description: 'Название сайта' },
      { key: 'siteDescription', value: 'База знаний медицинского центра', description: 'Описание сайта' },
      { key: 'primaryColor', value: '#007AFF', description: 'Основной цвет' },
      { key: 'accentColor', value: '#5856D6', description: 'Акцентный цвет' },
      { key: 'logo', value: null, description: 'URL логотипа' },
      { key: 'defaultRole', value: readerRole.id, description: 'Роль по умолчанию' },
      { key: 'allowRegistration', value: false, description: 'Разрешить регистрацию' }
    ];

    for (const setting of defaultSettings) {
      await Setting.create(setting);
    }
    console.log('✅ Default settings created');

    // Create welcome page
    console.log('🔄 Creating welcome page...');
    const welcomePage = await Page.create({
      slug: 'welcome',
      title: 'Добро пожаловать в Alfa Wiki',
      content: `
        <h1>Добро пожаловать в Alfa Wiki</h1>
        <p>Это база знаний вашего медицинского центра.</p>
        <h2>Начало работы</h2>
        <p>Используйте меню слева для навигации по разделам.</p>
        <p>Для создания новых страниц перейдите в административную панель.</p>
      `,
      contentType: 'wysiwyg',
      description: 'Главная страница базы знаний',
      keywords: ['главная', 'welcome', 'начало'],
      isPublished: true,
      createdBy: (await User.findOne({ where: { username: 'admin' } })).id
    });
    console.log('✅ Welcome page created');

    // Create sidebar item for welcome page
    console.log('🔄 Creating sidebar...');
    await SidebarItem.create({
      type: 'page',
      title: 'Главная',
      icon: 'home',
      pageId: welcomePage.id,
      sortOrder: 0,
      isVisible: true
    });

    await SidebarItem.create({
      type: 'divider',
      title: 'Разделы',
      sortOrder: 1,
      isVisible: true
    });
    console.log('✅ Sidebar created');

    console.log('\n🎉 Database initialized successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('  Admin credentials:');
    console.log('  Login: admin');
    console.log('  Password: admin123');
    console.log('═══════════════════════════════════════\n');
    console.log('⚠️  Please change the admin password after first login!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

initializeDatabase();