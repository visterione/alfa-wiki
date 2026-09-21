-- Оценка визита кнопкой в боте (ver. 8.49).
--
-- Просьба об отзыве существует с 7.86, но была просьбой в один конец: уходил
-- текст «расскажите, всё ли понравилось», а ответить на него человек мог только
-- сообщением — и оно попадало в открытую линию обычным обращением. То есть
-- оценки как числа у сети не было вовсе: ни средней по филиалу, ни по врачу, ни
-- даже счёта «сколько людей вообще ответили».
--
-- Кнопки 1–5 в боте уже были, но чужие: их ставит открытая линия после закрытия
-- обращения, и оценивается там работа оператора, привязанная к сессии
-- переписки. К визиту и врачу она отношения не имеет, и складывать одно с
-- другим нельзя — это два разных вопроса к разным людям.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКА В notif_outbox. Outbox отвечает на
-- вопрос «что мы отправили и чем кончилось», и строки в нём живут по своему
-- сроку. Оценка — это ответ пациента, факт другой природы: он приходит через
-- часы после отправки, переписывается (промахнулись по соседней цифре), а
-- дополняется текстом причины и вовсе отдельным сообщением. Плюс по оценкам
-- будут считать средние по врачу и филиалу, и делать это запросом по журналу
-- отправок значило бы каждый раз объяснять, почему в выборке участвуют
-- недоставленные напоминания.
--
-- Связь с outbox всё же есть и она — ключ повтора: кнопка под сообщением несёт
-- id строки outbox, по нему и находится, к какому визиту относится нажатие.
-- Уникальность по outbox_id означает «одна оценка на одну просьбу»: повторное
-- нажатие переписывает ту же строку, а не заводит вторую.

BEGIN;

-- Галка шаблона. Отдельным признаком, а не третьим значением withConfirm:
-- у события отзыва подтверждения и отмены не бывает по смыслу — визит уже
-- состоялся, — а у записи и напоминания не бывает оценки, оценивать ещё нечего.
ALTER TABLE notif_templates
  ADD COLUMN IF NOT EXISTS "withRating" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN notif_templates."withRating" IS
  'Кнопки оценки 1–5 под сообщением (ver. 8.49). Осмысленна только у события review';

-- Снимок галки на момент заведения события — ровно по той же причине, что и
-- тексты рядом: между заведением и отправкой проходят часы, за это время галку
-- могут снять, и кнопка должна соответствовать обещанному тексту.
ALTER TABLE notif_outbox
  ADD COLUMN IF NOT EXISTS "withRating" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN notif_outbox."withRating" IS
  'Снимок настройки шаблона: ставить ли под сообщением кнопки оценки (ver. 8.49)';

CREATE TABLE IF NOT EXISTS notif_visit_ratings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Какая именно просьба породила оценку. ON DELETE SET NULL, а не CASCADE:
    -- журнал отправок когда-нибудь начнут чистить по сроку, и оценка не должна
    -- уезжать вместе с сообщением, которым её попросили.
    outbox_id     UUID REFERENCES notif_outbox(id) ON DELETE SET NULL,
    appt_id       INTEGER,
    patient_id    INTEGER,
    -- Филиал и врач сохранены строкой на момент оценки, а не вычисляются по
    -- визиту при чтении: визит в notif_appointments живёт до следующей уборки,
    -- а оценка остаётся навсегда и должна отвечать на вопрос «кого оценили»
    -- сама по себе.
    "medCenterId" UUID REFERENCES med_centers(id) ON DELETE SET NULL,
    doctor_name   VARCHAR(255),
    visit_at      TIMESTAMP WITH TIME ZONE,
    score         SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    -- Причина низкой оценки: следующее сообщение человека после вопроса «что
    -- пошло не так». У оценки 4–5 остаётся пустым — мы о ней не спрашиваем.
    comment       TEXT,
    platform      VARCHAR(20),
    subscriber_id UUID REFERENCES bot_subscribers(id) ON DELETE SET NULL,
    -- Карточка на доске отзывов, заведённая по этой оценке. Пусто — карточки
    -- нет: оценка высокая либо причину не написали.
    "reviewId"    UUID REFERENCES reviews(id) ON DELETE SET NULL,
    -- До какого момента следующее сообщение этого человека считается причиной
    -- низкой оценки, а не новым вопросом оператору. Пусто — не ждём.
    comment_wait_until TIMESTAMP WITH TIME ZONE,
    rated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    commented_at  TIMESTAMP WITH TIME ZONE,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notif_visit_ratings IS
  'Оценка визита кнопкой в боте (ver. 8.49). Оценка приёма и врача — не путать с оценкой работы оператора в omni_sessions.rating';

CREATE UNIQUE INDEX IF NOT EXISTS notif_visit_ratings_outbox_uniq
  ON notif_visit_ratings (outbox_id) WHERE outbox_id IS NOT NULL;

-- Средние по филиалу за период — главный запрос к этой таблице.
CREATE INDEX IF NOT EXISTS notif_visit_ratings_branch_idx
  ON notif_visit_ratings ("medCenterId", rated_at);
CREATE INDEX IF NOT EXISTS notif_visit_ratings_doctor_idx
  ON notif_visit_ratings (doctor_name);
CREATE INDEX IF NOT EXISTS notif_visit_ratings_appt_idx
  ON notif_visit_ratings (appt_id);
-- Частичный: ожидание причины проверяется на КАЖДОЕ входящее сообщение бота,
-- а строк в этом состоянии единицы — остальные миллионы индексу не нужны.
CREATE INDEX IF NOT EXISTS notif_visit_ratings_waiting_idx
  ON notif_visit_ratings (subscriber_id, comment_wait_until)
  WHERE comment_wait_until IS NOT NULL;

-- Площадка «Наш бот» для карточек, заводимых по низким оценкам. Заводим здесь,
-- а не первым срабатыванием: администратор должен увидеть её в отборе доски
-- сразу, а не после первой жалобы.
INSERT INTO review_platforms (id, name, "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Наш бот', TRUE, 5, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM review_platforms WHERE name = 'Наш бот');

COMMIT;
