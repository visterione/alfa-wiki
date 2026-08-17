BEGIN;

-- Коды задач: РЕМ-42, у части — РЕМ-42/2.
--
-- Код записывается в задачу один раз и дальше не меняется: переименование
-- проекта и перенос задачи на него не влияют. Поэтому это отдельная колонка, а
-- не вычисление из текущего проекта при выдаче.

ALTER TABLE task_projects ADD COLUMN IF NOT EXISTS key VARCHAR(8);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS code VARCHAR(24);

-- Ключ проекта уникален без учёта регистра: «рем» и «РЕМ» — один префикс, иначе
-- коды двух проектов встретятся в одном пространстве номеров.
CREATE UNIQUE INDEX IF NOT EXISTS task_projects_key_uniq
  ON task_projects (upper(key)) WHERE key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_code_uniq
  ON tasks (code) WHERE code IS NOT NULL;

-- Счётчики по префиксам, а не по проектам. Если ключ РЕМ когда-нибудь
-- освободится и достанется другому проекту, нумерация продолжится с прежнего
-- места и старые коды не получат двойников. Здесь же живёт счётчик ЗАД —
-- префикс задач без проекта, у которых своего проекта нет по определению.
CREATE TABLE IF NOT EXISTS task_code_counters (
  prefix TEXT PRIMARY KEY,
  next INTEGER NOT NULL DEFAULT 1
);

COMMENT ON COLUMN task_projects.key IS
  'Префикс кодов задач проекта (РЕМ); уникален без учёта регистра';
COMMENT ON COLUMN tasks.code IS
  'Неизменяемый код задачи вида РЕМ-42, выдаётся при создании';
COMMENT ON TABLE task_code_counters IS
  'Выданные номера по префиксам: next — следующий свободный номер';

COMMIT;
