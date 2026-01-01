/**
 * Миграция для создания таблиц accreditations и telegram_subscribers
 * 
 * Запуск: node scripts/migrateAccreditations.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Создание ENUM типа для medCenter
    console.log('🔄 Creating ENUM type...');
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE med_center_enum AS ENUM ('Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Создание таблицы accreditations
    console.log('🔄 Creating accreditations table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS accreditations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "medCenter" med_center_enum NOT NULL,
        "fullName" VARCHAR(255) NOT NULL,
        specialty VARCHAR(255) NOT NULL,
        "expirationDate" DATE NOT NULL,
        comment TEXT,
        reminded90 BOOLEAN DEFAULT false,
        reminded60 BOOLEAN DEFAULT false,
        reminded30 BOOLEAN DEFAULT false,
        reminded14 BOOLEAN DEFAULT false,
        reminded7 BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Accreditations table created');

    // Создание индексов
    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_accreditations_medcenter ON accreditations("medCenter");
      CREATE INDEX IF NOT EXISTS idx_accreditations_fullname ON accreditations("fullName");
      CREATE INDEX IF NOT EXISTS idx_accreditations_specialty ON accreditations(specialty);
      CREATE INDEX IF NOT EXISTS idx_accreditations_expdate ON accreditations("expirationDate");
    `);
    console.log('✅ Indexes created');

    // Создание таблицы telegram_subscribers
    console.log('🔄 Creating telegram_subscribers table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS telegram_subscribers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "chatId" VARCHAR(50) NOT NULL UNIQUE,
        username VARCHAR(100),
        "firstName" VARCHAR(100),
        "lastName" VARCHAR(100),
        "isActive" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Telegram subscribers table created');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Следующие шаги:');
    console.log('  1. Добавьте TELEGRAM_BOT_TOKEN в .env');
    console.log('  2. Зарегистрируйте роут в server.js:');
    console.log('     app.use("/api/accreditations", require("./routes/accreditations"));');
    console.log('  3. Инициализируйте бота в server.js:');
    console.log('     const { initBot } = require("./bot/telegramBot");');
    console.log('     initBot();');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();