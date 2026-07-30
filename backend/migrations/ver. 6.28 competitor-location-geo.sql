-- ver. 6.28 — Координаты точек конкурентов и ручная привязка к филиалу прайса
--
-- Для карты с ценами точке нужны две вещи, которых у неё не было: место
-- на глобусе и связь с филиалом прайса.
--
-- Координаты берутся геокодером по адресу (Nominatim) и правятся мышью:
-- часть адресов геокодер сажает мимо, а вписанные руками точки автосбор
-- всё равно не перетирает. geoOrigin отличает одно от другого, чтобы
-- повторный автопрогон не сбивал выправленное.
--
-- filialIdManual — наша поправка к parserFilialId. Парсер связывает адрес
-- с филиалом прайса далеко не всегда: из 54 точек связано 7, а у Сочи
-- и Адлера автосбор вообще взял адреса всей сети. Без связи цену к точке
-- привязать нечем, поэтому нужна возможность указать её руками. Поле
-- отдельное, а не правка parserFilialId: тот приходит из парсера и
-- перезаписывается при каждом обновлении точек.

ALTER TABLE competitor_locations ADD COLUMN IF NOT EXISTS lat             NUMERIC(9, 6);
ALTER TABLE competitor_locations ADD COLUMN IF NOT EXISTS lon             NUMERIC(9, 6);
ALTER TABLE competitor_locations ADD COLUMN IF NOT EXISTS "geoOrigin"     VARCHAR(16);
ALTER TABLE competitor_locations ADD COLUMN IF NOT EXISTS "geocodedAt"    TIMESTAMP WITH TIME ZONE;
ALTER TABLE competitor_locations ADD COLUMN IF NOT EXISTS "filialIdManual" INTEGER;

COMMENT ON COLUMN competitor_locations.lat IS 'Широта; NULL — адрес ещё не геокодирован';
COMMENT ON COLUMN competitor_locations."geoOrigin" IS 'nominatim | manual — выправленное мышью автопрогон не трогает';
COMMENT ON COLUMN competitor_locations."filialIdManual" IS 'Филиал прайса, указанный человеком; перекрывает parserFilialId';

-- Карта запрашивает точки по прямоугольнику видимой области
CREATE INDEX IF NOT EXISTS competitor_locations_geo_idx
  ON competitor_locations (lat, lon)
  WHERE lat IS NOT NULL;
