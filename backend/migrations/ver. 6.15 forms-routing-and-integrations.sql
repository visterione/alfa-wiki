-- ver. 6.15 — Маршрутизация форм через подписки чатов + управление ключами из интерфейса
--
-- Убирает конфигурацию доставки из .env. Раньше адрес чата задавался переменной
-- PUBLIC_FORM_<ТИП>_CHAT_ID: чтобы подключить форму, нужно было зайти на сервер,
-- вписать id и перезапустить процесс. Теперь маршрут — это членство бота в чате,
-- как в Telegram: добавили бота в чат — он туда пишет, убрали — перестал.
--
-- form_subscriptions     — какой чат какие формы получает
-- submission_deliveries  — доставка стала 1:N (одна заявка → несколько чатов)
-- bot_tokens.servesForms — какие формы обслуживает бот (настраивается в интерфейсе)
-- api_clients.updatedBy  — права ключа теперь редактируются, нужен след кто менял

-- === Подписки чатов на формы ==================================================
-- Строка появляется автоматически, когда бота добавляют в чат (см. my_chat_member
-- в services/botWebhookService.js), и удаляется, когда его оттуда убирают.
-- Командами /subscribe и /unsubscribe прямо в чате её можно поправить руками.
CREATE TABLE IF NOT EXISTS form_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "botId"      UUID         NOT NULL REFERENCES bot_tokens(id) ON DELETE CASCADE,
  "chatId"     UUID         NOT NULL REFERENCES chats(id)      ON DELETE CASCADE,
  "formType"   VARCHAR(50)  NOT NULL,                          -- 'tax-deduction-certificate'
  filters      JSONB        NOT NULL DEFAULT '{}'::jsonb,      -- {"clientId": "uuid"} — принимать только от этого клиента
  "isActive"   BOOLEAN      NOT NULL DEFAULT true,
  "createdBy"  UUID,                                           -- кто подписал; NULL — автоподписка при входе бота
  "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Один бот не может дважды подписать один чат на одну форму
CREATE UNIQUE INDEX IF NOT EXISTS form_subscriptions_uq
  ON form_subscriptions ("botId", "chatId", "formType");

-- По этому индексу ищутся адресаты в момент приёма заявки
CREATE INDEX IF NOT EXISTS form_subscriptions_form_idx
  ON form_subscriptions ("formType") WHERE "isActive";

CREATE INDEX IF NOT EXISTS form_subscriptions_chat_idx ON form_subscriptions ("chatId");

-- === Доставка заявок ==========================================================
-- Одна заявка уходит в несколько чатов, у каждого свой статус и свои попытки.
-- Без этого сбой доставки в один чат либо терялся, либо приводил к дублям в остальных.
CREATE TABLE IF NOT EXISTS submission_deliveries (
  id            BIGSERIAL PRIMARY KEY,
  "submissionId" UUID        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  "chatId"      UUID         NOT NULL,
  "botId"       UUID,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending',       -- pending | sent | failed
  attempts      INTEGER      NOT NULL DEFAULT 0,
  error         TEXT,
  "messageId"   BIGINT,                                        -- message_id в чате вики
  "deliveredAt" TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Повтор доставки не должен создавать вторую строку на тот же чат
CREATE UNIQUE INDEX IF NOT EXISTS submission_deliveries_uq
  ON submission_deliveries ("submissionId", "chatId");

-- Крон повторной доставки выбирает недоставленное по этому индексу
CREATE INDEX IF NOT EXISTS submission_deliveries_pending_idx
  ON submission_deliveries (status, attempts) WHERE status <> 'sent';

-- === Бот объявляет, какие формы обслуживает ===================================
-- Раньше связь «форма → бот» задавалась переменной PUBLIC_FORMS_BOT_TOKEN, то есть
-- бэкенд аутентифицировался секретом сам перед собой, чтобы найти строку в этой же
-- таблице. Теперь связь хранится здесь и правится в интерфейсе ботов.
ALTER TABLE bot_tokens
  ADD COLUMN IF NOT EXISTS "servesForms" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN bot_tokens."servesForms" IS
  'Типы форм публичного API, которые доставляет этот бот, напр. ["patient-registration"]';

-- === След редактирования ключей ===============================================
-- Права ключа перестали быть неизменяемыми: раньше добавить форму существующему
-- клиенту было нельзя, приходилось выпускать новый ключ и передавать разработчику.
ALTER TABLE api_clients
  ADD COLUMN IF NOT EXISTS "updatedBy" UUID;

COMMENT ON COLUMN api_clients."updatedBy" IS 'Кто последним менял права ключа';

-- Заполнение form_subscriptions существующими адресами из .env и бэкфилл
-- submission_deliveries делает скрипт: node scripts/migrateFormRouting.js --apply
-- (SQL этого сделать не может — адреса лежат в переменных окружения).
