-- Migration: Add kanban field to adminAccess
-- Description: Добавление поля kanban в adminAccess для всех пользователей

-- Обновляем adminAccess для всех пользователей, у которых это поле есть
UPDATE users
SET "adminAccess" = jsonb_set(
  COALESCE("adminAccess", '{}'::jsonb),
  '{kanban}',
  'false'::jsonb,
  true
)
WHERE "adminAccess" IS NOT NULL
  AND NOT ("adminAccess" ? 'kanban');

-- Для пользователей без adminAccess создаем с дефолтными значениями
UPDATE users
SET "adminAccess" = '{
  "pages": false,
  "sidebar": false,
  "users": false,
  "roles": false,
  "media": false,
  "backup": false,
  "settings": false,
  "courses": false,
  "kanban": false
}'::jsonb
WHERE "adminAccess" IS NULL;
