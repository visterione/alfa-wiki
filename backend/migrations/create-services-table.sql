-- Создание таблицы services
-- Дата создания: 2026-01-25
-- Описание: Таблица для хранения медицинских услуг, привязанных к страницам wiki

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pageSlug" VARCHAR(255) NOT NULL,
  "medCenter" VARCHAR(50) NOT NULL,
  "serviceCode" VARCHAR(100) NOT NULL,
  "serviceName" VARCHAR(500) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  "isStopped" BOOLEAN DEFAULT false,
  "preparationLink" VARCHAR(1000),
  comment TEXT,
  "misServiceId" VARCHAR(50),
  "lastPriceUpdate" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_services_page_slug ON services("pageSlug");
CREATE INDEX IF NOT EXISTS idx_services_med_center ON services("medCenter");
CREATE INDEX IF NOT EXISTS idx_services_service_code ON services("serviceCode");
CREATE INDEX IF NOT EXISTS idx_services_service_name ON services("serviceName");
CREATE INDEX IF NOT EXISTS idx_services_is_stopped ON services("isStopped");
CREATE INDEX IF NOT EXISTS idx_services_mis_service_id ON services("misServiceId");

-- Комментарии к таблице и полям
COMMENT ON TABLE services IS 'Медицинские услуги, привязанные к страницам wiki';
COMMENT ON COLUMN services."pageSlug" IS 'Slug страницы wiki, к которой привязаны услуги';
COMMENT ON COLUMN services."medCenter" IS 'Медицинский центр (Альфа, Кидс, Проф, Линия, Смайл, 3К)';
COMMENT ON COLUMN services."serviceCode" IS 'Код услуги из МИС';
COMMENT ON COLUMN services."serviceName" IS 'Название услуги';
COMMENT ON COLUMN services.price IS 'Стоимость услуги';
COMMENT ON COLUMN services."isStopped" IS 'Услуга временно не выполняется';
COMMENT ON COLUMN services."preparationLink" IS 'Ссылка на файл с подготовкой к услуге';
COMMENT ON COLUMN services.comment IS 'Дополнительный комментарий';
COMMENT ON COLUMN services."misServiceId" IS 'ID услуги в МИС для обновления цен';
COMMENT ON COLUMN services."lastPriceUpdate" IS 'Время последнего обновления цены из МИС';
