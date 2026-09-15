-- Быстрые данные колл-центра переезжают в базу (ver. 8.32).
--
-- Страница backend/bot/call-center.html хранила набор — подготовки к
-- исследованиям, почты, ссылки, заготовки ответов — в localStorage браузера.
-- Это выглядело как общий справочник, но было личной записной книжкой: человек
-- заполнял карточки, считал работу сделанной, а смена продолжала видеть
-- демо-примеры и звонила ему спросить, почему у неё ничего не появилось.
--
-- Набор общий по смыслу задачи. Оператор диктует пациенту подготовку к УЗИ, и
-- она обязана совпадать с той, что диктует сосед: расхождение здесь — это два
-- разных ответа на один вопрос, и узнаёт о нём пациент.
--
-- Две таблицы, а не одно поле JSONB. Правится набор целиком, из интерфейса, —
-- но смотреть на него в базе приходится построчно, когда спрашивают, кто убрал
-- подготовку к колоноскопии и когда.
--
-- Идентификаторы строковые и приходят от страницы ('tab-prep', 'sn-uzi-abd').
-- UUID был бы аккуратнее, но эти ключи уже разошлись по браузерам операторов, и
-- смена формата расклеила бы перенос наборов, заведённых до этой версии.

CREATE TABLE IF NOT EXISTS call_center_tabs (
  id           VARCHAR(64) PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "updatedBy"  UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_center_snippets (
  id           VARCHAR(64) PRIMARY KEY,
  "tabId"      VARCHAR(64) NOT NULL,
  title        VARCHAR(300) NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  -- Поля карточки как есть: [{ label, kind, value }]. Раскладывать их по
  -- строкам незачем — они целиком приходят и целиком уходят, искать по ним не
  -- нужно, а отдельная таблица на три колонки стоила бы джойна на каждом показе.
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "updatedBy"  UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Единственная выборка страницы — карточки вкладки по порядку.
CREATE INDEX IF NOT EXISTS call_center_snippets_tab_idx
  ON call_center_snippets ("tabId", "sortOrder");

-- Внешнего ключа на вкладку нет намеренно. Набор сохраняется целиком, одной
-- транзакцией: вкладки и карточки переписываются вместе, и порядок операций
-- внутри неё диктовался бы ограничением, а не смыслом. Осиротевшие карточки
-- отсекает разбор на стороне маршрута — он выбрасывает те, чья вкладка не
-- пришла в том же запросе.

-- Номер правки. Страница присылает его обратно при сохранении, и если за время
-- редактирования набор успел измениться, запись не проходит: двое, открывшие
-- «Редактировать» в один день, иначе молча стёрли бы работу друг друга.
INSERT INTO settings (key, value, description, "createdAt", "updatedAt")
VALUES (
  'call_center_revision',
  '0'::jsonb,
  'Номер правки набора быстрых данных колл-центра',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
