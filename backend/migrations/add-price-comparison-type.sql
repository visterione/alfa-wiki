-- Миграция: добавить поле comparisonType в таблицу price_comparisons
BEGIN;

ALTER TABLE price_comparisons
  ADD COLUMN IF NOT EXISTS "comparisonType" VARCHAR(20) NOT NULL DEFAULT 'external';

COMMIT;
