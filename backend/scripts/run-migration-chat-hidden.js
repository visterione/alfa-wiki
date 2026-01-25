const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Запуск миграции: добавление поля isHidden в chat_members...');

    const migrationPath = path.join(__dirname, '../migrations/add-chat-hidden.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await sequelize.query(sql);

    console.log('✅ Миграция успешно выполнена!');
    console.log('Поле isHidden добавлено в таблицу chat_members');

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка выполнения миграции:', error);
    process.exit(1);
  }
}

runMigration();
