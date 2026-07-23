const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Запуск миграции: создание таблицы discount_report_entries...');

    const migrationPath = path.join(__dirname, '../migrations/create-discount-report-entries.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await sequelize.query(sql);

    console.log('✅ Миграция успешно выполнена!');
    console.log('Таблица discount_report_entries создана (отчёт по скидкам 100%)');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка выполнения миграции:', error);
    process.exit(1);
  }
}

runMigration();
