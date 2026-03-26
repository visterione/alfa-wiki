-- Migration: add cash_payments table
-- Stores records of cash issued from cashier to employees

CREATE TABLE IF NOT EXISTS cash_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "salaryRecordId" UUID NOT NULL REFERENCES salary_records(id) ON DELETE CASCADE,
  "misUserId" VARCHAR(50) NOT NULL,
  "doctorName" VARCHAR(255) NOT NULL,
  "periodLabel" VARCHAR(100),
  amount DECIMAL(10, 2) NOT NULL,
  "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "issuedByUserId" UUID,
  "financistName" VARCHAR(100),
  note TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_payments_salary_record ON cash_payments ("salaryRecordId");
CREATE INDEX IF NOT EXISTS cash_payments_mis_user ON cash_payments ("misUserId");
CREATE INDEX IF NOT EXISTS cash_payments_issued_at ON cash_payments ("issuedAt");
