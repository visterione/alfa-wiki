-- Простая миграция для добавления типа spreadsheet
-- Этот метод работает независимо от того, как был создан ENUM

-- Шаг 1: Временно изменяем колонку на VARCHAR
ALTER TABLE pages
  ALTER COLUMN "contentType" TYPE VARCHAR(50);

-- Шаг 2: Удаляем старый ENUM тип если существует
DROP TYPE IF EXISTS enum_pages_contenttype CASCADE;
DROP TYPE IF EXISTS "enum_pages_contentType" CASCADE;

-- Шаг 3: Создаем новый ENUM тип с 3 значениями
CREATE TYPE "enum_pages_contentType" AS ENUM ('wysiwyg', 'html', 'spreadsheet');

-- Шаг 4: Изменяем колонку обратно на ENUM
ALTER TABLE pages
  ALTER COLUMN "contentType" TYPE "enum_pages_contentType"
  USING "contentType"::"enum_pages_contentType";

-- Шаг 5: Устанавливаем значение по умолчанию
ALTER TABLE pages
  ALTER COLUMN "contentType" SET DEFAULT 'wysiwyg'::"enum_pages_contentType";
