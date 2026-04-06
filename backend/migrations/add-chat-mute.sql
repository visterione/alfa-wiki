-- Заглушка уведомлений для чата (per-user, в таблице chat_members)
ALTER TABLE chat_members
  ADD COLUMN IF NOT EXISTS "isNotificationMuted" BOOLEAN NOT NULL DEFAULT FALSE;
