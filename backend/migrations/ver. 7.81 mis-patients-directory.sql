-- Локальный справочник пациентов МИС (ver. 7.81).
--
-- Публичное API МИС ищет только по ТОЧНОЙ фамилии: «Курочк» возвращает ноль,
-- «Курочкин» — 52 карточки. Шаблоны (%, *, _) не работают, параметров вроде
-- search/query у метода нет — в самом интерфейсе МИС поиск по началу слова идёт
-- через их внутренний API, наружу не выставленный.
--
-- Поэтому префиксный поиск делаем у себя: выгружаем карточки пачками по месяцам
-- (getPatient принимает date_created_from/to — 5658 карточек за месяц, 18 секунд)
-- и дальше держим справочник в актуальном состоянии по date_updated_from.
--
-- Персональных данных берём минимум, только то, без чего не выбрать пациента:
-- ФИО, дата рождения, номер карты. Телефон, адрес, паспорт и медицинская часть
-- остаются в МИС.

CREATE TABLE IF NOT EXISTS mis_patients (
  patient_id   VARCHAR(30) PRIMARY KEY,
  number       VARCHAR(30),
  last_name    VARCHAR(120) NOT NULL DEFAULT '',
  first_name   VARCHAR(120) NOT NULL DEFAULT '',
  third_name   VARCHAR(120) NOT NULL DEFAULT '',
  birth_date   VARCHAR(20),
  mis_updated  VARCHAR(20),
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- text_pattern_ops — чтобы LIKE 'куроч%' шёл по индексу: без него поиск по
-- полумиллиону карточек разворачивался бы в полный перебор.
CREATE INDEX IF NOT EXISTS mis_patients_last_prefix_idx
  ON mis_patients (LOWER(last_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS mis_patients_first_prefix_idx
  ON mis_patients (LOWER(first_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS mis_patients_number_idx
  ON mis_patients (number);

COMMENT ON TABLE mis_patients IS 'Справочник карточек МИС для префиксного поиска ФИО; наполняется scripts/syncMisPatients.js';
COMMENT ON COLUMN mis_patients.mis_updated IS 'date_updated из МИС — по нему догружаются изменения';
