-- ver. 7.07 · Регламентная рассылка складских отчётов
--
-- Подписка хранится ОТКАЗАМИ, а не согласиями: по умолчанию рассылку получает
-- тот, у кого есть право на отчёт (warehouse_user_permissions), и заводить строку
-- на каждую пару «человек × отчёт» значило бы дублировать права второй таблицей,
-- которая начнёт с ними расходиться. Нет строки — подписан.
--
-- Запуск:
--   psql "$DATABASE_URL" -f "backend/migrations/ver. 7.07 warehouse-mailing.sql"

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_mail_optouts (
  "userId"     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "reportCode" VARCHAR(32) NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "reportCode")
);

COMMENT ON TABLE warehouse_mail_optouts IS
  'Отказы от регламентной рассылки. Нет строки — человек подписан, если у него есть право на отчёт.';

-- Журнал отправок. Нужен ровно для одного: повторный запуск рассылки за тот же
-- день не должен слать письмо второй раз. Воркер перезапускается вместе с
-- сервером, cron может сработать после сбоя — без ключа прогона люди получали бы
-- дубли и переставали читать рассылку вовсе.
CREATE TABLE IF NOT EXISTS warehouse_mail_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "reportCode" VARCHAR(32) NOT NULL,
  "userId"     UUID        REFERENCES users(id) ON DELETE SET NULL,
  "runKey"     VARCHAR(64) NOT NULL,
  status       VARCHAR(16) NOT NULL,
  "itemCount"  INTEGER,
  error        TEXT,
  "sentAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_mail_log_run
  ON warehouse_mail_log ("reportCode", "userId", "runKey");

CREATE INDEX IF NOT EXISTS warehouse_mail_log_sent
  ON warehouse_mail_log ("sentAt" DESC);

COMMIT;
