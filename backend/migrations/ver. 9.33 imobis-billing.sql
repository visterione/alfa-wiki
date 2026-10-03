-- Счета Имобиса в админке открытой линии (ver. 9.33).
--
-- Пополнение шести счетов Имобиса делалось руками: зайти в каждый кабинет,
-- выписать счёт, скачать PDF, — и сколько пополнять, решалось на глаз, потому
-- что API провайдера отдаёт только остаток. Теперь кабинеты обходит сервер:
-- расходы по дням забирает из краткого отчёта, счёт выписывает на сумму,
-- вписанную во вкладке «Счета».
--
--   imobis_spend_days — расход филиала за сутки; основа графиков и подсказки
--                       суммы. Хранится ~4 месяца, старше чистит синхронизация.
--   imobis_invoices   — счета текущей недели вместе с PDF. С началом новой
--                       недели удаляются: старые лежат в кабинете Имобиса.
--
-- Логин и пароль кабинета таблиц не требуют: они ложатся в
-- notif_branch_settings.imobis рядом с токеном (пароль — зашифрованным).

CREATE TABLE IF NOT EXISTS imobis_spend_days (
  "medCenterId" UUID NOT NULL REFERENCES med_centers(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  "byOperator" JSONB,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("medCenterId", day)
);

CREATE TABLE IF NOT EXISTS imobis_invoices (
  id UUID PRIMARY KEY,
  "medCenterId" UUID NOT NULL REFERENCES med_centers(id) ON DELETE CASCADE,
  number VARCHAR(64) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  payer VARCHAR(255),
  pdf BYTEA,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  "statusText" VARCHAR(64),
  "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS imobis_invoices_med_center ON imobis_invoices ("medCenterId", "createdAt");
