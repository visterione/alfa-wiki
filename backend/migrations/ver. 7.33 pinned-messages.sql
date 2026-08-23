-- Закреплённые сообщения.
--
-- Закрепление — свойство самого сообщения, а не отдельная сущность: у него нет
-- ни собственной истории, ни прав, ни порядка. Поэтому две колонки на messages,
-- а не таблица со ссылкой.
--
-- pinnedAt хранит и факт («закреплено, если не NULL»), и порядок: в шапке чата
-- показывается последнее закреплённое, а листаются они от свежих к старым.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "pinnedBy" UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN messages."pinnedAt" IS 'Когда сообщение закрепили. NULL — не закреплено';
COMMENT ON COLUMN messages."pinnedBy" IS 'Кто закрепил';

-- Частичный индекс: закреплённых в чате единицы, а сообщений могут быть сотни
-- тысяч — полный индекс по chatId здесь был бы почти целиком мусором.
CREATE INDEX IF NOT EXISTS messages_pinned_idx
  ON messages ("chatId", "pinnedAt" DESC)
  WHERE "pinnedAt" IS NOT NULL;
