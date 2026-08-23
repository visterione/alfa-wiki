-- Реестр файлов, приложенных к сообщениям чата.
--
-- Нужен ради одной операции: на каждый запрос файла ответить, состоит ли
-- проситель в чате, куда этот файл отправляли. Искать имя файла прямо в
-- messages.attachments (JSONB) значило бы последовательный скан всей таблицы
-- сообщений на каждую картинку в переписке.
--
-- Одно и то же имя может встречаться в нескольких чатах: пересылка копирует
-- массив вложений, не трогая сам файл. Поэтому уникальна пара имя+чат, а не имя.

CREATE TABLE IF NOT EXISTS chat_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    VARCHAR(255) NOT NULL,
  "chatId"    UUID REFERENCES chats(id) ON DELETE CASCADE,
  "messageId" UUID REFERENCES messages(id) ON DELETE CASCADE,
  "uploadedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULLS NOT DISTINCT: у только что загруженного файла чата ещё нет, и второй
-- такой же строки для него быть не должно.
CREATE UNIQUE INDEX IF NOT EXISTS chat_files_filename_chat_uniq
  ON chat_files (filename, "chatId") NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS chat_files_filename_idx ON chat_files (filename);
CREATE INDEX IF NOT EXISTS chat_files_chat_idx ON chat_files ("chatId");

-- Заполнение по уже отправленным сообщениям. messageId у исторических строк
-- остаётся пустым: для проверки доступа он не нужен, а восстанавливать связь
-- «файл — конкретное сообщение» задним числом смысла нет.
INSERT INTO chat_files (filename, "chatId")
SELECT DISTINCT
  regexp_replace(COALESCE(a->>'path', a->>'url'), '^.*/', ''),
  m."chatId"
FROM messages m
CROSS JOIN LATERAL jsonb_array_elements(m.attachments) AS a
WHERE jsonb_typeof(m.attachments) = 'array'
  AND COALESCE(a->>'path', a->>'url', '') <> ''
ON CONFLICT DO NOTHING;
