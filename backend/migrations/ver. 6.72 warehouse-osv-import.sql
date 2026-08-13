-- ver. 6.72 — импорт оборотно-сальдовой ведомости 1С (счёт МЦ.04).
--
-- Обмена с 1С нет и не будет: от него отказались в пользу полного внутреннего
-- учёта в портале. Единственное, что приходит извне, — файл XLSX раз в месяц:
-- дерево номенклатуры с количеством и балансовой суммой, обороты и сальдо.
--
-- Схема из трёх таблиц, и разделение между ними принципиальное:
--
--   warehouse_osv_imports   — снимок месяца: что сказала 1С, целиком и без правок
--   warehouse_osv_lines     — строки этого снимка, включая группы дерева
--   warehouse_osv_mappings  — сопоставление строк 1С с объектами портала
--
-- Сопоставления НЕ привязаны к импорту и переживают его. Разноска позиций по
-- кабинетам и ответственным — ручная работа на недели, а файл приезжает заново
-- каждый месяц: если импортировать прямо в рабочие таблицы, каждая загрузка
-- затирала бы её. При таком разделении второй импорт подхватывает готовое
-- сопоставление и обновляет только цифры.
--
-- Остаток «по 1С» и остаток портала намеренно живут в разных таблицах и никогда
-- не складываются в одно поле: расхождение между ними — это и есть предмет
-- аудита, а в общем поле его не станет видно.
--
-- Миграция аддитивна и идемпотентна.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. СНИМОК МЕСЯЦА
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_osv_imports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account        VARCHAR(20) NOT NULL,
  organization   VARCHAR(200),
  "periodYear"   INTEGER NOT NULL,
  "periodMonth"  SMALLINT NOT NULL,
  "periodLabel"  VARCHAR(60),
  "fileName"     VARCHAR(300) NOT NULL,
  "fileSize"     INTEGER,
  -- Хеш содержимого: сразу видно, что загрузили ровно тот же файл повторно.
  "fileHash"     VARCHAR(64),
  status         VARCHAR(20) NOT NULL DEFAULT 'draft',
  "lineCount"    INTEGER NOT NULL DEFAULT 0,
  "groupCount"   INTEGER NOT NULL DEFAULT 0,
  "leafCount"    INTEGER NOT NULL DEFAULT 0,
  "openingSum"   NUMERIC(16,2) NOT NULL DEFAULT 0,
  "openingQty"   NUMERIC(16,3) NOT NULL DEFAULT 0,
  "debitSum"     NUMERIC(16,2) NOT NULL DEFAULT 0,
  "debitQty"     NUMERIC(16,3) NOT NULL DEFAULT 0,
  "creditSum"    NUMERIC(16,2) NOT NULL DEFAULT 0,
  "creditQty"    NUMERIC(16,3) NOT NULL DEFAULT 0,
  "closingSum"   NUMERIC(16,2) NOT NULL DEFAULT 0,
  "closingQty"   NUMERIC(16,3) NOT NULL DEFAULT 0,
  warnings       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "uploadedBy"   UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "appliedAt"    TIMESTAMPTZ,
  "appliedBy"    UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_osv_imports_status_chk CHECK (status IN ('draft', 'applied')),
  CONSTRAINT warehouse_osv_imports_month_chk CHECK ("periodMonth" BETWEEN 1 AND 12)
);

COMMENT ON TABLE warehouse_osv_imports IS 'Снимки оборотно-сальдовой ведомости 1С, по одному на месяц';

-- Применённый снимок в периоде ровно один. Черновиков может быть сколько угодно:
-- файл разбирают, смотрят расхождения и решают, принимать ли, — и повторная
-- попытка не должна упираться в ограничение.
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_osv_imports_period_uniq
  ON warehouse_osv_imports (account, "periodYear", "periodMonth")
  WHERE status = 'applied';

CREATE INDEX IF NOT EXISTS warehouse_osv_imports_period_idx
  ON warehouse_osv_imports (account, "periodYear" DESC, "periodMonth" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. СТРОКИ СНИМКА
-- ─────────────────────────────────────────────────────────────────────────────
-- Группы дерева хранятся наравне с позициями: это структура отчёта, по ним же
-- делается групповое сопоставление, и по ним же проверяется, что разбор файла
-- не уехал (итог группы обязан равняться сумме вложенных строк).
CREATE TABLE IF NOT EXISTS warehouse_osv_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "importId"   UUID NOT NULL REFERENCES warehouse_osv_imports(id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- Номер строки листа: с ним расхождение открывается в самом файле и видно
  -- глазами. Без него спор с бухгалтерией сводится к «у вас неправильно».
  "rowNumber"  INTEGER NOT NULL,
  "sortOrder"  INTEGER NOT NULL,
  level        SMALLINT NOT NULL DEFAULT 0,
  name         VARCHAR(500) NOT NULL,
  "pathText"   TEXT,
  "isGroup"    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Номер повтора внутри группы: одна номенклатура лежит в 1С несколькими
  -- строками с разной ценой (партии), и различить их больше нечем.
  "dupIndex"   SMALLINT NOT NULL DEFAULT 0,
  "lineKey"    VARCHAR(40) NOT NULL,
  "openingSum" NUMERIC(16,2) NOT NULL DEFAULT 0,
  "openingQty" NUMERIC(16,3) NOT NULL DEFAULT 0,
  "debitSum"   NUMERIC(16,2) NOT NULL DEFAULT 0,
  "debitQty"   NUMERIC(16,3) NOT NULL DEFAULT 0,
  "creditSum"  NUMERIC(16,2) NOT NULL DEFAULT 0,
  "creditQty"  NUMERIC(16,3) NOT NULL DEFAULT 0,
  "closingSum" NUMERIC(16,2) NOT NULL DEFAULT 0,
  "closingQty" NUMERIC(16,3) NOT NULL DEFAULT 0,
  -- Цены за единицу в файле нет, это результат деления суммы на количество.
  -- Стоимость балансовая, а не закупочная: подставлять её в цену поставщика
  -- нельзя, иначе она всплывёт в запросах котировок.
  "unitCost"   NUMERIC(14,2)
);

COMMENT ON TABLE warehouse_osv_lines IS 'Строки ведомости 1С как в файле: дерево, количество, суммы';

CREATE INDEX IF NOT EXISTS warehouse_osv_lines_import_idx
  ON warehouse_osv_lines ("importId", "sortOrder");

-- Сравнение снимков идёт по ключу строки, и это самый горячий запрос модуля.
CREATE INDEX IF NOT EXISTS warehouse_osv_lines_key_idx
  ON warehouse_osv_lines ("importId", "lineKey");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. СОПОСТАВЛЕНИЯ
-- ─────────────────────────────────────────────────────────────────────────────
-- Единственная таблица, которая живёт между импортами.
CREATE TABLE IF NOT EXISTS warehouse_osv_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account          VARCHAR(20) NOT NULL,
  -- Сопоставить можно строку (lineKey) или целую ветку дерева (pathPrefix).
  -- Второе — не удобство, а условие выполнимости: групп третьего уровня 54, и
  -- половина названа по кабинету («Кабинет Хирурга», «Мед. приборы Астраханская
  -- 98»). Одно действие на группу закрывает больше полутора тысяч строк из 2992.
  "lineKey"        VARCHAR(40),
  "pathPrefix"     TEXT,
  -- Название на момент сопоставления. Если группу в 1С переименуют, ключ
  -- порвётся, и по этому полю будет видно, чем строка была раньше.
  name             VARCHAR(500),
  kind             VARCHAR(20) NOT NULL DEFAULT 'material',
  unit             VARCHAR(20),
  "nomenclatureId" UUID REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "categoryId"     UUID REFERENCES warehouse_categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "roomId"         UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  note             TEXT,
  "mappedBy"       UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_osv_mappings_kind_chk CHECK (kind IN ('material', 'asset', 'ignore')),
  -- Ровно одно из двух: либо строка, либо ветка. Запись с обоими полями сразу
  -- означала бы два разных правила в одной строке, и какое из них применилось
  -- бы, зависело от порядка выборки.
  CONSTRAINT warehouse_osv_mappings_target_chk CHECK (
    ("lineKey" IS NOT NULL AND "pathPrefix" IS NULL)
    OR ("lineKey" IS NULL AND "pathPrefix" IS NOT NULL)
  )
);

COMMENT ON TABLE warehouse_osv_mappings IS 'Строка/ветка ведомости 1С → объекты портала; переживает импорты';

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_osv_mappings_line_uniq
  ON warehouse_osv_mappings (account, "lineKey") WHERE "lineKey" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_osv_mappings_path_uniq
  ON warehouse_osv_mappings (account, "pathPrefix") WHERE "pathPrefix" IS NOT NULL;

COMMIT;
