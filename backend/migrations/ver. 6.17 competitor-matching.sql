-- ver. 6.17 — Сопоставление услуг конкурентов с нашими
--
-- Зеркало прайсов (ver. 6.16) само по себе ничего не сравнивает: «Общий анализ
-- крови» у конкурента и наша позиция в МИС — разные строки. Здесь появляется
-- слой соответствий между позицией сравнения и услугой конкурента, а также
-- признак происхождения цены в самом сравнении.

-- === Как клиника называется в сравнениях =====================================
-- В price_comparisons.competitors лежат человеческие названия («Неомед»), а в
-- зеркале — имена источников («clinic23-krd»). Без явной связи непонятно,
-- в какую колонку сравнения класть цену.
ALTER TABLE competitor_sources ADD COLUMN IF NOT EXISTS "competitorLabel" VARCHAR(255);

CREATE INDEX IF NOT EXISTS competitor_sources_label_idx ON competitor_sources ("competitorLabel");

-- === Поиск по названию =======================================================
-- Кодов 804н хватает только на лабораторные услуги; по стоматологии и приёмам
-- их нет вовсе, и там сопоставлять приходится по названию. Триграммы
-- справляются с русской морфологией без словаря: «приём стоматолога» и
-- «прием врача-стоматолога» имеют общие триграммы, хотя ни одно слово
-- не совпадает целиком.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE competitor_services ADD COLUMN IF NOT EXISTS "nameNormalized" TEXT;

-- Нормализация повторена в JS (services/competitorMatching.js, normalizeName).
-- Если менять — менять в обоих местах, иначе поиск начнёт промахиваться
-- на ровном месте.
UPDATE competitor_services
   SET "nameNormalized" = trim(regexp_replace(
         regexp_replace(translate(lower(name), 'ё', 'е'), '[^a-zа-я0-9]+', ' ', 'g'),
         '\s+', ' ', 'g'))
 WHERE "nameNormalized" IS NULL;

CREATE INDEX IF NOT EXISTS competitor_services_name_trgm
  ON competitor_services USING gin ("nameNormalized" gin_trgm_ops);

-- === Соответствия ============================================================
-- Связь именно с позицией сравнения, а не с нашим каталогом целиком: сравнения
-- собираются под задачу, и в разных сравнениях одна услуга может значить разное.
CREATE TABLE IF NOT EXISTS competitor_service_matches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "itemId"              UUID         NOT NULL REFERENCES price_comparison_items(id) ON DELETE CASCADE,
  "competitorServiceId" UUID         NOT NULL REFERENCES competitor_services(id)    ON DELETE CASCADE,
  -- suggested — подобрано автоматом и ждёт человека; confirmed — принято;
  -- rejected — человек отказал, и повторно предлагать это не нужно
  status                VARCHAR(16)  NOT NULL DEFAULT 'suggested',
  -- code804 | name | manual — чем подобрано. Видно, чему верить: код точен,
  -- название лишь похоже
  method                VARCHAR(16)  NOT NULL DEFAULT 'name',
  score                 NUMERIC(4,3),
  "confirmedBy"         UUID,
  "confirmedAt"         TIMESTAMPTZ,
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Одна пара — одна строка: повторный автоподбор не должен плодить дубли
-- и обязан видеть прежний отказ человека
CREATE UNIQUE INDEX IF NOT EXISTS competitor_matches_pair_uq
  ON competitor_service_matches ("itemId", "competitorServiceId");
CREATE INDEX IF NOT EXISTS competitor_matches_item_idx   ON competitor_service_matches ("itemId", status);
CREATE INDEX IF NOT EXISTS competitor_matches_status_idx ON competitor_service_matches (status);

-- === Откуда взялась цена =====================================================
-- В prices цены сотрудников и цены парсера лежали бы вперемешку, и ночной
-- прогон молча затирал бы ручные правки. Здесь помечается только то, что
-- проставил парсер, — всё остальное считается введённым человеком
-- и не перезаписывается.
--
-- Формат: {"Неомед": {"source":"parser","matchId":"...","filialName":"...","syncedAt":"..."}}
ALTER TABLE price_comparison_items
  ADD COLUMN IF NOT EXISTS "priceSources" JSONB NOT NULL DEFAULT '{}'::jsonb;
