-- Категории расписания
CREATE TABLE IF NOT EXISTS rb_schedule_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#94a3b8',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Кабинеты (привязаны к клинике)
CREATE TABLE IF NOT EXISTS rb_schedule_cabinets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  clinic_id VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Добавить поля в расписание врача
ALTER TABLE doctor_schedules
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES rb_schedule_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES rb_schedule_cabinets(id) ON DELETE SET NULL;
