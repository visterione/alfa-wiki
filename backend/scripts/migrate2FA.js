/**
 * Миграция для добавления полей двухфакторной аутентификации в таблицу users
 * 
 * Запуск: node scripts/migrate2FA.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Добавляем поля для 2FA
    console.log('🔄 Adding 2FA fields to users table...');
    
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT false;
    `);
    console.log('✅ twoFactorEnabled added');
    
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS "twoFactorCode" VARCHAR(6);
    `);
    console.log('✅ twoFactorCode added');
    
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS "twoFactorCodeExpires" TIMESTAMP WITH TIME ZONE;
    `);
    console.log('✅ twoFactorCodeExpires added');
    
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS "twoFactorAttempts" INTEGER DEFAULT 0;
    `);
    console.log('✅ twoFactorAttempts added');

    // Добавляем комментарии к полям
    console.log('🔄 Adding column comments...');
    await sequelize.query(`
      COMMENT ON COLUMN users."twoFactorEnabled" IS 'Включена ли 2FA для этого пользователя';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN users."twoFactorCode" IS 'Временный код для 2FA';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN users."twoFactorCodeExpires" IS 'Время истечения кода 2FA';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN users."twoFactorAttempts" IS 'Количество неудачных попыток ввода кода';
    `);
    console.log('✅ Comments added');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Поля двухфакторной аутентификации добавлены:');
    console.log('  • twoFactorEnabled - включена ли 2FA');
    console.log('  • twoFactorCode - временный код');
    console.log('  • twoFactorCodeExpires - время истечения кода');
    console.log('  • twoFactorAttempts - количество попыток');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();