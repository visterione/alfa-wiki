-- Темы обращений открытой линии (ver. 8.29).
--
-- Показатели линии отвечали на «как быстро» и «сколько», но не на «о чём». А
-- руководителю нужен именно этот вопрос: полсотни вопросов в месяц про
-- подготовку к анализам — это повод переписать памятку на сайте, а не повод
-- нанять ещё оператора. Без темы такой поток неотличим от любого другого.
--
-- Справочник общий на сеть: отчёт имеет смысл, только если филиалы называют
-- одно и то же одинаково.

CREATE TABLE IF NOT EXISTS omni_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  -- Тему не удаляют, а выключают: на неё уже ссылаются закрытые обращения, и
  -- удаление стёрло бы кусок отчёта за прошлые месяцы.
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "updatedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_topics_active_order_idx
  ON omni_topics ("isActive", "sortOrder");

-- Тема ставится обращению, а не переписке: у постоянного пациента переписка
-- вечная и за год вмещает и запись, и анализы, и жалобу.
--
-- ON DELETE SET NULL, а не RESTRICT: тему выключают, а не удаляют, но если её
-- всё же удалят руками из базы, отчёт должен потерять строку, а не обрушить
-- выборку обращений.
ALTER TABLE omni_sessions
  ADD COLUMN IF NOT EXISTS "topicId" UUID REFERENCES omni_topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS omni_sessions_topic_idx
  ON omni_sessions ("topicId", "openedAt");

-- Первый набор тем. Заводится здесь, а не оставляется на заказчика, по простой
-- причине: пустой справочник означает, что в день выката тему поставить не из
-- чего, и обязательность выбора пришлось бы отключать. Список заведомо не
-- окончательный — старший оператор переименует и добавит своё, для того
-- справочник и правится из интерфейса.
--
-- Порядок — по ожидаемой частоте, а не по алфавиту: оператор выбирает тему в
-- момент, когда его ждёт следующий пациент.
INSERT INTO omni_topics (name, "sortOrder")
SELECT v.name, v.ord
FROM (VALUES
  ('Запись на приём',            10),
  ('Перенос или отмена записи',  20),
  ('Цены и услуги',              30),
  ('Анализы и результаты',       40),
  ('Врачи и расписание',         50),
  ('Режим работы и адрес',       60),
  ('Подготовка к исследованию',  70),
  ('Документы и справки',        80),
  ('Жалоба',                     90),
  ('Другое',                    100)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM omni_topics);
