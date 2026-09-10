-- Данные визита для полного набора подстановок уведомлений (ver. 8.12).
--
-- Стоп-лист служебных врачей хранится в settings и отдельной таблицы не
-- требует. doctor_id сохраняем здесь, чтобы отправщик мог повторно проверить
-- запрет перед фактической отправкой уже поставленного напоминания.
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS patient_number VARCHAR(100);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS doctor_id VARCHAR(50);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS time_end TIMESTAMPTZ;
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS reserve_specialty VARCHAR(500);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS room VARCHAR(255);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS reserve_author_name VARCHAR(255);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS document_name VARCHAR(500);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS document_author_name VARCHAR(255);
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS document_at TIMESTAMPTZ;
ALTER TABLE notif_appointments ADD COLUMN IF NOT EXISTS document_clinic_name VARCHAR(255);

COMMENT ON COLUMN notif_appointments.doctor_id IS
  'Стабильный ID врача МИС; используется в том числе стоп-листом служебных ресурсов';
COMMENT ON COLUMN notif_appointments.reserved_at IS
  'Дата и время создания резерва/записи в МИС';
COMMENT ON COLUMN notif_appointments.reserve_specialty IS
  'Специальность из услуг записи для подстановки в уведомление';
