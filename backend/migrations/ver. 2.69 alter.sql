-- ver. 2.69: Add service_page_notes table for per-page notes on services pages
CREATE TABLE IF NOT EXISTS "service_page_notes" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pageSlug"    VARCHAR(255) NOT NULL UNIQUE,
  "notes"       TEXT,
  "updatedBy"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_page_notes_pageslug ON "service_page_notes" ("pageSlug");
