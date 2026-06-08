CREATE TABLE IF NOT EXISTS operations_report_entries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "entryDate" DATE,
  "searchText" TEXT,
  data        JSONB       NOT NULL DEFAULT '{}',
  "createdBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operations_report_entries_entry_date_idx  ON operations_report_entries ("entryDate");
CREATE INDEX IF NOT EXISTS operations_report_entries_created_at_idx  ON operations_report_entries ("createdAt");
