-- Рекламные рассылки подписчикам ботов (ver. 8.07).
--
-- До сих пор бот писал человеку только по делу: напоминание о визите из очереди
-- уведомлений или ответ оператора в открытой линии. Сеть хочет ещё и анонсы
-- акций — картинка с подписью, адресно по медцентрам.
--
-- ПОЧЕМУ ОТДЕЛЬНЫЕ ТАБЛИЦЫ, А НЕ notif_outbox. Очередь уведомлений устроена под
-- события МИС: у строки есть appt_id, дедуп-ключ с породившим значением и
-- каскад, который при неудаче бота уходит на платный SMS. Рекламе всё это
-- противопоказано. Дороже денег тут другое: реклама, ушедшая человеку SMS-кой,
-- — это уже не наша оплошность, а нарушение 38-ФЗ ст. 18 с адресатом-заявителем.
-- Каскада у рассылки нет вовсе: не дошло ботом — значит не дошло.
--
-- ПОЧЕМУ ДВЕ ТАБЛИЦЫ, А НЕ ОДНА СО СЧЁТЧИКАМИ. Строка на адресата нужна ради
-- трёх вещей: показать прогресс «отправлено 340 из 1900», ответить на вопрос
-- «а Иванову ушло?» и — главное — пережить падение процесса. Рассылка на всю
-- сеть идёт минутами; без отметки на каждом адресате перезапуск в середине
-- означал бы либо второй экземпляр сообщения половине базы, либо молчание для
-- другой половины.

CREATE TABLE IF NOT EXISTS omni_broadcasts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Внутреннее название для списка («Акция на УЗИ, октябрь»). Пациент его не видит.
    title            VARCHAR(150) NOT NULL,
    -- Подпись под картинкой. Предел в 1024 символа — не наш, а телеграмный:
    -- у сообщения с фотографией caption ограничен именно так (у текста без
    -- картинки было бы 4096). Проверка стоит и в интерфейсе, и на маршруте.
    text             TEXT NOT NULL DEFAULT '',
    -- Путь к загруженной картинке относительно uploads. Картинка необязательна:
    -- анонс вполне может быть текстовым.
    "imagePath"      VARCHAR(500),
    -- Медцентры-адресаты. Подписчик привязан к паре «платформа + организация»,
    -- медцентр же берётся у бота (messenger_bots."medCenterId", ver. 8.05) —
    -- бот и есть мост между тем и другим.
    "medCenterIds"   JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- draft   — черновик, наружу ничего не ушло;
    -- sending — набор адресатов зафиксирован, движок разбирает его;
    -- paused  — остановлена руками, возобновляема;
    -- done    — адресатов не осталось;
    -- failed  — не удалось даже загрузить картинку в мессенджер.
    status           VARCHAR(10) NOT NULL DEFAULT 'draft',
    -- Идентификатор уже загруженной картинки у платформы: file_id у Telegram,
    -- токен вложения у MAX. Ключ — платформа.
    --
    -- Ради этого поля рассылка и устроена в два шага. Отдать картинку ссылкой
    -- нельзя: скачивать её мессенджер пришёл бы к нам входящим соединением, а
    -- они до нас не доходят — на этом сломался вебхук и появился поллер. Значит
    -- файл уходит телом запроса, и делать так две тысячи раз незачем: первая
    -- отправка возвращает идентификатор, остальные ссылаются на него.
    "mediaIds"       JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdBy"      UUID REFERENCES users(id) ON DELETE SET NULL,
    "startedAt"      TIMESTAMP WITH TIME ZONE,
    "finishedAt"     TIMESTAMP WITH TIME ZONE,
    "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_broadcasts_status_idx ON omni_broadcasts (status, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS omni_broadcast_targets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "broadcastId"    UUID NOT NULL REFERENCES omni_broadcasts(id) ON DELETE CASCADE,
    "subscriberId"   UUID NOT NULL REFERENCES bot_subscribers(id) ON DELETE CASCADE,
    "botId"          UUID REFERENCES messenger_bots(id) ON DELETE SET NULL,
    -- pending | sent | failed | skipped
    status           VARCHAR(10) NOT NULL DEFAULT 'pending',
    error            TEXT,
    "externalMessageId" VARCHAR(64),
    "sentAt"         TIMESTAMP WITH TIME ZONE,
    "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Один адресат в рассылке ровно один раз. Человек, подписанный на боты
    -- нескольких медцентров, — это разные подписчики, и в рассылку на обе
    -- клиники он попадёт дважды; так и задумано, это разные боты.
    CONSTRAINT omni_broadcast_targets_unique UNIQUE ("broadcastId", "subscriberId")
);

-- По этому индексу движок берёт следующую порцию.
CREATE INDEX IF NOT EXISTS omni_broadcast_targets_queue_idx
    ON omni_broadcast_targets ("broadcastId", status);

-- Отказ от рекламы. Отдельно от isBlocked намеренно: заблокировавший бота
-- недоступен вообще, а отписавшийся продолжает получать напоминания о визитах
-- и разговаривать с открытой линией — он отказался от анонсов, а не от нас.
--
-- Кнопка «Не присылать рассылки» висит только под рекламным сообщением. Без неё
-- единственный доступный человеку способ прекратить рекламу — заблокировать
-- бота, и вместе с ней он унесёт канал напоминаний, ради которого всё строилось.
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "marketingOptOut" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "marketingOptOutAt" TIMESTAMP WITH TIME ZONE;
