-- Create kanban_boards table
CREATE TABLE IF NOT EXISTS kanban_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    "ownerId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archived BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_kanban_boards_owner ON kanban_boards("ownerId");
CREATE INDEX IF NOT EXISTS idx_kanban_boards_archived ON kanban_boards(archived);

-- Create board_permissions table
CREATE TABLE IF NOT EXISTS board_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "boardId" UUID NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("boardId", "userId")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_board_permissions_board ON board_permissions("boardId");
CREATE INDEX IF NOT EXISTS idx_board_permissions_user ON board_permissions("userId");
CREATE INDEX IF NOT EXISTS idx_board_permissions_role ON board_permissions(role);

-- Add boardId to kanban_tasks table
ALTER TABLE kanban_tasks
ADD COLUMN IF NOT EXISTS "boardId" UUID REFERENCES kanban_boards(id) ON DELETE CASCADE;

-- Create index for boardId in tasks
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_board ON kanban_tasks("boardId");
