-- Migration: Update Kanban tasks for multiple assignees and file attachments
-- Description:
-- 1. Заменяем assigneeId на assigneeIds (JSONB массив)
-- 2. Добавляем поле attachments для прикрепленных файлов

-- Добавляем новое поле assigneeIds
ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS "assigneeIds" JSONB DEFAULT '[]'::jsonb;

-- Мигрируем данные из assigneeId в assigneeIds
UPDATE kanban_tasks
SET "assigneeIds" = CASE
  WHEN "assigneeId" IS NOT NULL THEN jsonb_build_array("assigneeId"::text)
  ELSE '[]'::jsonb
END
WHERE "assigneeId" IS NOT NULL;

-- Удаляем старое поле assigneeId
ALTER TABLE kanban_tasks
DROP COLUMN IF EXISTS "assigneeId";

-- Добавляем поле для вложений
ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Удаляем старый индекс для assigneeId (если существует)
DROP INDEX IF EXISTS kanban_tasks_assignee_id;
