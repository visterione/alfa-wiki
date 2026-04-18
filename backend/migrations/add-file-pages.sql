-- Migration: add 'file' content type and media_id FK to pages

-- 1. Add new value to the contentType enum
--    (must run outside a transaction; IF NOT EXISTS requires PG 9.6+)
ALTER TYPE "enum_pages_contentType" ADD VALUE IF NOT EXISTS 'file';

-- 2. Add media_id FK column to pages
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS "mediaId" UUID REFERENCES media(id) ON DELETE SET NULL;
