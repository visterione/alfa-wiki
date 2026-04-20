-- Migration: ver. 3.26 — Add missing indexes
-- Apply: выполни в pgAdmin / DBeaver или: psql -d <dbname> -f "ver. 3.26 add-missing-indexes.sql"

-- users: фильтры по активности и типу пользователя
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users ("isActive");
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users ("isBot");

-- messages: нет ни одного индекса, при этом это самая часто читаемая таблица
-- chatId — обязателен (каждый запрос в чат фильтрует по chatId)
-- senderId — для профиля/истории сообщений пользователя
-- createdAt — для сортировки и курсорной пагинации
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages ("chatId");
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages ("senderId");
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages ("createdAt");
-- Составной индекс для типичного запроса: все сообщения чата, отсортированные по времени
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages ("chatId", "createdAt");
