-- Свои боты Telegram/MAX (ver. 7.84).
--
-- До этого боты жили у агрегатора Fromni, а мы только вычитывали оттуда список
-- подписчиков. Своих ботов не поднимали по двум причинам: у бота может быть лишь
-- один потребитель входящих (вебхук занимала Fromni) и считалось, что до
-- api.telegram.org с боевого сервера не достучаться без прокси. Второе проверено
-- 06.09.2026 и оказалось неверным — оба API отвечают напрямую, поэтому боты
-- переезжают к нам, а вместе с ними уходит и конфликт вебхуков.

CREATE TABLE IF NOT EXISTS messenger_bots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform      VARCHAR(20)  NOT NULL,          -- telegram | max
    organization  VARCHAR(50)  NOT NULL,          -- ключ из bot/patient/config.js, 'test' для проверочных
    token         TEXT         NOT NULL,          -- ключ бота; в репозиторий не попадает, заводится скриптом
    username      VARCHAR(100),                   -- @имя, заполняется ответом getMe
    title         VARCHAR(150),                   -- как называть бота в интерфейсе
    -- Секрет вебхука. Telegram возвращает его в заголовке X-Telegram-Bot-Api-Secret-Token,
    -- и это единственный способ отличить настоящее обновление от постороннего запроса:
    -- адрес приёмника публичный и защищён только этим значением.
    "webhookSecret" VARCHAR(64) NOT NULL,
    "isActive"    BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_bots_token_key ON messenger_bots (token);
CREATE INDEX IF NOT EXISTS messenger_bots_org_idx ON messenger_bots (organization, platform);

-- Подписчик приходит теперь не только выгрузкой из Fromni, но и живым ботом,
-- поэтому запоминаем, каким именно.
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "botId" UUID;

-- Человек может заблокировать бота — Telegram отвечает на отправку 403. Отмечаем
-- это на месте, чтобы каскад сразу уходил на следующую ступень и не тратил
-- попытку на заведомо закрытый канал.
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS bot_subscribers_phone_idx ON bot_subscribers (phone);
