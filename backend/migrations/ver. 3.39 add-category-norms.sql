-- Нормы часов по категориям расписания
CREATE TABLE IF NOT EXISTS category_norms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "categoryId" UUID NOT NULL REFERENCES rb_schedule_categories(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  "normHours" DECIMAL(10, 2),
  "createdBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("categoryId", year, month)
);
