-- Add subtasks field to kanban_tasks table
-- Subtasks will be stored as JSON array: [{id: UUID, text: string, completed: boolean}, ...]

ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS subtasks JSONB DEFAULT '[]';

COMMENT ON COLUMN kanban_tasks.subtasks IS 'Array of subtasks: [{id: UUID, text: string, completed: boolean}]';
