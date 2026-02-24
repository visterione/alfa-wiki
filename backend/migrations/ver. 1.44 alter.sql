-- ============================================================
-- ver. 1.44 — Автосинхронизация отзывов с внешних площадок
-- ============================================================

-- Таблица конфигураций синхронизации
-- Одна запись = одна площадка для одной доски
CREATE TABLE IF NOT EXISTS review_sync_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "boardId" UUID NOT NULL REFERENCES review_boards(id) ON DELETE CASCADE,
  -- provider: 'google' | 'yandex' | 'prodoctorov' | 'docdoc' | 'napopravku' | '2gis' | 'doctu'
  provider VARCHAR(50) NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  -- Credentials (зашифровывать на уровне приложения при необходимости):
  -- Google:      { clientId, clientSecret, refreshToken, locationName }
  -- Яндекс:     { oauthToken, organizationId }
  -- ПроДокторов: { apiToken, clinicId }
  -- DocDoc:      { apiToken, clinicId }
  -- НаПоправку:  { apiToken, clinicId }
  -- 2ГИС:        { branchId }
  -- Докту:       { clinicId, sessionToken }
  credentials JSONB NOT NULL DEFAULT '{}',
  "lastSyncAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncStatus" VARCHAR(20),  -- 'success' | 'error' | 'running'
  "lastSyncError" TEXT,
  "lastSyncCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE("boardId", provider)
);

CREATE INDEX IF NOT EXISTS review_sync_configs_board_idx ON review_sync_configs("boardId");
CREATE INDEX IF NOT EXISTS review_sync_configs_enabled_idx ON review_sync_configs("isEnabled");

-- Новые поля в таблице reviews для хранения источника импорта
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS "externalId" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "externalUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "isAutoImported" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "importSource" VARCHAR(50);

-- Уникальный индекс: один и тот же внешний отзыв не попадёт дважды в одну доску
CREATE UNIQUE INDEX IF NOT EXISTS reviews_external_id_board_idx
  ON reviews("externalId", "boardId")
  WHERE "externalId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS reviews_is_auto_imported_idx ON reviews("isAutoImported");
