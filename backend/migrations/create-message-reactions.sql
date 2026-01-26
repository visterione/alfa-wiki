-- Создание таблицы реакций на сообщения
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_user_message_reaction UNIQUE ("messageId", "userId")
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions("messageId");
CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions("userId");

-- Комментарии к таблице и полям
COMMENT ON TABLE message_reactions IS 'Реакции пользователей на сообщения в чате';
COMMENT ON COLUMN message_reactions.id IS 'Уникальный идентификатор реакции';
COMMENT ON COLUMN message_reactions."messageId" IS 'ID сообщения, на которое поставлена реакция';
COMMENT ON COLUMN message_reactions."userId" IS 'ID пользователя, который поставил реакцию';
COMMENT ON COLUMN message_reactions.emoji IS 'Эмодзи реакции: 👍 👎 ❤️ 😂 😮 🎉 🔥';
COMMENT ON COLUMN message_reactions."createdAt" IS 'Дата и время создания реакции';
COMMENT ON COLUMN message_reactions."updatedAt" IS 'Дата и время последнего обновления реакции';
COMMENT ON CONSTRAINT unique_user_message_reaction ON message_reactions IS 'Один пользователь может поставить только одну реакцию на сообщение';
