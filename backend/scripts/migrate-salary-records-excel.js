require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Adding "excelData" column to salary_records...');
    await sequelize.query(`
      ALTER TABLE salary_records
      ADD COLUMN IF NOT EXISTS "excelData" TEXT;
    `);
    console.log('✅ Column "excelData" added (or already existed)');

    // Удаляем неправильно созданную колонку excel_data, если она есть
    await sequelize.query(`
      ALTER TABLE salary_records
      DROP COLUMN IF EXISTS excel_data;
    `);
    console.log('✅ Old snake_case column excel_data removed (if existed)');

    console.log('\n🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
