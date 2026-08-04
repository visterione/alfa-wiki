DO $$ BEGIN
  CREATE TYPE certificate_registry_org AS ENUM ('prestige', 'labgroup', 'alex');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS certificate_registry_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org certificate_registry_org NOT NULL,
  "seqNumber" INTEGER,
  "searchText" TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_registry_org ON certificate_registry_entries (org);
CREATE INDEX IF NOT EXISTS idx_cert_registry_created ON certificate_registry_entries ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_cert_registry_org_seq ON certificate_registry_entries (org, "seqNumber");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_cert_registry_search
  ON certificate_registry_entries USING GIN ("searchText" gin_trgm_ops);
