-- ver. 3.21: Add doctor_schedules table for shift scheduling
CREATE TABLE IF NOT EXISTS "doctor_schedules" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "misUserId"   VARCHAR(100) NOT NULL,
  "clinicId"    VARCHAR(50)  NOT NULL,
  "dateFrom"    DATE         NOT NULL,
  "dateTo"      DATE         NOT NULL,
  "pattern"     JSONB        NOT NULL DEFAULT '{}',
  "timeFrom"    VARCHAR(5)   NOT NULL DEFAULT '09:00',
  "timeTo"      VARCHAR(5)   NOT NULL DEFAULT '18:00',
  "exceptions"  JSONB        NOT NULL DEFAULT '[]',
  "createdBy"   UUID,
  "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_mis_user
  ON "doctor_schedules" ("misUserId");

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_dates
  ON "doctor_schedules" ("dateFrom", "dateTo");
