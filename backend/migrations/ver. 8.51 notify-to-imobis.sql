-- Notify переезжает с Fromni на прямой канал Имобиса (ver. 8.51).
--
-- Каналом это всегда был Имобис. В подключении Fromni, которое заводили под
-- Notify, вводились ровно три вещи: название подключения, ТОКЕН ДОСТУПА К API
-- ИМОБИСА и ссылка на группу ВКонтакте. То есть агрегатор брал наш запрос и
-- пересылал его туда же, куда мы теперь ходим сами, — своего канала у него в
-- этой цепочке не было вовсе.
--
-- Посредник стоил того же, чего стоил у SMS (см. миграцию 8.50): исход отправки
-- Fromni не сообщает. Её метод отвечает «принято», а отчёт о доставке уходит на
-- её callback-сервер, занятый мостом Renovatio. На вопрос «дошло ли
-- уведомление» ответа не было. У Имобиса отчёт приходит нам, адресом в самом
-- запросе, и в журнале видно исход, а не факт приёма.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ. Заменяет имя ступени «notify+vk» на «imobis:vk» во всех
-- сохранённых каскадах и в тихих часах. Порядок ступеней сохраняется: он и есть
-- настройка. Если прямая ступень в каскаде уже стояла, второй раз она не
-- добавляется — дубль в маршруте означал бы две отправки одному человеку.
--
-- ЗАПУСКАТЬ ПОСЛЕ ПРОВЕРКИ, А НЕ ВМЕСТО НЕЁ. Прямому ВК-каналу нужно от филиала
-- две вещи, которых может не оказаться: номер группы ВКонтакте в карточке
-- филиала и одобренные шаблоны на счёте Имобиса — сообщение в ВК уходит только
-- по шаблону. И то, и другое видно в карточке филиала по кнопке «Проверить
-- счёт», а сама отправка проверяется тестовым сообщением по ступени «Notify».
-- Пока проверка не прошла по каждому филиалу, ступень Fromni остаётся в списке
-- и эту миграцию применять рано.
--
-- Журнала это не касается: строки с «notify+vk» остаются как есть — так и было
-- отправлено, и расшифровка имени в отчётах оставлена на месте.

BEGIN;

-- ── Общий каскад сети ─────────────────────────────────────────────────────
--
-- Порядок сохраняем через WITH ORDINALITY, дубль снимаем DISTINCT ON по имени
-- ступени с наименьшим номером: если прямая ступень уже стояла выше, победит
-- её исходное место, а не место бывшей ступени Fromni.
UPDATE settings
   SET value = COALESCE((
         SELECT jsonb_agg(step ORDER BY idx)
           FROM (
             SELECT DISTINCT ON (step) step, idx
               FROM (
                 SELECT CASE WHEN e = '"notify+vk"'::jsonb
                             THEN '"imobis:vk"'::jsonb ELSE e END AS step,
                        ord AS idx
                   FROM jsonb_array_elements(value) WITH ORDINALITY AS t(e, ord)
               ) mapped
              ORDER BY step, idx
           ) deduped
       ), '[]'::jsonb)
 WHERE key = 'notif_cascade'
   AND value @> '["notify+vk"]'::jsonb;

-- ── Каскады филиалов ──────────────────────────────────────────────────────
UPDATE notif_branch_settings
   SET "cascade" = COALESCE((
         SELECT jsonb_agg(step ORDER BY idx)
           FROM (
             SELECT DISTINCT ON (step) step, idx
               FROM (
                 SELECT CASE WHEN e = '"notify+vk"'::jsonb
                             THEN '"imobis:vk"'::jsonb ELSE e END AS step,
                        ord AS idx
                   FROM jsonb_array_elements("cascade") WITH ORDINALITY AS t(e, ord)
               ) mapped
              ORDER BY step, idx
           ) deduped
       ), '[]'::jsonb)
 WHERE "cascade" @> '["notify+vk"]'::jsonb;

-- ── Собственные каскады событий ───────────────────────────────────────────
UPDATE notif_templates
   SET "cascade" = COALESCE((
         SELECT jsonb_agg(step ORDER BY idx)
           FROM (
             SELECT DISTINCT ON (step) step, idx
               FROM (
                 SELECT CASE WHEN e = '"notify+vk"'::jsonb
                             THEN '"imobis:vk"'::jsonb ELSE e END AS step,
                        ord AS idx
                   FROM jsonb_array_elements("cascade") WITH ORDINALITY AS t(e, ord)
               ) mapped
              ORDER BY step, idx
           ) deduped
       ), '[]'::jsonb)
 WHERE "cascade" @> '["notify+vk"]'::jsonb;

-- ── Тихие часы ────────────────────────────────────────────────────────────
--
-- Здесь порядок не значит ничего — это набор, а не маршрут, — поэтому хватает
-- jsonb_agg(DISTINCT …). Как и в 8.50, ступень заменяется, а не удаляется:
-- список отвечает на вопрос «что ночью молчит», и потерять из него Notify
-- значило бы разрешить ночные уведомления там, где их запретили.
UPDATE settings
   SET value = jsonb_set(value, '{channels}', COALESCE((
         SELECT jsonb_agg(DISTINCT CASE WHEN e = '"notify+vk"'::jsonb
                                        THEN '"imobis:vk"'::jsonb ELSE e END)
           FROM jsonb_array_elements(value -> 'channels') AS t(e)
       ), '[]'::jsonb))
 WHERE key = 'notif_quiet_hours'
   AND value -> 'channels' @> '["notify+vk"]'::jsonb;

UPDATE notif_branch_settings
   SET "quietHours" = jsonb_set("quietHours", '{channels}', COALESCE((
         SELECT jsonb_agg(DISTINCT CASE WHEN e = '"notify+vk"'::jsonb
                                        THEN '"imobis:vk"'::jsonb ELSE e END)
           FROM jsonb_array_elements("quietHours" -> 'channels') AS t(e)
       ), '[]'::jsonb))
 WHERE "quietHours" -> 'channels' @> '["notify+vk"]'::jsonb;

COMMIT;
