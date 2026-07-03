/**
 * Миграция: Центр обновлений (release notes)
 *
 * Создаёт таблицы:
 *   release_notes       — сами нововведения (контент Tiptap, таргетинг, публикация)
 *   release_note_reads  — отметки о прочтении по каждому пользователю
 *
 * Запуск: node backend/migrations/create-release-notes.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
  const { sequelize } = require('../models');

  try {
    console.log('🚀 Миграция: создание таблиц Центра обновлений');

    const qi = sequelize.getQueryInterface();
    const tables = await qi.showAllTables();
    const has = (name) => tables.map(t => (t.tableName || t)).includes(name);

    // release_notes
    if (has('release_notes')) {
      console.log('ℹ️  Таблица release_notes уже существует');
    } else {
      await sequelize.query(`
        CREATE TABLE release_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          version VARCHAR(50),
          severity VARCHAR(20) NOT NULL DEFAULT 'info',
          "targetRoleIds" JSONB NOT NULL DEFAULT '[]',
          "targetMedCenterIds" JSONB NOT NULL DEFAULT '[]',
          "isPublished" BOOLEAN NOT NULL DEFAULT false,
          "publishedAt" TIMESTAMPTZ,
          "createdBy" UUID,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sequelize.query(`CREATE INDEX release_notes_is_published ON release_notes ("isPublished")`);
      await sequelize.query(`CREATE INDEX release_notes_published_at ON release_notes ("publishedAt")`);
      console.log('✅ Таблица release_notes создана');
    }

    // release_note_reads
    if (has('release_note_reads')) {
      console.log('ℹ️  Таблица release_note_reads уже существует');
    } else {
      await sequelize.query(`
        CREATE TABLE release_note_reads (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "releaseNoteId" UUID NOT NULL REFERENCES release_notes(id) ON DELETE CASCADE,
          "userId" UUID NOT NULL,
          "readAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sequelize.query(`CREATE UNIQUE INDEX release_note_reads_note_user ON release_note_reads ("releaseNoteId", "userId")`);
      await sequelize.query(`CREATE INDEX release_note_reads_user ON release_note_reads ("userId")`);
      console.log('✅ Таблица release_note_reads создана');
    }

    console.log('🎉 Миграция завершена');
  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
