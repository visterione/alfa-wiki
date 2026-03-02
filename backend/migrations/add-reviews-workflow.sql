-- Миграция: добавление полей workflowConfig и columnNames в таблицу review_boards
-- Версия: 1.60
-- Описание: Поддержка визуального редактора сценариев (Workflow) и кастомных названий столбцов Kanban

ALTER TABLE review_boards
  ADD COLUMN IF NOT EXISTS "workflowConfig" JSONB DEFAULT '{"nodes":[],"edges":[]}',
  ADD COLUMN IF NOT EXISTS "columnNames" JSONB DEFAULT '{}';
