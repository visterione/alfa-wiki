-- Приём событий от МИС (ver. 7.88).
--
-- В админке Renovatio нашлась настройка «уведомления о событиях»: название,
-- адрес обращения и событие из списка — по одной записи на событие. Это и есть
-- второй конец моста, который мы искали: МИС сама зовёт указанный адрес.
--
-- Почему это важно именно для лаборатории. Готовность результатов через
-- публичное API не спросить: getPatientLabResults требует patient_key, а он
-- выдаётся только по логину и паролю самого пациента. Но спрашивать и не нужно —
-- МИС расскажет сама, ровно так же, как рассказывала мосту Fromni.
--
-- Сначала только принимаем и записываем как есть. Формат тела нам неизвестен, и
-- гадать о нём по документации мы уже один раз попробовали (getAppointmentsV2).

CREATE TABLE IF NOT EXISTS mis_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Что это было, по нашей же ссылке: адрес приёмника содержит имя события,
    -- потому что в настройке МИС одна запись = одно событие.
    event        VARCHAR(50),
    -- Тело и заголовки целиком. Разбирать начнём, когда увидим настоящий формат.
    body         JSONB NOT NULL DEFAULT '{}'::jsonb,
    headers      JSONB NOT NULL DEFAULT '{}'::jsonb,
    method       VARCHAR(10),
    query        JSONB NOT NULL DEFAULT '{}'::jsonb,
    "remoteAddr" VARCHAR(64),
    processed    BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mis_events_created_idx ON mis_events ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS mis_events_event_idx ON mis_events (event, processed);
