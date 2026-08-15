BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "taskWorkSchedule" JSONB;

COMMENT ON COLUMN users."taskWorkSchedule" IS
  'Недельное рабочее расписание по дням и границы смен';

-- Старая дневная норма переносится в длительность смены. После первого
-- сохранения сотрудник может настроить каждый день отдельно.
UPDATE users
SET "taskWorkSchedule" = jsonb_build_object('days', jsonb_build_object(
  'mon', jsonb_build_object('enabled', true, 'start', '09:00', 'end', to_char(time '09:00' + LEAST("dailyNormHours", 9) * interval '1 hour', 'HH24:MI')),
  'tue', jsonb_build_object('enabled', true, 'start', '09:00', 'end', to_char(time '09:00' + LEAST("dailyNormHours", 9) * interval '1 hour', 'HH24:MI')),
  'wed', jsonb_build_object('enabled', true, 'start', '09:00', 'end', to_char(time '09:00' + LEAST("dailyNormHours", 9) * interval '1 hour', 'HH24:MI')),
  'thu', jsonb_build_object('enabled', true, 'start', '09:00', 'end', to_char(time '09:00' + LEAST("dailyNormHours", 9) * interval '1 hour', 'HH24:MI')),
  'fri', jsonb_build_object('enabled', true, 'start', '09:00', 'end', to_char(time '09:00' + LEAST("dailyNormHours", 9) * interval '1 hour', 'HH24:MI')),
  'sat', jsonb_build_object('enabled', false),
  'sun', jsonb_build_object('enabled', false)
))
WHERE "taskWorkSchedule" IS NULL AND "dailyNormHours" IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_schedule_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "oldSchedule" JSONB,
  "newSchedule" JSONB,
  "changedBy" UUID REFERENCES users(id),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_schedule_changes_user_created_idx
  ON task_schedule_changes ("userId", "createdAt");

COMMIT;
