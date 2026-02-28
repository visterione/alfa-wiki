-- Migration: Add clinicId column to performed_service_bonuses
-- Run in PGAdmin or psql

-- 1. Add clinicId column
ALTER TABLE performed_service_bonuses
ADD COLUMN IF NOT EXISTS "clinicId" VARCHAR(50) NOT NULL DEFAULT '';

-- 2. Drop old unique constraint/index (try all possible generated names)
ALTER TABLE performed_service_bonuses DROP CONSTRAINT IF EXISTS performed_service_bonuses_mis_user_id_service_code_key;
ALTER TABLE performed_service_bonuses DROP CONSTRAINT IF EXISTS "performed_service_bonuses_misUserId_serviceCode_key";
DROP INDEX IF EXISTS "performed_service_bonuses_mis_user_id_service_code";
DROP INDEX IF EXISTS "performed_service_bonuses_misUserId_serviceCode";

-- 3. New unique index on (misUserId, serviceCode, clinicId)
CREATE UNIQUE INDEX IF NOT EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId"
ON performed_service_bonuses ("misUserId", "serviceCode", "clinicId");
