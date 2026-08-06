DO $$
BEGIN
  ALTER TYPE "enum_messages_type" ADD VALUE IF NOT EXISTS 'poll';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll JSONB;
COMMENT ON COLUMN messages.poll IS 'Опрос: вопрос, варианты, настройки и карта голосов';
