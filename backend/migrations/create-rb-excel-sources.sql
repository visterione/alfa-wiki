-- =====================================================
-- RB EXCEL SOURCES — хранилище Excel-файлов источников
-- для автоматической подгрузки в отчётах по зарплате
-- =====================================================

CREATE TABLE IF NOT EXISTS rb_excel_sources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "dateFrom"  DATE NOT NULL,
    "dateTo"    DATE NOT NULL,
    "periodLabel" VARCHAR(255),
    "fileName"  VARCHAR(500) NOT NULL,
    "fileData"  TEXT NOT NULL,               -- base64-encoded Excel (.xlsx)
    "uploadedBy" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rb_excel_sources_date_from ON rb_excel_sources("dateFrom");
CREATE INDEX IF NOT EXISTS idx_rb_excel_sources_date_to   ON rb_excel_sources("dateTo");

COMMENT ON TABLE rb_excel_sources IS 'Excel-источники для автоподгрузки при формировании зарплатных отчётов';
COMMENT ON COLUMN rb_excel_sources."dateFrom"    IS 'Начало периода, которому соответствует файл';
COMMENT ON COLUMN rb_excel_sources."dateTo"      IS 'Конец периода, которому соответствует файл';
COMMENT ON COLUMN rb_excel_sources."periodLabel" IS 'Человекочитаемое название периода (напр. «Январь 2026»)';
COMMENT ON COLUMN rb_excel_sources."fileName"    IS 'Оригинальное имя файла для скачивания';
COMMENT ON COLUMN rb_excel_sources."fileData"    IS 'Содержимое файла в формате base64';
COMMENT ON COLUMN rb_excel_sources."uploadedBy"  IS 'Имя пользователя, загрузившего файл';
