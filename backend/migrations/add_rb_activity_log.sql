-- RB Activity Log: детальный журнал изменений модуля Зарплата
CREATE TABLE IF NOT EXISTS rb_activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  tab         VARCHAR(50)  NOT NULL,
  action      VARCHAR(50)  NOT NULL,
  entity_type VARCHAR(100),
  entity_id   VARCHAR(255),
  doctor_name VARCHAR(255),
  mis_user_id VARCHAR(100),
  clinic_id   VARCHAR(100),
  summary     TEXT         NOT NULL,
  diff        JSONB,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rb_activity_log_user_id    ON rb_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_rb_activity_log_tab        ON rb_activity_log(tab);
CREATE INDEX IF NOT EXISTS idx_rb_activity_log_created_at ON rb_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rb_activity_log_mis_user   ON rb_activity_log(mis_user_id);
