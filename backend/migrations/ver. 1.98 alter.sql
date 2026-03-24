-- Норма часов: новая таблица
CREATE TABLE IF NOT EXISTS hour_norms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "professionTitle" VARCHAR(255) NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  "normHours" DECIMAL(10,2),
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE ("professionTitle", year, month)
);

-- Добавить tabHourNorms в таблицу прав доступа
ALTER TABLE rb_user_permissions
  ADD COLUMN IF NOT EXISTS "tabHourNorms" VARCHAR(10) NOT NULL DEFAULT 'edit';
