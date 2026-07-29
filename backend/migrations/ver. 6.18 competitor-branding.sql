-- ver. 6.18 — Карточка клиники-конкурента: название и логотип
--
-- В зеркале источники звались по домену («sochi.fomin-clinic.ru»), и список
-- из двух десятков поддоменов одной сети читать было невозможно. Парсер
-- теперь берёт с сайта человеческое название и значок, а мы держим их у себя:
-- логотип нужен и в админской таблице, и на странице сравнения цен, а туда
-- парсер не дотягивается.

ALTER TABLE competitor_sources ADD COLUMN IF NOT EXISTS "displayName"      VARCHAR(255);
ALTER TABLE competitor_sources ADD COLUMN IF NOT EXISTS "logoUrl"          TEXT;
-- Байтами, а не ссылкой: сайт конкурента может убрать картинку или закрыть
-- её от посторонних, а страница вики открыта у сотрудников в браузере —
-- ходить с неё на чужой сайт за логотипом не нужно и не всегда возможно.
ALTER TABLE competitor_sources ADD COLUMN IF NOT EXISTS "logoData"         BYTEA;
ALTER TABLE competitor_sources ADD COLUMN IF NOT EXISTS "logoContentType"  VARCHAR(100);
