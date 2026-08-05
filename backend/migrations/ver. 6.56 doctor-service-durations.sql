-- ver. 6.56 — фактическая длительность услуги врача по клинике

CREATE TABLE IF NOT EXISTS doctor_service_durations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "misUserId"       VARCHAR(50) NOT NULL,
  "clinicId"        VARCHAR(50) NOT NULL,
  "serviceId"       VARCHAR(50) NOT NULL,
  "durationMinutes" INTEGER NOT NULL CHECK ("durationMinutes" > 0),
  "sourceCardId"    UUID REFERENCES doctor_cards(id) ON DELETE SET NULL,
  "updatedBy"       UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS doctor_service_durations_tuple_uq
  ON doctor_service_durations ("misUserId", "clinicId", "serviceId");
CREATE INDEX IF NOT EXISTS doctor_service_durations_doctor_idx
  ON doctor_service_durations ("misUserId");
CREATE INDEX IF NOT EXISTS doctor_service_durations_service_idx
  ON doctor_service_durations ("serviceId");
