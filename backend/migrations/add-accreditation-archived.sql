-- Добавление поля isArchived в таблицу accreditations
-- Для переноса записей в архив

ALTER TABLE accreditations
ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false;

COMMENT ON COLUMN accreditations."isArchived" IS 'Запись перенесена в архив';

-- Создаем индекс для быстрой фильтрации архивных записей
CREATE INDEX IF NOT EXISTS idx_accreditations_is_archived ON accreditations("isArchived");
