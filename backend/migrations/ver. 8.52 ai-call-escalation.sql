-- Догоняющий ИИ-звонок молчунам (ver. 8.52).
--
-- Напоминание о визите уходит с кнопками «Подтверждаю» и «Отменить запись» с
-- 8.33, и нажатие тут же попадает в МИС. Но нажимают не все: часть людей
-- сообщение даже не открывает. Про таких колл-центр узнавал только в день
-- приёма и обзванивал вручную.
--
-- Теперь по каждому отправленному напоминанию с кнопкой заводится отложенная
-- заявка: через настроенное время спрашиваем, ответил ли человек, и если нет —
-- отдаём его карточку в CRM партнёра. Звонок делает она; у нас нет ни
-- телефонии, ни сценария разговора, и наша часть заканчивается лидом.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ СТРОКА В notif_outbox. По очереди отвечают на
-- вопрос «что человек получил и почему не получил». Передача его данных
-- стороннему API — соседний вопрос: кому мы их отдали и что нам ответили. Плюс
-- на очередь завязан каскад отправщика, который попытался бы такую строку
-- кому-нибудь доставить.
--
-- ПОЧЕМУ СНИМОК НАСТРОЙКИ В ОЧЕРЕДИ. Напоминаний у филиала бывает несколько —
-- за сутки и за два часа, — и по строке очереди уже не узнать, которое из них
-- её завело. Единственной зацепкой был бы разбор ключа идемпотентности, а
-- строить на нём поведение, которое звонит живым людям, нельзя.

BEGIN;

-- ── Настройка события ─────────────────────────────────────────────────────

-- NULL означает «не звонить». Именно NULL, а не 0: выключение должно быть
-- отсутствием настройки, а не нулём, который в интерфейсе неотличим от
-- «позвонить сразу же».
ALTER TABLE notif_templates
  ADD COLUMN IF NOT EXISTS call_after_minutes integer,
  ADD COLUMN IF NOT EXISTS call_min_lead_minutes integer;

COMMENT ON COLUMN notif_templates.call_after_minutes IS
  'Через сколько минут после отправки звонить, если пациент не ответил. NULL — не звонить';
COMMENT ON COLUMN notif_templates.call_min_lead_minutes IS
  'За сколько минут до визита заявка гаснет: звонок человеку у кабинета бессмысленен';

ALTER TABLE notif_outbox
  ADD COLUMN IF NOT EXISTS call_after_minutes integer,
  ADD COLUMN IF NOT EXISTS call_min_lead_minutes integer;

COMMENT ON COLUMN notif_outbox.call_after_minutes IS
  'Снимок настройки звонка с шаблона, породившего строку (ver. 8.52)';

-- ── Счёт филиала в CRM ────────────────────────────────────────────────────

-- На филиал, а не на сеть: у партнёра лиды разведены по клиникам, общего
-- адреса, куда их складывать, нет. Ровно та же причина, по которой на филиал
-- лёг счёт Имобиса в 8.25.
ALTER TABLE notif_branch_settings
  ADD COLUMN IF NOT EXISTS ai_call jsonb;

COMMENT ON COLUMN notif_branch_settings.ai_call IS
  'CRM филиала для ИИ-звонков: { url, token, header, enabled }';

-- ── Заявки ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notif_call_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appt_id           integer,
  -- Сообщение, на которое не ответили. Уникально: одно отправленное
  -- напоминание порождает ровно одну заявку, и это же отсекает повтор, если
  -- отправщик возьмётся за ту же строку дважды.
  outbox_id         uuid,
  med_center_id     uuid,
  patient_id        integer,
  phone             varchar(30),
  -- Данные пациента лежат здесь копией, как и в notif_visit_ratings, и по той
  -- же причине: notif_appointments — рабочий стол детектора, а заявка должна
  -- отвечать «кого и почему передали наружу» сама по себе.
  patient_name      varchar(255),
  doctor_name       varchar(255),
  visit_at          timestamptz,
  planned_at        timestamptz NOT NULL,
  min_lead_minutes  integer,
  -- pending — ждёт срока; sent — лид ушёл; skipped — звонить не нужно или уже
  -- поздно, причина в error; failed — CRM не приняла.
  status            varchar(12) NOT NULL DEFAULT 'pending',
  attempts          smallint NOT NULL DEFAULT 0,
  error             text,
  -- Что именно ушло наружу. Храним целиком: это передача персональных данных
  -- третьему лицу, и на вопрос «что вы им отдали» отвечать придётся дословно.
  payload           jsonb,
  response          jsonb,
  sent_at           timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notif_call_requests_outbox_id
  ON notif_call_requests (outbox_id);
CREATE INDEX IF NOT EXISTS notif_call_requests_status_planned
  ON notif_call_requests (status, planned_at);
CREATE INDEX IF NOT EXISTS notif_call_requests_appt
  ON notif_call_requests (appt_id);

COMMENT ON TABLE notif_call_requests IS
  'Заявки на догоняющий ИИ-звонок пациентам, не ответившим на кнопки напоминания (ver. 8.52)';

COMMIT;
