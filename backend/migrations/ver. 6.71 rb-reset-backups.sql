-- ver. 6.71 — снимки данных перед выборочным сбросом на вкладке «Сотрудники».
--
-- Сброс переписывает settings в executor_settings по выбранным клиникам: удаляет
-- незафиксированные записи и обнуляет незафиксированные суммы. Операция была
-- необратимой — в rb_activity_log попадали только счётчики (сколько сотрудников и
-- значений затронуто), и восстанавливать данные после ошибочного сброса было не из
-- чего, кроме ночного бекапа всей базы.
--
-- Снимок хранит settings целиком по каждой строке, которую сброс собирается
-- переписать, а не выборку затронутых ключей. Причина: состав затронутых ключей
-- вычисляет та же функция, что делает и сам сброс, и её ошибка одинаково повредила
-- бы и данные, и бекап. Полный settings от такого расхождения защищён по построению.

CREATE TABLE IF NOT EXISTS rb_reset_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'reset' — снимок перед сбросом, 'restore' — перед откатом. Откат тоже
  -- перезаписывает данные, поэтому нуждается в собственной точке возврата.
  kind VARCHAR(20) NOT NULL DEFAULT 'reset',

  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  clinic_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  employee_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0,

  -- { "<misUserId>": { "doctorName": "…", "settings": {…}, "updatedAt": "…" } }
  -- updatedAt — отметка строки уже ПОСЛЕ записи сброса. По ней при откате видно,
  -- правил ли кто-то этого сотрудника после сброса.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  restored_at TIMESTAMPTZ,
  restored_by UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rb_reset_backups
  DROP CONSTRAINT IF EXISTS rb_reset_backups_kind_chk;

ALTER TABLE rb_reset_backups
  ADD CONSTRAINT rb_reset_backups_kind_chk CHECK (kind IN ('reset', 'restore'));

-- Список снимков всегда читается «последние сверху», и по этому же порядку
-- отсекаются лишние: в таблице живут только пять свежих записей.
CREATE INDEX IF NOT EXISTS rb_reset_backups_created_at_idx
  ON rb_reset_backups (created_at DESC);

COMMENT ON TABLE rb_reset_backups IS
  'Снимки executor_settings перед выборочным сбросом и откатом на вкладке '
  '«Сотрудники». Хранятся пять последних, лишние удаляются при создании нового';
