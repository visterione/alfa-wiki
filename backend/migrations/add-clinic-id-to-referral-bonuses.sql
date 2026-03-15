-- Add clinicId column to referral_bonuses
-- Allows per-clinic bonus overrides for the same service within a doctor

ALTER TABLE referral_bonuses
  ADD COLUMN IF NOT EXISTS "clinicId" VARCHAR(50) NOT NULL DEFAULT '';

-- Drop old unique constraint (different possible names)
ALTER TABLE referral_bonuses
  DROP CONSTRAINT IF EXISTS "referral_bonuses_doctor_service_unique";
DROP INDEX IF EXISTS "referral_bonuses_doctor_service_unique";

-- Drop new constraint too (idempotent re-run safety)
ALTER TABLE referral_bonuses
  DROP CONSTRAINT IF EXISTS "referral_bonuses_misUserId_serviceCode_clinicId_key";
DROP INDEX IF EXISTS "referral_bonuses_misUserId_serviceCode_clinicId_key";

-- Add new unique constraint including clinicId
ALTER TABLE referral_bonuses
  ADD CONSTRAINT "referral_bonuses_misUserId_serviceCode_clinicId_key"
  UNIQUE ("misUserId", "serviceCode", "clinicId");
