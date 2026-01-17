-- Добавление поля isArchived в таблицу vehicles
-- Для переноса записей в архив

ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false;

COMMENT ON COLUMN vehicles."isArchived" IS 'Запись перенесена в архив';

-- Создаем индекс для быстрой фильтрации архивных записей
CREATE INDEX IF NOT EXISTS idx_vehicles_is_archived ON vehicles("isArchived");
