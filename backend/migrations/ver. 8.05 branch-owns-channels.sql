-- Филиал владеет своими каналами: боты, счёт у провайдера, имя отправителя
-- (ver. 8.05).
--
-- До сих пор настройка была разложена по трём разным основаниям, и ни одно из
-- них не совпадало с тем, как о ней думает заказчик:
--
--   • боты привязывались к «организации» — ключу лицевого счёта у Fromni
--     ('alfa', 'alfa-deti'), который появился в 5.91 ради выгрузки подписчиков
--     и к филиалам отношения не имел;
--   • токен Имобиса и имя отправителя лежали одной строкой на всю сеть, а
--     переопределение имени — в настройках филиала, то есть одна настройка в
--     двух местах;
--   • сам филиал в этой картине был списком галочек «подключён».
--
-- Между тем филиал — это и есть то, что настраивают: у Кидс свой бот, своё
-- юрлицо и своё одобренное имя отправителя, потому что имя проходит модерацию
-- у операторов связи на конкретное юрлицо. Собираем всё туда.
--
-- «Организация» не исчезает: на неё завязаны подписчики (bot_subscribers),
-- выгрузка из Fromni и статистика с 5.91. Она становится свойством филиала, а
-- не отдельным основанием — одно поле вместо параллельного справочника.

-- ── Организация у филиала ─────────────────────────────────────────────────
ALTER TABLE med_centers ADD COLUMN IF NOT EXISTS "botOrganization" VARCHAR(50);

-- Соответствие однозначное и известное: ключи организаций заводились по этим же
-- филиалам. Сеем по code, а не по названию: названия правит заказчик.
UPDATE med_centers SET "botOrganization" = v.org
  FROM (VALUES
    ('alfa',   'alfa'),
    ('kids',   'alfa-deti'),
    ('liniya', 'alfa-liniya'),
    ('prof',   'alfa-prof'),
    ('smile',  'alfa-smile'),
    ('3k',     'alfa-3k')
  ) AS v(code, org)
 WHERE med_centers.code = v.code
   AND med_centers."botOrganization" IS NULL;

-- ── Бот принадлежит филиалу ───────────────────────────────────────────────
--
-- Раньше связь была косвенной: бот знал организацию, организация угадывалась по
-- филиалу. Теперь связь прямая, а организация остаётся у бота как есть — её
-- читают подписчики и статистика.
ALTER TABLE messenger_bots ADD COLUMN IF NOT EXISTS "medCenterId" UUID REFERENCES med_centers(id) ON DELETE SET NULL;

-- Переносим то, что уже заведено: бот встаёт к филиалу с той же организацией.
-- Проверочные боты (organization = 'test') остаются без филиала намеренно — они
-- не обслуживают пациентов, и приписывать их к клинике неверно.
UPDATE messenger_bots b
   SET "medCenterId" = mc.id
  FROM med_centers mc
 WHERE mc."botOrganization" = b.organization
   AND b."medCenterId" IS NULL;

CREATE INDEX IF NOT EXISTS messenger_bots_medcenter_idx ON messenger_bots ("medCenterId");

-- ── Счёт провайдера у филиала ─────────────────────────────────────────────
--
-- Токен и имя отправителя переезжают в настройки филиала (notif_branch_settings
-- .imobis — колонка заведена в 8.03). Общая настройка notif_imobis остаётся
-- основанием: сеть чаще всего живёт на одном счету, и заставлять вписывать один
-- токен девять раз значило бы менять одну беду на другую. Филиал заполняет своё
-- поле только тогда, когда счёт у него действительно отдельный.
--
-- Прежние переопределения имени отправителя лежали в общей настройке словарём
-- senders[organization] — перекладываем их в филиалы, к которым они относятся.
INSERT INTO notif_branch_settings ("medCenterId", imobis, "createdAt", "updatedAt")
SELECT mc.id,
       jsonb_build_object('sender', s.value->'senders'->>mc."botOrganization"),
       NOW(), NOW()
  FROM med_centers mc
  CROSS JOIN (SELECT value FROM settings WHERE key = 'notif_imobis') AS s
 WHERE mc."botOrganization" IS NOT NULL
   AND COALESCE(s.value->'senders'->>mc."botOrganization", '') <> ''
   AND NOT EXISTS (SELECT 1 FROM notif_branch_settings b WHERE b."medCenterId" = mc.id)
ON CONFLICT DO NOTHING;

-- То же для филиалов, у которых строка настроек уже была.
UPDATE notif_branch_settings b
   SET imobis = COALESCE(b.imobis, '{}'::jsonb)
                || jsonb_build_object('sender', s.value->'senders'->>mc."botOrganization")
  FROM med_centers mc,
       (SELECT value FROM settings WHERE key = 'notif_imobis') AS s
 WHERE b."medCenterId" = mc.id
   AND mc."botOrganization" IS NOT NULL
   AND COALESCE(s.value->'senders'->>mc."botOrganization", '') <> ''
   AND COALESCE(b.imobis->>'sender', '') = '';
