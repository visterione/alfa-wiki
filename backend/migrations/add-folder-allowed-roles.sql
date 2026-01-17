-- Добавление поля allowedRoles к папкам
-- Позволяет настраивать доступ к папкам по ролям, аналогично страницам

-- Добавляем колонку allowedRoles в таблицу folders
ALTER TABLE folders
ADD COLUMN IF NOT EXISTS "allowedRoles" UUID[] DEFAULT '{}';

-- Комментарии к колонке
COMMENT ON COLUMN folders."allowedRoles" IS 'Массив ID ролей, которым разрешен доступ к папке. Пустой массив означает доступ для всех';

-- Индекс для ускорения поиска папок по ролям
CREATE INDEX IF NOT EXISTS idx_folders_allowed_roles ON folders USING GIN("allowedRoles");
