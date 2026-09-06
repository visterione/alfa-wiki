-- Уведомления пациентам: события из МИС и каскад доставки (ver. 7.86).
--
-- Почему события ищем опросом, а не получаем толчком: у Renovatio свой движок
-- уведомлений, но наружу он отдаёт их через мост Fromni, к которому нам не
-- подключиться — второй конец настраивается внутри МИС, и его мы не видим. Зато
-- у getAppointments есть фильтр по дате изменения, поэтому вопрос «что
-- изменилось за последнюю минуту» стоит один дешёвый запрос и возвращает почти
-- всегда пустой список.

-- ── Снимок визитов ────────────────────────────────────────────────────────
--
-- Отдельно от mis_appointments намеренно. Тот кэш наполняется своей ночной
-- синхронизацией для склада и статистики и перезаписывает строки — сравнивать с
-- ним «что было до» невозможно. Здесь хранится ровно то, по чему считаются
-- события, и пишет сюда только сам детектор.
CREATE TABLE IF NOT EXISTS notif_appointments (
    appt_id        INTEGER PRIMARY KEY,
    clinic_id      SMALLINT,
    -- Название клиники приходит в самом визите. Сопоставлять его с нашим
    -- справочником ради подстановки не нужно: МИС уже дала готовую строку.
    clinic_name    VARCHAR(255),
    patient_id     INTEGER,
    phone          VARCHAR(30),
    patient_name   VARCHAR(255),
    doctor_name    VARCHAR(255),
    time_start     TIMESTAMP WITH TIME ZONE,
    status_id      SMALLINT,
    confirm_status SMALLINT,
    seen_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notif_appointments_time_idx ON notif_appointments (time_start);

-- ── Шаблоны ───────────────────────────────────────────────────────────────
--
-- Тексты уезжают из МИС к нам вместе с самой отправкой: раз инициатор мы, то и
-- шаблон должен лежать здесь. Подстановки те же по смыслу, что на экране
-- Renovatio, но с русскими именами — их правит администратор, а не программист.
CREATE TABLE IF NOT EXISTS notif_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event         VARCHAR(20) NOT NULL,   -- created | moved | cancelled | reminder
    -- Пусто — шаблон общий на всю сеть. Заполнено — переопределение для клиники.
    "medCenterId" UUID REFERENCES med_centers(id) ON DELETE CASCADE,
    text          TEXT NOT NULL,
    -- Только для напоминаний: за сколько минут до визита отправлять. У одного
    -- события может быть несколько строк — напомнить и за сутки, и за два часа.
    "beforeMinutes" INTEGER,
    -- Кнопка «Подтверждаю» под сообщением. Осмысленна у записи и напоминания.
    "withConfirm" BOOLEAN NOT NULL DEFAULT FALSE,
    "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notif_templates_event_idx ON notif_templates (event, "isActive");

-- ── Очередь отправки и журнал ─────────────────────────────────────────────
--
-- Одна таблица на то и другое: запись создаётся в состоянии pending и остаётся
-- навсегда с исходом. Отдельный журнал пришлось бы держать в согласии с
-- очередью, а на вопрос «почему человек не получил напоминание» отвечать всё
-- равно по нему.
CREATE TABLE IF NOT EXISTS notif_outbox (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appt_id       INTEGER,
    event         VARCHAR(20) NOT NULL,
    -- Ключ повтора. Одно и то же событие не должно уйти дважды после
    -- перезапуска или повторного прогона: в ключ входит и значение, из-за
    -- которого событие возникло (новое время визита у переноса).
    dedup_key     VARCHAR(200) NOT NULL,
    patient_id    INTEGER,
    phone         VARCHAR(30),
    text          TEXT NOT NULL,
    "withConfirm" BOOLEAN NOT NULL DEFAULT FALSE,
    -- Когда отправлять. У напоминаний — заранее рассчитанный момент, у
    -- остальных событий совпадает с созданием.
    planned_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status        VARCHAR(12) NOT NULL DEFAULT 'pending',  -- pending | sent | failed | skipped
    channel       VARCHAR(20),          -- чем в итоге доставили
    error         TEXT,
    sent_at       TIMESTAMP WITH TIME ZONE,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notif_outbox_dedup_uniq ON notif_outbox (dedup_key);
CREATE INDEX IF NOT EXISTS notif_outbox_due_idx ON notif_outbox (status, planned_at);
CREATE INDEX IF NOT EXISTS notif_outbox_appt_idx ON notif_outbox (appt_id);

-- Шаблоны по умолчанию. Заводятся только если событий ещё нет: повторный запуск
-- миграции не должен затирать тексты, поправленные заказчиком.
INSERT INTO notif_templates (event, text, "beforeMinutes", "withConfirm")
SELECT * FROM (VALUES
  ('created',   'Здравствуйте, {{имя}}! Вы записаны на {{дата}} в {{время}}, врач {{врач}}. Ждём вас в {{клиника}}.', NULL, TRUE),
  ('moved',     'Здравствуйте, {{имя}}! Ваш визит перенесён на {{дата}} в {{время}}, врач {{врач}}. {{клиника}}.', NULL, TRUE),
  ('cancelled', 'Здравствуйте, {{имя}}! Ваша запись на {{дата}} в {{время}} отменена. Если это ошибка, позвоните нам.', NULL, FALSE),
  ('reminder',  'Напоминаем: завтра, {{дата}} в {{время}}, вы записаны к врачу {{врач}}. {{клиника}}.', 1440, TRUE)
) AS defaults(event, text, "beforeMinutes", "withConfirm")
WHERE NOT EXISTS (SELECT 1 FROM notif_templates);
