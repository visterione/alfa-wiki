-- Владелец подразделения
ALTER TABLE structural_divisions
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Таблица доступа к подразделениям
CREATE TABLE IF NOT EXISTS division_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES structural_divisions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  VARCHAR(10) NOT NULL DEFAULT 'read' CHECK (permission IN ('edit', 'read')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, user_id)
);
