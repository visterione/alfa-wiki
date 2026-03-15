-- Add cabinetId column to performed_service_bonuses
-- Allows per-cabinet bonus overrides for the same service within a clinic

ALTER TABLE performed_service_bonuses
  ADD COLUMN IF NOT EXISTS "cabinetId" VARCHAR(100) NOT NULL DEFAULT '';

-- Drop old unique (constraint or index) on (misUserId, serviceCode, clinicId)
ALTER TABLE performed_service_bonuses
  DROP CONSTRAINT IF EXISTS "performed_service_bonuses_mis_user_svc_clinic_unique";
ALTER TABLE performed_service_bonuses
  DROP CONSTRAINT IF EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId_key";
ALTER TABLE performed_service_bonuses
  DROP CONSTRAINT IF EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId";
-- The old constraint was created as an INDEX (not a CONSTRAINT) — must use DROP INDEX
DROP INDEX IF EXISTS "performed_service_bonuses_mis_user_svc_clinic_unique";
DROP INDEX IF EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId";

-- Drop new constraint too (idempotent re-run safety)
ALTER TABLE performed_service_bonuses
  DROP CONSTRAINT IF EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId_cabinetId_key";
DROP INDEX IF EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId_cabinetId_key";

-- Add new unique constraint including cabinetId
ALTER TABLE performed_service_bonuses
  ADD CONSTRAINT "performed_service_bonuses_misUserId_serviceCode_clinicId_cabinetId_key"
  UNIQUE ("misUserId", "serviceCode", "clinicId", "cabinetId");
