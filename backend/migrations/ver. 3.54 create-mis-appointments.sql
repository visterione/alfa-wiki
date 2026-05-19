-- Таблица для хранения визитов из МИС (getAppointments v2)
-- Синхронизируется ежедневно в 00:05 МСК; первичная загрузка с 2026-02-01

CREATE TABLE IF NOT EXISTS mis_appointments (
  id           SERIAL PRIMARY KEY,
  appt_id      INTEGER NOT NULL,               -- ID визита в МИС (уникален)
  clinic_id    SMALLINT,
  room         VARCHAR(100),
  doctor_id    INTEGER,
  patient_id   INTEGER,
  time_start   TIMESTAMPTZ,
  time_end     TIMESTAMPTZ,
  status_id    SMALLINT,
  status       VARCHAR(20),
  date_created TIMESTAMPTZ,
  date_updated TIMESTAMPTZ,
  data         JSONB       NOT NULL DEFAULT '{}', -- полный объект из МИС
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mis_appt_appt_id_unique ON mis_appointments (appt_id);
CREATE INDEX        IF NOT EXISTS mis_appt_clinic_id      ON mis_appointments (clinic_id);
CREATE INDEX        IF NOT EXISTS mis_appt_room           ON mis_appointments (room);
CREATE INDEX        IF NOT EXISTS mis_appt_time_start     ON mis_appointments (time_start);
CREATE INDEX        IF NOT EXISTS mis_appt_doctor_id      ON mis_appointments (doctor_id);
CREATE INDEX        IF NOT EXISTS mis_appt_patient_id     ON mis_appointments (patient_id);
CREATE INDEX        IF NOT EXISTS mis_appt_status_id      ON mis_appointments (status_id);
