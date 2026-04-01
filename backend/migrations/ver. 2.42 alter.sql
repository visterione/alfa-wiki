-- Норма часов по ролям: новая таблица
CREATE TABLE IF NOT EXISTS role_norms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "roleTitle" VARCHAR(255) NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  "normHours" DECIMAL(10,2),
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE ("roleTitle", year, month)
);
