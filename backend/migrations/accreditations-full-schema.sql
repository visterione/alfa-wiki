-- =====================================================================
--  Модуль «Аккредитации» — полная схема БД (одним файлом, идемпотентно)
-- ---------------------------------------------------------------------
--  Запуск:
--     psql -d <ИМЯ_БД_из_.env_DB_NAME> -f migrations/accreditations-full-schema.sql
--
--  ВАЖНО:
--   • НЕ оборачивать в BEGIN/COMMIT — ALTER TYPE ... ADD VALUE должен
--     выполняться вне транзакции (PostgreSQL 12+).
--   • Все шаги безопасны для повторного запуска (IF NOT EXISTS / ADD VALUE
--     IF NOT EXISTS / ON CONFLICT DO NOTHING).
--   • Объединяет: migrateAccreditations.js, migrateAccreditationFiles.js,
--     addIsArchivedColumn.js, addAccreditationMedCenters.js,
--     addAccreditationMisColumns.js, add-sukko-and-mikaelyan-medcenters.sql.
--   • НЕ входит: linkAccreditationsToMis.js — это разовый бэкфилл через API МИС,
--     запускать отдельно: node scripts/linkAccreditationsToMis.js
-- =====================================================================

-- 1. ENUM медцентров (имя — как генерирует Sequelize). Сразу все 8 значений.
DO $$ BEGIN
  CREATE TYPE "enum_accreditations_medCenter" AS ENUM
    ('Альфа','Кидс','Проф','Линия','Смайл','3К','Сукко','ИП Микаелян');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Если тип уже существовал с 6 значениями — добавляем недостающие.
ALTER TYPE "enum_accreditations_medCenter" ADD VALUE IF NOT EXISTS 'Сукко';
ALTER TYPE "enum_accreditations_medCenter" ADD VALUE IF NOT EXISTS 'ИП Микаелян';

-- 2. Основная таблица accreditations
CREATE TABLE IF NOT EXISTS accreditations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "medCenter" "enum_accreditations_medCenter" NOT NULL,
  "fullName" VARCHAR(255) NOT NULL,
  specialty VARCHAR(255) NOT NULL,
  "expirationDate" DATE NOT NULL,
  comment TEXT,
  reminded90 BOOLEAN DEFAULT false,
  reminded60 BOOLEAN DEFAULT false,
  reminded30 BOOLEAN DEFAULT false,
  reminded14 BOOLEAN DEFAULT false,
  reminded7 BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2a. Дополнительные колонки (медцентры-массив, привязка к МИС, архив, версия)
ALTER TABLE accreditations ADD COLUMN IF NOT EXISTS "medCenters"     JSONB;
ALTER TABLE accreditations ADD COLUMN IF NOT EXISTS "misUserId"      INTEGER;
ALTER TABLE accreditations ADD COLUMN IF NOT EXISTS "supersededById" UUID;
ALTER TABLE accreditations ADD COLUMN IF NOT EXISTS "isArchived"     BOOLEAN DEFAULT false;

COMMENT ON COLUMN accreditations."medCenters"     IS 'Медцентры, на которые распространяется аккредитация (массив)';
COMMENT ON COLUMN accreditations."misUserId"      IS 'ID сотрудника в МИС (источник ФИО/специальности/клиник)';
COMMENT ON COLUMN accreditations."supersededById" IS 'ID новой версии аккредитации, заменившей эту (для архива/истории)';
COMMENT ON COLUMN accreditations."isArchived"     IS 'Запись перенесена в архив';

-- 2b. Бэкфилл medCenters для старых записей: [medCenter]
UPDATE accreditations
SET "medCenters" = jsonb_build_array("medCenter")
WHERE "medCenters" IS NULL AND "medCenter" IS NOT NULL;

-- 2c. Индексы
CREATE INDEX IF NOT EXISTS idx_accreditations_medcenter   ON accreditations("medCenter");
CREATE INDEX IF NOT EXISTS idx_accreditations_fullname    ON accreditations("fullName");
CREATE INDEX IF NOT EXISTS idx_accreditations_specialty   ON accreditations(specialty);
CREATE INDEX IF NOT EXISTS idx_accreditations_expdate     ON accreditations("expirationDate");
CREATE INDEX IF NOT EXISTS idx_accreditations_is_archived ON accreditations("isArchived");
CREATE INDEX IF NOT EXISTS idx_accreditations_mis_user_id ON accreditations("misUserId");

-- 3. Файлы аккредитаций
CREATE TABLE IF NOT EXISTS accreditation_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accreditationId" UUID NOT NULL REFERENCES accreditations(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100),
  size INTEGER,
  path VARCHAR(1000) NOT NULL,
  "uploadedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE accreditation_files IS 'Файлы, прикрепленные к аккредитациям';
CREATE INDEX IF NOT EXISTS idx_accreditation_files_accreditation_id ON accreditation_files("accreditationId");
CREATE INDEX IF NOT EXISTS idx_accreditation_files_uploaded_by      ON accreditation_files("uploadedBy");

-- 4. Подписчики Telegram-бота (уведомления о сроках)
CREATE TABLE IF NOT EXISTS telegram_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(100),
  "firstName" VARCHAR(100),
  "lastName" VARCHAR(100),
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS "subscribedToAccreditations" BOOLEAN DEFAULT true;
ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS "subscribedToVehicles"       BOOLEAN DEFAULT true;

-- 5. settings — хранит общий список скрытых сотрудников
--    (ключ accreditation_hidden_staff создаётся автоматически при первом скрытии).
--    На основной БД таблица обычно уже есть; создаём на всякий случай.
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB,
  description TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 6. (ОПЦИОНАЛЬНО) Справочник медцентров med_centers — добавить Сукко/Микаелян.
--    Не требуется для работы аккредитаций (цвета в UI зашиты в шаблоне),
--    но было в исходной миграции. Требует уже существующих med_centers
--    и типа "enum_med_centers_name" (есть на основной БД). Если их нет —
--    этот блок можно просто не запускать.
-- =====================================================================
ALTER TYPE "enum_med_centers_name" ADD VALUE IF NOT EXISTS 'Сукко';
ALTER TYPE "enum_med_centers_name" ADD VALUE IF NOT EXISTS 'ИП Микаелян';

INSERT INTO med_centers (id, name, "displayName", description, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Сукко',       'МЦ Сукко',    'Медицинский центр Сукко', NOW(), NOW()),
  (gen_random_uuid(), 'ИП Микаелян', 'ИП Микаелян', 'ИП Микаелян',             NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
