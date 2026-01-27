-- Создание таблицы для журнализации изменений страниц
CREATE TABLE IF NOT EXISTS page_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pageId" UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated', 'published', 'unpublished')),
  "changesSummary" TEXT,
  metadata JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_page_history_page_id ON page_history("pageId");
CREATE INDEX IF NOT EXISTS idx_page_history_user_id ON page_history("userId");
CREATE INDEX IF NOT EXISTS idx_page_history_created_at ON page_history("createdAt");
CREATE INDEX IF NOT EXISTS idx_page_history_action ON page_history(action);

-- Комментарии к таблице и полям
COMMENT ON TABLE page_history IS 'Журнал изменений страниц wiki';
COMMENT ON COLUMN page_history.id IS 'UUID записи истории';
COMMENT ON COLUMN page_history."pageId" IS 'ID страницы';
COMMENT ON COLUMN page_history."userId" IS 'ID пользователя, внесшего изменения';
COMMENT ON COLUMN page_history.action IS 'Тип действия: created - создание, updated - редактирование, published/unpublished - изменение статуса публикации';
COMMENT ON COLUMN page_history."changesSummary" IS 'Краткое описание изменений';
COMMENT ON COLUMN page_history.metadata IS 'Дополнительные данные: измененные поля, старые/новые значения';
COMMENT ON COLUMN page_history."createdAt" IS 'Дата и время изменения';
