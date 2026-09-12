-- Раздел «Вакансии» (ver. 8.20) — второе поколение онбординга.
--
-- Таблицы onb_* не трогаются: старый модуль остаётся рабочим и будет удалён
-- отдельным релизом, когда сюда переедут живые заявки. Переноса данных между
-- поколениями нет и не планируется — процессы у них разные.

-- ── Шаблоны: анкета плюс процесс ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_templates (
  id           UUID PRIMARY KEY,
  title        VARCHAR(150) NOT NULL,
  description  TEXT,
  form         JSONB NOT NULL DEFAULT '{"blocks": []}'::jsonb,
  process      JSONB NOT NULL DEFAULT '{"steps": []}'::jsonb,
  emails       JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isPublished" BOOLEAN NOT NULL DEFAULT FALSE,
  "isArchived"  BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy"  UUID,
  "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_templates_archived_idx  ON vac_templates ("isArchived");
CREATE INDEX IF NOT EXISTS vac_templates_published_idx ON vac_templates ("isPublished");

-- ── Вакансии: публикация шаблона в филиале ────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_vacancies (
  id            UUID PRIMARY KEY,
  "templateId"  UUID NOT NULL REFERENCES vac_templates (id) ON DELETE RESTRICT,
  "medCenterId" UUID NOT NULL REFERENCES med_centers (id) ON DELETE RESTRICT,
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  "isOpen"      BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdBy"   UUID,
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_vacancies_template_idx  ON vac_vacancies ("templateId");
CREATE INDEX IF NOT EXISTS vac_vacancies_medcenter_idx ON vac_vacancies ("medCenterId");
CREATE INDEX IF NOT EXISTS vac_vacancies_open_idx      ON vac_vacancies ("isOpen");

-- ── Заявки ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_applications (
  id              UUID PRIMARY KEY,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
  "vacancyId"     UUID NOT NULL REFERENCES vac_vacancies (id) ON DELETE RESTRICT,
  "templateId"    UUID NOT NULL REFERENCES vac_templates (id) ON DELETE RESTRICT,
  "medCenterId"   UUID NOT NULL REFERENCES med_centers (id) ON DELETE RESTRICT,
  "accessToken"   VARCHAR(64) NOT NULL UNIQUE,
  email           VARCHAR(255) NOT NULL,
  "emailVerifiedAt" TIMESTAMP WITH TIME ZONE,
  "fullName"      VARCHAR(255),
  phone           VARCHAR(50),
  "startDate"     DATE,
  professions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  form            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "formSnapshot"  JSONB NOT NULL DEFAULT '{}'::jsonb,
  consents        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "misUserId"     VARCHAR(50),
  "submittedAt"   TIMESTAMP WITH TIME ZONE,
  "decidedBy"     UUID,
  "decidedAt"     TIMESTAMP WITH TIME ZONE,
  "decisionNote"  TEXT,
  "revisionFields" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "launchedAt"    TIMESTAMP WITH TIME ZONE,
  "cancelledAt"   TIMESTAMP WITH TIME ZONE,
  "cancelledBy"   UUID,
  "cancelReason"  TEXT,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_applications_status_idx    ON vac_applications (status);
CREATE INDEX IF NOT EXISTS vac_applications_email_idx     ON vac_applications (email);
CREATE INDEX IF NOT EXISTS vac_applications_vacancy_idx   ON vac_applications ("vacancyId");
CREATE INDEX IF NOT EXISTS vac_applications_template_idx  ON vac_applications ("templateId");
CREATE INDEX IF NOT EXISTS vac_applications_medcenter_idx ON vac_applications ("medCenterId");
CREATE INDEX IF NOT EXISTS vac_applications_mis_idx       ON vac_applications ("misUserId");

-- Откликаться на несколько вакансий сети один человек вправе, дважды на одну и
-- ту же — нет. Условие в индексе, а не проверкой в коде: заявка создаётся из
-- публичного контура, и две одновременные отправки формы иначе разойдутся между
-- проверкой и вставкой.
CREATE UNIQUE INDEX IF NOT EXISTS vac_applications_active_uniq
  ON vac_applications (email, "vacancyId")
  WHERE status IN ('draft', 'submitted', 'revision', 'in_progress', 'launched');

-- ── Исполнители шагов ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_assignments (
  id            UUID PRIMARY KEY,
  "templateId"  UUID NOT NULL REFERENCES vac_templates (id) ON DELETE CASCADE,
  "stepKey"     VARCHAR(60) NOT NULL,
  "medCenterId" UUID REFERENCES med_centers (id) ON DELETE CASCADE,
  "userId"      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_assignments_template_idx ON vac_assignments ("templateId");
CREATE INDEX IF NOT EXISTS vac_assignments_user_idx     ON vac_assignments ("userId");

-- Уникальность с NULL в medCenterId (сетевой шаг) обычным UNIQUE не выражается:
-- в SQL два NULL не равны, и одного и того же человека можно было бы назначить
-- на сетевой шаг дважды. Поэтому два частичных индекса.
CREATE UNIQUE INDEX IF NOT EXISTS vac_assignments_branch_uniq
  ON vac_assignments ("templateId", "stepKey", "medCenterId", "userId")
  WHERE "medCenterId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vac_assignments_network_uniq
  ON vac_assignments ("templateId", "stepKey", "userId")
  WHERE "medCenterId" IS NULL;

-- ── Задачи по шагам ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_tasks (
  id              UUID PRIMARY KEY,
  "applicationId" UUID NOT NULL REFERENCES vac_applications (id) ON DELETE CASCADE,
  "stepKey"       VARCHAR(60) NOT NULL,
  "assigneeIds"   JSONB NOT NULL DEFAULT '[]'::jsonb,
  "claimedBy"     UUID,
  "claimedAt"     TIMESTAMP WITH TIME ZONE,
  "completedBy"   UUID,
  "completedAt"   TIMESTAMP WITH TIME ZONE,
  "verifiedByMis" BOOLEAN NOT NULL DEFAULT FALSE,
  "dueAt"         TIMESTAMP WITH TIME ZONE,
  "remindedAt"    TIMESTAMP WITH TIME ZONE,
  "escalatedAt"   TIMESTAMP WITH TIME ZONE,
  note            TEXT,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT vac_tasks_app_step_uniq UNIQUE ("applicationId", "stepKey")
);
CREATE INDEX IF NOT EXISTS vac_tasks_application_idx ON vac_tasks ("applicationId");
CREATE INDEX IF NOT EXISTS vac_tasks_step_idx        ON vac_tasks ("stepKey");
CREATE INDEX IF NOT EXISTS vac_tasks_completed_idx   ON vac_tasks ("completedAt");
CREATE INDEX IF NOT EXISTS vac_tasks_due_idx         ON vac_tasks ("dueAt");

-- ── Выбранные услуги ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_service_choices (
  id              UUID PRIMARY KEY,
  "applicationId" UUID NOT NULL REFERENCES vac_applications (id) ON DELETE CASCADE,
  "serviceId"     VARCHAR(50),
  code            VARCHAR(100),
  title           VARCHAR(500) NOT NULL,
  price           NUMERIC(12, 2),
  "misDuration"    INTEGER,
  "doctorDuration" INTEGER,
  comment         TEXT,
  "isCustom"      BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_service_choices_application_idx ON vac_service_choices ("applicationId");
CREATE INDEX IF NOT EXISTS vac_service_choices_custom_idx      ON vac_service_choices ("isCustom");

-- ── Файлы анкеты ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_files (
  id              UUID PRIMARY KEY,
  "applicationId" UUID NOT NULL REFERENCES vac_applications (id) ON DELETE CASCADE,
  "fieldKey"      VARCHAR(60) NOT NULL,
  filename        VARCHAR(255) NOT NULL UNIQUE,
  "originalName"  VARCHAR(255),
  "mimeType"      VARCHAR(100),
  size            INTEGER,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_files_application_idx ON vac_files ("applicationId");

-- ── Журнал ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_events (
  id              UUID PRIMARY KEY,
  "applicationId" UUID NOT NULL REFERENCES vac_applications (id) ON DELETE CASCADE,
  "userId"        UUID,
  action          VARCHAR(40) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_events_application_idx ON vac_events ("applicationId");
CREATE INDEX IF NOT EXISTS vac_events_created_idx     ON vac_events ("createdAt");

-- ── Коды подтверждения почты ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_email_codes (
  id          UUID PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  "vacancyId" UUID NOT NULL REFERENCES vac_vacancies (id) ON DELETE CASCADE,
  "codeHash"  VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  "usedAt"    TIMESTAMP WITH TIME ZONE,
  "requestIp" VARCHAR(64),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_email_codes_email_idx   ON vac_email_codes (email);
CREATE INDEX IF NOT EXISTS vac_email_codes_vacancy_idx ON vac_email_codes ("vacancyId");
CREATE INDEX IF NOT EXISTS vac_email_codes_expires_idx ON vac_email_codes ("expiresAt");

-- ── Рабочие чаты ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vac_chat_links (
  id            UUID PRIMARY KEY,
  "templateId"  UUID NOT NULL REFERENCES vac_templates (id) ON DELETE CASCADE,
  "medCenterId" UUID REFERENCES med_centers (id) ON DELETE CASCADE,
  url           VARCHAR(500) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  subtitle      VARCHAR(255),
  "avatarPath"  VARCHAR(255),
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "fetchedAt"   TIMESTAMP WITH TIME ZONE,
  "fetchError"  VARCHAR(255),
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vac_chat_links_template_idx  ON vac_chat_links ("templateId");
CREATE INDEX IF NOT EXISTS vac_chat_links_medcenter_idx ON vac_chat_links ("medCenterId");
CREATE INDEX IF NOT EXISTS vac_chat_links_active_idx    ON vac_chat_links ("isActive");
