/**
 * Миграция для создания таблицы calendar_events
 * 
 * Запуск: node scripts/migrateCalendar.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Создание таблицы calendar_events
    console.log('🔄 Creating calendar_events table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
        "endTime" TIMESTAMP WITH TIME ZONE NOT NULL,
        "allDay" BOOLEAN DEFAULT false,
        
        -- Типы событий
        "eventType" VARCHAR(50) NOT NULL DEFAULT 'personal',
        
        -- Приоритет и статус
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'planned',
        
        -- Визуальное оформление
        color VARCHAR(20) DEFAULT '#4a90e2',
        
        -- Местоположение
        location VARCHAR(500),
        
        -- Повторяющиеся события
        "isRecurring" BOOLEAN DEFAULT false,
        "recurrenceRule" JSONB,
        "parentEventId" UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
        
        -- Участники
        participants JSONB DEFAULT '[]'::jsonb,
        
        -- Напоминания
        reminders JSONB DEFAULT '[]'::jsonb,
        
        -- Связи с другими сущностями
        "linkedEntityType" VARCHAR(50),
        "linkedEntityId" UUID,
        
        -- Метаданные
        "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        visibility VARCHAR(20) DEFAULT 'private',
        "sharedWith" JSONB DEFAULT '[]'::jsonb,
        
        -- Уведомления
        "lastReminderSent" TIMESTAMP WITH TIME ZONE,
        
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Calendar events table created');

    // Создание индексов
    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events("startTime");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_end_time ON calendar_events("endTime");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON calendar_events("createdBy");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_type ON calendar_events("eventType");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_recurring ON calendar_events("isRecurring");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_linked_entity ON calendar_events("linkedEntityType", "linkedEntityId");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_parent ON calendar_events("parentEventId");
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Следующие шаги:');
    console.log('  1. Добавьте модель CalendarEvent в backend/models/index.js');
    console.log('  2. Создайте файл backend/routes/calendar.js');
    console.log('  3. Зарегистрируйте роут в server.js:');
    console.log('     const calendarRoutes = require("./routes/calendar");');
    console.log('     app.use("/api/calendar", calendarRoutes);');
    console.log('  4. Создайте frontend компоненты и страницу Calendar');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();