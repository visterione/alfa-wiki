-- Уведомление о сборе отзыва (ver. 7.87).
--
-- Последнее событие из тех, что мы можем забрать у МИС своими силами. Оно
-- считается от завершения визита: в getAppointments статус 4 и есть «завершён»,
-- а date_completed даёт момент, от которого отсчитывается интервал.
--
-- Лабораторные уведомления (полная и частичная готовность) сюда не попадают
-- намеренно: getPatientLabResults требует patient_key, а он выдаётся только по
-- логину и паролю самого пациента (authPatient). Своим ключом интеграции его не
-- получить, значит узнать о готовности результатов мы не можем — эти два события
-- остаются за МИС.

-- До сих пор смещение было только «за сколько до визита». У отзыва оно обратное —
-- «через сколько после». Разные поля, а не одно со знаком: минус в интерфейсе
-- администратора читается хуже, чем два понятных вопроса.
ALTER TABLE notif_templates ADD COLUMN IF NOT EXISTS "afterMinutes" INTEGER;

-- Как часто спрашивать отзыв, если визитов у человека несколько:
--   each  — по каждому визиту
--   daily — один раз, после последнего визита за день
ALTER TABLE notif_templates ADD COLUMN IF NOT EXISTS frequency VARCHAR(10) NOT NULL DEFAULT 'each';

-- Момент завершения визита. Нужен, чтобы отсчитать интервал от него, а не от
-- времени начала приёма: приём мог задержаться или затянуться.
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS date_completed TIMESTAMP WITH TIME ZONE;

INSERT INTO notif_templates (event, text, "afterMinutes", frequency, "withConfirm")
SELECT 'review',
       'Здравствуйте, {{имя}}! Вы были сегодня у врача {{врач}}. Расскажите, всё ли понравилось — нам важно ваше мнение.',
       180, 'daily', FALSE
WHERE NOT EXISTS (SELECT 1 FROM notif_templates WHERE event = 'review');
