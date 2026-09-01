-- Порционные требования на питание больных (ver. 7.67).
--
-- Единица хранения — день отделения целиком, а не отдельная палата: медсестра
-- правит всю таблицу разом и разом же отправляет её в буфет. Строки палат лежат
-- в JSONB, потому что самостоятельной жизни у них нет — ни поиска по ним, ни
-- ссылок на них: они существуют только внутри своего дня.
--
-- entries и "sentEntries" разделены намеренно. После отправки день продолжает
-- редактироваться, но в буфете до повторной отправки лежит прежняя картинка, и
-- архивный PDF обязан показывать именно её. entries — то, что на экране,
-- "sentEntries" — снимок последней отправки, из него и рисуются файлы.

CREATE TABLE IF NOT EXISTS meal_requirement_days (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department    VARCHAR(30) NOT NULL,
  "reportDate"  DATE NOT NULL,
  entries       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sentEntries" JSONB,
  status        VARCHAR(10) NOT NULL DEFAULT 'draft',
  "sentVersion" INTEGER NOT NULL DEFAULT 0,
  "sentAt"      TIMESTAMPTZ,
  "sentBy"      UUID REFERENCES users(id) ON DELETE SET NULL,
  "nurseName"   VARCHAR(150),
  "createdBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
  "updatedBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- День отделения ровно один: вторая строка на ту же дату означала бы два разных
-- требования в буфете на один и тот же завтрак.
CREATE UNIQUE INDEX IF NOT EXISTS meal_requirement_days_uniq
  ON meal_requirement_days (department, "reportDate");

CREATE INDEX IF NOT EXISTS meal_requirement_days_archive_idx
  ON meal_requirement_days (department, "reportDate" DESC);

COMMENT ON COLUMN meal_requirement_days.entries       IS 'Строки палат: [{ room, patients, diet, breakfast, lunch, dinner }]';
COMMENT ON COLUMN meal_requirement_days."sentEntries" IS 'Снимок последней отправки в буфет; из него рисуются картинка и PDF';
COMMENT ON COLUMN meal_requirement_days.status        IS 'draft — не отправлялось, sent — отправлено, changed — отправлено и после правилось';
COMMENT ON COLUMN meal_requirement_days."nurseName"   IS 'ФИО постовой медсестры под таблицей — фиксируется в момент отправки';

-- Словарь ФИО для подсказок при вводе. Отдельной таблицей, а не выборкой
-- DISTINCT по JSONB: за год набегут тысячи фамилий, и подсказка должна искаться
-- по индексу префикса, а не разворачиванием всех дней подряд.
CREATE TABLE IF NOT EXISTS meal_requirement_patients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department   VARCHAR(30) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS meal_requirement_patients_uniq
  ON meal_requirement_patients (department, LOWER(name));

-- text_pattern_ops — чтобы LIKE 'иван%' шёл по индексу; обычный btree по
-- умолчанию под префиксный поиск не работает.
CREATE INDEX IF NOT EXISTS meal_requirement_patients_prefix_idx
  ON meal_requirement_patients (department, LOWER(name) text_pattern_ops);
