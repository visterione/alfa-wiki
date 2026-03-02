-- Add lastSeen timestamp to users for online/offline status tracking
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMPTZ;
