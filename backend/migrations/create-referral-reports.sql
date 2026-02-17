-- Таблица архива отчётов по бонусам за направления
CREATE TABLE IF NOT EXISTS referral_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reportType" VARCHAR(10) NOT NULL DEFAULT 'single' CHECK ("reportType" IN ('single', 'bulk')),
  title VARCHAR(500) NOT NULL,
  "doctorName" VARCHAR(255),
  "misUserId" VARCHAR(50),
  "dateFrom" DATE,
  "dateTo" DATE,
  "totalAmount" NUMERIC(12, 2),
  "reportData" JSONB NOT NULL,
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_reports_type ON referral_reports ("reportType");
CREATE INDEX IF NOT EXISTS idx_referral_reports_mis_user ON referral_reports ("misUserId");
CREATE INDEX IF NOT EXISTS idx_referral_reports_period ON referral_reports ("dateFrom", "dateTo");
CREATE INDEX IF NOT EXISTS idx_referral_reports_created ON referral_reports ("createdAt" DESC);
