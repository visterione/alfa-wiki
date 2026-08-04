-- ver. 6.52 — таблица расходников по услугам
--
-- Модель и API service_consumables уже используются приложением, но таблица
-- отсутствует в production-схеме. Миграция полностью аддитивна и идемпотентна.

CREATE TABLE IF NOT EXISTS service_consumables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "misUserId"   VARCHAR(50)  NOT NULL,
  "doctorName"  VARCHAR(255) NOT NULL DEFAULT '',
  "serviceCode" VARCHAR(100) NOT NULL,
  "serviceName" VARCHAR(500) NOT NULL DEFAULT '',
  name           VARCHAR(255) NOT NULL,
  quantity       NUMERIC(10,3) NOT NULL DEFAULT 1,
  "costPerUnit" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "createdBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_consumables_quantity_positive CHECK (quantity > 0),
  CONSTRAINT service_consumables_cost_nonnegative CHECK ("costPerUnit" >= 0)
);

-- Таблица новая и пустая, поэтому обычное создание индексов не блокирует
-- существующий трафик. Повторный запуск безопасен.
CREATE INDEX IF NOT EXISTS service_consumables_mis_user_idx
  ON service_consumables ("misUserId");
CREATE INDEX IF NOT EXISTS service_consumables_service_code_idx
  ON service_consumables ("serviceCode");
CREATE INDEX IF NOT EXISTS service_consumables_mis_user_service_idx
  ON service_consumables ("misUserId", "serviceCode");

