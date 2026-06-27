-- Добавляет колонку slug для папок (постоянные ссылки на папки в проводнике).
-- Заполнение значениями выполняется скриптом scripts/run-migration-folder-slug.js
ALTER TABLE folders ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
CREATE INDEX IF NOT EXISTS folders_slug_idx ON folders (slug);
