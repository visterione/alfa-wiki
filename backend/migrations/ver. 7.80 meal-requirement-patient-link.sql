-- Привязка пациентов порционного требования к карточкам МИС (ver. 7.80).
--
-- Зачем: требование знает, кого фактически кормили, а МИС — что выставили в
-- счёт. Сопоставление этих двух списков находит невыставленные койко-дни: за
-- август таких дней насчиталось семь. Само по себе требование опознать
-- пациента не может — медсёстры пишут одну фамилию, а карт в базе полмиллиона.

-- Привязка живёт в словаре подсказок, а не в JSONB дня. Ключ словаря —
-- (отделение, ФИО), поэтому кнопка «Вчерашний список» переносит привязку сама
-- вместе с фамилией: искать пациента приходится один раз, в день поступления.
ALTER TABLE meal_requirement_patients
  ADD COLUMN IF NOT EXISTS "misPatientId"  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "misCardNumber" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "misBirthDate"  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "misFullName"   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "misLinkedAt"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "misLinkedBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- auto — привязала система по единственному совпадению, manual — выбрал человек.
  -- Ручной выбор система не перебивает: если медсестра указала пациента сама,
  -- значит она видела его живьём, а автоматика видит только счета.
  ADD COLUMN IF NOT EXISTS "misLinkSource" VARCHAR(10);

COMMENT ON COLUMN meal_requirement_patients."misPatientId"  IS 'ID карточки пациента в МИС';
COMMENT ON COLUMN meal_requirement_patients."misCardNumber" IS 'Номер карты — показывается в подсказке, чтобы различать однофамильцев';
COMMENT ON COLUMN meal_requirement_patients."misFullName"   IS 'ФИО из МИС целиком; в требовании остаётся то, что написала медсестра';
COMMENT ON COLUMN meal_requirement_patients."misLinkSource" IS 'auto — по единственному совпадению, manual — выбор человека';

-- Снимок «кто в какой палате лежал в этот день». Словарь — это текущая истина
-- (тёзка через полгода перезапишет привязку), а статистика прошлых месяцев
-- меняться от этого не должна, поэтому день фиксируется отдельными строками.
CREATE TABLE IF NOT EXISTS meal_requirement_stays (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department     VARCHAR(30) NOT NULL,
  "stayDate"     DATE NOT NULL,
  room           VARCHAR(30),
  name           VARCHAR(200) NOT NULL,
  "misPatientId" VARCHAR(30),
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Пересборка идёт целиком по дню (delete + insert), как в синхронизации
-- списаний: день правят весь разом, и догонять отдельные строки незачем.
CREATE INDEX IF NOT EXISTS meal_requirement_stays_day_idx
  ON meal_requirement_stays (department, "stayDate");

CREATE INDEX IF NOT EXISTS meal_requirement_stays_patient_idx
  ON meal_requirement_stays ("misPatientId", "stayDate");

COMMENT ON TABLE meal_requirement_stays IS 'Койко-дни по данным требования: кого фактически кормили в этот день';
