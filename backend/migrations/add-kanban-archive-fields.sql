-- Migration: Add archive fields to kanban_tasks
-- Description: Добавление полей для архивации задач

-- Добавляем поле archived (флаг архивации)
ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Добавляем поле archivedAt (дата архивации)
ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP WITH TIME ZONE;

-- Добавляем поле completedAt (дата завершения)
ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP WITH TIME ZONE;

-- Создаем индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS kanban_tasks_archived ON kanban_tasks(archived);
CREATE INDEX IF NOT EXISTS kanban_tasks_completed_at ON kanban_tasks("completedAt");

-- Обновляем существующие завершенные задачи - устанавливаем completedAt равным updatedAt
UPDATE kanban_tasks
SET "completedAt" = "updatedAt"
WHERE status = 'done' AND "completedAt" IS NULL;
