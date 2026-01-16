-- Migration: Create kanban_tasks table
-- Description: Создание таблицы для задач на Канбан-доске

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'backlog',
  priority VARCHAR(20) DEFAULT 'medium',
  "assigneeId" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  tags JSONB DEFAULT '[]',
  "dueDate" TIMESTAMP WITH TIME ZONE,
  "sortOrder" INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для оптимизации запросов
CREATE INDEX idx_kanban_tasks_status ON kanban_tasks(status);
CREATE INDEX idx_kanban_tasks_assignee ON kanban_tasks("assigneeId");
CREATE INDEX idx_kanban_tasks_created_by ON kanban_tasks("createdBy");
CREATE INDEX idx_kanban_tasks_priority ON kanban_tasks(priority);
CREATE INDEX idx_kanban_tasks_sort_order ON kanban_tasks("sortOrder");
CREATE INDEX idx_kanban_tasks_due_date ON kanban_tasks("dueDate");

-- Таблица настроек доступа к Канбану (используется существующая таблица settings)

-- Вставка начальных настроек доступа в таблицу settings
INSERT INTO settings (key, value, description, "createdAt", "updatedAt") VALUES
(
  'kanban_access',
  '{
    "readAccess": "all",
    "writeRoles": []
  }'::jsonb,
  'Настройки доступа к Канбан-доске: readAccess может быть "all" или массив roleIds, writeRoles - массив roleIds с правом редактирования',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE kanban_tasks IS 'Задачи на Канбан-доске медицинского центра';
COMMENT ON COLUMN kanban_tasks.status IS 'Статус задачи: backlog, todo, in_progress, review, done';
COMMENT ON COLUMN kanban_tasks.priority IS 'Приоритет: low, medium, high, urgent';
COMMENT ON COLUMN kanban_tasks.tags IS 'Теги задачи в формате массива строк';
COMMENT ON COLUMN kanban_tasks.metadata IS 'Дополнительные данные задачи';
COMMENT ON COLUMN kanban_tasks.sort_order IS 'Порядок сортировки внутри колонки';
