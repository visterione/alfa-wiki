-- Свой сбор отзывов вместо GetLoyalty (ver. 8.80).
--
-- GetLoyalty — платный посредник: он входил в кабинеты площадок нашими же
-- учётными записями, собирал отзывы и отправлял ответы. Теперь то же делает
-- Альфа Парсер (отдельный сервер), а вики остаётся местом, где с отзывами
-- работают люди, и местом, где заводятся учётные записи площадок. Последнее —
-- решение заказчика: пароли периодически меняются, и маркетолог без доступа к
-- серверу парсера должен справляться сам, из интерфейса.
--
-- Соединения открывает только парсер: забирает учётки и очередь задач,
-- присылает отзывы и результаты. Вики к парсеру не обращается никогда — ему
-- не нужен открытый снаружи адрес.
--
-- GetLoyalty на время перехода продолжает работать. Чтобы отзывы не
-- задвоились, каждое место на площадке живёт в одном из режимов (см. mode) и
-- отзывы двух источников сопоставляются между собой: у карточки, найденной с
-- обеих сторон, есть и externalId от GetLoyalty, и sourceKey от парсера.
--
-- Отменить можно: таблицы новые, в reviews добавляется одна колонка.

-- ── Учётные записи площадок ─────────────────────────────────────────────
--
-- Учётка и медцентр — не одно и то же. У ПроДокторов она обычно на филиал
-- (но у Смайла и 3К — одна на два), у Яндекса, 2ГИС и НаПоправку одна на всю
-- сеть, у СберЗдоровья три. Поэтому медцентры привязываются не к учётке, а к
-- местам внутри неё — review_platform_places ниже.

CREATE TABLE IF NOT EXISTS review_platform_accounts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform             VARCHAR(20) NOT NULL,
    label                VARCHAR(200),
    login                VARCHAR(320) NOT NULL,
    -- Пароль нужен площадке в открытом виде при каждом входе, поэтому здесь
    -- обратимое шифрование тем же ключом, что у почтовых ящиков
    -- (services/mail/crypto.js).
    "passwordEnc"        TEXT NOT NULL,
    "passwordIv"         VARCHAR(64) NOT NULL,
    "passwordTag"        VARCHAR(64) NOT NULL,
    "keyVersion"         INTEGER NOT NULL DEFAULT 1,
    -- Растёт при каждой смене логина или пароля. По нему парсер понимает, что
    -- сохранённая сессия больше не про эту учётку и входить надо заново.
    "credentialsVersion" INTEGER NOT NULL DEFAULT 1,
    "isEnabled"          BOOLEAN NOT NULL DEFAULT TRUE,
    status               VARCHAR(20) NOT NULL DEFAULT 'new',
    "statusMessage"      TEXT,
    "statusAt"           TIMESTAMPTZ,
    -- Что площадка требует от человека, чтобы пустить: подтверждение на
    -- телефоне (Яндекс присылает три цифры) или капча. Пусто — ничего.
    challenge            JSONB,
    "lastCollectedAt"    TIMESTAMPTZ,
    "createdBy"          UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_platform_accounts_platform_check
      CHECK (platform IN ('prodoctorov', 'yandex', '2gis', 'napopravku', 'sberhealth', 'doctu')),
    CONSTRAINT review_platform_accounts_status_check
      CHECK (status IN ('new', 'ok', 'needs_login', 'bad_password', 'error'))
);

COMMENT ON TABLE review_platform_accounts IS
  'Учётные записи площадок отзывов для Альфа Парсера (ver. 8.80)';

CREATE UNIQUE INDEX IF NOT EXISTS review_platform_accounts_platform_login_key
  ON review_platform_accounts (platform, lower(login));

-- ── Места на площадке ───────────────────────────────────────────────────
--
-- То, что в кабинете площадки выбирается из выпадающего списка: клиника на
-- ПроДокторов, организация в Яндексе, филиал в 2ГИС, профиль НаПоправку.
-- Места не заводятся руками — их сообщает парсер после входа, а человек
-- только привязывает место к доске и выбирает режим.

CREATE TABLE IF NOT EXISTS review_platform_places (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId"    UUID NOT NULL REFERENCES review_platform_accounts(id) ON DELETE CASCADE,
    "externalId"   VARCHAR(200) NOT NULL,
    name           VARCHAR(300),
    address        VARCHAR(500),
    "boardId"      UUID REFERENCES review_boards(id) ON DELETE SET NULL,
    -- off    — место известно, но отзывы с него не берутся;
    -- shadow — сверка: отзывы только привязываются к карточкам GetLoyalty,
    --          новых карточек не создаётся, несовпавшие попадают в отчёт;
    -- live   — место работает: несовпавшие отзывы становятся карточками.
    mode           VARCHAR(10) NOT NULL DEFAULT 'off',
    -- Итоги сверки: сколько привязано, создано, не найдено, и образцы
    -- ненайденных — по ним видно, чего не хватает до переключения в live.
    stats          JSONB NOT NULL DEFAULT '{}'::jsonb,
    "lastSeenAt"   TIMESTAMPTZ,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_platform_places_mode_check CHECK (mode IN ('off', 'shadow', 'live'))
);

CREATE UNIQUE INDEX IF NOT EXISTS review_platform_places_account_external_key
  ON review_platform_places ("accountId", "externalId");
CREATE INDEX IF NOT EXISTS review_platform_places_board_idx
  ON review_platform_places ("boardId");

-- ── Очередь задач для парсера ───────────────────────────────────────────
--
-- Ответ на отзыв и проверка учётки. Парсер забирает задачи сам, раз в
-- минуту; результат приходит отдельным запросом.

CREATE TABLE IF NOT EXISTS review_collector_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          VARCHAR(20) NOT NULL,
    "accountId"   UUID NOT NULL REFERENCES review_platform_accounts(id) ON DELETE CASCADE,
    "placeId"     UUID REFERENCES review_platform_places(id) ON DELETE CASCADE,
    "reviewId"    UUID REFERENCES reviews(id) ON DELETE CASCADE,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts      INTEGER NOT NULL DEFAULT 0,
    result        JSONB,
    error         TEXT,
    "takenAt"     TIMESTAMPTZ,
    "finishedAt"  TIMESTAMPTZ,
    "createdBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_collector_jobs_kind_check CHECK (kind IN ('reply', 'check')),
    CONSTRAINT review_collector_jobs_status_check CHECK (status IN ('queued', 'taken', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS review_collector_jobs_status_idx
  ON review_collector_jobs (status, "createdAt");
CREATE INDEX IF NOT EXISTS review_collector_jobs_review_idx
  ON review_collector_jobs ("reviewId");

-- ── Отзыв: ключ от парсера ──────────────────────────────────────────────
--
-- «Площадка:родной номер», например prodoctorov:7607557. Отдельная колонка, а
-- не externalId: у карточки, найденной и GetLoyalty, и парсером, должны жить
-- оба ключа сразу, иначе при следующем проходе одного из них она снова
-- покажется новой.
--
-- Уникален среди всех строк, включая мягко удалённые: удалённый отзыв не
-- должен возвращаться при следующем сборе.

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS "sourceKey" VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_source_key_key
  ON reviews ("sourceKey") WHERE "sourceKey" IS NOT NULL;

COMMENT ON COLUMN reviews."sourceKey" IS
  'Ключ отзыва у Альфа Парсера: «площадка:номер» (ver. 8.80)';
