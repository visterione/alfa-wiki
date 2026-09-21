-- SMS уходит целиком на прямую отправку (ver. 8.50).
--
-- Ступеней SMS в каскаде было две: «SMS напрямую» через Имобис и «SMS» через
-- Fromni. Разными каналами они не были — то же сообщение тому же человеку на
-- тот же номер, — и выбор между ними был выбором не канала, а провайдера, о
-- котором администратор колл-центра знать не обязан. Два одинаковых пункта в
-- одном списке всегда означают, что кто-то однажды выберет не тот.
--
-- Оставлена прямая. Она отвечает, дошло ли сообщение: отчёт о доставке приходит
-- от Имобиса, тогда как Fromni не сообщает исход вовсе — ровно та причина, по
-- которой прямая отправка появилась в 7.95. Плюс счёт у Имобиса заведён на
-- каждый медцентр отдельно (ver. 8.25), и трафик по филиалам виден, а не
-- размазан по общему договору агрегатора.
--
-- Fromni остаётся в каскаде ступенью Notify — её отсюда никто не убирает.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ. Вычищает имя ступени «sms+webchat» из всех сохранённых
-- каскадов: общего по сети, каскадов филиалов и собственных каскадов событий.
-- Иначе правка в коде ничего бы не изменила — каскады хранятся в базе, и
-- отправщик продолжил бы ходить в Fromni за SMS по уже сохранённому порядку.
--
-- Журнала это не касается. В notif_outbox.channel остаются записи вида
-- «notify+vk→sms+webchat» — так и было отправлено, и переписывать историю
-- нельзя. Расшифровка этого имени в отчётах оставлена на месте.

BEGIN;

-- ── Общий каскад сети ─────────────────────────────────────────────────────
--
-- Порядок ступеней — это и есть настройка, поэтому пересобираем массив с
-- сохранением исходного порядка (WITH ORDINALITY), а не просто вычитаем
-- элемент.
UPDATE settings
   SET value = COALESCE((
         SELECT jsonb_agg(step ORDER BY idx)
           FROM jsonb_array_elements(value) WITH ORDINALITY AS s(step, idx)
          WHERE step <> '"sms+webchat"'::jsonb
       ), '[]'::jsonb)
 WHERE key = 'notif_cascade'
   AND value @> '["sms+webchat"]'::jsonb;

-- Пустой каскад означает «не слать никуда» — а это не то, о чём просили.
-- Строку убираем совсем: без неё берётся умолчание из services/notifications/
-- settings.js, то есть Telegram, MAX и Notify.
DELETE FROM settings
 WHERE key = 'notif_cascade' AND value = '[]'::jsonb;

-- ── Каскады филиалов ──────────────────────────────────────────────────────
--
-- Пустой массив здесь безопасен: cascadeFor() считает его отсутствием отличия
-- и берёт общий каскад сети.
UPDATE notif_branch_settings
   SET "cascade" = COALESCE((
         SELECT jsonb_agg(step ORDER BY idx)
           FROM jsonb_array_elements("cascade") WITH ORDINALITY AS s(step, idx)
          WHERE step <> '"sms+webchat"'::jsonb
       ), '[]'::jsonb)
 WHERE "cascade" @> '["sms+webchat"]'::jsonb;

-- ── Собственные каскады событий ───────────────────────────────────────────
UPDATE notif_templates
   SET "cascade" = COALESCE((
         SELECT jsonb_agg(step ORDER BY idx)
           FROM jsonb_array_elements("cascade") WITH ORDINALITY AS s(step, idx)
          WHERE step <> '"sms+webchat"'::jsonb
       ), '[]'::jsonb)
 WHERE "cascade" @> '["sms+webchat"]'::jsonb;

-- ── Тихие часы ────────────────────────────────────────────────────────────
--
-- Здесь ступень ЗАМЕНЯЕТСЯ, а не удаляется, и это важнее, чем кажется. Список
-- отвечает на вопрос «что ночью молчит», и вычеркнуть из него SMS значило бы
-- разрешить ночные SMS в сети, где их запретили осознанно. Намерение было
-- «ночью SMS не отправляем», и после переезда на прямую отправку оно должно
-- относиться к ней.
UPDATE settings
   SET value = jsonb_set(value, '{channels}', COALESCE((
         SELECT jsonb_agg(DISTINCT CASE WHEN step = '"sms+webchat"'::jsonb
                                        THEN '"imobis:sms"'::jsonb
                                        ELSE step END)
           FROM jsonb_array_elements(value -> 'channels') AS s(step)
       ), '[]'::jsonb))
 WHERE key = 'notif_quiet_hours'
   AND value -> 'channels' @> '["sms+webchat"]'::jsonb;

UPDATE notif_branch_settings
   SET "quietHours" = jsonb_set("quietHours", '{channels}', COALESCE((
         SELECT jsonb_agg(DISTINCT CASE WHEN step = '"sms+webchat"'::jsonb
                                        THEN '"imobis:sms"'::jsonb
                                        ELSE step END)
           FROM jsonb_array_elements("quietHours" -> 'channels') AS s(step)
       ), '[]'::jsonb))
 WHERE "quietHours" -> 'channels' @> '["sms+webchat"]'::jsonb;

COMMIT;
