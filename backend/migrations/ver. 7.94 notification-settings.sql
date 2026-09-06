-- Тексты по каналам, порядок каскада и тихие часы (ver. 7.94).
--
-- Три замечания заказчика, все по делу:
--
-- 1. Текст должен отличаться по каналу. У бота ограничений нет — эмодзи и
--    сколько угодно строк. У SMS длина считается сегментами, и кириллица даёт
--    70 символов на сегмент: превысил на один — платим как за две. Поэтому у
--    шаблона появляется отдельный короткий текст для SMS.
-- 2. Порядок каскада должен настраиваться, а не жить в .env.
-- 3. Ночью писать нельзя. Сообщение, попавшее в запрещённые часы, не
--    выбрасывается, а откладывается до утра.
--
-- Порядок каскада и тихие часы легли в settings: это одна строка на всю сеть,
-- заводить под неё таблицу не за чем.

ALTER TABLE notif_templates ADD COLUMN IF NOT EXISTS "smsText" TEXT;

-- Готовый короткий текст едет в очередь вместе с обычным: шаблон могли
-- поправить между постановкой и отправкой, а уйти должно то, что было на момент
-- события.
ALTER TABLE notif_outbox ADD COLUMN IF NOT EXISTS sms_text TEXT;

-- Отметка о переносе по тихим часам — чтобы в журнале было видно, что
-- сообщение не потерялось, а ждёт утра.
ALTER TABLE notif_outbox ADD COLUMN IF NOT EXISTS postponed_from TIMESTAMP WITH TIME ZONE;

INSERT INTO settings (key, value, description, "createdAt", "updatedAt")
VALUES (
  'notif_cascade',
  '["bot","notify+vk","sms+webchat"]'::jsonb,
  'Порядок каскада уведомлений: bot — наши боты, дальше ступени Fromni по её именам каналов',
  NOW(), NOW()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description, "createdAt", "updatedAt")
VALUES (
  'notif_quiet_hours',
  '{"enabled":true,"from":"21:00","to":"09:00","channels":["notify+vk","sms+webchat"]}'::jsonb,
  'Тихие часы: когда не отправлять. Сообщение откладывается до начала разрешённого времени, а не отменяется',
  NOW(), NOW()
)
ON CONFLICT (key) DO NOTHING;
