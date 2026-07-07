-- Реестр сотрудников RB (локальное зеркало сотрудников МИС).
-- См. модель RbEmployee в models/index.js.
CREATE TABLE IF NOT EXISTS rb_employees (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "misUserId"    VARCHAR(50)  NOT NULL UNIQUE,
  name           VARCHAR(255),
  professions    JSONB        DEFAULT '[]'::jsonb,
  roles          JSONB        DEFAULT '[]'::jsonb,
  clinics        JSONB        DEFAULT '[]'::jsonb,
  status         VARCHAR(10)  NOT NULL DEFAULT 'active',
  "seededBaseline" BOOLEAN    NOT NULL DEFAULT false,
  "firstSeenAt"  TIMESTAMPTZ,
  "lastSeenAt"   TIMESTAMPTZ,
  "archivedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rb_employees_status_idx ON rb_employees (status);
