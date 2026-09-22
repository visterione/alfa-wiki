-- Модуль «Почта» (ver. 8.58) — почтовый клиент для общих ящиков сети.
--
-- Ящики заводит администратор, человек получает доступ к готовому — своих
-- паролей никто не вводит. Их около сотни на восемь клиник, суммарно ~44 ГБ,
-- и держать это исключительно на стороне reg.ru нельзя: IMAP умеет искать
-- только внутри одной папки одного ящика, а нужен поиск сразу по всем, куда
-- у человека есть доступ. Поэтому здесь заводится локальное зеркало, а IMAP
-- остаётся источником, с которым зеркало сверяется.
--
-- Зеркало, а не единственная копия: удаление письма в портале доезжает до
-- сервера (решение заказчика), и наоборот — то, что удалили из Roundcube,
-- исчезнет и здесь. Переходный период, когда часть людей ещё в Roundcube, а
-- часть уже в портале, закладывается с самого начала.

-- ── Ящик ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mail_accounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          VARCHAR(320) NOT NULL UNIQUE,
    -- Чем подписывать исходящие: «Регистратура Альфа на Ленина», а не адрес.
    "displayName"  VARCHAR(150) NOT NULL,
    "medCenterId"  UUID REFERENCES med_centers(id) ON DELETE SET NULL,

    -- Координаты сервера на каждом ящике свои, хотя сейчас у всех одинаковые.
    -- Вбивать их в код нельзя: домены у сети разные, и почта части из них
    -- когда-нибудь переедет от reg.ru отдельно от остальных.
    "imapHost"     VARCHAR(255) NOT NULL DEFAULT 'mail.hosting.reg.ru',
    "imapPort"     INTEGER      NOT NULL DEFAULT 993,
    "imapSecure"   BOOLEAN      NOT NULL DEFAULT TRUE,
    "smtpHost"     VARCHAR(255) NOT NULL DEFAULT 'mail.hosting.reg.ru',
    "smtpPort"     INTEGER      NOT NULL DEFAULT 465,
    "smtpSecure"   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Обычно совпадает с email, но отдельным полем: на других хостингах логин
    -- бывает вида «u1234567_info».
    login          VARCHAR(320) NOT NULL,

    -- Пароль лежит обратимо зашифрованным — IMAP не умеет иначе, хэш здесь
    -- бесполезен. AES-256-GCM, ключ в MAIL_SECRET_KEY и только там.
    -- keyVersion нужен, чтобы ключ можно было однажды сменить, перешифровывая
    -- ящики по одному, а не останавливая всю почту ради разовой операции.
    "passwordEnc"  TEXT         NOT NULL,
    "passwordIv"   VARCHAR(64)  NOT NULL,
    "passwordTag"  VARCHAR(64)  NOT NULL,
    "keyVersion"   INTEGER      NOT NULL DEFAULT 1,

    "isActive"     BOOLEAN      NOT NULL DEFAULT TRUE,

    -- Что сервер ответил на CAPABILITY при последнем подключении. Снимается
    -- каждый раз заново, а не настраивается руками: хостер может включить или
    -- выключить QRESYNC когда угодно, и синхронизатор обязан это заметить сам.
    capabilities   JSONB        NOT NULL DEFAULT '{}',

    -- idle → headers → bodies → ready, либо error. Первичная заливка идёт в
    -- два прохода, и по этому полю видно, на каком ящик сейчас.
    "syncState"    VARCHAR(20)  NOT NULL DEFAULT 'idle',
    "syncStartedAt"  TIMESTAMP WITH TIME ZONE,
    "syncFinishedAt" TIMESTAMP WITH TIME ZONE,
    "lastSyncAt"     TIMESTAMP WITH TIME ZONE,
    "lastError"      TEXT,
    "lastErrorAt"    TIMESTAMP WITH TIME ZONE,

    -- Подпись, которая подставляется в исходящие. На ящик, а не на человека:
    -- письмо уходит от регистратуры клиники, и подписывать его личным именем
    -- оператора было бы неверно — отвечать на него будет уже другая смена.
    signature      TEXT,

    "sortOrder"    INTEGER      NOT NULL DEFAULT 100,
    "createdBy"    UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mail_accounts_active_idx ON mail_accounts ("isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS mail_accounts_medcenter_idx ON mail_accounts ("medCenterId");

-- ── Доступ ────────────────────────────────────────────────────────────────

-- Доступ выдаётся поимённо и только администратором. Соблазн выдавать его по
-- должности («все регистраторы такой-то клиники») сильный — текучка большая, и
-- списки придётся править руками. Но в этих ящиках жалобы и гарантийные письма
-- с фамилиями пациентов, а выдача по должности означает, что новый сотрудник
-- получит всю историю переписки раньше, чем кто-то об этом подумает.
CREATE TABLE IF NOT EXISTS mail_account_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId" UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Чтение подразумевается самим фактом строки: доступа «к ящику, но без
    -- писем» не бывает. Отдельно отмечается только то, что необратимо.
    "canSend"   BOOLEAN NOT NULL DEFAULT FALSE,
    "canDelete" BOOLEAN NOT NULL DEFAULT FALSE,
    -- Какой ящик открывается первым у человека с доступом к нескольким.
    "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
    "grantedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_account_users_uniq ON mail_account_users ("accountId", "userId");
CREATE INDEX IF NOT EXISTS mail_account_users_user_idx ON mail_account_users ("userId");

-- ── Папки ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mail_folders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId"   UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    -- Путь как его понимает сервер, им же и адресуемся при SELECT.
    path          VARCHAR(1000) NOT NULL,
    -- Человеческое имя последнего уровня, уже расшифрованное из модифицированного
    -- UTF-7: на сервере «Отправленные» выглядят как «&BB4EQgQ,BEAEMA-».
    name          VARCHAR(500)  NOT NULL,
    delimiter     VARCHAR(8),
    -- \Sent, \Trash, \Drafts, \Junk — берём из SPECIAL-USE, а не угадываем по
    -- имени: имена бывают русскими, английскими и разными на разных ящиках.
    "specialUse"  VARCHAR(20),
    flags         JSONB   NOT NULL DEFAULT '[]',
    selectable    BOOLEAN NOT NULL DEFAULT TRUE,

    -- Главная страховка зеркала. Если хостер переедет или восстановит ящик из
    -- копии, UIDVALIDITY сменится, и все наши UID разом станут мусором — папку
    -- надо перезаливать целиком. Без этой проверки зеркало однажды тихо
    -- разъедется с реальностью, и заметят это далеко не сразу.
    "uidValidity" BIGINT,
    "uidNext"     BIGINT,
    -- Есть только если сервер умеет CONDSTORE. Позволяет догонять изменения
    -- флагов одним запросом вместо перечитывания всей папки.
    "highestModSeq" BIGINT,

    "messagesTotal" INTEGER NOT NULL DEFAULT 0,
    "unseenTotal"   INTEGER NOT NULL DEFAULT 0,

    -- Докуда дошла первичная заливка. Заливка идёт от свежих к старым, поэтому
    -- курсор движется вниз: всё, что выше него, уже в зеркале.
    "backfillUid"   BIGINT,
    "backfillDone"  BOOLEAN NOT NULL DEFAULT FALSE,

    "lastSyncAt"  TIMESTAMP WITH TIME ZONE,
    "sortOrder"   INTEGER NOT NULL DEFAULT 100,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_folders_uniq ON mail_folders ("accountId", path);

-- ── Письмо ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mail_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId"  UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    "folderId"   UUID NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
    uid          BIGINT NOT NULL,

    -- Заголовок Message-ID. Одно и то же письмо лежит и во «Входящих», и в
    -- пользовательской папке, и приходит сразу на два наших ящика — без этого
    -- поля поиск выдавал бы его трижды.
    "messageId"  VARCHAR(998),
    "inReplyTo"  VARCHAR(998),
    "references" TEXT[],
    -- Корень цепочки: первый из References, иначе собственный Message-ID.
    -- Считается при разборе, чтобы не перебирать ссылки на каждый показ.
    "threadKey"  VARCHAR(998),

    subject      VARCHAR(2000),
    -- Отправитель продублирован сюда из mail_addresses намеренно: список писем
    -- читается постоянно, и джойн ради одной строки на каждое письмо — это
    -- лишняя работа на самом горячем запросе модуля.
    "fromName"   VARCHAR(300),
    "fromEmail"  VARCHAR(320),

    -- Дата из заголовка и дата получения сервером. Расходятся чаще, чем
    -- кажется: у отправителя сбиты часы, письмо пролежало в очереди. Сортируем
    -- по receivedAt — он не врёт, показываем sentAt.
    "sentAt"     TIMESTAMP WITH TIME ZONE,
    "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL,

    size         INTEGER NOT NULL DEFAULT 0,
    flags        TEXT[]  NOT NULL DEFAULT '{}',
    -- \Seen вынесен из flags отдельной колонкой ради индекса: «покажи
    -- непрочитанные» — второй по частоте запрос после «покажи последние».
    "isSeen"     BOOLEAN NOT NULL DEFAULT FALSE,
    "isFlagged"  BOOLEAN NOT NULL DEFAULT FALSE,
    "isAnswered" BOOLEAN NOT NULL DEFAULT FALSE,
    "isDraft"    BOOLEAN NOT NULL DEFAULT FALSE,

    "hasAttachments"   BOOLEAN NOT NULL DEFAULT FALSE,
    "attachmentsCount" SMALLINT NOT NULL DEFAULT 0,
    -- Первые строки текста для списка, чтобы не поднимать тело ради превью.
    preview      VARCHAR(300),

    -- Путь к сырому .eml.gz. Пусто, пока тело не скачано: первый проход
    -- заливки берёт только конверты, и список работает уже по ним.
    "rawPath"    VARCHAR(500),
    "bodyState"  VARCHAR(16) NOT NULL DEFAULT 'pending',
    "modSeq"     BIGINT,

    -- Письмо, которое человек удалил, но до сервера это ещё не доехало.
    --
    -- Строку не удаляем сразу намеренно. Удаление настоящее: письмо уезжает в
    -- «Корзину» на reg.ru и пропадает у всех, включая тех, кто сидит в
    -- Roundcube. Но если сервер в этот момент недоступен, а строку мы уже
    -- стёрли, письмо осталось бы на сервере и при этом исчезло из портала
    -- навсегда: обычная синхронизация его не вернёт, она забирает только UID
    -- выше известного максимума. Поэтому сначала прячем, а стираем — после
    -- подтверждения от сервера.
    "pendingDelete" BOOLEAN NOT NULL DEFAULT FALSE,

    "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_uid_uniq ON mail_messages ("folderId", uid);
CREATE INDEX IF NOT EXISTS mail_messages_folder_date_idx ON mail_messages ("folderId", "receivedAt" DESC) WHERE NOT "pendingDelete";
CREATE INDEX IF NOT EXISTS mail_messages_account_date_idx ON mail_messages ("accountId", "receivedAt" DESC) WHERE NOT "pendingDelete";
CREATE INDEX IF NOT EXISTS mail_messages_msgid_idx ON mail_messages ("messageId");
CREATE INDEX IF NOT EXISTS mail_messages_thread_idx ON mail_messages ("threadKey");
-- Отбор по теме идёт отдельно от полнотекстового поиска: «subject:договор»
-- должен смотреть только в тему, а не находить письма, где это слово мелькнуло
-- в подписи. Триграммы, а не FTS, потому что тему ищут и кусками — по номеру
-- счёта, по коду заявки.
CREATE INDEX IF NOT EXISTS mail_messages_subject_trgm ON mail_messages USING gin (subject gin_trgm_ops);
-- Частичный: непрочитанных всегда меньшинство, полный индекс был бы вдвое
-- больше и полезен ровно наполовину.
CREATE INDEX IF NOT EXISTS mail_messages_unseen_idx ON mail_messages ("accountId", "receivedAt" DESC) WHERE NOT "isSeen";
-- Очередь второго прохода заливки.
CREATE INDEX IF NOT EXISTS mail_messages_pending_idx ON mail_messages ("accountId", "receivedAt" DESC) WHERE "bodyState" = 'pending';

-- ── Адреса ────────────────────────────────────────────────────────────────

-- Адреса отдельной таблицей, а не строкой в письме. Выглядит избыточно, но
-- именно это даёт мгновенное «вся переписка с этим человеком», автодополнение
-- при ответе и работающий фильтр по отправителю. Если сразу не разнести,
-- переделывать придётся с переиндексацией всей почты.
CREATE TABLE IF NOT EXISTS mail_addresses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Всегда в нижнем регистре: Ivanov@ и ivanov@ — один и тот же человек.
    email           VARCHAR(320) NOT NULL UNIQUE,
    -- Последнее встреченное отображаемое имя. Люди меняют подпись, и спорить
    -- с этим бессмысленно — показываем свежее.
    name            VARCHAR(300),
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt"    TIMESTAMP WITH TIME ZONE,
    "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Триграммы, а не полнотекстовый поиск: по адресам и фамилиям ищут кусками
-- («гулие», «@alfa»), а стеммер такие обрывки только испортит.
CREATE INDEX IF NOT EXISTS mail_addresses_email_trgm ON mail_addresses USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS mail_addresses_name_trgm ON mail_addresses USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS mail_message_addresses (
    "messageId" UUID NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    "addressId" UUID NOT NULL REFERENCES mail_addresses(id) ON DELETE CASCADE,
    role        VARCHAR(10) NOT NULL,
    -- Имя именно в этом письме: в mail_addresses лежит последнее, а в переписке
    -- важно, как человек подписался тогда.
    name        VARCHAR(300),
    PRIMARY KEY ("messageId", "addressId", role)
);

CREATE INDEX IF NOT EXISTS mail_message_addresses_addr_idx ON mail_message_addresses ("addressId", role);

-- ── Тело письма ───────────────────────────────────────────────────────────

-- Отдельной таблицей от списка. Причина практическая: список читается
-- постоянно, и таскать за ним мегабайты тел — значит забивать кэш Postgres тем,
-- что для списка не нужно.
CREATE TABLE IF NOT EXISTS mail_message_bodies (
    "messageId"        UUID PRIMARY KEY REFERENCES mail_messages(id) ON DELETE CASCADE,
    "textBody"         TEXT,
    -- То же, но без процитированной переписки и подписи. Индексируем именно
    -- это: иначе ветка из двадцати писем вываливалась бы в поиске двадцатью
    -- одинаковыми строками, и поиском перестали бы пользоваться.
    "textStripped"     TEXT,
    "htmlSanitized"    TEXT,
    -- Версия профиля очистки. Когда санитайзер станет строже, по этому полю
    -- видно, какие письма пересчитать, — не перебирая полмиллиона.
    "sanitizerVersion" INTEGER NOT NULL DEFAULT 1,
    -- Индексируется ДВУМЯ конфигурациями сразу:
    --   to_tsvector('russian', …) || to_tsvector('simple', …)
    -- и запрос по simple-части строится с префиксом (`иванов:*`).
    --
    -- Одной русской конфигурации недостаточно, и это не теория: snowball режет
    -- фамилии несимметрично. «Иванов» превращается в лексему «иван», а
    -- «Иванову» — в «иванов»; это разные леммы, и поиск по фамилии в
    -- именительном падеже не находил письмо, где она в дательном. «Гулиев»
    -- стеммер и вовсе обращает в «гул», после чего письмо находится по слову
    -- «гулять». Для почты, где половина работы — жалобы и гарантийные письма с
    -- фамилиями, это означало бы поиск, работающий через раз.
    --
    -- simple ничего не стеммит, а префикс покрывает склонение: «иванов:*»
    -- находит «иванову», «иванова», «ивановым». Русская часть при этом
    -- остаётся и делает свою работу на обычных словах: «договору» → «договор».
    -- Платим удвоением размера индекса, и это дёшево.
    "searchVector"     tsvector,
    "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Индекс заводится сейчас, хотя поиском займёмся этапом позже: на пустой
-- таблице он бесплатен, а построить его потом на полумиллионе писем — это
-- отдельная ночная операция.
CREATE INDEX IF NOT EXISTS mail_bodies_search_idx ON mail_message_bodies USING gin ("searchVector");

-- ── Вложения ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mail_attachments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "messageId"   UUID NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    filename      VARCHAR(500),
    "mimeType"    VARCHAR(200),
    size          INTEGER NOT NULL DEFAULT 0,
    -- Дедупликация: одно коммерческое предложение, разосланное на восемь
    -- клиник, лежит на диске одним файлом.
    sha256        CHAR(64),
    "storagePath" VARCHAR(500),
    -- Картинки из вёрстки письма, а не приложенные файлы. В списке вложений их
    -- показывать не надо, иначе у каждой рекламной рассылки будет «12 файлов».
    "isInline"    BOOLEAN NOT NULL DEFAULT FALSE,
    "contentId"   VARCHAR(300),
    "partId"      VARCHAR(50),
    -- Текст, извлечённый из PDF и DOCX. Заполнится на этапе поиска: жалобы и
    -- гарантийные письма приходят вложением, и поиск по фамилии, который
    -- смотрит только в тело письма, не найдёт ровно их. Распознавание сканов
    -- (OCR) при этом не планируется — решение заказчика.
    "textContent" TEXT,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mail_attachments_message_idx ON mail_attachments ("messageId");
CREATE INDEX IF NOT EXISTS mail_attachments_sha_idx ON mail_attachments (sha256);

-- ── Личный слой поверх общего ящика ───────────────────────────────────────

-- Флаг \Seen в IMAP один на ящик: если в info@ сидят пятеро, прочитанное одним
-- становится прочитанным для всех. Пока часть людей остаётся в Roundcube, этот
-- общий флаг ломать нельзя — мы его синхронизируем. А здесь лежит личное:
-- «я это читал», «я взял в работу».
--
-- Строка появляется только когда человек что-то сделал. Иначе на полумиллионе
-- писем и двадцати сотрудниках вышло бы десять миллионов строк «ничего не
-- произошло».
CREATE TABLE IF NOT EXISTS mail_user_message_state (
    "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "messageId" UUID NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    "isRead"    BOOLEAN NOT NULL DEFAULT FALSE,
    "readAt"    TIMESTAMP WITH TIME ZONE,
    "isStarred" BOOLEAN NOT NULL DEFAULT FALSE,
    -- «Взял в работу» — чтобы двое не отвечали на одно письмо. Приём тот же,
    -- что в открытой линии, и по той же причине.
    "takenAt"   TIMESTAMP WITH TIME ZONE,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("userId", "messageId")
);

CREATE INDEX IF NOT EXISTS mail_user_state_message_idx ON mail_user_message_state ("messageId");

-- ── Журнал ────────────────────────────────────────────────────────────────

-- Ящик общий, переписка — с пациентами, а удаление настоящее и доезжает до
-- сервера. Журнал здесь не бюрократия, а единственный способ потом ответить на
-- вопрос «кто это стёр». Поэтому messageId обнуляется, а не каскадит: запись об
-- удалении обязана пережить удалённое письмо, и в detail остаются тема,
-- отправитель и UID на момент действия.
CREATE TABLE IF NOT EXISTS mail_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"    UUID REFERENCES users(id) ON DELETE SET NULL,
    "accountId" UUID REFERENCES mail_accounts(id) ON DELETE SET NULL,
    "messageId" UUID REFERENCES mail_messages(id) ON DELETE SET NULL,
    action      VARCHAR(30) NOT NULL,
    detail      JSONB NOT NULL DEFAULT '{}',
    ip          VARCHAR(64),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mail_audit_account_idx ON mail_audit ("accountId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS mail_audit_user_idx ON mail_audit ("userId", "createdAt" DESC);

-- Исходящие: черновики и отправленное (ver. 8.58).
--
-- Черновик хранится у нас, а не кладётся в папку «Черновики» на сервере. Так
-- проще и честнее: недописанное письмо — дело одного человека, и класть его в
-- общий ящик, где его увидит вся смена, незачем. В «Черновики» на IMAP мы
-- ничего не пишем.
--
-- Отправленное остаётся здесь же строкой со статусом sent. Это нужно не для
-- истории — само письмо после отправки попадает в «Отправленные» на сервере и
-- приезжает обратно обычной синхронизацией, — а для суточного предела: по этой
-- таблице считается, сколько писем ящик уже отправил сегодня.
CREATE TABLE IF NOT EXISTS mail_drafts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId"   UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    "userId"      UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Письмо, на которое отвечаем или которое пересылаем. Нужно, чтобы
    -- проставить In-Reply-To и References: без них ответ вываливается из
    -- переписки и у получателя выглядит новым письмом на ту же тему.
    "replyToId"   UUID REFERENCES mail_messages(id) ON DELETE SET NULL,
    kind          VARCHAR(12) NOT NULL DEFAULT 'new',  -- new | reply | forward

    subject       VARCHAR(2000),
    "toList"      JSONB NOT NULL DEFAULT '[]',
    "ccList"      JSONB NOT NULL DEFAULT '[]',
    "bccList"     JSONB NOT NULL DEFAULT '[]',
    "bodyHtml"    TEXT,
    "bodyText"    TEXT,
    -- Приложенные файлы: имя, размер, тип и путь в хранилище. Отдельной
    -- таблицей не делаем — у черновика их единицы, и жить они должны ровно
    -- столько же, сколько он сам.
    attachments   JSONB NOT NULL DEFAULT '[]',

    status        VARCHAR(12) NOT NULL DEFAULT 'draft', -- draft | sending | sent | error
    error         TEXT,
    "sentAt"      TIMESTAMP WITH TIME ZONE,
    -- Собственный Message-ID отправленного письма. По нему мы узнаём своё
    -- письмо, когда оно вернётся к нам из папки «Отправленные».
    "messageId"   VARCHAR(998),

    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mail_drafts_user_idx ON mail_drafts ("userId", status, "updatedAt" DESC);
-- Суточный предел считается по этому индексу: «сколько ящик отправил с начала
-- дня» — запрос, который делается перед каждой отправкой.
CREATE INDEX IF NOT EXISTS mail_drafts_sent_idx ON mail_drafts ("accountId", "sentAt") WHERE status = 'sent';

-- Сохранённые поиски, они же «умные папки» (ver. 8.58).
--
-- Почти все просьбы «заведите нам папку под рекламу» на деле означают фильтр, а
-- не папку: письма никто не собирается перекладывать, их нужно видеть вместе.
-- Настоящая папка стоила бы дорого — её пришлось бы создавать на IMAP, следить
-- за UIDVALIDITY и раскладывать письма на сервере. Сохранённый запрос делает то
-- же самое и ничего не ломает.
--
-- Поиск бывает личным и общим на ящик: «мои жалобы» нужны одному человеку, а
-- «гарантийные письма» — всей смене. Пустой userId и означает общий.
CREATE TABLE IF NOT EXISTS mail_saved_searches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"    UUID REFERENCES users(id) ON DELETE CASCADE,
    "accountId" UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    query       TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mail_saved_searches_user_idx ON mail_saved_searches ("userId", "sortOrder");
CREATE INDEX IF NOT EXISTS mail_saved_searches_account_idx ON mail_saved_searches ("accountId", "sortOrder");

-- Изменения, которые надо донести до сервера (ver. 8.58).
--
-- Человек нажал «прочитано» — и это должно попасть на IMAP, а не только к нам.
-- Пока часть сотрудников работает в Roundcube, общий флаг \Seen остаётся
-- единственным, что у нас с ними общее: не отдав его, мы оставим им ящик, где
-- вечно всё непрочитано.
--
-- Почему очередь, а не запись прямо в обработчике запроса. Отправка флага
-- требует соединения с reg.ru, а их мало и они общие на сотню ящиков. Ждать
-- свободного слота внутри HTTP-запроса значит подвесить интерфейс на секунды из
-- за действия, которое человек считает мгновенным. Здесь же оно и переживёт
-- перезапуск: без очереди неудавшаяся отправка просто потерялась бы, а
-- следующая синхронизация вернула бы флаг с сервера и отменила действие
-- человека у него на глазах.
CREATE TABLE IF NOT EXISTS mail_flag_ops (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    "userId"    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- seen | unseen | flag | unflag | answered | delete.
    op          VARCHAR(20) NOT NULL,
    attempts    SMALLINT NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "doneAt"    TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Частичный индекс по невыполненным: очередь почти всегда пуста, и полный
-- индекс по истории операций был бы в сотни раз больше полезной части.
CREATE INDEX IF NOT EXISTS mail_flag_ops_pending_idx ON mail_flag_ops ("createdAt") WHERE "doneAt" IS NULL;
CREATE INDEX IF NOT EXISTS mail_flag_ops_message_idx ON mail_flag_ops ("messageId");

-- Прогоны синхронизации: без них разбираться, почему ящик отстал на сутки,
-- пришлось бы по логам процесса, которых через неделю уже нет.
CREATE TABLE IF NOT EXISTS mail_sync_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId"       UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
    "folderId"        UUID REFERENCES mail_folders(id) ON DELETE SET NULL,
    kind              VARCHAR(20) NOT NULL,
    "startedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "finishedAt"      TIMESTAMP WITH TIME ZONE,
    "messagesFetched" INTEGER NOT NULL DEFAULT 0,
    "bytesFetched"    BIGINT  NOT NULL DEFAULT 0,
    error             TEXT
);

CREATE INDEX IF NOT EXISTS mail_sync_runs_account_idx ON mail_sync_runs ("accountId", "startedAt" DESC);
