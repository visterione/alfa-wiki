const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Запуск миграции: создание таблицы page_history...');

    const migrationPath = path.join(__dirname, '../migrations/create-page-history.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await sequelize.query(sql);

    console.log('✅ Миграция успешно выполнена!');
    console.log('Таблица page_history создана успешно');
    console.log('Добавлены индексы для оптимизации запросов');
    console.log('\nТеперь система будет автоматически отслеживать:');
    console.log('  - Создание страниц');
    console.log('  - Редактирование страниц');
    console.log('  - Публикацию/снятие публикации страниц');

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка выполнения миграции:', error);
    process.exit(1);
  }
}

runMigration();
