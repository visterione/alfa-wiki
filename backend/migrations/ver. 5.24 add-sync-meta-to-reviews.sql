-- ver. 5.24: Add syncMeta JSONB to reviews for GetLoyalty reply support
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS "syncMeta" JSONB NOT NULL DEFAULT '{}';
