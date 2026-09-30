-- Почта: страховка на рост архива и на вредные письма (ver. 9.11).
--
-- Без CONCURRENTLY намеренно: таблицы почты в пределах миллиона строк, индексы
-- строятся за секунды, а блокируется на это время только запись синхронизатора.
-- Зато весь файл идёт одной транзакцией и не остаётся применённым наполовину.

-- Сколько раз воркер брался за тело письма. Счётчик растёт ДО разбора, поэтому
-- переживает и падение процесса: письмо с zip-бомбой или PDF, на котором
-- зависает разборщик, раньше оставалось в очереди первым и роняло воркер на
-- каждом перезапуске — тела переставали качаться во всех ящиках сети.
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS "bodyAttempts" SMALLINT NOT NULL DEFAULT 0;

-- Сколько кругов подряд папки не было в ответе LIST. Удаляем из зеркала только
-- после нескольких пропусков: один сбойный ответ сервера иначе стирал папку со
-- всеми письмами, и она заново качалась целиком.
ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS "missingCount" SMALLINT NOT NULL DEFAULT 0;

-- Постраничный список по ключу (receivedAt, id) вместо OFFSET: на глубокой
-- прокрутке OFFSET перебирает все пропущенные строки заново. id в индексе
-- нужен как второй ключ — у рассылок одинаковое время прихода не редкость.
CREATE INDEX IF NOT EXISTS mail_messages_folder_keyset_idx
  ON mail_messages ("folderId", "receivedAt" DESC, id DESC) WHERE NOT "pendingDelete";
CREATE INDEX IF NOT EXISTS mail_messages_account_keyset_idx
  ON mail_messages ("accountId", "receivedAt" DESC, id DESC) WHERE NOT "pendingDelete";
DROP INDEX IF EXISTS mail_messages_folder_date_idx;
DROP INDEX IF EXISTS mail_messages_account_date_idx;

-- Аватар отправителя в списке ищется по lower(users.email) на каждую строку.
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- Журнал без фильтра по ящику сортировался перебором всей таблицы, а она растёт
-- на каждое открытие письма.
CREATE INDEX IF NOT EXISTS mail_audit_created_idx ON mail_audit ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS mail_audit_action_idx ON mail_audit (action, "createdAt" DESC);

-- Уборка журнала синхронизации идёт по времени начала.
CREATE INDEX IF NOT EXISTS mail_sync_runs_started_idx ON mail_sync_runs ("startedAt");
