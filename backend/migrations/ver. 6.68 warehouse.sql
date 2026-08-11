-- ver. 6.68 — складской учёт: локации, основные средства, материалы, движения,
-- ТО, инвентаризация, котировки, планы помещений.
--
-- Модуль ставится без интеграции с 1С: обмена нет, данные заводятся вручную и
-- сидом (scripts/seedWarehouse.js). Поля, которыми владеет бухгалтерия (ОКОФ,
-- СПИ, начисленная амортизация), в схеме есть, но портал их НЕ рассчитывает —
-- он их хранит и раскладывает по локациям. Считать амортизацию у себя означает
-- однажды разойтись с 1С, а сверка «расхождение 0,00 ₽» это молча скроет.
--
-- Все таблицы с префиксом warehouse_: модуль большой (26 таблиц против 109 во
-- всей остальной базе), и без префикса реестр таблиц перестал бы читаться.
--
-- Миграция аддитивна и идемпотентна: ничего существующего не меняет, кроме
-- одной строки — добавляет ключ warehouse в users.adminAccess. Повторный запуск
-- безопасен.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. СПРАВОЧНИК СПЕЦИАЛЬНОСТЕЙ
-- ─────────────────────────────────────────────────────────────────────────────
-- Нужен маске инвентарного номера (МЦ-2025-ХИРУРГ-00341). Код в номере, а не
-- id: номер печатается на этикетке и читается человеком.
CREATE TABLE IF NOT EXISTS warehouse_specialties (
  code        VARCHAR(20) PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE warehouse_specialties IS 'Коды специальностей для маски инвентарного номера, Приложение А ТЗ';

INSERT INTO warehouse_specialties (code, name, "sortOrder") VALUES
  ('ХИРУРГ',  'Хирургия',                        10),
  ('ТЕРАП',   'Терапия',                         20),
  ('ПЕДИАТ',  'Педиатрия',                       30),
  ('СТОМАТ',  'Стоматология',                    40),
  ('ЛУЧДИАГ', 'Лучевая диагностика',             50),
  ('РЕАНИМ',  'Реанимация и интенсивная терапия',60),
  ('ЭНДОСК',  'Эндоскопия',                      70),
  ('ЛАБОР',   'Лаборатория',                     80),
  ('ФИЗИО',   'Физиотерапия',                    90),
  ('ГИНЕК',   'Гинекология',                    100),
  ('ОФТАЛЬМ', 'Офтальмология',                  110),
  ('ЛОР',     'Оториноларингология',            120),
  ('КАРДИО',  'Кардиология',                    130),
  ('АХО',     'Административно-хозяйственный',  140),
  ('IT',      'Информационные технологии',       150)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ИЕРАРХИЯ ЛОКАЦИЙ: КОРПУС → ЭТАЖ → КАБИНЕТ → МЕСТО ХРАНЕНИЯ
-- ─────────────────────────────────────────────────────────────────────────────
-- Корень иерархии — не корпус, а медцентр из справочника ver. 6.67. Иначе
-- получился бы второй, независимый список клиник — ровно та ошибка, которую
-- 6.67 и разбирала.
CREATE TABLE IF NOT EXISTS warehouse_buildings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "medCenterId"  UUID NOT NULL REFERENCES med_centers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name           VARCHAR(150) NOT NULL,
  code           VARCHAR(30),
  address        VARCHAR(500),
  "sortOrder"    INTEGER NOT NULL DEFAULT 100,
  "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_buildings_med_center_idx ON warehouse_buildings ("medCenterId");

-- Этаж несёт систему координат плана. Ширина и высота — в метрах: план рисуется
-- в реальных размерах, иначе площадь кабинета и масштаб этажей разъезжаются.
-- SVG-координаты считаются из них на клиенте.
CREATE TABLE IF NOT EXISTS warehouse_floors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "buildingId"   UUID NOT NULL REFERENCES warehouse_buildings(id) ON UPDATE CASCADE ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  name           VARCHAR(120),
  "planWidthM"   NUMERIC(7,2) NOT NULL DEFAULT 40,
  "planHeightM"  NUMERIC(7,2) NOT NULL DEFAULT 25,
  "planBgUrl"    VARCHAR(500),
  "planBgOpacity" NUMERIC(3,2) NOT NULL DEFAULT 0.35,
  "sortOrder"    INTEGER NOT NULL DEFAULT 100,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_floors_building_idx ON warehouse_floors ("buildingId");
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_floors_building_number_key ON warehouse_floors ("buildingId", number);

COMMENT ON COLUMN warehouse_floors."planWidthM" IS 'Габарит плана в метрах. Кабинеты рисуются в тех же единицах, отсюда берётся площадь';
COMMENT ON COLUMN warehouse_floors."planBgUrl" IS 'Подложка: скан или фото поэтажного плана БТИ, по которому обводят кабинеты';

-- Отделение — не уровень вложенности, а разрез: одно отделение занимает кабинеты
-- на разных этажах, а АХО и IT вообще не привязаны к этажу. Поэтому кабинет
-- ссылается и на этаж (где физически), и на отделение (кому принадлежит).
CREATE TABLE IF NOT EXISTS warehouse_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "medCenterId"   UUID NOT NULL REFERENCES med_centers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  "specialtyCode" VARCHAR(20) REFERENCES warehouse_specialties(code) ON UPDATE CASCADE ON DELETE SET NULL,
  kind            VARCHAR(20) NOT NULL DEFAULT 'specialty',
  "divisionId"    UUID REFERENCES structural_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "headUserId"    UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  color           VARCHAR(20),
  "sortOrder"     INTEGER NOT NULL DEFAULT 100,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_departments_med_center_idx ON warehouse_departments ("medCenterId");

COMMENT ON COLUMN warehouse_departments.kind IS 'specialty — клиническое отделение; division — служебное подразделение (АХО, IT, лаборанты)';
COMMENT ON COLUMN warehouse_departments."divisionId" IS 'Связь со структурными подразделениями зарплатного модуля, если отделение совпадает с уже заведённым там';
COMMENT ON COLUMN warehouse_departments."headUserId" IS 'Зав. отделением. От него зависит row-level доступ к отчётам «в рамках своего отделения»';

-- Кабинет — центральная сущность модуля: к нему привязаны активы, остатки,
-- дашборд, тепловая карта и QR на двери.
CREATE TABLE IF NOT EXISTS warehouse_rooms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "floorId"           UUID NOT NULL REFERENCES warehouse_floors(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "departmentId"      UUID REFERENCES warehouse_departments(id) ON UPDATE CASCADE ON DELETE SET NULL,
  number              VARCHAR(30) NOT NULL,
  name                VARCHAR(200),
  kind                VARCHAR(40) NOT NULL DEFAULT 'office',
  "responsibleUserId" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "misRoomAliases"    TEXT[] NOT NULL DEFAULT '{}',
  "capacityHours"     NUMERIC(5,2) NOT NULL DEFAULT 8,
  "workingDays"       SMALLINT NOT NULL DEFAULT 5,
  plan                JSONB NOT NULL DEFAULT '{}',
  "publicToken"       VARCHAR(40),
  "isActive"          BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_rooms_floor_idx      ON warehouse_rooms ("floorId");
CREATE INDEX IF NOT EXISTS warehouse_rooms_department_idx  ON warehouse_rooms ("departmentId");
CREATE INDEX IF NOT EXISTS warehouse_rooms_mis_aliases_idx ON warehouse_rooms USING GIN ("misRoomAliases");
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_rooms_public_token_key ON warehouse_rooms ("publicToken") WHERE "publicToken" IS NOT NULL;

COMMENT ON COLUMN warehouse_rooms."misRoomAliases" IS
  'Как этот кабинет называется в mis_appointments.room. МИС хранит кабинет строкой («Каб. 312», «312 операционная»), '
  'и без сопоставления ни тепловая карта, ни расход на одно посещение не собираются. Тот же приём, что importAliases в ver. 6.67';
COMMENT ON COLUMN warehouse_rooms."capacityHours" IS 'daily_capacity_hours из методики тепловой карты: сколько часов в сутки кабинет в принципе доступен';
COMMENT ON COLUMN warehouse_rooms.plan IS
  'Геометрия на плане этажа: {"points":[[x,y],…] в метрах, "label":{"x":…,"y":…}}. '
  'Хранится как полигон, а не картинка: по полигону считается площадь, ищется клик и красится тепловая карта';
COMMENT ON COLUMN warehouse_rooms.kind IS 'office | operating | dressing | procedure | lab | storage | fridge_room | tech | reception';

-- Прочая геометрия этажа: стены, коридоры, двери, лестницы, подписи. Отдельно от
-- кабинетов, потому что это оформление плана и на учёт не влияет — иначе пришлось
-- бы заводить «кабинет-коридор» с инвентарём.
CREATE TABLE IF NOT EXISTS warehouse_floor_shapes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "floorId"   UUID NOT NULL REFERENCES warehouse_floors(id) ON UPDATE CASCADE ON DELETE CASCADE,
  kind        VARCHAR(20) NOT NULL DEFAULT 'wall',
  geometry    JSONB NOT NULL DEFAULT '{}',
  label       VARCHAR(200),
  style       JSONB NOT NULL DEFAULT '{}',
  z           INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_floor_shapes_floor_idx ON warehouse_floor_shapes ("floorId");
COMMENT ON COLUMN warehouse_floor_shapes.kind IS 'wall | corridor | door | stairs | elevator | text | area';

-- Место хранения — шкаф, полка, холодильник. Уровень, на котором реально лежат
-- материалы: остаток «в кабинете 312» бесполезен, когда искать надо в шкафу А.
CREATE TABLE IF NOT EXISTS warehouse_storages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomId"    UUID NOT NULL REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  kind        VARCHAR(30) NOT NULL DEFAULT 'cabinet',
  "tempMinC"  NUMERIC(4,1),
  "tempMaxC"  NUMERIC(4,1),
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_storages_room_idx ON warehouse_storages ("roomId");
COMMENT ON COLUMN warehouse_storages.kind IS 'cabinet | shelf | fridge | rack | drawer | safe | floor';
COMMENT ON COLUMN warehouse_storages."tempMinC" IS 'Температурный режим для холодильников: часть препаратов и реагентов вне режима подлежит списанию';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. КОНТРАГЕНТЫ (поставщики и сервисные подрядчики)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_contractors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(255) NOT NULL,
  kind                 VARCHAR(20) NOT NULL DEFAULT 'supplier',
  inn                  VARCHAR(12),
  phone                VARCHAR(50),
  email                VARCHAR(255),
  "contactPerson"      VARCHAR(255),
  rating               NUMERIC(3,2),
  "deliveryFailures"   INTEGER NOT NULL DEFAULT 0,
  "accreditationUntil" DATE,
  "paymentTerms"       VARCHAR(120),
  "avgDeliveryDays"    NUMERIC(4,1),
  comment              TEXT,
  "isActive"           BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN warehouse_contractors.kind IS 'supplier — поставщик; service — сервисный подрядчик по ТО; both';
COMMENT ON COLUMN warehouse_contractors."deliveryFailures" IS 'Срывов поставок за год — входит в оценку в сравнении котировок';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. НОМЕНКЛАТУРА И КАТЕГОРИИ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_categories (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(200) NOT NULL,
  "parentId"             UUID REFERENCES warehouse_categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
  kind                   VARCHAR(10) NOT NULL DEFAULT 'material',
  okof                   VARCHAR(20),
  "depreciationGroup"    SMALLINT,
  "defaultUsefulMonths"  INTEGER,
  "sortOrder"            INTEGER NOT NULL DEFAULT 100,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_categories_parent_idx ON warehouse_categories ("parentId");
COMMENT ON COLUMN warehouse_categories.kind IS 'fixed — основные средства (счёт 01); material — материалы (счёт 10)';
COMMENT ON COLUMN warehouse_categories.okof IS 'Код ОКОФ. Владелец поля — 1С, портал его только хранит и показывает';

CREATE TABLE IF NOT EXISTS warehouse_nomenclature (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(50) NOT NULL,
  name           VARCHAR(500) NOT NULL,
  "categoryId"   UUID REFERENCES warehouse_categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
  unit           VARCHAR(20) NOT NULL DEFAULT 'шт',
  "packUnit"     VARCHAR(20),
  "packSize"     NUMERIC(10,3),
  "isMedicine"   BOOLEAN NOT NULL DEFAULT FALSE,
  "isSterile"    BOOLEAN NOT NULL DEFAULT FALSE,
  "tracksBatch"  BOOLEAN NOT NULL DEFAULT TRUE,
  "vatPercent"   SMALLINT NOT NULL DEFAULT 20,
  "lastPrice"    NUMERIC(12,2),
  "defaultSupplierId" UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "storageTempMinC" NUMERIC(4,1),
  "storageTempMaxC" NUMERIC(4,1),
  "oneCRef"      VARCHAR(60),
  "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_nomenclature_code_key ON warehouse_nomenclature (code);
CREATE INDEX IF NOT EXISTS warehouse_nomenclature_category_idx ON warehouse_nomenclature ("categoryId");
CREATE INDEX IF NOT EXISTS warehouse_nomenclature_name_trgm ON warehouse_nomenclature USING GIN (name gin_trgm_ops);

COMMENT ON COLUMN warehouse_nomenclature."tracksBatch" IS 'Ведётся ли партионный учёт. У расходников со сроком годности — да, у канцелярии — нет';
COMMENT ON COLUMN warehouse_nomenclature."oneCRef" IS
  'GUID объекта в 1С. Заполнится, когда появится обмен. Заводится сразу, потому что '
  'сопоставление по названию — гарантированное расхождение (см. историю med_centers в ver. 6.67)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ОСНОВНЫЕ СРЕДСТВА (ОБОРУДОВАНИЕ)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_assets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "inventoryNumber"   VARCHAR(60) NOT NULL,
  name                VARCHAR(300) NOT NULL,
  model               VARCHAR(200),
  "serialNumber"      VARCHAR(120),
  manufacturer        VARCHAR(200),
  "categoryId"        UUID REFERENCES warehouse_categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "roomId"            UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "storageId"         UUID REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "responsibleUserId" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'in_use',
  "purchaseDate"      DATE,
  "commissioningDate" DATE,
  "initialCost"       NUMERIC(14,2) NOT NULL DEFAULT 0,
  "usefulLifeMonths"  INTEGER,
  "depreciationGroup" SMALLINT,
  "depreciationMethod" VARCHAR(20) NOT NULL DEFAULT 'linear',
  okof                VARCHAR(20),
  "accumulatedDepreciation" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "depreciationAsOf"  DATE,
  "fundingSource"     VARCHAR(60),
  "warrantyUntil"     DATE,
  "supplierId"        UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "maintenanceIntervalMonths" INTEGER,
  "nextMaintenanceDate" DATE,
  "dailyCapacityHours" NUMERIC(5,2) NOT NULL DEFAULT 8,
  "lastActivityAt"    TIMESTAMPTZ,
  "publicToken"       VARCHAR(40) NOT NULL,
  "labelPrintedAt"    TIMESTAMPTZ,
  notes               TEXT,
  "oneCRef"           VARCHAR(60),
  "isArchived"        BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy"         UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_assets_status_chk CHECK (status IN ('in_use','maintenance','repair','storage','written_off','reserved'))
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_assets_inventory_number_key ON warehouse_assets ("inventoryNumber");
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_assets_public_token_key    ON warehouse_assets ("publicToken");
CREATE INDEX IF NOT EXISTS warehouse_assets_room_idx        ON warehouse_assets ("roomId");
CREATE INDEX IF NOT EXISTS warehouse_assets_status_idx      ON warehouse_assets (status);
CREATE INDEX IF NOT EXISTS warehouse_assets_next_maint_idx  ON warehouse_assets ("nextMaintenanceDate") WHERE "isArchived" = FALSE;
CREATE INDEX IF NOT EXISTS warehouse_assets_responsible_idx ON warehouse_assets ("responsibleUserId");
CREATE INDEX IF NOT EXISTS warehouse_assets_name_trgm       ON warehouse_assets USING GIN (name gin_trgm_ops);

COMMENT ON COLUMN warehouse_assets."publicToken" IS
  'Случайный токен для публичной карточки по QR. Отдельно от id: id уходит в служебные ссылки и логи, '
  'а этот токен напечатан на этикетке и живёт вечно — светить им внутренний идентификатор незачем';
COMMENT ON COLUMN warehouse_assets."accumulatedDepreciation" IS
  'Накопленная амортизация ИЗ 1С. Портал её не начисляет — при обмене поле перезапишется, до обмена вносится руками';
COMMENT ON COLUMN warehouse_assets."lastActivityAt" IS 'Последняя операция с активом. Из неё считается признак простоя (idle ≥ 14 дней) для тепловой карты';
COMMENT ON COLUMN warehouse_assets."dailyCapacityHours" IS 'Сколько часов в сутки актив может работать. Знаменатель available_hours в методике загрузки';

-- Документы и фото по активу — по образцу vehicle_files/accreditation_files.
CREATE TABLE IF NOT EXISTS warehouse_asset_files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assetId"      UUID NOT NULL REFERENCES warehouse_assets(id) ON UPDATE CASCADE ON DELETE CASCADE,
  kind           VARCHAR(30) NOT NULL DEFAULT 'other',
  "originalName" VARCHAR(300) NOT NULL,
  "storedName"   VARCHAR(300) NOT NULL,
  "mimeType"     VARCHAR(120),
  size           INTEGER,
  "isPublic"     BOOLEAN NOT NULL DEFAULT FALSE,
  "uploadedBy"   UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_asset_files_asset_idx ON warehouse_asset_files ("assetId");
COMMENT ON COLUMN warehouse_asset_files.kind IS 'passport | warranty | certificate | photo | act | manual | other';
COMMENT ON COLUMN warehouse_asset_files."isPublic" IS 'Показывать ли файл на публичной карточке по QR. По умолчанию нет: там же лежат договоры с ценами';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ПАРТИИ И ОСТАТКИ МАТЕРИАЛОВ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nomenclatureId"  UUID NOT NULL REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "batchNumber"     VARCHAR(80) NOT NULL,
  "expiryDate"      DATE,
  "productionDate"  DATE,
  "supplierId"      UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "unitCost"        NUMERIC(12,2) NOT NULL DEFAULT 0,
  "receivedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "certificateNumber" VARCHAR(120),
  "isBlocked"       BOOLEAN NOT NULL DEFAULT FALSE,
  "blockReason"     VARCHAR(255),
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_batches_nom_number_key ON warehouse_batches ("nomenclatureId", "batchNumber");
CREATE INDEX IF NOT EXISTS warehouse_batches_expiry_idx ON warehouse_batches ("expiryDate");
COMMENT ON COLUMN warehouse_batches."isBlocked" IS
  'Партия запрещена к выдаче. Ставится вручную (отзыв производителем) и автоматически при истечении срока — '
  'сканирование в мобилке такую партию не пропускает';

-- Остаток = (номенклатура, партия, место хранения). Отдельной таблицей, а не
-- суммой движений: остаток читают на каждом экране, а движений за год десятки
-- тысяч. Пересчёт из движений возможен и служит контрольной сверкой.
CREATE TABLE IF NOT EXISTS warehouse_stock (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nomenclatureId" UUID NOT NULL REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "batchId"        UUID REFERENCES warehouse_batches(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "storageId"      UUID NOT NULL REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  quantity         NUMERIC(14,3) NOT NULL DEFAULT 0,
  "unitCost"       NUMERIC(12,2) NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_stock_qty_nonneg CHECK (quantity >= 0)
);
-- Партия может быть NULL (непартионный учёт), а NULL в UNIQUE не сравнивается —
-- отсюда два частичных индекса вместо одного составного.
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_stock_key_batch
  ON warehouse_stock ("nomenclatureId", "batchId", "storageId") WHERE "batchId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_stock_key_nobatch
  ON warehouse_stock ("nomenclatureId", "storageId") WHERE "batchId" IS NULL;
CREATE INDEX IF NOT EXISTS warehouse_stock_storage_idx ON warehouse_stock ("storageId");

-- Минимальные остатки. Уровень задаётся либо на место хранения, либо на кабинет,
-- либо глобально на номенклатуру — отсюда обе ссылки nullable.
CREATE TABLE IF NOT EXISTS warehouse_reorder_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nomenclatureId" UUID NOT NULL REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "roomId"         UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "storageId"      UUID REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "minQty"         NUMERIC(14,3) NOT NULL DEFAULT 0,
  "maxQty"         NUMERIC(14,3),
  "autoRfq"        BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_reorder_nom_idx  ON warehouse_reorder_rules ("nomenclatureId");
CREATE INDEX IF NOT EXISTS warehouse_reorder_room_idx ON warehouse_reorder_rules ("roomId");
COMMENT ON COLUMN warehouse_reorder_rules."autoRfq" IS 'Создавать запрос котировок автоматически при пробитии минимума';

-- Нормы расхода. «На одно посещение» — то, с чем сравнивается факт в отчёте № 3.
CREATE TABLE IF NOT EXISTS warehouse_consumption_norms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nomenclatureId" UUID NOT NULL REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "departmentId"   UUID REFERENCES warehouse_departments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "roomId"         UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  basis            VARCHAR(20) NOT NULL DEFAULT 'per_visit',
  "normValue"      NUMERIC(12,4) NOT NULL,
  comment          TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_norms_nom_idx ON warehouse_consumption_norms ("nomenclatureId");
COMMENT ON COLUMN warehouse_consumption_norms.basis IS 'per_visit | per_procedure | absolute_month';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ДОКУМЕНТЫ И ДВИЖЕНИЯ
-- ─────────────────────────────────────────────────────────────────────────────
-- Нумераторы вынесены в таблицы, а не считаются как max(number)+1: при двух
-- одновременных сохранениях max даёт один и тот же номер.
CREATE TABLE IF NOT EXISTS warehouse_doc_counters (
  prefix       VARCHAR(10) NOT NULL,
  year         INTEGER     NOT NULL,
  "lastValue"  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

CREATE TABLE IF NOT EXISTS warehouse_inventory_counters (
  prefix          VARCHAR(10) NOT NULL,
  year            INTEGER     NOT NULL,
  "specialtyCode" VARCHAR(20) NOT NULL,
  "lastValue"     INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year, "specialtyCode")
);
COMMENT ON TABLE warehouse_inventory_counters IS
  'Счётчик инвентарных номеров, независимый для каждой тройки (префикс, год, специальность). '
  'Приложение А ТЗ. Номер не переиспользуется даже после списания';

CREATE TABLE IF NOT EXISTS warehouse_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        VARCHAR(40) NOT NULL,
  type          VARCHAR(20) NOT NULL,
  date          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        VARCHAR(20) NOT NULL DEFAULT 'draft',
  "fromRoomId"  UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "toRoomId"    UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "contractorId" UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "reasonCode"  VARCHAR(30),
  "reasonText"  VARCHAR(500),
  comment       TEXT,
  "createdBy"   UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "signedBy"    UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "signedAt"    TIMESTAMPTZ,
  "signatureNote" VARCHAR(255),
  device        VARCHAR(255),
  "oneCStatus"  VARCHAR(20) NOT NULL DEFAULT 'disabled',
  "oneCError"   TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_documents_type_chk CHECK (type IN ('receipt','issue','transfer','repair_out','repair_in','writeoff','inventory','surplus')),
  CONSTRAINT warehouse_documents_status_chk CHECK (status IN ('draft','signed','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_documents_number_key ON warehouse_documents (number);
CREATE INDEX IF NOT EXISTS warehouse_documents_date_idx ON warehouse_documents (date);
CREATE INDEX IF NOT EXISTS warehouse_documents_type_idx ON warehouse_documents (type);

COMMENT ON COLUMN warehouse_documents."oneCStatus" IS
  'disabled — обмена с 1С нет (текущее состояние макета); pending | synced | error — когда обмен появится. '
  'Значение по умолчанию именно disabled, чтобы отчёт сверки не показывал десятки «не синхронизировано» на пустом месте';
COMMENT ON COLUMN warehouse_documents."signedBy" IS
  'Простая подпись: подтверждение в системе + запись в журнал. Не КЭП — для КЭП нужен криптопровайдер, '
  'это отдельная задача и отдельные деньги';
COMMENT ON COLUMN warehouse_documents.device IS 'С какого устройства оформлено — колонка 13 отчёта № 2, нужна при разборе недостач';

-- Движение — строка документа. Одна таблица и для ОС, и для материалов: у них
-- общий аудиторский след, и отчёт № 2 читает их вместе.
CREATE TABLE IF NOT EXISTS warehouse_movements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "documentId"        UUID REFERENCES warehouse_documents(id) ON UPDATE CASCADE ON DELETE CASCADE,
  type                VARCHAR(20) NOT NULL,
  "assetId"           UUID REFERENCES warehouse_assets(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "nomenclatureId"    UUID REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "batchId"           UUID REFERENCES warehouse_batches(id) ON UPDATE CASCADE ON DELETE SET NULL,
  quantity            NUMERIC(14,3) NOT NULL DEFAULT 1,
  "unitCost"          NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  "fromStorageId"     UUID REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "toStorageId"       UUID REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "fromRoomId"        UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "toRoomId"          UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "fromResponsibleId" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "toResponsibleId"   UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "doctorUserId"      UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "doctorMisId"       INTEGER,
  "serviceCode"       VARCHAR(100),
  "reasonCode"        VARCHAR(30),
  "reasonText"        VARCHAR(500),
  "initiatorUserId"   UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "occurredAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_movements_type_chk CHECK (type IN ('receipt','issue','transfer','repair_out','repair_in','writeoff','inventory','surplus')),
  CONSTRAINT warehouse_movements_object_chk CHECK ("assetId" IS NOT NULL OR "nomenclatureId" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS warehouse_movements_doc_idx      ON warehouse_movements ("documentId");
CREATE INDEX IF NOT EXISTS warehouse_movements_asset_idx    ON warehouse_movements ("assetId");
CREATE INDEX IF NOT EXISTS warehouse_movements_nom_idx      ON warehouse_movements ("nomenclatureId");
CREATE INDEX IF NOT EXISTS warehouse_movements_occurred_idx ON warehouse_movements ("occurredAt");
CREATE INDEX IF NOT EXISTS warehouse_movements_from_room_idx ON warehouse_movements ("fromRoomId");
CREATE INDEX IF NOT EXISTS warehouse_movements_to_room_idx   ON warehouse_movements ("toRoomId");
CREATE INDEX IF NOT EXISTS warehouse_movements_doctor_idx    ON warehouse_movements ("doctorUserId");

COMMENT ON COLUMN warehouse_movements."doctorUserId" IS
  'Врач, под которого выдан расходник. Без него режим «расход по врачам» отчёта № 3 не строится. '
  'Заполняется при выдаче — и это главное требование к дисциплине персонала во всём модуле';
COMMENT ON COLUMN warehouse_movements."serviceCode" IS 'Код услуги МИС — мост к service_consumables (ver. 6.52) и к нормированию';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ТО И РЕМОНТЫ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_maintenance_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number          VARCHAR(40) NOT NULL,
  "assetId"       UUID NOT NULL REFERENCES warehouse_assets(id) ON UPDATE CASCADE ON DELETE CASCADE,
  type            VARCHAR(20) NOT NULL DEFAULT 'maintenance',
  "plannedDate"   DATE NOT NULL,
  "factDate"      DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'planned',
  result          VARCHAR(30),
  "resultNote"    TEXT,
  cost            NUMERIC(12,2) NOT NULL DEFAULT 0,
  "contractorId"  UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "isMandatory"   BOOLEAN NOT NULL DEFAULT FALSE,
  "downtimeHours" NUMERIC(7,2) NOT NULL DEFAULT 0,
  "engineerUserId" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  reminders       JSONB NOT NULL DEFAULT '{}',
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_maint_type_chk   CHECK (type IN ('maintenance','verification','calibration','dosimetry','inspection')),
  CONSTRAINT warehouse_maint_status_chk CHECK (status IN ('planned','in_progress','done','overdue','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_maint_number_key ON warehouse_maintenance_orders (number);
CREATE INDEX IF NOT EXISTS warehouse_maint_asset_idx   ON warehouse_maintenance_orders ("assetId");
CREATE INDEX IF NOT EXISTS warehouse_maint_planned_idx ON warehouse_maintenance_orders ("plannedDate");
CREATE INDEX IF NOT EXISTS warehouse_maint_status_idx  ON warehouse_maintenance_orders (status);

COMMENT ON COLUMN warehouse_maintenance_orders.reminders IS
  'Какие напоминания уже отправлены: {"7":"2026-08-04T09:00:00Z","3":"2026-08-08T09:00:00Z"}. '
  'JSONB, а не колонки reminded7/reminded3: наборов reminded* в базе уже два (аккредитации, транспорт), '
  'третий набор колонок под каждый горизонт — это тупик, менять горизонты потом придётся миграцией';
COMMENT ON COLUMN warehouse_maintenance_orders."isMandatory" IS 'Обязательное по НПА (поверка, дозиметрия) — предмет проверки Росздравнадзора, отдельный фильтр в отчёте № 6';
COMMENT ON COLUMN warehouse_maintenance_orders.result IS 'normal | with_remarks | failed — результат по факту выполнения';

CREATE TABLE IF NOT EXISTS warehouse_repairs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number          VARCHAR(40) NOT NULL,
  "assetId"       UUID NOT NULL REFERENCES warehouse_assets(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "startedAt"     DATE NOT NULL,
  "finishedAt"    DATE,
  description     TEXT,
  "contractorId"  UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  cost            NUMERIC(12,2) NOT NULL DEFAULT 0,
  result          VARCHAR(30),
  "downtimeHours" NUMERIC(7,2) NOT NULL DEFAULT 0,
  "createdBy"     UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_repairs_number_key ON warehouse_repairs (number);
CREATE INDEX IF NOT EXISTS warehouse_repairs_asset_idx ON warehouse_repairs ("assetId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ИНВЕНТАРИЗАЦИЯ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_inventory_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number              VARCHAR(40) NOT NULL,
  scope               VARCHAR(20) NOT NULL DEFAULT 'room',
  "roomId"            UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "departmentId"      UUID REFERENCES warehouse_departments(id) ON UPDATE CASCADE ON DELETE SET NULL,
  basis               VARCHAR(255),
  "periodFrom"        DATE,
  "periodTo"          DATE,
  status              VARCHAR(20) NOT NULL DEFAULT 'open',
  "chairmanUserId"    UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  members             JSONB NOT NULL DEFAULT '[]',
  "responsibleUserId" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "startedAt"         TIMESTAMPTZ,
  "finishedAt"        TIMESTAMPTZ,
  "durationMinutes"   INTEGER,
  "createdBy"         UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_inv_status_chk CHECK (status IN ('open','counting','closed','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_inv_sessions_number_key ON warehouse_inventory_sessions (number);
COMMENT ON COLUMN warehouse_inventory_sessions.members IS 'Члены комиссии: [{"userId":…,"name":"…","signedAt":"…"}]. Массивом, потому что состав разный от описи к описи';

CREATE TABLE IF NOT EXISTS warehouse_inventory_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"      UUID NOT NULL REFERENCES warehouse_inventory_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "assetId"        UUID REFERENCES warehouse_assets(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "nomenclatureId" UUID REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "batchId"        UUID REFERENCES warehouse_batches(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "storageId"      UUID REFERENCES warehouse_storages(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "expectedQty"    NUMERIC(14,3) NOT NULL DEFAULT 0,
  "actualQty"      NUMERIC(14,3),
  "scanMethod"     VARCHAR(10),
  "scannedAt"      TIMESTAMPTZ,
  "scannedBy"      UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  note             VARCHAR(500),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_inv_items_session_idx ON warehouse_inventory_items ("sessionId");
COMMENT ON COLUMN warehouse_inventory_items."scanMethod" IS 'qr | manual. Доля ручного ввода — метрика качества маркировки в отчёте № 9';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ЗАПРОСЫ КОТИРОВОК
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_rfq (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        VARCHAR(40) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open',
  reason        VARCHAR(500),
  "roomId"      UUID REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "dueAt"       TIMESTAMPTZ,
  "createdBy"   UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "autoCreated" BOOLEAN NOT NULL DEFAULT FALSE,
  "decidedContractorId" UUID REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "decidedAt"   TIMESTAMPTZ,
  "decisionNote" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_rfq_status_chk CHECK (status IN ('open','collecting','decided','ordered','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_rfq_number_key ON warehouse_rfq (number);

CREATE TABLE IF NOT EXISTS warehouse_rfq_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfqId"          UUID NOT NULL REFERENCES warehouse_rfq(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "nomenclatureId" UUID NOT NULL REFERENCES warehouse_nomenclature(id) ON UPDATE CASCADE ON DELETE CASCADE,
  quantity         NUMERIC(14,3) NOT NULL DEFAULT 1,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_rfq_items_rfq_idx ON warehouse_rfq_items ("rfqId");

CREATE TABLE IF NOT EXISTS warehouse_rfq_quotes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfqId"        UUID NOT NULL REFERENCES warehouse_rfq(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "contractorId" UUID NOT NULL REFERENCES warehouse_contractors(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "deliveryDays" INTEGER,
  "paymentTerms" VARCHAR(120),
  prices         JSONB NOT NULL DEFAULT '{}',
  "respondedAt"  TIMESTAMPTZ,
  comment        TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_rfq_quotes_key ON warehouse_rfq_quotes ("rfqId", "contractorId");
COMMENT ON COLUMN warehouse_rfq_quotes.prices IS 'Цена за единицу по позициям: {"<rfq_item_id>": 412.00}. JSONB, потому что позиций мало, а отдельная таблица на два поля не оправдана';

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. ЗАГРУЗКА КАБИНЕТОВ (ночной расчёт для тепловой карты)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_utilization_daily (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomId"          UUID NOT NULL REFERENCES warehouse_rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  date              DATE NOT NULL,
  "usedHours"       NUMERIC(7,2) NOT NULL DEFAULT 0,
  "availableHours"  NUMERIC(7,2) NOT NULL DEFAULT 0,
  "utilizationPct"  NUMERIC(5,2) NOT NULL DEFAULT 0,
  "appointmentsCount" INTEGER NOT NULL DEFAULT 0,
  "idleAssets"      INTEGER NOT NULL DEFAULT 0,
  "downtimeHours"   NUMERIC(7,2) NOT NULL DEFAULT 0,
  source            VARCHAR(20) NOT NULL DEFAULT 'mis_schedule',
  "computedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_utilization_key ON warehouse_utilization_daily ("roomId", date);
CREATE INDEX IF NOT EXISTS warehouse_utilization_date_idx ON warehouse_utilization_daily (date);

COMMENT ON TABLE warehouse_utilization_daily IS
  'Загрузка кабинета за сутки. Считается из mis_appointments (часы приёма по room), а НЕ из журнала выдачи: '
  'выдачу стационарного оборудования никто не отмечает, и метрика из ТЗ по этому источнику показала бы нули';
COMMENT ON COLUMN warehouse_utilization_daily.source IS 'mis_schedule — часы приёма из МИС; issue_log — журнал выдачи; mixed';

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. OUTBOX ДЛЯ 1С — СОЗДАЁТСЯ ПУСТЫМ И ВЫКЛЮЧЕННЫМ
-- ─────────────────────────────────────────────────────────────────────────────
-- Обмена с 1С нет. Таблица заводится сразу по образцу submissions (ver. 6.06):
-- данные сначала в БД, доставка потом, недоставленное добивается по ретраям.
-- Пока обмен выключен, сюда ничего не пишется — но и переделывать схему под него
-- задним числом не придётся.
CREATE TABLE IF NOT EXISTS warehouse_outbox (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventType"       VARCHAR(50) NOT NULL,
  "objectType"      VARCHAR(30) NOT NULL,
  "objectId"        UUID,
  payload           JSONB NOT NULL DEFAULT '{}',
  "idempotencyKey"  VARCHAR(100) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts          INTEGER NOT NULL DEFAULT 0,
  "lastError"       TEXT,
  "deliveredAt"     TIMESTAMPTZ,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_outbox_status_chk CHECK (status IN ('pending','sent','failed','skipped'))
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_outbox_idempotency_key ON warehouse_outbox ("idempotencyKey");
CREATE INDEX IF NOT EXISTS warehouse_outbox_status_idx ON warehouse_outbox (status) WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. ПРАВА ДОСТУПА
-- ─────────────────────────────────────────────────────────────────────────────
-- Модуль закрыт гранулярным доступом adminAccess.warehouse — тем же механизмом,
-- что «Отзывы» и «Справочник медцентров». Всем существующим пользователям ключ
-- проставляется в false: складской учёт видят только те, кому его выдали руками.
UPDATE users
SET "adminAccess" = COALESCE("adminAccess", '{}'::jsonb) || '{"warehouse": false}'::jsonb
WHERE "adminAccess" IS NULL OR NOT ("adminAccess" ? 'warehouse');

-- Роль «Склад» с правами на модуль. Заводится выключенной по составу: сотрудников
-- в неё добавляют руками, автоматически никого не переносим.
INSERT INTO roles (id, name, description, permissions, "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Склад', 'Складской учёт: оборудование, материалы, ТО, инвентаризация',
       '{"warehouse": {"read": true, "write": true, "delete": false, "admin": false}}'::jsonb,
       FALSE, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Склад');

COMMIT;
