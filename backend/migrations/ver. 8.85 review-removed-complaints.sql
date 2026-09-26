-- Удалённые с площадки отзывы, жалобы и удалённый вход (ver. 8.85).
--
-- Удалённый отзыв — важный итог работы с негативом: либо пациент сам стёр
-- отзыв после урегулирования, либо площадка сняла его по нашей жалобе. До
-- этой версии карточка ничего об этом не знала и висела как ни в чём не
-- бывало. Теперь Альфа Парсер после каждого прохода по месту сообщает, какие
-- отзывы он видел, и вики отмечает карточки, которых на площадке больше нет.
--
-- Отмечаем, а не удаляем и не архивируем: карточка — это история работы с
-- отзывом, и вернётся отзыв (снова опубликован) — отметка снимается сама.
--
-- Отменить можно: колонки новые, данные не меняются.

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS "platformRemovedAt" TIMESTAMPTZ;
-- moderation — площадка явно сообщила, что сняла отзыв (ПроДокторов: reject);
-- hidden     — площадка скрыла отзыв (2ГИС: isHidden);
-- missing    — отзыва два прохода подряд нет в выдаче: удалён автором или
--              площадкой, без объяснения причины.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS "platformRemovedReason" VARCHAR(20);

COMMENT ON COLUMN reviews."platformRemovedAt" IS
  'Когда парсер перестал видеть отзыв на площадке (ver. 8.85); пусто — отзыв на месте';

CREATE INDEX IF NOT EXISTS reviews_platform_removed_idx
  ON reviews ("platformRemovedAt") WHERE "platformRemovedAt" IS NOT NULL;

-- Новые задачи парсера: жалоба на отзыв и ввод человека при удалённом входе
-- (клик по капче, текст, Enter) — СберЗдоровье и ДокТу пускают только через
-- Яндекс SmartCaptcha.
ALTER TABLE review_collector_jobs DROP CONSTRAINT IF EXISTS review_collector_jobs_kind_check;
ALTER TABLE review_collector_jobs ADD CONSTRAINT review_collector_jobs_kind_check
  CHECK (kind IN ('reply', 'check', 'complaint', 'input'));
