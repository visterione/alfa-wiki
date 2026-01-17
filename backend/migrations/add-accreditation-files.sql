-- Миграция для добавления таблицы файлов аккредитаций
-- Дата: 2026-01-17

-- Создание таблицы для файлов аккредитаций
CREATE TABLE IF NOT EXISTS accreditation_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accreditationId" UUID NOT NULL REFERENCES accreditations(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100),
  size INTEGER,
  path VARCHAR(1000) NOT NULL,
  "uploadedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_accreditation_files_accreditation_id
  ON accreditation_files("accreditationId");

CREATE INDEX IF NOT EXISTS idx_accreditation_files_uploaded_by
  ON accreditation_files("uploadedBy");

-- Комментарии к таблице и полям
COMMENT ON TABLE accreditation_files IS 'Файлы, прикрепленные к аккредитациям';
COMMENT ON COLUMN accreditation_files.id IS 'Уникальный идентификатор файла';
COMMENT ON COLUMN accreditation_files."accreditationId" IS 'ID аккредитации, к которой прикреплен файл';
COMMENT ON COLUMN accreditation_files.filename IS 'Имя файла на сервере';
COMMENT ON COLUMN accreditation_files."originalName" IS 'Оригинальное имя файла';
COMMENT ON COLUMN accreditation_files."mimeType" IS 'MIME тип файла';
COMMENT ON COLUMN accreditation_files.size IS 'Размер файла в байтах';
COMMENT ON COLUMN accreditation_files.path IS 'Путь к файлу на сервере';
COMMENT ON COLUMN accreditation_files."uploadedBy" IS 'ID пользователя, загрузившего файл';
