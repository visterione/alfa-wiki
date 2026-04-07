-- Миграция: добавить поле lab в таблицу price_comparison_items
BEGIN;

ALTER TABLE price_comparison_items
  ADD COLUMN IF NOT EXISTS "lab" VARCHAR(255) NOT NULL DEFAULT '';

COMMIT;
