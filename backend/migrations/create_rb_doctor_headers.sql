CREATE TABLE IF NOT EXISTS rb_doctor_headers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mis_user_id  VARCHAR(100) NOT NULL UNIQUE,
  tabel_number VARCHAR(50),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
