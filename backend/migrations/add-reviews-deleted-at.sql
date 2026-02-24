-- Добавляем колонку deletedAt для поддержки мягкого удаления (paranoid: true)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
