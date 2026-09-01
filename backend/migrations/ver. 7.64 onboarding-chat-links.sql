-- Рабочие чаты филиала для онбординга врача (ver. 7.64).
--
-- Когда закрыт последний шаг чек-листа, врачу уходит приветственное письмо. До
-- сих пор ссылки на групповые чаты кидали ему руками — кто вспомнил, тот и
-- кинул, — и врач раз за разом оказывался не в том чате или ни в одном.
-- Теперь список настраивается заранее и уезжает в письмо сам.
--
-- Таблица одна на филиальные и сетевые чаты: у филиального "medCenterId"
-- заполнен, у общего на сеть — NULL. Врачу уходит объединение того и другого, а
-- не «филиальный, иначе сетевой», как у исполнителей шагов в onb_assignments:
-- там сетевое назначение работает запасным вариантом, здесь же общий чат сети и
-- чат филиала нужны оба.
--
-- Название и аватарка лежат тут же, а не читаются со страницы приглашения в
-- момент отправки: страница может не ответить, и тогда письмо ушло бы с голыми
-- ссылками ровно тогда, когда его читают. Превью забирается при настройке и
-- обновляется кнопкой.
--
-- "avatarPath" — имя файла в uploads/onboarding-chats, а не адрес картинки в
-- телеграме: их CDN отдаёт файл по временной ссылке, и через месяц в уже
-- отправленном письме была бы дырка.

CREATE TABLE IF NOT EXISTS onb_chat_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "medCenterId" UUID REFERENCES med_centers(id) ON DELETE CASCADE,
  url           VARCHAR(500) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  subtitle      VARCHAR(255),
  "avatarPath"  VARCHAR(255),
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "fetchedAt"   TIMESTAMP WITH TIME ZONE,
  "fetchError"  VARCHAR(255),
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onb_chat_links_med_center_idx ON onb_chat_links ("medCenterId");
CREATE INDEX IF NOT EXISTS onb_chat_links_active_idx     ON onb_chat_links ("isActive");

COMMENT ON COLUMN onb_chat_links."medCenterId" IS 'NULL — чат общий на сеть, уходит врачам всех филиалов';
COMMENT ON COLUMN onb_chat_links.title         IS 'Что видит врач в письме; правится руками поверх превью';
COMMENT ON COLUMN onb_chat_links.subtitle      IS 'Пояснение под названием: зачем этот чат';
COMMENT ON COLUMN onb_chat_links."avatarPath"  IS 'Имя файла в uploads/onboarding-chats';
COMMENT ON COLUMN onb_chat_links."fetchError"  IS 'Чем закончилась последняя попытка прочитать превью';
