-- ver. 5.86 — Подписчики клиентских ботов (Telegram / MAX)
-- Отслеживание подписчиков ботов по 6 организациям и простановка категории в МИС.
-- Категория в МИС зависит только от платформы (2 категории), organization — разрез для статистики.

CREATE TABLE IF NOT EXISTS bot_subscribers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        VARCHAR(20)  NOT NULL,              -- 'telegram' | 'max'
  organization    VARCHAR(50)  NOT NULL,              -- 'alfa', 'alfa-deti', ...
  "externalUserId" VARCHAR(50) NOT NULL,              -- chatId / user_id в мессенджере
  username        VARCHAR(100),
  "firstName"     VARCHAR(100),
  "lastName"      VARCHAR(100),
  phone           VARCHAR(30),
  "patientIds"    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  status          VARCHAR(20)  NOT NULL DEFAULT 'started',  -- started | identified | tagged
  source          VARCHAR(20)  NOT NULL DEFAULT 'bot',      -- bot | import (Fromni backfill)
  "startedAt"     TIMESTAMPTZ,
  "identifiedAt"  TIMESTAMPTZ,
  "taggedAt"      TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- на случай, если таблица уже была создана более ранней версией миграции
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'bot';

-- Уникальность на (платформа, организация, пользователь): один человек может быть
-- подписан на боты нескольких медцентров — считаем его в каждом.
CREATE UNIQUE INDEX IF NOT EXISTS bot_subscribers_platform_org_user_uq
  ON bot_subscribers (platform, organization, "externalUserId");
CREATE INDEX IF NOT EXISTS bot_subscribers_organization_idx
  ON bot_subscribers (organization);
CREATE INDEX IF NOT EXISTS bot_subscribers_status_idx
  ON bot_subscribers (status);
