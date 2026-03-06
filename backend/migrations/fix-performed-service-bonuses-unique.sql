-- Fix: drop old 2-field unique constraint and ensure correct 3-field one exists
-- Old constraint only covered (misUserId, serviceCode), blocking per-clinic bonuses

-- Drop the old constraint if it exists
ALTER TABLE performed_service_bonuses
  DROP CONSTRAINT IF EXISTS performed_service_bonuses_mis_user_service_unique;

-- Create the correct 3-field unique constraint (misUserId, serviceCode, clinicId)
-- (Sequelize may have already created it under a different name; use IF NOT EXISTS via index)
CREATE UNIQUE INDEX IF NOT EXISTS performed_service_bonuses_mis_user_svc_clinic_unique
  ON performed_service_bonuses ("misUserId", "serviceCode", "clinicId");
