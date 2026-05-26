-- ver. 4.46: Add canAccessStatistics flag to Users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "canAccessStatistics" BOOLEAN NOT NULL DEFAULT false;
