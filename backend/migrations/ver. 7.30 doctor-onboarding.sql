-- ver. 7.30 — онбординг врача: одна публичная анкета, согласование главврача,
-- параллельный запуск и чек-лист готовности.
--
-- Три решения, которые объясняют, почему схема выглядит так, а не иначе:
--
--   1) **Ролей не заводим.** Исполнитель каждого шага — конкретный человек,
--      строка в onb_assignments. Ролей в проекте и без того много, а здесь они
--      дали бы лишний уровень косвенности ради шести шагов. Тем же способом
--      считает права складской модуль: «по факту назначения», а не по роли.
--
--   2) **Анкета лежит в JSONB.** Повторяемых блоков шесть (образование,
--      квалификация, сертификаты, труды, конференции, ресурсы), число записей в
--      каждом не ограничено. В реляционном виде это шесть таблиц, которые всегда
--      читаются и пишутся вместе с заявкой. В колонки вынесено только то, по
--      чему ищут и проверяют уникальность.
--
--   3) **Файлы — отдельной таблицей.** Право на скан диплома проверяется по
--      имени файла в момент запроса статики, и это должен быть один
--      индексированный SELECT. Ровно так устроен chat_files из ver. 7.27, и по
--      той же причине: до него /uploads отдавался целиком всем, кто знал имя.
--
-- Миграция аддитивна и идемпотентна.

-- ── Заявки ────────────────────────────────────────────────────────────────

-- Номер заявки выдаёт последовательность, а не счётчик в приложении: форму
-- заполняет публичный контур, где двое могут отправить её в одну секунду.
CREATE SEQUENCE IF NOT EXISTS onb_application_number_seq START 1;

CREATE TABLE IF NOT EXISTS onb_applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           INTEGER NOT NULL UNIQUE DEFAULT nextval('onb_application_number_seq'),
  status           VARCHAR(20) NOT NULL DEFAULT 'draft',
  "accessToken"    VARCHAR(64) NOT NULL UNIQUE,
  email            VARCHAR(255) NOT NULL,
  "emailVerifiedAt" TIMESTAMPTZ,
  "fullName"       VARCHAR(255),
  phone            VARCHAR(50),
  "startDate"      DATE,
  "medCenterId"    UUID REFERENCES med_centers(id) ON DELETE SET NULL,
  professions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  form             JSONB NOT NULL DEFAULT '{}'::jsonb,
  consents         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "misUserId"      VARCHAR(50),
  "submittedAt"    TIMESTAMPTZ,
  "decidedBy"      UUID REFERENCES users(id) ON DELETE SET NULL,
  "decidedAt"      TIMESTAMPTZ,
  "decisionNote"   TEXT,
  "revisionFields" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "launchedAt"     TIMESTAMPTZ,
  "cancelledAt"    TIMESTAMPTZ,
  "cancelledBy"    UUID REFERENCES users(id) ON DELETE SET NULL,
  "cancelReason"   TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onb_applications_status_idx ON onb_applications (status);
CREATE INDEX IF NOT EXISTS onb_applications_email_idx ON onb_applications (lower(email));
CREATE INDEX IF NOT EXISTS onb_applications_medcenter_idx ON onb_applications ("medCenterId");
CREATE INDEX IF NOT EXISTS onb_applications_mis_user_idx ON onb_applications ("misUserId");

-- Ключ уникальности — e-mail, но только среди заявок в работе: после отклонения
-- или отмены тот же врач может подать анкету заново. Частичный уникальный
-- индекс, а не проверка в приложении: публичная ссылка одна на всех, и две
-- одновременные отправки формы обязаны разойтись на уровне базы.
CREATE UNIQUE INDEX IF NOT EXISTS onb_applications_active_email_uniq
  ON onb_applications (lower(email))
  WHERE status IN ('draft','submitted','revision','approved','mis_created','launched');

-- ── Кто отвечает за шаг ───────────────────────────────────────────────────
--
-- medCenterId NULL означает «исполнитель общий на сеть» (админ МИС, маркетологи,
-- колл-центр). У шагов главврача, регистратора и бухгалтера филиал заполнен: в
-- каждом МЦ они свои, и от филиала зависит вся маршрутизация заявки.

CREATE TABLE IF NOT EXISTS onb_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "stepKey"     VARCHAR(40) NOT NULL,
  "medCenterId" UUID REFERENCES med_centers(id) ON DELETE CASCADE,
  "userId"      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULLS NOT DISTINCT: у сетевого шага филиала нет, и второй такой же строки для
-- того же человека быть не должно.
CREATE UNIQUE INDEX IF NOT EXISTS onb_assignments_uniq
  ON onb_assignments ("stepKey", "medCenterId", "userId") NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS onb_assignments_step_idx ON onb_assignments ("stepKey");
CREATE INDEX IF NOT EXISTS onb_assignments_user_idx ON onb_assignments ("userId");

-- ── Задачи по шагам ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onb_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicationId" UUID NOT NULL REFERENCES onb_applications(id) ON DELETE CASCADE,
  "stepKey"       VARCHAR(40) NOT NULL,
  "assigneeIds"   JSONB NOT NULL DEFAULT '[]'::jsonb,
  "claimedBy"     UUID REFERENCES users(id) ON DELETE SET NULL,
  "claimedAt"     TIMESTAMPTZ,
  "completedBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
  "completedAt"   TIMESTAMPTZ,
  "verifiedByMis" BOOLEAN NOT NULL DEFAULT FALSE,
  "dueAt"         TIMESTAMPTZ,
  "remindedAt"    TIMESTAMPTZ,
  "escalatedAt"   TIMESTAMPTZ,
  note            TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Один шаг — одна задача на заявку. Повторный запуск ветки должен переоткрывать
-- существующую строку, а не плодить вторую: иначе чек-лист увидит две записи с
-- разным состоянием и не сможет решить, какая настоящая.
CREATE UNIQUE INDEX IF NOT EXISTS onb_tasks_app_step_uniq
  ON onb_tasks ("applicationId", "stepKey");
CREATE INDEX IF NOT EXISTS onb_tasks_app_idx ON onb_tasks ("applicationId");
CREATE INDEX IF NOT EXISTS onb_tasks_open_due_idx ON onb_tasks ("dueAt") WHERE "completedAt" IS NULL;

-- ── Услуги, отмеченные врачом ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onb_service_choices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicationId" UUID NOT NULL REFERENCES onb_applications(id) ON DELETE CASCADE,
  "serviceId"     VARCHAR(50),
  code            VARCHAR(100),
  title           VARCHAR(500) NOT NULL,
  price           NUMERIC(12,2),
  "misDuration"   INTEGER,
  "doctorDuration" INTEGER,
  comment         TEXT,
  "isCustom"      BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onb_service_choices_app_idx ON onb_service_choices ("applicationId");
-- Одна и та же услуга не может быть отмечена дважды. Позиции, вписанные врачом
-- текстом, под это правило не попадают: serviceId у них пуст, а названия могут
-- совпадать.
CREATE UNIQUE INDEX IF NOT EXISTS onb_service_choices_app_service_uniq
  ON onb_service_choices ("applicationId", "serviceId") WHERE "serviceId" IS NOT NULL;

-- ── Файлы анкеты ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onb_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicationId" UUID NOT NULL REFERENCES onb_applications(id) ON DELETE CASCADE,
  kind            VARCHAR(30) NOT NULL,
  filename        VARCHAR(255) NOT NULL UNIQUE,
  "originalName"  VARCHAR(255),
  "mimeType"      VARCHAR(100),
  size            INTEGER,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onb_files_app_idx ON onb_files ("applicationId");
CREATE INDEX IF NOT EXISTS onb_files_filename_idx ON onb_files (filename);

-- ── Журнал ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onb_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicationId" UUID NOT NULL REFERENCES onb_applications(id) ON DELETE CASCADE,
  -- NULL — событие породил не сотрудник: врач по своей ссылке или сама система
  -- (автопроверка МИС, напоминание по SLA).
  "userId"        UUID REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(40) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onb_events_app_idx ON onb_events ("applicationId");
CREATE INDEX IF NOT EXISTS onb_events_created_idx ON onb_events ("createdAt");

-- ── Коды подтверждения e-mail ─────────────────────────────────────────────
--
-- Анкета открывается только после подтверждения адреса. Это разом защита от
-- спама на публичной ссылке и гарантия, что ключ уникальности заявки настоящий.
-- Код лежит хэшем: таблица с живыми кодами — это готовый обход подтверждения
-- для того, кто дотянулся до базы.

CREATE TABLE IF NOT EXISTS onb_email_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL,
  "codeHash"  VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  "usedAt"    TIMESTAMPTZ,
  "requestIp" VARCHAR(64),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onb_email_codes_email_idx ON onb_email_codes (lower(email));
CREATE INDEX IF NOT EXISTS onb_email_codes_expires_idx ON onb_email_codes ("expiresAt");

-- ── Доступ к разделу ──────────────────────────────────────────────────────
--
-- Гранулярный флаг, как у «Отзывов» и склада: решает только, видит ли человек
-- раздел. Кто какой шаг выполняет — определяет onb_assignments, а не этот флаг.

UPDATE users
SET "adminAccess" = jsonb_set(COALESCE("adminAccess", '{}'::jsonb), '{onboarding}', 'false'::jsonb)
WHERE "adminAccess" IS NULL OR NOT ("adminAccess" ? 'onboarding');
