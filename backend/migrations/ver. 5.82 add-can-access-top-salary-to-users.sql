-- ver. 5.82: Add canAccessTopSalary flag to Users (АУП — top-management salary access)
-- Доступ к секретной клинике «АУП». НЕ выдаётся автоматически админам.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "canAccessTopSalary" BOOLEAN NOT NULL DEFAULT false;
