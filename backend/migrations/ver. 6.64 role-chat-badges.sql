-- Метка сотрудника в чатах переезжает с отдельных пользователей на роли:
--   иконка   — из роли с наибольшим badgePriority,
--   цвет     — из медцентра с наименьшим sortOrder среди привязанных,
--   users.chatBadge — вычисленный результат, его читают все запросы чата,
--   users.chatBadgeOverride — ручные правки админа ({ value, color, label }).

-- Иконка и приоритет роли.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS "chatBadgeIcon"  VARCHAR(50);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS "chatBadgeLabel" VARCHAR(80);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS "badgePriority"  INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN roles."chatBadgeIcon"  IS 'Имя lucide-иконки метки в чате';
COMMENT ON COLUMN roles."chatBadgeLabel" IS 'Подпись метки (tooltip); пусто — берётся название иконки';
COMMENT ON COLUMN roles."badgePriority"  IS 'Чем больше, тем важнее роль при выборе иконки у мультиролевого сотрудника';

-- Цвет клиники и порядок для выбора цвета у мультиклиничных сотрудников.
ALTER TABLE med_centers ADD COLUMN IF NOT EXISTS color       VARCHAR(7);
ALTER TABLE med_centers ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 100;

COMMENT ON COLUMN med_centers.color       IS 'Цвет клиники (#rrggbb) — им красится метка сотрудника';
COMMENT ON COLUMN med_centers."sortOrder" IS 'Чем меньше, тем приоритетнее клиника при выборе цвета метки';

-- Стартовая палитра — та же, что исторически используется в отчётах
-- (frontend/src/pages/ReferralBonuses/utils/clinicUtils.js).
UPDATE med_centers
SET color = COALESCE(med_centers.color, v.color), "sortOrder" = v.ord
FROM (VALUES
  ('Альфа',        '#de64a1', 1),
  ('Кидс',         '#ed9121', 2),
  ('Проф',         '#9999ff', 3),
  ('Линия',        '#c7a878', 4),
  ('3К',           '#800080', 5),
  ('Смайл',        '#999999', 6),
  ('Сукко',        '#2d7055', 7),
  ('ИП Микаелян',  '#e05252', 8)
) AS v(name, color, ord)
WHERE med_centers.name::text = v.name;

-- Ручное переопределение метки у пользователя.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "chatBadgeOverride" JSONB;

COMMENT ON COLUMN users."chatBadgeOverride" IS
  'Ручное переопределение метки: { value, color, label } — любое поле необязательно';
COMMENT ON COLUMN users."chatBadge" IS
  'Вычисленная метка в чате { type: icon, value, color, label }. Не редактируется напрямую — пересчитывается из ролей, клиник и chatBadgeOverride';

-- Существующие индивидуальные метки становятся переопределениями.
-- Эмодзи и картинки больше не поддерживаются: у них нет имени lucide-иконки,
-- поэтому сохраняем только цвет и подпись, иконку подберёт роль.
UPDATE users
SET "chatBadgeOverride" = jsonb_strip_nulls(jsonb_build_object(
      'value', CASE WHEN "chatBadge"->>'type' = 'icon' THEN NULLIF("chatBadge"->>'value', '') END,
      'color', NULLIF("chatBadge"->>'color', ''),
      'label', NULLIF("chatBadge"->>'label', '')
    ))
WHERE "chatBadge" IS NOT NULL
  AND "chatBadgeOverride" IS NULL;

UPDATE users SET "chatBadgeOverride" = NULL WHERE "chatBadgeOverride" = '{}'::jsonb;

-- Вычисленные метки пересчитает скрипт миграции (recomputeAll) сразу после SQL.
