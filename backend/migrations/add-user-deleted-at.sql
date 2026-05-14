-- Добавляет поля deletedAt и deletedBy в таблицу users для мягкого удаления (корзина)
ALTER TABLE users ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "deletedBy" UUID DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL;
