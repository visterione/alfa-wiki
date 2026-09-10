-- Самостоятельный раздел «Анонсы»: отложенная отправка, шаблоны ботов и
-- почтовые рассылки под единым гранулярным правом.

ALTER TABLE omni_broadcasts
  ADD COLUMN IF NOT EXISTS "isTemplate" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE omni_broadcasts
  ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP WITH TIME ZONE;

ALTER TABLE omni_broadcasts ALTER COLUMN status TYPE VARCHAR(12);

CREATE INDEX IF NOT EXISTS omni_broadcasts_schedule_idx
  ON omni_broadcasts ("scheduledAt") WHERE status = 'scheduled';

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP WITH TIME ZONE;

ALTER TABLE email_logs ALTER COLUMN "sentAt" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS email_logs_schedule_idx
  ON email_logs ("scheduledAt") WHERE status = 'scheduled';

-- Не выдаём новое опасное право автоматически даже тем, у кого есть настройки
-- открытой линии: владелец доступа должен назначить его явно.
UPDATE users
SET "adminAccess" = COALESCE("adminAccess", '{}'::jsonb) || '{"announcements": false}'::jsonb
WHERE NOT (COALESCE("adminAccess", '{}'::jsonb) ? 'announcements');
