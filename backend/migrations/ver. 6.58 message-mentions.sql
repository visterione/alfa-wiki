ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN messages.mentions IS
  'Снимок адресатов упоминания: targetId, label, userIds';
