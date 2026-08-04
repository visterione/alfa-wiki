-- ver. 6.53 — индекс списка чатов пользователя
--
-- CONCURRENTLY не удерживает блокировку записи таблицы на всё время построения.
-- Этот файл нельзя выполнять внутри BEGIN/COMMIT.

-- Список чатов начинается с фильтра по userId и скрытым чатам. Существующий
-- UNIQUE (chatId, userId) для такого запроса не подходит из-за порядка колонок.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_members_user_visible
  ON chat_members ("userId", "isHidden", "chatId");

