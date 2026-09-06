-- Открытая линия: обращения пациентов из ботов (ver. 7.85).
--
-- Устройство повторяет то, к чему в колл-центре уже привыкли по Битриксу: на
-- каждый медцентр своя линия, у линии свой состав сотрудников, и новые обращения
-- видят только те, кто начал день. Смысл смены именно в этом — чужие чаты не
-- должны мигать у того, кто сегодня занят другим.
--
-- Пациент намеренно НЕ становится пользователем портала. Учётка втянула бы его в
-- три десятка мест, где перечисляются сотрудники: поиск, создание чатов, списки
-- участников, права на файлы. Собеседник здесь — подписчик бота из
-- bot_subscribers, и дальше этого модуля он нигде не появляется.

-- ── Линия ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS omni_lines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Пусто у проверочной линии: тестовый бот не относится к живому медцентру.
    "medCenterId" UUID REFERENCES med_centers(id) ON DELETE SET NULL,
    name          VARCHAR(150) NOT NULL,
    -- Ответ, когда на линии нет ни одного человека на смене. Шлётся один раз за
    -- обращение, а не на каждое сообщение: иначе человек, написавший ночью три
    -- строки, получит три одинаковых извинения.
    "offlineReply" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Бот кормит конкретную линию. Связь явная, а не «по ключу организации»: на один
-- медцентр приходится два бота (Telegram и MAX), и наоборот — небольшие центры
-- со временем могут обслуживаться одной линией.
ALTER TABLE messenger_bots ADD COLUMN IF NOT EXISTS "lineId" UUID REFERENCES omni_lines(id) ON DELETE SET NULL;

-- ── Состав линии и смены ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS omni_line_operators (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "lineId"    UUID NOT NULL REFERENCES omni_lines(id) ON DELETE CASCADE,
    "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Признак «начал день». Хранится на связи, а не на пользователе: сотрудник
    -- может числиться на нескольких линиях и открыть не все.
    "onShift"   BOOLEAN NOT NULL DEFAULT FALSE,
    "shiftStartedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_line_operators_uniq ON omni_line_operators ("lineId", "userId");
CREATE INDEX IF NOT EXISTS omni_line_operators_shift_idx ON omni_line_operators ("lineId", "onShift");

-- ── Обращения ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS omni_conversations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "lineId"       UUID NOT NULL REFERENCES omni_lines(id) ON DELETE CASCADE,
    -- Собеседник — подписчик бота. Через него же достаётся телефон и карточка МИС.
    "subscriberId" UUID NOT NULL REFERENCES bot_subscribers(id) ON DELETE CASCADE,
    "botId"        UUID REFERENCES messenger_bots(id) ON DELETE SET NULL,
    -- queued — в общей очереди, видно всем на смене
    -- assigned — взято в работу, отвечает один
    -- closed — завершено, остаётся в архиве
    status         VARCHAR(12) NOT NULL DEFAULT 'queued',
    "assigneeUserId" UUID REFERENCES users(id) ON DELETE SET NULL,
    "assignedAt"   TIMESTAMP WITH TIME ZONE,
    "closedAt"     TIMESTAMP WITH TIME ZONE,
    "closedBy"     UUID REFERENCES users(id) ON DELETE SET NULL,
    "lastMessageAt"  TIMESTAMP WITH TIME ZONE,
    "lastIncomingAt" TIMESTAMP WITH TIME ZONE,
    -- Когда отправили извинение об отсутствии людей на линии (см. offlineReply).
    "offlineNoticeAt" TIMESTAMP WITH TIME ZONE,
    "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_conversations_queue_idx ON omni_conversations ("lineId", status, "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS omni_conversations_assignee_idx ON omni_conversations ("assigneeUserId", status);
-- Открытое обращение у собеседника может быть только одно: второе сообщение
-- продолжает начатый разговор, а не заводит новую карточку в очереди.
CREATE UNIQUE INDEX IF NOT EXISTS omni_conversations_open_uniq
    ON omni_conversations ("subscriberId") WHERE status <> 'closed';

CREATE TABLE IF NOT EXISTS omni_messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL REFERENCES omni_conversations(id) ON DELETE CASCADE,
    direction        VARCHAR(3) NOT NULL,          -- in | out
    -- Пусто у входящих: их автор — пациент, а он не пользователь портала.
    "authorUserId"   UUID REFERENCES users(id) ON DELETE SET NULL,
    text             TEXT NOT NULL DEFAULT '',
    -- Файлы храним у себя: ссылки мессенджеров живут около часа, а внутри вполне
    -- может оказаться фотография направления или анализов.
    attachments      JSONB NOT NULL DEFAULT '[]'::jsonb,
    "externalMessageId" VARCHAR(64),
    "deliveryError"  TEXT,
    "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_messages_conversation_idx ON omni_messages ("conversationId", "createdAt");
