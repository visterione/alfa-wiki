-- ver. 6.49 — Реестр сессий и честный онлайн-статус
--
-- Две связанные проблемы.
--
-- 1. Токен нельзя было отозвать. При входе выдавался голый JWT { userId }, на
--    мобиле — сроком на 365 дней (см. routes/auth.js). Разлогин был чисто
--    клиентским: приложение стирало токен из Keychain, но сам токен оставался
--    валидным ещё год. Потерянный телефон = год доступа, и сделать с этим было
--    нечего, кроме смены JWT_SECRET для всех сразу.
--
-- 2. Индикатор «в сети» врал. Онлайном считалось наличие живого socket.io-
--    коннекта, а свёрнутое мобильное приложение держит его часами — человек
--    вечно висел «в сети». Обратная сторона: карта онлайна жила в памяти
--    процесса, и рестарт бэка терял её, не записав никому lastSeen, — тот же
--    человек внезапно становился «был(а) 3 дня назад».
--
-- Теперь в payload токена есть `sid` — ссылка на строку этой таблицы. Middleware
-- сверяется с ней (с кэшем в памяти на минуту, чтобы не бить БД на каждый
-- запрос), и снятие сессии действует сразу. Сокеты снятой сессии сервер рвёт
-- принудительно, без ожидания exp.
--
-- Онлайн-статус переехал на heartbeat активности (services/presence.js) и от
-- этой таблицы не зависит — но зависит от неё в другую сторону: сокет с
-- отозванной сессией выкидывается и в онлайне не числится.

CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform         VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'mobile', 'desktop')),
  "deviceName"     VARCHAR(200),
  ip               VARCHAR(64),
  "userAgent"      VARCHAR(512),
  "lastActivityAt" TIMESTAMPTZ,
  "expiresAt"      TIMESTAMPTZ NOT NULL,
  "revokedAt"      TIMESTAMPTZ,
  "revokedReason"  VARCHAR(20) CHECK ("revokedReason" IN ('logout', 'logout_all', 'admin', 'password_change')),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx        ON user_sessions ("userId");
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx ON user_sessions ("userId", "revokedAt");
-- Для периодической чистки протухших строк
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx     ON user_sessions ("expiresAt");

-- Совместимость с уже выданными токенами.
--
-- Токены без `sid` (всё, что выдано до этой миграции) middleware продолжает
-- принимать до их естественного истечения — иначе выкат разлогинил бы разом
-- всех, в том числе мобильных пользователей с годовым токеном. Такие сессии в
-- «моих устройствах» не видны и отозвать их нельзя; они вымрут сами: веб — за
-- неделю, мобилки — по мере перезахода. Проверку `sid` можно сделать
-- обязательной, когда старые токены кончатся (см. LEGACY_TOKENS_OK в
-- middleware/auth.js).
