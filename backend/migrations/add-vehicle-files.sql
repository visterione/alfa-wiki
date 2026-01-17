-- Создание таблицы для файлов ТС
-- Хранит файлы, прикрепленные к записям о транспортных средствах

CREATE TABLE IF NOT EXISTS vehicle_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vehicleId" UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100),
  size INTEGER,
  path VARCHAR(1000) NOT NULL,
  "uploadedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Комментарии к колонкам
COMMENT ON TABLE vehicle_files IS 'Файлы, прикрепленные к записям о транспортных средствах';
COMMENT ON COLUMN vehicle_files."vehicleId" IS 'ID транспортного средства, к которому прикреплен файл';
COMMENT ON COLUMN vehicle_files.filename IS 'Имя файла на сервере';
COMMENT ON COLUMN vehicle_files."originalName" IS 'Оригинальное имя файла';
COMMENT ON COLUMN vehicle_files."mimeType" IS 'MIME тип файла';
COMMENT ON COLUMN vehicle_files.size IS 'Размер файла в байтах';
COMMENT ON COLUMN vehicle_files.path IS 'Путь к файлу на сервере';
COMMENT ON COLUMN vehicle_files."uploadedBy" IS 'ID пользователя, загрузившего файл';

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_vehicle_files_vehicle_id ON vehicle_files("vehicleId");
CREATE INDEX IF NOT EXISTS idx_vehicle_files_uploaded_by ON vehicle_files("uploadedBy");
