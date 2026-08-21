-- ver. 7.11 · Сохранённые отчёты складского модуля
--
-- Хранится результат, а не параметры расчёта. Отчёты модуля тяжёлые (оборотка
-- разворачивает дерево локаций, ABC считает вариацию по месяцам), и вернуться к
-- построенному вчера можно было только построив его заново. При этом пересчёт за
-- тот же период даёт другие цифры: остатки успели измениться. Снимок отвечает на
-- вопрос «что мы видели тогда», чего ссылка на расчёт не умеет в принципе.
--
-- Колонки лежат рядом со строками: состав колонок отчёта со временем меняется, и
-- прошлогодний снимок под нынешними заголовками показывал бы пустые столбцы.
--
-- Запуск из backend/:
--   npm run migrate:7.11:check   # только проверить
--   npm run migrate:7.11         # применить
--
-- Транзакцию открывает раннер (scripts/migrateWarehouseSavedReports.js), как у
-- остальных миграций проекта, — здесь её быть не должно.

CREATE TABLE IF NOT EXISTS warehouse_saved_reports (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(32)  NOT NULL,
  "reportKey"  VARCHAR(40)  NOT NULL,
  mode         VARCHAR(40),
  title        VARCHAR(300) NOT NULL,
  note         TEXT,
  "periodFrom" DATE,
  "periodTo"   DATE,
  params       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  columns      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  payload      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "rowCount"   INTEGER      NOT NULL DEFAULT 0,
  "createdBy"  UUID         REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE warehouse_saved_reports IS
  'Снимки построенных отчётов: строки, итоги и колонки на момент сохранения.';
COMMENT ON COLUMN warehouse_saved_reports.payload IS
  'Результат целиком: items, totals, summary, header, hierarchical, disclaimer.';
COMMENT ON COLUMN warehouse_saved_reports.params IS
  'Чем строили: период, медцентр, отделение и человеческая строка отбора из шапки.';

-- Список открывают по свежести и фильтруют по виду отчёта — оба запроса ходят
-- по этому индексу. Отдельного индекса по автору нет намеренно: «мои отчёты»
-- отбираются на уже отфильтрованном по правам списке, который короток.
CREATE INDEX IF NOT EXISTS warehouse_saved_reports_recent
  ON warehouse_saved_reports (code, "createdAt" DESC);
