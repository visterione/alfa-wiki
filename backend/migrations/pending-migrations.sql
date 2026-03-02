-- ============================================================
-- Pending migrations (apply in order)
-- ============================================================

-- 1. Online status tracking: lastSeen for users
--    File: add-user-lastseen.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMPTZ;

-- 2. Workflow + custom column names for review boards
--    File: add-reviews-workflow.sql
ALTER TABLE review_boards
  ADD COLUMN IF NOT EXISTS "workflowConfig" JSONB DEFAULT '{"nodes":[],"edges":[]}',
  ADD COLUMN IF NOT EXISTS "columnNames" JSONB DEFAULT '{}';

-- 3. Fix reviews bot avatar path (actual file is uploads/bot-avatars/reviews-bot.svg)
--    File: fix-reviews-bot-avatar.sql
UPDATE users
SET avatar = 'uploads/bot-avatars/reviews-bot.svg'
WHERE id = '00000000-0000-0000-0000-000000000002';
