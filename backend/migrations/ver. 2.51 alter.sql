-- ver. 2.51: Add isReadOnly flag to chat_members (per-user read-only in group)
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS "isReadOnly" BOOLEAN NOT NULL DEFAULT FALSE;
