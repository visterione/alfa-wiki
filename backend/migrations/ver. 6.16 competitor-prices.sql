-- ver. 6.16 — Зеркало прайсов клиник-конкурентов из alfa-parser
--
-- Парсер обходит сайты конкурентов и хранит прайсы у себя. Вики ночью
-- забирает текущие цены и держит собственную копию: без полного каталога
-- конкурента невозможно автосопоставление услуг (в price_comparison_items
-- лежат только уже отобранные позиции, сопоставлять там не с чем).
--
-- competitor_sources  — клиника конкурента в одном городе (зеркало sources парсера)
-- competitor_services — каталог услуг источника
-- competitor_prices   — текущие цены; у клиники цена зависит от филиала

-- === Источники ================================================================
CREATE TABLE IF NOT EXISTS competitor_sources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "parserSourceId" INTEGER      NOT NULL,                       -- id источника в парсере
  name             VARCHAR(255) NOT NULL,                       -- 'clinic23-krd'
  "baseUrl"        TEXT         NOT NULL,
  city             VARCHAR(150),                                -- города разведены: свой прайс у каждого
  "servicesTotal"  INTEGER      NOT NULL DEFAULT 0,
  "lastRunAt"      TIMESTAMPTZ,                                 -- когда парсер обходил сайт
  "lastRunStatus"  VARCHAR(16),                                 -- ok | partial | failed | running
  "syncedAt"       TIMESTAMPTZ,                                 -- когда мы забирали данные
  "syncStatus"     VARCHAR(16)  NOT NULL DEFAULT 'pending',     -- pending | ok | failed
  "syncError"      TEXT,
  "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_sources_parser_uq ON competitor_sources ("parserSourceId");

-- === Услуги ===================================================================
CREATE TABLE IF NOT EXISTS competitor_services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sourceId"        UUID         NOT NULL REFERENCES competitor_sources(id) ON DELETE CASCADE,
  "parserServiceId" INTEGER      NOT NULL,                      -- id услуги в парсере
  "externalId"      VARCHAR(255),                               -- артикул на сайте конкурента
  name              TEXT         NOT NULL,
  url               TEXT,
  category          TEXT,                                       -- путь строкой, для выборок
  "categoryPath"    JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- ['Стоматология','Терапия']
  turnaround        VARCHAR(255),                               -- срок выполнения
  codes             JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- коды 804н, по ним идёт сопоставление
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,         -- пропала из прайса — гасим, но не удаляем
  "lastSeenAt"      TIMESTAMPTZ,
  "createdAt"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- id услуги в парсере сквозной по всем источникам, поэтому ключ одноколоночный.
-- Он же — цель ON CONFLICT при обновлении: id строки в вики обязан пережить
-- синхронизацию, иначе сопоставления с нашими услугами будут рваться каждую ночь.
CREATE UNIQUE INDEX IF NOT EXISTS competitor_services_parser_uq ON competitor_services ("parserServiceId");
CREATE INDEX IF NOT EXISTS competitor_services_source_idx       ON competitor_services ("sourceId");
CREATE INDEX IF NOT EXISTS competitor_services_active_idx       ON competitor_services ("sourceId", "isActive");
-- под сопоставление по названию: сравнивать всё равно придётся в нижнем регистре
CREATE INDEX IF NOT EXISTS competitor_services_name_idx         ON competitor_services (lower(name));
-- под сопоставление по 804н: коды лежат массивом, обычный btree по ним бесполезен
CREATE INDEX IF NOT EXISTS competitor_services_codes_gin        ON competitor_services USING gin (codes);

-- === Цены =====================================================================
-- Три значения, а не одно: конкуренты отдают вилку {min, base, max}, и base —
-- самостоятельная величина, а не середина. Клиенту на сайте показывают именно его.
CREATE TABLE IF NOT EXISTS competitor_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "serviceId"     UUID          NOT NULL REFERENCES competitor_services(id) ON DELETE CASCADE,
  "filialId"      INTEGER,                                      -- id филиала в парсере; NULL — филиалов нет
  "filialName"    VARCHAR(255),                                 -- денормализовано: отдельная таблица филиалов
                                                                -- дала бы join без единой новой возможности
  price           NUMERIC(12,2),
  "priceMin"      NUMERIC(12,2),
  "priceMax"      NUMERIC(12,2),
  "priceDiscount" NUMERIC(12,2),
  currency        VARCHAR(3)    NOT NULL DEFAULT 'RUB',
  "observedAt"    TIMESTAMPTZ,                                  -- когда парсер видел эту цену
  "createdAt"     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Ограничений на порядок цен нет намеренно: у конкурентов встречаются позиции
-- с base вне [min, max] и вовсе без цены. CHECK здесь ронял бы синхронизацию
-- на честных данных.

-- Уникальность парой (услуга, филиал). У лабораторий филиала нет, а NULL-ы
-- в Postgres между собой не конфликтуют — поэтому два частичных индекса,
-- ровно как это сделано в самом парсере.
CREATE UNIQUE INDEX IF NOT EXISTS competitor_prices_filial_uq
  ON competitor_prices ("serviceId", "filialId") WHERE "filialId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competitor_prices_nofilial_uq
  ON competitor_prices ("serviceId") WHERE "filialId" IS NULL;

CREATE INDEX IF NOT EXISTS competitor_prices_service_idx ON competitor_prices ("serviceId");
