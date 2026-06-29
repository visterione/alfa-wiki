-- ver. 5.55 — add tabel_type to tabel_records
-- Stores which kind of timesheet was generated: 'standard' | 'normalized' | 'detailed'
ALTER TABLE tabel_records
  ADD COLUMN IF NOT EXISTS tabel_type VARCHAR(20) NOT NULL DEFAULT 'standard';
