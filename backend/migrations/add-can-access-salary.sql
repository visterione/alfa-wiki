-- Migration: add canAccessSalary column to Users table
-- Controls whether a user can access the Salary (Referral Bonuses) section

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "canAccessSalary" BOOLEAN NOT NULL DEFAULT FALSE;
