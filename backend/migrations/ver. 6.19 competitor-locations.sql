-- ver. 6.19 — Адреса точек клиник-конкурентов
--
-- Города для сравнения мало: у clinic23 в одном Краснодаре десять отделений
-- с разными адресами, и на карте это десять меток, а не одна. Парсер собирает
-- адреса со страниц контактов, здесь мы держим их копию — карту рисует вики,
-- и ходить за адресами в парсер при каждом показе незачем.
--
-- Отдельно от филиалов намеренно: филиал в прайсе — измерение цены, а точка —
-- место на карте. У лаборатории филиалов в смысле прайса нет вовсе, а пункт
-- забора с адресом есть.

CREATE TABLE IF NOT EXISTS competitor_locations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sourceId"         UUID         NOT NULL REFERENCES competitor_sources(id) ON DELETE CASCADE,
  "parserLocationId" INTEGER      NOT NULL,                    -- id точки в парсере
  name               VARCHAR(255),                             -- 'Клиника на Сормовской'
  address            TEXT         NOT NULL,
  city               VARCHAR(150),                             -- пусто, если на сайте не указан
  -- jsonld | text | manual — по нему видно, чему верить: вписанное руками
  -- точнее вытащенного из текста
  origin             VARCHAR(16)  NOT NULL DEFAULT 'text',
  -- id филиала в парсере, если точку удалось связать с ценами
  "parserFilialId"   INTEGER,
  "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_locations_parser_uq
  ON competitor_locations ("parserLocationId");
CREATE INDEX IF NOT EXISTS competitor_locations_source_idx ON competitor_locations ("sourceId");
CREATE INDEX IF NOT EXISTS competitor_locations_city_idx   ON competitor_locations (city);
