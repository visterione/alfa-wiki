const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Запуск миграции: создание таблицы surgery_report_entries...');

    const migrationPath = path.join(__dirname, '../migrations/create-surgery-report-entries.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await sequelize.query(sql);

    console.log('✅ Миграция успешно выполнена!');
    console.log('Таблица surgery_report_entries создана (хирургический стационар)');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка выполнения миграции:', error);
    process.exit(1);
  }
}

runMigration();
