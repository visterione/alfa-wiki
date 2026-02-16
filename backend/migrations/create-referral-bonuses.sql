-- Таблица для хранения бонусов врачей-направителей
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "misUserId" VARCHAR(50) NOT NULL,
  "doctorName" VARCHAR(255) NOT NULL DEFAULT '',
  "serviceCode" VARCHAR(100) NOT NULL,
  "serviceName" VARCHAR(500) NOT NULL,
  "bonusPercent" DECIMAL(10, 2),
  "bonusRub" DECIMAL(10, 2),
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_bonuses_doctor_service_unique UNIQUE ("misUserId", "serviceCode")
);

CREATE INDEX IF NOT EXISTS idx_referral_bonuses_mis_user ON referral_bonuses ("misUserId");
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_service_code ON referral_bonuses ("serviceCode");
