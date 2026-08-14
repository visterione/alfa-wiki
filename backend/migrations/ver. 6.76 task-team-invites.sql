BEGIN;

CREATE TABLE IF NOT EXISTS task_team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId" UUID NOT NULL REFERENCES task_teams(id) ON DELETE CASCADE,
  token VARCHAR(96) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'viewer', 'lead')),
  "expiresAt" TIMESTAMPTZ,
  "createdBy" UUID NOT NULL REFERENCES users(id),
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_team_invites_team_idx
  ON task_team_invites ("teamId");
CREATE INDEX IF NOT EXISTS task_team_invites_expires_idx
  ON task_team_invites ("expiresAt");

COMMIT;
