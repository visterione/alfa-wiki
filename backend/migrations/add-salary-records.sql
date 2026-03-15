-- Migration: add salary_records table
-- Stores confirmed payroll records for salary history tracking

CREATE TABLE IF NOT EXISTS salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "misUserId" VARCHAR(50) NOT NULL,
  "doctorName" VARCHAR(255) NOT NULL,
  "dateFrom" DATE,
  "dateTo" DATE,
  "periodLabel" VARCHAR(100),
  "reportData" JSONB,
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS salary_records_mis_user_id ON salary_records ("misUserId");
CREATE INDEX IF NOT EXISTS salary_records_date_from ON salary_records ("dateFrom");
