-- Добавление поля isHidden в таблицу chat_members
-- Это поле позволяет пользователю скрывать чат (только у себя)

ALTER TABLE chat_members
ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN DEFAULT false;

COMMENT ON COLUMN chat_members."isHidden" IS 'Чат скрыт у пользователя (видит только этот пользователь)';
