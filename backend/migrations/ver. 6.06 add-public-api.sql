-- ver. 6.06 — Публичный API для внешних интеграций
--
-- Приём данных от сторонних систем (сайт клиники и т.д.) на /api/public/v1/*.
-- Первая интеграция: форма регистрации пациента с сайта → сообщение в групповой чат вики.
--
-- api_clients      — внешние системы, которым разрешено слать нам данные (ключи API)
-- submissions      — принятые заявки (источник правды; чат — только доставка)
-- api_request_logs — аудит обращений к публичному API (без тела запроса: там ПДн)

-- === Клиенты публичного API ===================================================
CREATE TABLE IF NOT EXISTS api_clients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(150) NOT NULL,                          -- 'Сайт medcentralfa.ru'
  "keyType"          VARCHAR(10)  NOT NULL DEFAULT 'secret',         -- secret | public
  "keyPrefix"        VARCHAR(32)  NOT NULL,                          -- начало ключа, для поиска строки
  "keyHash"          VARCHAR(64)  NOT NULL,                          -- sha256 полного ключа
  scopes             JSONB        NOT NULL DEFAULT '[]'::jsonb,      -- ['forms:patient-registration']
  "allowedOrigins"   JSONB        NOT NULL DEFAULT '[]'::jsonb,      -- обязателен для keyType='public'
  "allowedIps"       JSONB        NOT NULL DEFAULT '[]'::jsonb,      -- опционально для keyType='secret'
  "rateLimitPerMin"  INTEGER      NOT NULL DEFAULT 60,
  "isActive"         BOOLEAN      NOT NULL DEFAULT true,
  "lastUsedAt"       TIMESTAMPTZ,
  "createdBy"        UUID,
  "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_clients_key_prefix_uq ON api_clients ("keyPrefix");
CREATE INDEX IF NOT EXISTS api_clients_is_active_idx        ON api_clients ("isActive");

-- === Заявки ===================================================================
-- Универсальная таблица: новая форма = новый formType, без миграции.
CREATE TABLE IF NOT EXISTS submissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "formType"         VARCHAR(50)  NOT NULL,                          -- 'patient-registration'
  "clientId"         UUID         REFERENCES api_clients(id) ON DELETE SET NULL,
  payload            JSONB        NOT NULL DEFAULT '{}'::jsonb,      -- поля формы после нормализации
  status             VARCHAR(20)  NOT NULL DEFAULT 'new',            -- new | in_progress | done | spam
  "deliveryStatus"   VARCHAR(20)  NOT NULL DEFAULT 'pending',        -- pending | sent | failed
  "deliveryAttempts" INTEGER      NOT NULL DEFAULT 0,
  "deliveryError"    TEXT,
  "deliveredMsgId"   BIGINT,                                         -- message_id в чате вики
  "deliveredAt"      TIMESTAMPTZ,
  "assignedUserId"   UUID,
  "sourceIp"         VARCHAR(64),
  "userAgent"        TEXT,
  "idempotencyKey"   VARCHAR(100),                                   -- защита от дублей при ретраях
  "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Дубли ловим в паре (клиент, ключ идемпотентности): ключи генерят на стороне клиента.
CREATE UNIQUE INDEX IF NOT EXISTS submissions_idempotency_uq
  ON submissions ("clientId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- Крон повторной доставки выбирает по этому индексу.
CREATE INDEX IF NOT EXISTS submissions_delivery_status_idx ON submissions ("deliveryStatus");
CREATE INDEX IF NOT EXISTS submissions_form_created_idx    ON submissions ("formType", "createdAt" DESC);

-- === Аудит обращений ==========================================================
CREATE TABLE IF NOT EXISTS api_request_logs (
  id           BIGSERIAL PRIMARY KEY,
  "clientId"   UUID,
  method       VARCHAR(10)  NOT NULL,
  path         TEXT         NOT NULL,
  "statusCode" INTEGER      NOT NULL,
  "errorCode"  VARCHAR(50),
  "durationMs" INTEGER,
  ip           VARCHAR(64),
  "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_request_logs_client_idx  ON api_request_logs ("clientId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS api_request_logs_created_idx ON api_request_logs ("createdAt" DESC);
