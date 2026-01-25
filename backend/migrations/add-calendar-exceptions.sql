-- Миграция для добавления поля exceptions в таблицу calendar_events
-- Это поле будет хранить массив дат, когда повторяющееся событие НЕ должно происходить

-- Добавляем поле exceptions в таблицу calendar_events
ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS exceptions JSONB DEFAULT '[]';

-- Добавляем комментарий к столбцу
COMMENT ON COLUMN calendar_events.exceptions IS 'Массив дат (ISO строк) когда повторяющееся событие НЕ должно происходить';

-- Обновляем существующие записи, устанавливая пустой массив если значение NULL
UPDATE calendar_events
SET exceptions = '[]'
WHERE exceptions IS NULL;
