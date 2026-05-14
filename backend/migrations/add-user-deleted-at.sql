-- Добавляет поле deletedAt в таблицу users для мягкого удаления (корзина)
ALTER TABLE users ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
