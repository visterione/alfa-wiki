/**
 * Миграция для создания таблицы user_favorites
 * 
 * Запуск: node scripts/migrateFavorites.js
 * 
 * Эта миграция создаёт таблицу для персонального избранного пользователей.
 * Можно запускать многократно - проверяет существование таблицы.
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Checking if user_favorites table exists...');
    
    const [results] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'user_favorites'
      );
    `);
    
    const tableExists = results[0].exists;
    
    if (tableExists) {
      console.log('ℹ️  Table user_favorites already exists');
    } else {
      console.log('🔄 Creating user_favorites table...');
      
      await sequelize.query(`
        CREATE TABLE user_favorites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          "pageId" UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
          "sortOrder" INTEGER DEFAULT 0,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE("userId", "pageId")
        );
      `);
      
      console.log('✅ Table user_favorites created');
      
      console.log('🔄 Creating indexes...');
      await sequelize.query(`
        CREATE INDEX idx_user_favorites_user ON user_favorites("userId");
        CREATE INDEX idx_user_favorites_page ON user_favorites("pageId");
      `);
      console.log('✅ Indexes created');
    }

    console.log('\n🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();