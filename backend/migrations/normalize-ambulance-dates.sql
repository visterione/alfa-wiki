-- normalize-ambulance-dates.sql
-- Приводит дата-поля в data JSONB таблицы ambulance_report_entries к формату ДД.ММ.ГГГГ.
-- Поля: callDate (calls, patientCalls), refusalDate (refusals),
--       caddyDate (caddy), patientCallDate (patientCalls).
--
-- Распознаёт форматы:
--   YYYY-MM-DD  →  ДД.ММ.ГГГГ
--   Д.М.ГГГГ   →  ДД.ММ.ГГГГ  (убирает отсутствие нулей)
--   ДД/ММ/ГГГГ →  ДД.ММ.ГГГГ
--   ДД-ММ-ГГГГ →  ДД.ММ.ГГГГ  (только «чистый» дефис, без смешанных разделителей)
-- Оставляет без изменений:
--   — уже корректный ДД.ММ.ГГГГ
--   — «01-02.06.2026» и прочие неоднозначные / непарсируемые значения
--   — пустые строки и NULL
--
-- КАК ЗАПУСКАТЬ:
--   1. Сначала закомментируйте COMMIT и раскомментируйте ROLLBACK → посмотрите, что изменится.
--   2. Убедитесь в preview-блоке, что конвертации выглядят корректно.
--   3. Поменяйте обратно на COMMIT и прогоните скрипт.

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- Вспомогательная функция (удаляется в конце скрипта)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _amb_normalize_date(val text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed date;
BEGIN
  IF val IS NULL OR trim(val) = '' THEN
    RETURN val;
  END IF;

  -- Уже Д.М.ГГГГ или ДД.ММ.ГГГГ — переформатируем, чтобы добавить ведущие нули
  IF trim(val) ~ '^\d{1,2}\.\d{1,2}\.\d{4}$' THEN
    parsed := to_date(trim(val), 'DD.MM.YYYY');
    RETURN to_char(parsed, 'DD.MM.YYYY');
  END IF;

  -- ISO: YYYY-MM-DD
  IF trim(val) ~ '^\d{4}-\d{2}-\d{2}$' THEN
    parsed := to_date(trim(val), 'YYYY-MM-DD');
    RETURN to_char(parsed, 'DD.MM.YYYY');
  END IF;

  -- ДД/ММ/ГГГГ или Д/М/ГГГГ
  IF trim(val) ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    parsed := to_date(trim(val), 'DD/MM/YYYY');
    RETURN to_char(parsed, 'DD.MM.YYYY');
  END IF;

  -- ДД-ММ-ГГГГ (чистые дефисы, не «01-02.06.2026»)
  IF trim(val) ~ '^\d{1,2}-\d{1,2}-\d{4}$' THEN
    parsed := to_date(trim(val), 'DD-MM-YYYY');
    RETURN to_char(parsed, 'DD.MM.YYYY');
  END IF;

  -- Всё остальное (смешанные разделители, текст, прочий мусор) — не трогаем
  RETURN val;
EXCEPTION WHEN OTHERS THEN
  -- Невалидная дата (32 число и т.п.) — тоже не трогаем
  RETURN val;
END;
$$;

-- ──────────────────────────────────────────────────────────────────
-- PREVIEW — раскомментируйте, чтобы посмотреть что изменится
-- ──────────────────────────────────────────────────────────────────
/*

SELECT id, "entryType",
       data->>'callDate'                        AS before,
       _amb_normalize_date(data->>'callDate')   AS after
FROM ambulance_report_entries
WHERE "entryType" = 'calls'
  AND data->>'callDate' IS NOT NULL AND data->>'callDate' <> ''
  AND _amb_normalize_date(data->>'callDate') <> data->>'callDate';

SELECT id, "entryType",
       data->>'refusalDate'                        AS before,
       _amb_normalize_date(data->>'refusalDate')   AS after
FROM ambulance_report_entries
WHERE "entryType" = 'refusals'
  AND data->>'refusalDate' IS NOT NULL AND data->>'refusalDate' <> ''
  AND _amb_normalize_date(data->>'refusalDate') <> data->>'refusalDate';

SELECT id, "entryType",
       data->>'caddyDate'                        AS before,
       _amb_normalize_date(data->>'caddyDate')   AS after
FROM ambulance_report_entries
WHERE "entryType" = 'caddy'
  AND data->>'caddyDate' IS NOT NULL AND data->>'caddyDate' <> ''
  AND _amb_normalize_date(data->>'caddyDate') <> data->>'caddyDate';

SELECT id, "entryType",
       data->>'patientCallDate'                        AS pc_before,
       _amb_normalize_date(data->>'patientCallDate')   AS pc_after,
       data->>'callDate'                               AS cd_before,
       _amb_normalize_date(data->>'callDate')          AS cd_after
FROM ambulance_report_entries
WHERE "entryType" = 'patientCalls'
  AND (
    ( data->>'patientCallDate' IS NOT NULL AND data->>'patientCallDate' <> ''
      AND _amb_normalize_date(data->>'patientCallDate') <> data->>'patientCallDate' )
    OR
    ( data->>'callDate' IS NOT NULL AND data->>'callDate' <> ''
      AND _amb_normalize_date(data->>'callDate') <> data->>'callDate' )
  );

-- Что НЕ удалось распарсить (останется как есть):
SELECT "entryType",
       data->>'callDate' AS value
FROM ambulance_report_entries
WHERE "entryType" IN ('calls', 'patientCalls')
  AND data->>'callDate' IS NOT NULL AND data->>'callDate' <> ''
  AND _amb_normalize_date(data->>'callDate') = data->>'callDate'
  AND data->>'callDate' !~ '^\d{1,2}\.\d{1,2}\.\d{4}$'   -- уже не в целевом формате
LIMIT 50;

*/

-- ──────────────────────────────────────────────────────────────────
-- ОБНОВЛЕНИЯ
-- ──────────────────────────────────────────────────────────────────

-- calls: callDate
WITH upd AS (
  SELECT id,
    jsonb_set(data, '{callDate}',
      to_jsonb(_amb_normalize_date(data->>'callDate'))
    ) AS new_data
  FROM ambulance_report_entries
  WHERE "entryType" = 'calls'
    AND data->>'callDate' IS NOT NULL
    AND data->>'callDate' <> ''
    AND _amb_normalize_date(data->>'callDate') <> data->>'callDate'
)
UPDATE ambulance_report_entries e
SET
  data        = upd.new_data,
  "searchText" = (
    SELECT coalesce(string_agg(jt.value, ' '), '')
    FROM jsonb_each_text(upd.new_data) jt
    WHERE jt.key NOT LIKE '\_%' AND jt.value IS NOT NULL AND jt.value <> ''
  ),
  "updatedAt" = NOW()
FROM upd
WHERE e.id = upd.id;

-- refusals: refusalDate
WITH upd AS (
  SELECT id,
    jsonb_set(data, '{refusalDate}',
      to_jsonb(_amb_normalize_date(data->>'refusalDate'))
    ) AS new_data
  FROM ambulance_report_entries
  WHERE "entryType" = 'refusals'
    AND data->>'refusalDate' IS NOT NULL
    AND data->>'refusalDate' <> ''
    AND _amb_normalize_date(data->>'refusalDate') <> data->>'refusalDate'
)
UPDATE ambulance_report_entries e
SET
  data        = upd.new_data,
  "searchText" = (
    SELECT coalesce(string_agg(jt.value, ' '), '')
    FROM jsonb_each_text(upd.new_data) jt
    WHERE jt.key NOT LIKE '\_%' AND jt.value IS NOT NULL AND jt.value <> ''
  ),
  "updatedAt" = NOW()
FROM upd
WHERE e.id = upd.id;

-- caddy: caddyDate
WITH upd AS (
  SELECT id,
    jsonb_set(data, '{caddyDate}',
      to_jsonb(_amb_normalize_date(data->>'caddyDate'))
    ) AS new_data
  FROM ambulance_report_entries
  WHERE "entryType" = 'caddy'
    AND data->>'caddyDate' IS NOT NULL
    AND data->>'caddyDate' <> ''
    AND _amb_normalize_date(data->>'caddyDate') <> data->>'caddyDate'
)
UPDATE ambulance_report_entries e
SET
  data        = upd.new_data,
  "searchText" = (
    SELECT coalesce(string_agg(jt.value, ' '), '')
    FROM jsonb_each_text(upd.new_data) jt
    WHERE jt.key NOT LIKE '\_%' AND jt.value IS NOT NULL AND jt.value <> ''
  ),
  "updatedAt" = NOW()
FROM upd
WHERE e.id = upd.id;

-- patientCalls: patientCallDate + callDate (оба поля за один проход)
WITH upd AS (
  SELECT id,
    jsonb_set(
      jsonb_set(data,
        '{patientCallDate}',
        to_jsonb(_amb_normalize_date(data->>'patientCallDate'))
      ),
      '{callDate}',
      to_jsonb(_amb_normalize_date(data->>'callDate'))
    ) AS new_data
  FROM ambulance_report_entries
  WHERE "entryType" = 'patientCalls'
    AND (
      ( data->>'patientCallDate' IS NOT NULL AND data->>'patientCallDate' <> ''
        AND _amb_normalize_date(data->>'patientCallDate') <> data->>'patientCallDate' )
      OR
      ( data->>'callDate' IS NOT NULL AND data->>'callDate' <> ''
        AND _amb_normalize_date(data->>'callDate') <> data->>'callDate' )
    )
)
UPDATE ambulance_report_entries e
SET
  data        = upd.new_data,
  "searchText" = (
    SELECT coalesce(string_agg(jt.value, ' '), '')
    FROM jsonb_each_text(upd.new_data) jt
    WHERE jt.key NOT LIKE '\_%' AND jt.value IS NOT NULL AND jt.value <> ''
  ),
  "updatedAt" = NOW()
FROM upd
WHERE e.id = upd.id;

-- ──────────────────────────────────────────────────────────────────
-- Удаляем временную функцию
-- ──────────────────────────────────────────────────────────────────
DROP FUNCTION _amb_normalize_date(text);

-- Итоговый отчёт
SELECT "entryType", COUNT(*) AS total
FROM ambulance_report_entries
GROUP BY "entryType"
ORDER BY "entryType";

COMMIT;
-- Для dry-run: замените COMMIT на ROLLBACK выше
