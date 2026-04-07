-- Добавляем поле себестоимости для внутреннего сравнения цен
ALTER TABLE price_comparison_items
  ADD COLUMN IF NOT EXISTS "costPrices" JSONB NOT NULL DEFAULT '{}';
