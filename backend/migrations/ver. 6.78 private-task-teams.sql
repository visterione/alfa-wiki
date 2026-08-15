BEGIN;

-- Команды модуля задач всегда закрыты: доступ получают только явно
-- перечисленные участники, руководители и наблюдатели.
UPDATE task_teams SET access = 'members', "isHidden" = TRUE;

ALTER TABLE task_teams ALTER COLUMN access SET DEFAULT 'members';
ALTER TABLE task_teams ALTER COLUMN "isHidden" SET DEFAULT TRUE;

ALTER TABLE task_teams DROP CONSTRAINT IF EXISTS task_teams_private_access;
ALTER TABLE task_teams ADD CONSTRAINT task_teams_private_access CHECK (access = 'members');
ALTER TABLE task_teams DROP CONSTRAINT IF EXISTS task_teams_always_hidden;
ALTER TABLE task_teams ADD CONSTRAINT task_teams_always_hidden CHECK ("isHidden" IS TRUE);

COMMENT ON COLUMN task_teams.access IS
  'Закрытая область загрузки: доступ только участникам и наблюдателям';
COMMENT ON COLUMN task_teams."isHidden" IS
  'Всегда TRUE: команда не раскрывается посторонним';

COMMIT;
