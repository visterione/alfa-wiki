-- Add MIS import support to doctor_schedules
ALTER TABLE doctor_schedules
  ADD COLUMN IF NOT EXISTS source   VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS mis_data JSONB;

-- Mapping table: MIS category_id (integer) -> internal rb_schedule_category UUID
CREATE TABLE IF NOT EXISTS mis_schedule_category_map (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  mis_category_id INTEGER NOT NULL,
  rb_category_id  UUID    REFERENCES rb_schedule_categories(id) ON DELETE SET NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(mis_category_id)
);
