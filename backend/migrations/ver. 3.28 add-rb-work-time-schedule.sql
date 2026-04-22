-- Добавление новых колонок прав доступа для "Учёт времени" и "Архив" (sub-tabs)
ALTER TABLE rb_user_permissions
  ADD COLUMN IF NOT EXISTS "tabWorkTime"       VARCHAR(10) NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS "tabSchedule"       VARCHAR(10) NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS "tabArchiveHistory" VARCHAR(10) NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS "tabArchiveKassa"   VARCHAR(10) NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS "tabArchiveTabel"   VARCHAR(10) NOT NULL DEFAULT 'edit';
