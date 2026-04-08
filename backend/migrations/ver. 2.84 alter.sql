-- ver. 2.84: Add partner_service_cache table for nightly MIS services cache
CREATE TABLE IF NOT EXISTS "partner_service_cache" (
  "id"             SERIAL PRIMARY KEY,
  "clinicId"       INTEGER NOT NULL,
  "serviceId"      INTEGER NOT NULL,
  "code"           VARCHAR(100),
  "subCode"        VARCHAR(100),
  "title"          VARCHAR(500) NOT NULL,
  "categoryId"     INTEGER,
  "categoryTitle"  VARCHAR(500),
  "categoryPath"   TEXT,
  "price"          DECIMAL(10,2),
  "duration"       INTEGER,
  "lab"            VARCHAR(255),
  "isHidden"       BOOLEAN NOT NULL DEFAULT false,
  "isDeleted"      BOOLEAN NOT NULL DEFAULT false,
  "syncedAt"       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_service_clinic_service_unique
  ON "partner_service_cache" ("clinicId", "serviceId");

CREATE INDEX IF NOT EXISTS idx_partner_service_clinic
  ON "partner_service_cache" ("clinicId");

CREATE INDEX IF NOT EXISTS idx_partner_service_category
  ON "partner_service_cache" ("categoryId");

CREATE INDEX IF NOT EXISTS idx_partner_service_title
  ON "partner_service_cache" USING gin (to_tsvector('russian', "title"));
