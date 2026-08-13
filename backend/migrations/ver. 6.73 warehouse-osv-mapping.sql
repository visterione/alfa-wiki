-- ver. 6.73 — разбор ведомости 1С: сопоставление веток и материализация.
--
-- Второй шаг импорта. Первый (ver. 6.72) складывает снимок как есть; этот
-- превращает его в объекты портала — номенклатуру, карточки оборудования и
-- остатки по кабинетам.
--
-- Ключевое здесь — тип 'auto' у сопоставления. Ветка дерева 1С («Кабинет
-- Хирурга», 431 единица) содержит вперемешку и хирургический инструмент за
-- 300 000 ₽, и салфетки по рублю. Требовать решения по каждой строке значит не
-- разобрать ведомость никогда: строк 2992. Поэтому ветка сопоставляется целиком,
-- а разделение на карточки и остатки идёт по цене за единицу: дороже порога —
-- отдельная карточка с инвентарным номером и QR, дешевле — количество на полке.
--
-- Порог по умолчанию 10 000 ₽ даёт по августовской выгрузке 3277 карточек и
-- 79 % стоимости имущества под поштучным контролем. Оставшийся хвост — 620 строк
-- дешевле 1000 ₽ — это 10 268 единиц на 1,9 млн ₽, меньше двух процентов
-- стоимости: клеить на них этикетки бессмысленно.
--
-- Обратные ссылки "osvLineKey" на номенклатуре и активах нужны для
-- идемпотентности: повторный запуск материализации обязан ничего не создать, а
-- узнать «эта карточка уже сделана из этой строки» больше не по чему — названия
-- в ведомости повторяются, а инвентарный номер портал присваивает сам.
--
-- Миграция аддитивна и идемпотентна.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. СОПОСТАВЛЕНИЯ: тип 'auto', порог, место хранения
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_osv_mappings
  DROP CONSTRAINT IF EXISTS warehouse_osv_mappings_kind_chk;

ALTER TABLE warehouse_osv_mappings
  ADD CONSTRAINT warehouse_osv_mappings_kind_chk
  CHECK (kind IN ('auto', 'material', 'asset', 'ignore'));

ALTER TABLE warehouse_osv_mappings
  ADD COLUMN IF NOT EXISTS "assetThreshold" NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS "storageId" UUID
    REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE SET NULL;

COMMENT ON COLUMN warehouse_osv_mappings.kind IS
  'auto — делить по цене за единицу; material — остаток; asset — карточка; ignore — не учитывать';
COMMENT ON COLUMN warehouse_osv_mappings."assetThreshold" IS
  'Порог цены за единицу для kind=auto; NULL — общий порог модуля (10 000 ₽)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ОБРАТНЫЕ ССЫЛКИ НА СТРОКУ ВЕДОМОСТИ
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_nomenclature
  ADD COLUMN IF NOT EXISTS "osvLineKey" VARCHAR(40);

-- Номенклатура на строку ведомости ровно одна: строка это и есть позиция 1С.
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_nomenclature_osv_uniq
  ON warehouse_nomenclature ("osvLineKey") WHERE "osvLineKey" IS NOT NULL;

ALTER TABLE warehouse_assets
  ADD COLUMN IF NOT EXISTS "osvLineKey" VARCHAR(40);

-- А карточек на строку столько, сколько единиц в ведомости: «Компьютер MSI
-- Cubi, 14 шт» — это четырнадцать инвентарных номеров. Индекс неуникальный, по
-- нему считается, сколько уже создано.
CREATE INDEX IF NOT EXISTS warehouse_assets_osv_idx
  ON warehouse_assets ("osvLineKey") WHERE "osvLineKey" IS NOT NULL;

COMMIT;
