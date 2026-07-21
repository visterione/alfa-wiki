-- Вкладки реестра справок = организация + год (как листы в исходном Excel).
ALTER TABLE certificate_registry_entries ADD COLUMN IF NOT EXISTS year INTEGER;

-- Бэкофилл для уже импортированных записей: год берём из «Даты формирования».
-- Кривые даты (например 08.07.0202) отсекаем диапазоном.
UPDATE certificate_registry_entries
SET year = split_part(data->>'formDate', '.', 3)::int
WHERE year IS NULL
  AND split_part(data->>'formDate', '.', 3) ~ '^[0-9]{4}$'
  AND split_part(data->>'formDate', '.', 3)::int BETWEEN 2000 AND 2100;

CREATE INDEX IF NOT EXISTS idx_cert_registry_org_year ON certificate_registry_entries (org, year);
