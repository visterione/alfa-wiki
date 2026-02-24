-- ============================================================
-- Шаг 1: Мерж дублей — переносим отзывы и удаляем старые строки
-- ============================================================

-- Яндекс.Карты → Яндекс Карты
DO $$
DECLARE
  old_id UUID;
  new_id UUID;
BEGIN
  SELECT id INTO old_id FROM review_platforms WHERE name = 'Яндекс.Карты';
  SELECT id INTO new_id FROM review_platforms WHERE name = 'Яндекс Карты';

  IF old_id IS NOT NULL AND new_id IS NOT NULL THEN
    -- Оба существуют: переключаем отзывы на новую запись, удаляем старую
    UPDATE reviews SET "platformId" = new_id WHERE "platformId" = old_id;
    DELETE FROM review_platforms WHERE id = old_id;
  ELSIF old_id IS NOT NULL AND new_id IS NULL THEN
    -- Только старая: просто переименовываем
    UPDATE review_platforms SET name = 'Яндекс Карты' WHERE id = old_id;
  END IF;
END $$;

-- Zoon → Зун
DO $$
DECLARE
  old_id UUID;
  new_id UUID;
BEGIN
  SELECT id INTO old_id FROM review_platforms WHERE name = 'Zoon';
  SELECT id INTO new_id FROM review_platforms WHERE name = 'Зун';

  IF old_id IS NOT NULL AND new_id IS NOT NULL THEN
    UPDATE reviews SET "platformId" = new_id WHERE "platformId" = old_id;
    DELETE FROM review_platforms WHERE id = old_id;
  ELSIF old_id IS NOT NULL AND new_id IS NULL THEN
    UPDATE review_platforms SET name = 'Зун' WHERE id = old_id;
  END IF;
END $$;

-- ============================================================
-- Шаг 2: Добавляем отсутствующие платформы
-- ============================================================
INSERT INTO review_platforms (name, "isActive", "sortOrder") VALUES
  ('Фламп',     true,  8),
  ('Зун',       true,  9),
  ('Plaso.pro', true, 10)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Шаг 3: Обновляем sortOrder и активность актуальных площадок
-- ============================================================
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 1  WHERE name = 'Яндекс Карты';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 2  WHERE name = 'Google Maps';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 3  WHERE name = '2ГИС';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 4  WHERE name = 'ПроДокторов';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 5  WHERE name = 'Докту';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 6  WHERE name = 'DocDoc';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 7  WHERE name = 'НаПоправку';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 8  WHERE name = 'Фламп';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 9  WHERE name = 'Зун';
UPDATE review_platforms SET "isActive" = true, "sortOrder" = 10 WHERE name = 'Plaso.pro';

-- ============================================================
-- Шаг 4: Деактивируем всё лишнее
-- ============================================================
UPDATE review_platforms
SET "isActive" = false
WHERE name NOT IN (
  'Яндекс Карты', 'Google Maps', '2ГИС', 'ПроДокторов',
  'Докту', 'DocDoc', 'НаПоправку', 'Фламп', 'Зун', 'Plaso.pro'
);
