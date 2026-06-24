-- ver. 5.38: Справочник номенклатуры медицинских услуг (приказ Минздрава 804н)
-- Эталонные названия по коду 804н для проверки названий услуг в кэше.
-- Источник: актуальная редакция (xlsx 1.2.643.5.1.13.13.11.1070), nameAlt — редакция 2017 (только отличия).

CREATE TABLE IF NOT EXISTS nomenclature_804n (
  code        VARCHAR(100) PRIMARY KEY,            -- нормализованный код (кириллица→латиница, A01.01.001)
  name        VARCHAR(500) NOT NULL,               -- эталонное название (актуальная редакция)
  "nameAlt"   VARCHAR(500),                        -- название в редакции 2017 (заполнено только если отличается)
  deprecated  BOOLEAN NOT NULL DEFAULT FALSE,      -- код упразднён (Признак актуальности = 0)
  edition     VARCHAR(20) NOT NULL DEFAULT '2.10', -- версия справочника-источника
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nomenclature_804n_deprecated_idx ON nomenclature_804n (deprecated);
