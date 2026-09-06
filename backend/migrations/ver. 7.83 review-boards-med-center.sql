-- Привязка досок отзывов к филиалам (ver. 7.83).
--
-- Доски заводили раньше, чем появился нормальный справочник медцентров, и
-- филиал жил только в названии доски строкой. Сравнить такое название со
-- справочником может человек, но не запрос, — поэтому средней оценки по
-- клинике в портале до сих пор не существовало.
--
-- Привязка ставится на доску, а не на отзыв, и на то две причины. Досок
-- десяток, а отзывов тысячи: править одно поле в десяти строках дешевле, чем
-- проставлять клинику каждому отзыву. И филиал у доски один на всю её жизнь —
-- это свойство доски, а не отдельного отзыва.
--
-- SET NULL при удалении филиала: доска с историей отзывов должна пережить
-- закрытие клиники, терять её из-за правки справочника нельзя.

ALTER TABLE review_boards
  ADD COLUMN IF NOT EXISTS "medCenterId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_boards_medCenterId_fkey'
  ) THEN
    ALTER TABLE review_boards
      ADD CONSTRAINT "review_boards_medCenterId_fkey"
      FOREIGN KEY ("medCenterId") REFERENCES med_centers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS review_boards_med_center_id ON review_boards ("medCenterId");

COMMENT ON COLUMN review_boards."medCenterId" IS
  'Филиал, отзывы которого собирает доска. NULL — доска не про филиал';

-- ── Разовое сопоставление по названию ────────────────────────────────────────
-- Доски названы по филиалам — так и задумывалось, в модели у поля name прямо
-- написано «Название доски (медицинский центр)». Поэтому сопоставляем тем же
-- набором, что используется при импорте прайсов: name, displayName и
-- importAliases справочника, без учёта регистра и лишних пробелов.
--
-- Что не совпало — остаётся NULL и выбирается руками в настройках доски. Это
-- сознательно: угадывать филиал по похожести названия хуже, чем оставить пусто.
UPDATE review_boards AS b SET "medCenterId" = m.id
FROM med_centers AS m
WHERE b."medCenterId" IS NULL
  AND m."isVirtual" = FALSE
  AND (
    lower(btrim(b.name)) = lower(btrim(m.name::text))
    OR lower(btrim(b.name)) = lower(btrim(COALESCE(m."displayName", '')))
    OR EXISTS (
      SELECT 1 FROM unnest(m."importAliases") AS alias
      WHERE lower(btrim(alias)) = lower(btrim(b.name))
    )
  );

-- Посмотреть, что осталось без привязки:
--   SELECT name FROM review_boards WHERE "medCenterId" IS NULL AND archived = FALSE;
