-- Отчёт по врачам за месяц: строка = врач, в days лежат суммы и комментарии по дням.
-- Вкладка страницы = год + месяц (лист исходного Excel).
-- Порядок строк не хранится: список всегда показывается по алфавиту ФИО.
CREATE TABLE IF NOT EXISTS doctor_day_report_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  "doctorName" TEXT NOT NULL,
  -- { "1": { "sum": "1200", "info": "оплачено" }, "2": { ... } } — ключ = число месяца
  days JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_day_report_period
  ON doctor_day_report_entries (year, month, lower(btrim("doctorName")));
CREATE INDEX IF NOT EXISTS idx_doctor_day_report_doctor
  ON doctor_day_report_entries ("doctorName");

-- Один врач встречается на листе месяца один раз — защищает импорт от дублей
CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_day_report_unique
  ON doctor_day_report_entries (year, month, lower(btrim("doctorName")));
