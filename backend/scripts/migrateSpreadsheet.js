/**
 * Миграция для добавления типа 'spreadsheet' в ENUM contentType
 *
 * Запуск: node scripts/migrateSpreadsheet.js
 *
 * Эта миграция добавляет новый тип страницы 'spreadsheet' к существующим 'wysiwyg' и 'html'.
 */

require('dotenv').config();
const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Running migration to add spreadsheet contentType...');

    // Читаем и выполняем SQL миграцию
    const migrationPath = path.join(__dirname, '../migrations/20260129-add-spreadsheet-contenttype-simple.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    await sequelize.query(migrationSQL);

    console.log('✅ Migration executed successfully');

    // Проверяем результат
    console.log('🔄 Verifying ENUM values...');
    const [enumValues] = await sequelize.query(`
      SELECT unnest(enum_range(NULL::"enum_pages_contentType"))::text AS value
      ORDER BY value;
    `);

    console.log('Current ENUM values:', enumValues.map(row => row.value));

    console.log('\n🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nТехническая информация:', error.message);
    if (error.sql) {
      console.error('SQL:', error.sql);
    }
    process.exit(1);
  }
}

migrate();
