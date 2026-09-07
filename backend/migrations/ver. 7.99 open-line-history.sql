-- Открытая линия: вечная переписка, обращения-сессии, смены и оценки (ver. 7.99).
--
-- Что не так было раньше. Обращение и переписка были одним и тем же: закрыли
-- вопрос, человек написал через неделю снова — заводилась вторая карточка.
-- Оператор получал пустой чат без единой строки предыстории, а в архиве по
-- одному пациенту лежало по десятку отдельных кусков одного разговора, и
-- «найти, о чём с ним говорили» означало открыть их все по очереди.
--
-- Теперь переписка у собеседника одна и живёт вечно, а обращение стало сессией
-- внутри неё: от первого вопроса до закрытия оператором. Сессия нужна не для
-- показа — лента у оператора сплошная, — а для учёта: по ней считаются оценка
-- работы сотрудника, время до первого ответа и доля разобранных обращений.
--
-- Переписки разных мессенджеров намеренно НЕ сводятся. Подписчик заведён на
-- пару «платформа + организация», и один человек в Telegram и в MAX — это два
-- подписчика: общего идентификатора у платформ нет, а телефон есть не у всех.

-- ── Карточка пациента в заголовке чата ────────────────────────────────────
--
-- Телефон в заголовке бесполезен: по нему всё равно лезут в МИС. Держим снимок
-- карточки — «№123456 Иванов Иван Иванович (01.01.1999)». Снимок, а не запрос
-- на лету: список обращений иначе ходил бы в МИС на каждую строку.
--
-- Если по номеру заведена вся семья, берётся самый старший: почти всегда пишет
-- именно он, а если нет — оператор уточнит в разговоре.

ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "patientCard" VARCHAR(30);
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "patientName" VARCHAR(250);
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "patientBirthDate" VARCHAR(20);
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "patientCheckedAt" TIMESTAMP WITH TIME ZONE;

-- ── Обращение внутри переписки ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS omni_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL REFERENCES omni_conversations(id) ON DELETE CASCADE,
    -- Линия и бот дублируются с переписки: бота могли перепривязать к другой
    -- линии, и прошлогоднее обращение должно остаться посчитанным там, где его
    -- на самом деле разбирали.
    "lineId"         UUID NOT NULL REFERENCES omni_lines(id) ON DELETE CASCADE,
    "botId"          UUID REFERENCES messenger_bots(id) ON DELETE SET NULL,
    "openedAt"       TIMESTAMP WITH TIME ZONE NOT NULL,
    "assigneeUserId" UUID REFERENCES users(id) ON DELETE SET NULL,
    "assignedAt"     TIMESTAMP WITH TIME ZONE,
    -- Первый ответ живого человека, а не бота: по нему видно, сколько пациент
    -- ждал сотрудника.
    "firstReplyAt"   TIMESTAMP WITH TIME ZONE,
    "closedAt"       TIMESTAMP WITH TIME ZONE,
    "closedBy"       UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Извинение за пустую линию переехало сюда с переписки: раз на обращение, а
    -- не раз на человека. Иначе вернувшийся через месяц ночью не получил бы его
    -- вовсе.
    "offlineNoticeAt" TIMESTAMP WITH TIME ZONE,
    "ratingAskedAt"  TIMESTAMP WITH TIME ZONE,
    rating           INTEGER,     -- 1..5, ставит пациент кнопкой в боте
    "ratedAt"        TIMESTAMP WITH TIME ZONE,
    "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_sessions_conversation_idx ON omni_sessions ("conversationId", "openedAt");
CREATE INDEX IF NOT EXISTS omni_sessions_line_idx ON omni_sessions ("lineId", "openedAt");
CREATE INDEX IF NOT EXISTS omni_sessions_assignee_idx ON omni_sessions ("assigneeUserId", "closedAt");

-- ── Отработанные смены ────────────────────────────────────────────────────
--
-- Начало смены жило одним полем на связи «сотрудник — линия» и стиралось
-- следующим «закончить смену». Сказать, сколько обращений пришло, пока человек
-- был на линии, было не по чему — а это и есть знаменатель KPI: сравнивать
-- разобранное с общим потоком за месяц нечестно к тому, кто выходит через день.

CREATE TABLE IF NOT EXISTS omni_shifts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "lineId"    UUID NOT NULL REFERENCES omni_lines(id) ON DELETE CASCADE,
    "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endedAt"   TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_shifts_user_idx ON omni_shifts ("userId", "startedAt");
CREATE INDEX IF NOT EXISTS omni_shifts_line_idx ON omni_shifts ("lineId", "startedAt");

-- Уже открытые смены переносим, чтобы никому не пришлось перещёлкивать кнопку.
INSERT INTO omni_shifts ("lineId", "userId", "startedAt")
SELECT o."lineId", o."userId", o."shiftStartedAt"
FROM omni_line_operators o
WHERE o."onShift" AND o."shiftStartedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM omni_shifts s
    WHERE s."userId" = o."userId" AND s."lineId" = o."lineId" AND s."endedAt" IS NULL
  );

-- ── Перенос старых данных ─────────────────────────────────────────────────

ALTER TABLE omni_messages ADD COLUMN IF NOT EXISTS "sessionId" UUID REFERENCES omni_sessions(id) ON DELETE SET NULL;

-- Каждая существующая переписка — ровно одно прошлое обращение. Делается до
-- слияния: пока переписок много, соответствие «сообщение → обращение»
-- однозначное, а после слияния восстановить его было бы уже нечем.
INSERT INTO omni_sessions (
    "conversationId", "lineId", "botId", "openedAt",
    "assigneeUserId", "assignedAt", "closedAt", "closedBy", "offlineNoticeAt", "createdAt"
)
SELECT c.id, c."lineId", c."botId", c."createdAt",
       c."assigneeUserId", c."assignedAt", c."closedAt", c."closedBy", c."offlineNoticeAt", c."createdAt"
FROM omni_conversations c
WHERE NOT EXISTS (SELECT 1 FROM omni_sessions s WHERE s."conversationId" = c.id);

UPDATE omni_messages m
SET "sessionId" = s.id
FROM omni_sessions s
WHERE s."conversationId" = m."conversationId" AND m."sessionId" IS NULL;

-- Слияние переписок одного собеседника в одну. Выживает открытая, а если все
-- закрыты — самая свежая: у выжившей уже верные статус и исполнитель, и
-- пересчитывать их не приходится.
CREATE TEMP TABLE ol_merge ON COMMIT DROP AS
SELECT id,
       FIRST_VALUE(id) OVER (
         PARTITION BY "subscriberId"
         ORDER BY (status <> 'closed') DESC, COALESCE("lastMessageAt", "createdAt") DESC, "createdAt" DESC
       ) AS keep
FROM omni_conversations;

UPDATE omni_messages m SET "conversationId" = k.keep
FROM ol_merge k WHERE m."conversationId" = k.id AND k.keep <> k.id;

UPDATE omni_sessions s SET "conversationId" = k.keep
FROM ol_merge k WHERE s."conversationId" = k.id AND k.keep <> k.id;

DELETE FROM omni_conversations c
USING ol_merge k WHERE c.id = k.id AND k.keep <> k.id;

-- Последняя реплика могла приехать из присоединённой переписки — иначе список
-- расставит слитые чаты по дате, которой у них уже нет.
UPDATE omni_conversations c
SET "lastMessageAt" = m.mx
FROM (SELECT "conversationId", MAX("createdAt") AS mx FROM omni_messages GROUP BY "conversationId") m
WHERE m."conversationId" = c.id
  AND (c."lastMessageAt" IS NULL OR c."lastMessageAt" < m.mx);

-- ── Один чат на собеседника ───────────────────────────────────────────────

-- Было: «открытое обращение может быть только одно». Стало: «переписка может
-- быть только одна» — закрытая в том числе.
DROP INDEX IF EXISTS omni_conversations_open_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS omni_conversations_subscriber_uniq
    ON omni_conversations ("subscriberId");

-- Отметка об извинении переехала на обращение (см. выше).
ALTER TABLE omni_conversations DROP COLUMN IF EXISTS "offlineNoticeAt";
