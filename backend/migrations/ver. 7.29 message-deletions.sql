-- Удаление сообщений «у себя».
--
-- До ver. 7.29 удаление было одно на всех и оставляло в переписке заглушку
-- «Сообщение удалено». При массовом удалении такие заглушки превращают чат в
-- кладбище, поэтому от них отказались: «удалить у всех» стирает сообщение
-- физически, «удалить у себя» прячет его только от того, кто удалил, — вот эта
-- таблица.
--
-- Строк здесь будет много и все — по паре (сообщение, пользователь), поэтому
-- пара и есть первичный ключ: отдельный id только раздувал бы индекс.

CREATE TABLE IF NOT EXISTS message_deletions (
  "messageId" UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("messageId", "userId")
);

-- Выборка истории чата спрашивает «что этот человек у себя удалил», поэтому
-- нужен вход по пользователю, а не только по сообщению из первичного ключа.
CREATE INDEX IF NOT EXISTS message_deletions_user_idx ON message_deletions ("userId");
