-- Правила сортировки применяются только к новым письмам при синхронизации.
ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS "fromContains" VARCHAR(320);
ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS "subjectContains" VARCHAR(500);
ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS "requireAttachments" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS "rulesUpdatedAt" TIMESTAMP WITH TIME ZONE;
