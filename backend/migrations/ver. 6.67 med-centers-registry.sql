-- Медцентр становится одной сущностью с одним источником правды.
--
-- До этого клиника жила в четырёх независимых видах, не связанных между собой:
--   1) med_centers (UUID)          — привязка сотрудников, доступ к курсам, адресаты рассылок;
--   2) clinic_id из МИС (2, 3, 6…) — расписание, зарплата, бонусы, партнёрские услуги, платежи;
--   3) название строкой            — services.medCenter, promotions.medCenter, accreditations.medCenter;
--   4) ключ организации у ботов    — 'alfa-deti', 'alfa-3k' (backend/bot/patient/config.js).
-- Плюс девять копий списка клиник с цветами в JS и ещё десяток в backend/bot/*.html.
-- Копии успели разъехаться: у Линии четыре разных цвета, у Сукко три.
--
-- Миграция только добавляет — ни одна существующая колонка не удаляется и не
-- переписывается, кроме смены типа med_centers.name с ENUM на VARCHAR. Старый код
-- продолжает работать в точности как раньше; переезд модулей на справочник идёт
-- отдельными релизами. Скрипт идемпотентный, повторный запуск безопасен.

BEGIN;

-- ── Юрлица ───────────────────────────────────────────────────────────────────
-- Отдельно от медцентров, потому что ООО и филиал — разные вещи: одно юрлицо
-- держит несколько МЦ, а «ИП Микаелян» вообще другая организационная форма.
-- Реквизиты нужны справкам, договорам и реестру сертификатов.
-- Таблица создаётся пустой: реальных ИНН/ОГРН в проекте нигде нет, заполняется руками.
CREATE TABLE IF NOT EXISTS organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  "shortName"     VARCHAR(100),
  inn             VARCHAR(12),
  kpp             VARCHAR(9),
  ogrn            VARCHAR(15),
  "legalAddress"  VARCHAR(500),
  "directorName"  VARCHAR(255),
  "directorTitle" VARCHAR(120),
  phone           VARCHAR(50),
  email           VARCHAR(255),
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"     INTEGER NOT NULL DEFAULT 100,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  organizations                 IS 'Юрлица (ООО / ИП), которым принадлежат медцентры';
COMMENT ON COLUMN organizations."directorTitle" IS 'Должность подписанта: «Генеральный директор», «Индивидуальный предприниматель»';

-- ИНН уникален, но заполнен будет не сразу — отсюда частичный индекс.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_inn_key ON organizations (inn) WHERE inn IS NOT NULL;

-- ── Название медцентра: ENUM → VARCHAR ───────────────────────────────────────
-- ENUM означал, что переименование клиники — это ALTER TYPE ... RENAME VALUE, а
-- новая клиника — ALTER TYPE ... ADD VALUE, который нельзя выполнить в транзакции.
-- Ради справочника на восемь строк это неоправданно дорого.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'med_centers' AND column_name = 'name' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE med_centers ALTER COLUMN name TYPE VARCHAR(100) USING name::text;
  END IF;
END $$;

-- То же самое для аккредитаций: там свой, отдельный ENUM с тем же составом.
-- Пока он на месте, новая клиника из справочника не записывается в аккредитацию —
-- вставка падает на типе, хотя название уже валидно с точки зрения портала.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accreditations' AND column_name = 'medCenter' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE accreditations ALTER COLUMN "medCenter" TYPE VARCHAR(100) USING "medCenter"::text;
  END IF;
END $$;

-- Сами типы enum_med_centers_name и enum_accreditations_medCenter намеренно не
-- удаляются: они больше ни к чему не привязаны, но пока живы — откат этой
-- миграции остаётся тривиальным. Уберём, когда аккредитации переедут на FK.

-- ── Новые поля медцентра ─────────────────────────────────────────────────────
ALTER TABLE med_centers
  ADD COLUMN IF NOT EXISTS code                VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "organizationId"    UUID,
  ADD COLUMN IF NOT EXISTS "misClinicIds"      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "botOrgKey"         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "importAliases"     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "logoUrl"           VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "logoSquareUrl"     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS address             VARCHAR(500),
  ADD COLUMN IF NOT EXISTS city                VARCHAR(120),
  ADD COLUMN IF NOT EXISTS lat                 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng                 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS phones              JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS email               VARCHAR(255),
  ADD COLUMN IF NOT EXISTS site                VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "workingHours"      JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "workingHoursNote"  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "chiefDoctorUserId" UUID,
  ADD COLUMN IF NOT EXISTS "chiefDoctorName"   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "isVirtual"         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "isActive"          BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN med_centers.code IS
  'Латинский идентификатор для кода и файлов: alfa, kids, prof… В отличие от name не меняется при переименовании клиники';
COMMENT ON COLUMN med_centers."misClinicIds" IS
  'ID этой клиники в МИС. Мост между справочником и всем МИС-блоком (расписание, зарплата, бонусы). '
  'Массив, потому что у Сукко исторически два id (11 и 12) — раньше это лечилось картой CLINIC_ID_ALIASES в коде. '
  'Тип text[], а не integer[]: портал использует псевдо-id «ip» и «aup» в том же пространстве, '
  'да и большинство таблиц хранят clinicId как varchar';
COMMENT ON COLUMN med_centers."botOrgKey" IS
  'Ключ организации у пациентских ботов (Fromni), см. backend/bot/patient/config.js';
COMMENT ON COLUMN med_centers."importAliases" IS
  'Как клинику называют в импортируемых Excel: «альфа kids», «альфа линия». '
  'Раньше это была карта CLINIC_EXCEL_MAP в коде фронта. Сравнение регистронезависимое, '
  'само name и displayName добавлять не нужно — они проверяются всегда';
COMMENT ON COLUMN med_centers."workingHours" IS
  'График работы: {"mon":{"from":"08:00","to":"20:00"}, …, "sun":null}. null — выходной';
COMMENT ON COLUMN med_centers."workingHoursNote" IS
  'Приписка к графику: «приём по записи», «обед 13:00–14:00»';
COMMENT ON COLUMN med_centers."chiefDoctorUserId" IS
  'Главврач как сотрудник портала. Если у него нет учётной записи — chiefDoctorName';
COMMENT ON COLUMN med_centers."isVirtual" IS
  'Служебная группировка, а не настоящий медцентр («Направители», «АУП»). Не показывается там, где выбирают филиал';
COMMENT ON COLUMN med_centers."isActive" IS
  'Закрытый медцентр гасится флагом, а не удаляется: на него ссылаются история, зарплата и аккредитации';

-- Внешние ключи. ON DELETE SET NULL: удаление юрлица или увольнение главврача
-- не должно уносить с собой медцентр.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'med_centers_organizationId_fkey') THEN
    ALTER TABLE med_centers ADD CONSTRAINT "med_centers_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'med_centers_chiefDoctorUserId_fkey') THEN
    ALTER TABLE med_centers ADD CONSTRAINT "med_centers_chiefDoctorUserId_fkey"
      FOREIGN KEY ("chiefDoctorUserId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS med_centers_code_key ON med_centers (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS med_centers_mis_clinic_ids ON med_centers USING GIN ("misClinicIds");

-- ── Заполнение из существующих хардкод-списков ───────────────────────────────
-- Источники: DEFAULT_CLINICS и CLINIC_ID_ALIASES (clinicUtils.js), CLINIC_LOGOS
-- (ClinicLogo.js), MIS_CLINIC_TO_MEDCENTER (accreditations.js), ORGANIZATIONS
-- (bot/patient/config.js). Цвета не трогаем: те, что уже в таблице, с ver. 6.64
-- красят метки сотрудников в чате, и менять их сейчас — видимое пользователю изменение.
UPDATE med_centers AS m SET
  code            = v.code,
  "misClinicIds"  = v.mis_ids,
  "botOrgKey"     = v.bot_key,
  "logoUrl"       = v.logo,
  "importAliases" = v.aliases,
  "displayName"   = COALESCE(m."displayName", v.display)
FROM (VALUES
  ('Альфа',       'alfa',         ARRAY['2'],       'alfa',        '/lab-logos/alfa.png',        'МЦ Альфа',    ARRAY[]::text[]),
  ('Кидс',        'kids',         ARRAY['3'],       'alfa-deti',   '/lab-logos/alfa-kids.png',   'МЦ Кидс',     ARRAY['альфа kids','альфа кидс','kids']),
  ('Проф',        'prof',         ARRAY['1'],       'alfa-prof',   '/lab-logos/alfa-prof.jpg',   'МЦ Проф',     ARRAY['альфа проф']),
  ('Линия',       'liniya',       ARRAY['6'],       'alfa-liniya', '/lab-logos/alfa-liniya.png', 'МЦ Линия',    ARRAY['альфа линия']),
  ('3К',          '3k',           ARRAY['4'],       'alfa-3k',     '/lab-logos/alfa-3k.png',     'МЦ 3К',       ARRAY['3k']),
  ('Смайл',       'smile',        ARRAY['7'],       'alfa-smile',  '/lab-logos/alfa-smile.jpeg', 'МЦ Смайл',    ARRAY['альфа смайл']),
  -- 12 — тот же филиал «Алекс/Сукко», второй id из МИС.
  ('Сукко',       'sukko',        ARRAY['11','12'], NULL,          '/lab-logos/alfa-sukko.jpg',  'МЦ Сукко',    ARRAY['альфа сукко']),
  -- Своего clinic_id в МИС нет, портал подставляет псевдо-id «ip».
  -- Логотип NULL: файла ip-mikaelyan.png в lab-logos ещё нет, ClinicLogo рисует кружок.
  ('ИП Микаелян', 'ip-mikaelyan', ARRAY['ip'],      NULL,          NULL,                         'ИП Микаелян', ARRAY[]::text[])
) AS v(name, code, mis_ids, bot_key, logo, display, aliases)
WHERE m.name::text = v.name;

-- Служебные группировки зарплатного модуля. Заводим строками, чтобы поиск по
-- clinic_id всегда что-то возвращал и отчёты не рисовали серый «неизвестный»
-- кружок; от настоящих филиалов их отделяет isVirtual.
-- Вставляем через WHERE NOT EXISTS, а не ON CONFLICT: триггер ниже проверяет
-- misClinicIds в BEFORE INSERT, то есть до того, как Postgres увидит конфликт по
-- имени, и при повторном запуске ON CONFLICT не успел бы ничего погасить.
INSERT INTO med_centers (id, name, "displayName", code, "misClinicIds", color, "sortOrder", "isVirtual", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.name, v.name, v.code, v.mis_ids, v.color, v.ord, TRUE, now(), now()
FROM (VALUES
  ('Направители', 'referrers', ARRAY['8'],   '#00bfff', 90),
  ('АУП',         'aup',       ARRAY['aup'], '#111111', 91)
) AS v(name, code, mis_ids, color, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM med_centers m WHERE m.name::text = v.name OR m.code = v.code
);

-- ── Юрлица и привязка к ним филиалов ─────────────────────────────────────────
-- Названия взяты из карты _CLINIC_COMPANY в reportExport.js: по ней зарплатная
-- выгрузка группирует листы по компаниям, то есть это уже используемый факт, а не
-- догадка. Реквизиты (ИНН, ОГРН, юр. адрес, подписант) не заполняем — их в проекте
-- нигде нет, вносятся руками в админке. Полное наименование пока равно короткому.
INSERT INTO organizations (id, name, "shortName", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.name, v.name, v.ord, now(), now()
FROM (VALUES
  ('Престиж', 1),
  ('Лаб Групп', 2),
  ('Проф', 3),
  ('Алекс', 4),
  ('ИП Микаелян', 5)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o."shortName" = v.name);

UPDATE med_centers AS m
SET "organizationId" = o.id
FROM (VALUES
  ('alfa',         'Престиж'),
  ('kids',         'Престиж'),
  ('liniya',       'Престиж'),
  ('prof',         'Проф'),
  ('smile',        'Лаб Групп'),
  ('3k',           'Лаб Групп'),
  ('sukko',        'Алекс'),
  ('ip-mikaelyan', 'ИП Микаелян')
) AS v(code, org), organizations o
WHERE m.code = v.code AND o."shortName" = v.org AND m."organizationId" IS DISTINCT FROM o.id;

-- ── Инвариант: один id из МИС принадлежит ровно одному медцентру ─────────────
-- Это главное свойство misClinicIds: если id окажется у двух клиник, зарплата и
-- бонусы начнут двоиться молча. Ограничением на массивы такое не выражается,
-- поэтому проверяем триггером — на справочнике в десять строк это бесплатно.
CREATE OR REPLACE FUNCTION med_centers_check_mis_ids() RETURNS trigger AS $$
DECLARE
  dup TEXT;
BEGIN
  SELECT x INTO dup
  FROM unnest(NEW."misClinicIds") AS x
  WHERE EXISTS (
    SELECT 1 FROM med_centers o
    WHERE o.id <> NEW.id AND o."misClinicIds" @> ARRAY[x]
  )
  LIMIT 1;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'clinic_id % из МИС уже привязан к другому медцентру', dup
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Считаем через count(), а не array_length: у пустого массива длина NULL,
  -- и сравнение с нулём дало бы ложное срабатывание.
  IF (SELECT count(*) FROM unnest(NEW."misClinicIds") x)
     <> (SELECT count(DISTINCT x) FROM unnest(NEW."misClinicIds") x) THEN
    RAISE EXCEPTION 'В misClinicIds есть повторы: %', NEW."misClinicIds" USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS med_centers_mis_ids_guard ON med_centers;
CREATE TRIGGER med_centers_mis_ids_guard
  BEFORE INSERT OR UPDATE OF "misClinicIds" ON med_centers
  FOR EACH ROW EXECUTE FUNCTION med_centers_check_mis_ids();

COMMIT;
