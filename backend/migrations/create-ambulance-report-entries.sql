DO $$ BEGIN
  CREATE TYPE ambulance_report_entry_type AS ENUM ('calls', 'refusals', 'caddy', 'patientCalls');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ambulance_report_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entryType" ambulance_report_entry_type NOT NULL,
  "seqNumber" INTEGER,
  "entryDate" DATE,
  "entryTime" VARCHAR(5),
  "patientName" VARCHAR(255),
  "sourceCallId" UUID,
  "searchText" TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE ambulance_report_entries
  ADD COLUMN IF NOT EXISTS "searchText" TEXT;

ALTER TABLE ambulance_report_entries
  ADD COLUMN IF NOT EXISTS "sourceCallId" UUID;

UPDATE ambulance_report_entries
SET "searchText" = data::text
WHERE "searchText" IS NULL;

UPDATE ambulance_report_entries
SET "sourceCallId" = NULLIF(data->>'sourceCallId', '')::uuid
WHERE "sourceCallId" IS NULL
  AND data ? 'sourceCallId'
  AND NULLIF(data->>'sourceCallId', '') IS NOT NULL
  AND data->>'sourceCallId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

CREATE INDEX IF NOT EXISTS idx_ambulance_reports_type ON ambulance_report_entries ("entryType");
CREATE INDEX IF NOT EXISTS idx_ambulance_reports_date ON ambulance_report_entries ("entryDate");
CREATE INDEX IF NOT EXISTS idx_ambulance_reports_type_date ON ambulance_report_entries ("entryType", "entryDate" DESC, "entryTime" DESC, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_ambulance_reports_patient ON ambulance_report_entries ("patientName");
CREATE INDEX IF NOT EXISTS idx_ambulance_reports_source_call ON ambulance_report_entries ("sourceCallId");
CREATE INDEX IF NOT EXISTS idx_ambulance_reports_created ON ambulance_report_entries ("createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ambulance_reports_daily_number
  ON ambulance_report_entries ("entryType", "entryDate", "seqNumber")
  WHERE "entryType" IN ('calls', 'refusals') AND "seqNumber" IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_ambulance_reports_search
  ON ambulance_report_entries USING GIN ("searchText" gin_trgm_ops);
