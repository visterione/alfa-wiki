-- Денормализованный счётчик непрочитанных.
--
-- До ver. 7.30 счётчик считался запросом COUNT по таблице messages — по одному
-- на каждый чат пользователя, и так при каждом показе списка чатов. На сотнях
-- тысяч сообщений это самый дорогой запрос портала, а растёт он вместе с
-- перепиской, то есть ровно там, где расти не должен.
--
-- Теперь счётчик лежит рядом с членством и меняется на месте: +1 всем, кроме
-- отправителя, при появлении сообщения (хук afterCreate у модели Message),
-- 0 при отметке «прочитано». Пересчёт по-старому остался как ремонт —
-- unreadService.recountChat().

ALTER TABLE chat_members
  ADD COLUMN IF NOT EXISTS "unreadCount" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN chat_members."unreadCount" IS
  'Непрочитанные сообщения участника. Поддерживается инкрементом, пересчитывается unreadService.recountChat()';

-- Заполнение по прежнему правилу: всё, что пришло после lastReadAt не от тебя.
UPDATE chat_members cm
SET "unreadCount" = sub.n
FROM (
  SELECT cm2.id AS member_id, count(m.id)::int AS n
  FROM chat_members cm2
  LEFT JOIN messages m
    ON m."chatId" = cm2."chatId"
   AND m."createdAt" > COALESCE(cm2."lastReadAt", '-infinity'::timestamptz)
   AND m."senderId" <> cm2."userId"
  GROUP BY cm2.id
) sub
WHERE cm.id = sub.member_id
  AND cm."unreadCount" IS DISTINCT FROM sub.n;
