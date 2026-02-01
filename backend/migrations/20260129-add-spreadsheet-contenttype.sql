-- Миграция для добавления нового значения 'spreadsheet' в ENUM contentType
-- Дата: 2026-01-29

-- Сначала проверяем, какой тип используется (пробуем разные варианты)

-- Вариант 1: Стандартное имя Sequelize
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pages_contentType') THEN
        ALTER TYPE "enum_pages_contentType" ADD VALUE IF NOT EXISTS 'spreadsheet';
        RAISE NOTICE 'Added spreadsheet to enum_pages_contentType';
    ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pages_contenttype') THEN
        ALTER TYPE enum_pages_contenttype ADD VALUE IF NOT EXISTS 'spreadsheet';
        RAISE NOTICE 'Added spreadsheet to enum_pages_contenttype';
    ELSE
        -- Если ENUM не существует, создаем его и изменяем колонку
        CREATE TYPE enum_pages_contenttype AS ENUM ('wysiwyg', 'html', 'spreadsheet');
        ALTER TABLE pages
            ALTER COLUMN "contentType" TYPE enum_pages_contenttype
            USING "contentType"::text::enum_pages_contenttype;
        RAISE NOTICE 'Created new enum type and updated column';
    END IF;
END $$;
