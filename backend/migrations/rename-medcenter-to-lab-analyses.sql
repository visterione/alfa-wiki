-- ===============================================
-- Миграция: Переименование medCenter → lab
-- Таблица: analyses
-- Дата: 2026-01-25
-- Описание: Замена поля medCenter на lab,
--           т.к. анализы выполняются лабораториями,
--           а не медицинскими центрами
-- ===============================================

BEGIN;

-- 1. Переименовываем колонку medCenter в lab
ALTER TABLE analyses
RENAME COLUMN "medCenter" TO lab;

-- 2. Пересоздаём индекс (если он был создан явно с именем)
-- Обычно индексы создаются автоматически, но если есть специфический индекс, пересоздаём его
DROP INDEX IF EXISTS idx_analyses_medcenter;
CREATE INDEX IF NOT EXISTS idx_analyses_lab ON analyses(lab);

-- 3. Обновляем метаданные в таблице search_index
UPDATE search_index
SET metadata = jsonb_set(
  metadata - 'medCenter',
  '{lab}',
  metadata->'medCenter'
)
WHERE "entityType" = 'analysis'
  AND metadata ? 'medCenter';

COMMIT;

-- Откат (rollback) в случае ошибки:
-- BEGIN;
-- ALTER TABLE analyses RENAME COLUMN lab TO "medCenter";
-- DROP INDEX IF EXISTS idx_analyses_lab;
-- CREATE INDEX IF NOT EXISTS idx_analyses_medcenter ON analyses("medCenter");
-- UPDATE search_index SET metadata = jsonb_set(metadata - 'lab', '{medCenter}', metadata->'lab') WHERE entity_type = 'analysis' AND metadata ? 'lab';
-- COMMIT;
