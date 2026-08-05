ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "misUserId" VARCHAR(50);

COMMENT ON COLUMN users."misUserId"
  IS 'ID сотрудника в МИС для персональных разделов врача';

-- Автопривязка старых учётных записей только при однозначном полном совпадении ФИО.
-- Регистр, повторные пробелы и е/ё не учитываются.
WITH user_names AS (
  SELECT id,
         replace(lower(regexp_replace(trim("displayName"), '\s+', ' ', 'g')), 'ё', 'е') AS normalized_name
  FROM users
  WHERE "misUserId" IS NULL AND "displayName" IS NOT NULL
), unique_users AS (
  SELECT normalized_name, min(id::text)::uuid AS user_id
  FROM user_names
  GROUP BY normalized_name
  HAVING count(*) = 1
), card_names AS (
  SELECT id,
         nullif(metadata->>'misUserId', '') AS mis_user_id,
         replace(lower(regexp_replace(trim("fullName"), '\s+', ' ', 'g')), 'ё', 'е') AS normalized_name
  FROM doctor_cards
  WHERE nullif(metadata->>'misUserId', '') IS NOT NULL
), unique_cards AS (
  SELECT normalized_name,
         min(mis_user_id) AS mis_user_id
  FROM card_names
  GROUP BY normalized_name
  HAVING count(*) = 1
)
UPDATE users u
SET "misUserId" = c.mis_user_id
FROM unique_users un
JOIN unique_cards c USING (normalized_name)
WHERE u.id = un.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS users_mis_user_id_unique
  ON users ("misUserId")
  WHERE "misUserId" IS NOT NULL;
