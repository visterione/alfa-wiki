-- Разрешить создание записей кассы без привязки к зарплатному листу
ALTER TABLE cash_payments ALTER COLUMN "salaryRecordId" DROP NOT NULL;
