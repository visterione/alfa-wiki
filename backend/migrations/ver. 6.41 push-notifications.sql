-- ver. 6.41 — Push-уведомления для мобильного приложения
--
-- До этого уведомления на телефоне были целиком клиентской выдумкой: приложение
-- держало Socket.IO живым через Android foreground-сервис и само рисовало
-- локальные уведомления на событие new_message. Сервер про телефоны не знал ничего.
-- Схема не работала: notifee по умолчанию поднимает сервис типом shortService,
-- и Android 14+ убивает его через несколько минут, а на iOS фонового сервиса
-- нет в принципе.
--
-- Теперь сервер сам отправляет push через FCM. Таблица хранит по строке на
-- каждый установленный экземпляр приложения.
--
-- Почему platform и provider — разные колонки:
-- iOS сейчас регистрируется, но пуши не получает (нет платной подписки Apple,
-- значит нет APNs-ключа). Такие устройства лежат в таблице с provider='fcm'
-- и platform='ios' и пропускаются при рассылке — сообщения им приходят только
-- по сокету, пока приложение открыто. Когда APNs подключат, они начнут
-- регистрироваться с provider='apns'; ни схема, ни логика рассылки не меняются.

CREATE TABLE IF NOT EXISTS user_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         VARCHAR(512) NOT NULL,
  platform      VARCHAR(10)  NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  provider      VARCHAR(10)  NOT NULL DEFAULT 'fcm' CHECK (provider IN ('fcm', 'apns', 'webpush')),
  "appVersion"  VARCHAR(50),
  "deviceName"  VARCHAR(120),
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "lastSeenAt"  TIMESTAMPTZ,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Токен уникален глобально, а не в паре с пользователем: при смене аккаунта на
-- том же телефоне FCM отдаёт тот же токен, и строка должна переехать на нового
-- владельца, а не задвоиться. Регистрация делает ON CONFLICT (token) DO UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS user_devices_token_key ON user_devices (token);
CREATE INDEX IF NOT EXISTS user_devices_user_idx ON user_devices ("userId");
CREATE INDEX IF NOT EXISTS user_devices_user_active_idx ON user_devices ("userId", "isActive");

-- Sequelize объявляет platform/provider как ENUM, в БД это обычный VARCHAR с CHECK.
-- Так проще добавлять значения: новый провайдер — это ALTER ... DROP/ADD CONSTRAINT,
-- а не пересоздание типа с пересборкой всех зависимостей.
