/**
 * Миграция для добавления поля canEditDoctorCards в таблицу users
 *
 * Запуск: node scripts/migrateCanEditDoctorCards.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Добавляем поле canEditDoctorCards
    console.log('🔄 Adding canEditDoctorCards field to users table...');

    await sequelize.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "canEditDoctorCards" BOOLEAN DEFAULT false;
    `);
    console.log('✅ canEditDoctorCards column added');

    // Добавляем комментарий к полю
    console.log('🔄 Adding column comment...');
    await sequelize.query(`
      COMMENT ON COLUMN users."canEditDoctorCards" IS 'Разрешение на создание, редактирование и удаление карточек врачей';
    `);
    console.log('✅ Comment added');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Поле canEditDoctorCards добавлено в таблицу users');
    console.log('  • По умолчанию: false');
    console.log('  • Администраторы имеют доступ независимо от флага');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
