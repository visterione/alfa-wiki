-- Migration: add editHistory to cash_payments
ALTER TABLE cash_payments ADD COLUMN IF NOT EXISTS "editHistory" JSONB DEFAULT '[]'::jsonb;
