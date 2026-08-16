-- Общая схема медцентра — базовый план для помещений без корпуса и этажа.
-- Корпуса/этажи остаются необязательным способом разбить большую площадку.
BEGIN;

ALTER TABLE med_centers
  ADD COLUMN IF NOT EXISTS "warehousePlan" JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
