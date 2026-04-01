-- Migration: create announcements table
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  "authorId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned BOOLEAN NOT NULL DEFAULT false,
  "targetRoles" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "targetMedCenterIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "targetUserIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_author ON announcements("authorId");
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements(pinned);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements("createdAt" DESC);
