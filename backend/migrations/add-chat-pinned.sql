-- Migration: add isPinned and pinnedOrder to chat_members
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS "pinnedOrder" INTEGER;
