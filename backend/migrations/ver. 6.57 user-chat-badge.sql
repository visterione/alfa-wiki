-- Администраторская метка сотрудника в чатах.
-- type: icon | emoji | image, value: имя иконки / эмодзи / путь к изображению.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "chatBadge" JSONB;

COMMENT ON COLUMN users."chatBadge" IS
  'Администраторская метка в чате: { type, value, color, label }';
