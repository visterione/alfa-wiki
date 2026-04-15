-- ver. 3.22: tabel records (табели учёта рабочего времени)

CREATE TABLE IF NOT EXISTS tabel_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month       SMALLINT  NOT NULL,
  year        SMALLINT  NOT NULL,
  org_name    VARCHAR(255),
  subdivision VARCHAR(255),
  doc_number  VARCHAR(50),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tabel_record_doctors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabel_record_id UUID NOT NULL REFERENCES tabel_records(id) ON DELETE CASCADE,
  mis_user_id     VARCHAR(100) NOT NULL,
  doctor_name     VARCHAR(255),
  entries         JSONB NOT NULL DEFAULT '{}',
  pay_data        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tabel_records_year_month  ON tabel_records(year, month);
CREATE INDEX IF NOT EXISTS idx_tabel_record_doctors_rec  ON tabel_record_doctors(tabel_record_id);
CREATE INDEX IF NOT EXISTS idx_tabel_record_doctors_user ON tabel_record_doctors(mis_user_id);
