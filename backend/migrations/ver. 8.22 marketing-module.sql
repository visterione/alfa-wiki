-- ver. 8.22 — модуль «Маркетинг»: акции, рекламные площадки и анонсы одним разделом.
--
-- Права трёх бывших вразнобой разделов сводятся в adminAccess.marketing —
-- объект с тремя уровнями ('block' | 'read' | 'edit') по вкладке на ключ.
-- Никому ничего не убавляется: каждый получает ровно то, чем пользовался.
--
--   promotions  — акции. Их видели все: карточки висели на вики-странице,
--                 открытой всему порталу. Значит всем 'read', а 'edit' тем,
--                 у кого стоял canManagePromotions.
--   ads         — карта рекламных площадок. Та же история: смотреть мог любой
--                 авторизованный, править — обладатель права pages.write в
--                 какой-нибудь из ролей.
--   announcements — рассылки. Единственный из трёх, кто и раньше был закрыт
--                 флагом, поэтому 'block' по умолчанию и 'edit' по флагу.
--
-- Миграция идемпотентна: строки с уже заполненным marketing не трогаются, так
-- что повторный запуск ничего не перепишет.

BEGIN;

UPDATE users u
SET "adminAccess" = jsonb_set(
      COALESCE(u."adminAccess", '{}'::jsonb) - 'announcements',
      '{marketing}',
      jsonb_build_object(
        'promotions',
          CASE WHEN COALESCE(u."canManagePromotions", false) THEN 'edit' ELSE 'read' END,
        'ads',
          CASE WHEN EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.id = ur."roleId"
            WHERE ur."userId" = u.id
              AND COALESCE((r.permissions -> 'pages' ->> 'write')::boolean, false)
          ) THEN 'edit' ELSE 'read' END,
        'announcements',
          CASE WHEN COALESCE(u."adminAccess" ->> 'announcements', 'false') = 'true'
               THEN 'edit' ELSE 'block' END
      ),
      true
    )
WHERE u."adminAccess" -> 'marketing' IS NULL;

COMMIT;
