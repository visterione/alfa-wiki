ALTER TABLE structural_divisions
  ADD COLUMN IF NOT EXISTS rates JSONB NOT NULL DEFAULT '[]'::jsonb;
