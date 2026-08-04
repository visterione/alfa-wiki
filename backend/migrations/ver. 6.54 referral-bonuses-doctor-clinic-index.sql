-- ver. 6.54 — индекс бонусов врача по клинике
--
-- CONCURRENTLY не удерживает блокировку записи миллионной таблицы на всё время
-- построения. Этот файл нельзя выполнять внутри BEGIN/COMMIT.
--
-- Bulk-редактор читает правила конкретного врача и клиники. Уникальный индекс
-- (misUserId, serviceCode, clinicId) не может эффективно использовать clinicId
-- без условия по serviceCode.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_bonuses_mis_user_clinic
  ON referral_bonuses ("misUserId", "clinicId");

