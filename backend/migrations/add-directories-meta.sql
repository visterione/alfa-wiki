CREATE TABLE IF NOT EXISTS directories_meta (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50)  NOT NULL,
  entity_id   VARCHAR(255) NOT NULL,
  data        JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_directories_meta_type ON directories_meta (entity_type);
