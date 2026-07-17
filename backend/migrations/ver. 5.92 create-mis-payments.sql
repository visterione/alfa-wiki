-- Таблица для хранения финансовых списаний из МИС (getPayments, type=2)
-- Синхронизируется ежедневно; первичная загрузка с 2026-02-01.
--
-- В getPayments нет отдельного фильтра "только возвраты", поэтому забираем ВСЕ
-- списания (type=2) и помечаем возвраты флагом is_refund (по type_name ~ 'возврат').
-- Статистику возвратов строим уже из этой таблицы (по is_refund), не дёргая МИС.
--
-- ВАЖНО: getPayments не возвращает уникальный id операции, поэтому синхронизация
-- идемпотентна по дню: перед вставкой строки за день удаляются (delete-by-day + insert).

CREATE TABLE IF NOT EXISTS mis_payments (
  id               SERIAL PRIMARY KEY,
  op_date          TIMESTAMPTZ,                   -- дата и время операции (date из МИС)
  value            NUMERIC(14,2),                 -- сумма операции
  type             SMALLINT,                      -- тип операции (2 = списание)
  type_name        VARCHAR(255),                  -- название типа операции
  is_refund        BOOLEAN     NOT NULL DEFAULT FALSE, -- вычислено: type_name ~* 'возврат'
  income_type      SMALLINT,                      -- способ платежа
  income_type_name VARCHAR(255),                  -- название способа платежа
  invoice_number   VARCHAR(100),                  -- номер оплаченного счёта
  title            VARCHAR(500),                  -- наименование операции
  patient_id       INTEGER,
  patient          VARCHAR(500),                  -- ФИО пациента
  clinic_id        SMALLINT,
  clinic_name      VARCHAR(255),
  is_company       BOOLEAN     NOT NULL DEFAULT FALSE, -- операция по юр. компании
  author_id        INTEGER,                       -- ID сотрудника, создавшего операцию
  author_name      VARCHAR(255),                  -- ФИО сотрудника
  device           VARCHAR(100),                  -- номер устройства ККМ
  is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE, -- в корзине
  data             JSONB       NOT NULL DEFAULT '{}', -- полный объект из МИС
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mis_pay_op_date    ON mis_payments (op_date);
CREATE INDEX IF NOT EXISTS mis_pay_clinic_id  ON mis_payments (clinic_id);
CREATE INDEX IF NOT EXISTS mis_pay_author_id  ON mis_payments (author_id);
CREATE INDEX IF NOT EXISTS mis_pay_is_refund  ON mis_payments (is_refund);
CREATE INDEX IF NOT EXISTS mis_pay_type_name  ON mis_payments (type_name);
