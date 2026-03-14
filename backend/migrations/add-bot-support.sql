-- Migration: add-bot-support
-- Adds Telegram Bot API compatibility tables and fields
-- Run with: psql -U <user> -d <database> -f migrations/add-bot-support.sql

-- 1. Create int_id_map table (UUID → stable BIGSERIAL integer, used as Telegram integer IDs)
CREATE TABLE IF NOT EXISTS int_id_map (
  id            BIGSERIAL   PRIMARY KEY,
  uuid          UUID        NOT NULL UNIQUE,
  "entityType"  VARCHAR(20) NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS int_id_map_uuid_idx        ON int_id_map (uuid);
CREATE INDEX IF NOT EXISTS int_id_map_entity_type_idx ON int_id_map ("entityType");

-- 2. Add telegramMsgId to messages table
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS "telegramMsgId" BIGINT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS messages_telegram_msg_id_idx
  ON messages ("telegramMsgId");

-- 2. Create bot_tokens table
CREATE TABLE IF NOT EXISTS bot_tokens (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token                VARCHAR(150) NOT NULL UNIQUE,
  name                 VARCHAR(100) NOT NULL,
  username             VARCHAR(100) NOT NULL UNIQUE,
  description          TEXT        NOT NULL DEFAULT '',
  "userId"             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "webhookUrl"         TEXT,
  "webhookSecretToken" VARCHAR(256),
  "allowedUpdates"     TEXT[]      NOT NULL DEFAULT '{}',
  "maxConnections"     INTEGER     NOT NULL DEFAULT 40,
  commands             JSONB       NOT NULL DEFAULT '[]',
  "isActive"           BOOLEAN     NOT NULL DEFAULT TRUE,
  "lastUpdateId"       BIGINT      NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_tokens_user_id_idx    ON bot_tokens ("userId");
CREATE INDEX IF NOT EXISTS bot_tokens_is_active_idx  ON bot_tokens ("isActive");

-- 3. Create bot_updates table with BIGSERIAL for update_id sequence
CREATE TABLE IF NOT EXISTS bot_updates (
  id           BIGSERIAL   PRIMARY KEY,
  "botId"      UUID        NOT NULL REFERENCES bot_tokens(id) ON DELETE CASCADE,
  "updateType" VARCHAR(50) NOT NULL,
  "updateData" JSONB       NOT NULL DEFAULT '{}',
  processed    BOOLEAN     NOT NULL DEFAULT FALSE,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_updates_bot_id_idx           ON bot_updates ("botId");
CREATE INDEX IF NOT EXISTS bot_updates_processed_idx        ON bot_updates (processed);
CREATE INDEX IF NOT EXISTS bot_updates_bot_id_processed_idx ON bot_updates ("botId", processed);
CREATE INDEX IF NOT EXISTS bot_updates_created_at_idx       ON bot_updates ("createdAt");
