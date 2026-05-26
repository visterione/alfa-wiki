-- ver. 4.28: Add source and mis_data columns to doctor_schedules
-- source: tracks whether a schedule entry was created manually or imported from MIS ('manual' | 'mis_import')
-- mis_data: stores raw MIS import payload for reference

ALTER TABLE doctor_schedules
  ADD COLUMN IF NOT EXISTS source   VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS mis_data JSONB;
