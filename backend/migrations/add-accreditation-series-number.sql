-- Добавление полей series и number в таблицу accreditations

ALTER TABLE accreditations
  ADD COLUMN IF NOT EXISTS "series" VARCHAR(50);

COMMENT ON COLUMN accreditations."series"
  IS 'Серия аккредитации (буквы/цифры, необязательно)';

ALTER TABLE accreditations
  ADD COLUMN IF NOT EXISTS "number" VARCHAR(50);

COMMENT ON COLUMN accreditations."number"
  IS 'Номер аккредитации (буквы/цифры, необязательно)';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'accreditations'
  AND column_name IN ('series', 'number')
ORDER BY column_name;
