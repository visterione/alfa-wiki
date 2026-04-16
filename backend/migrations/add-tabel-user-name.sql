-- Add user_name column to tabel_records
ALTER TABLE tabel_records ADD COLUMN IF NOT EXISTS user_name VARCHAR(255);
