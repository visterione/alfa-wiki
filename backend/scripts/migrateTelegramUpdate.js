/**
 * Миграция для обновления таблицы telegram_subscribers
 * Добавляет поля выбора подписок
 * 
 * Запуск: node scripts/migrateTelegramUpdate.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Добавляем новые поля
    console.log('🔄 Adding subscription fields...');
    
    await sequelize.query(`
      ALTER TABLE telegram_subscribers 
      ADD COLUMN IF NOT EXISTS "subscribeAccreditations" BOOLEAN DEFAULT true;
    `);
    
    await sequelize.query(`
      ALTER TABLE telegram_subscribers 
      ADD COLUMN IF NOT EXISTS "subscribeVehicles" BOOLEAN DEFAULT true;
    `);

    console.log('✅ Subscription fields added');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Теперь пользователи могут выбирать подписки:');
    console.log('  • subscribeAccreditations - уведомления об аккредитациях');
    console.log('  • subscribeVehicles - уведомления о техобслуживании');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();