-- Добавление поля adminAccess для гранулярного контроля доступа к админ-разделам

ALTER TABLE users
ADD COLUMN IF NOT EXISTS "adminAccess" JSONB DEFAULT '{
  "pages": false,
  "sidebar": false,
  "users": false,
  "roles": false,
  "media": false,
  "backup": false,
  "settings": false,
  "courses": false
}'::jsonb;

COMMENT ON COLUMN users."adminAccess" IS 'Гранулярный доступ к админ-разделам';
