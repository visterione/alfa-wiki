-- Вакансии: шаблоны анкет и наши файлы в анкете (ver. 8.34).
--
-- Две правки по просьбе заказчика, обе про одно — повторяющуюся работу руками.
--
-- ШАБЛОНЫ. Набор данных, который собирают со всех врачей, одинаков от вакансии
-- к вакансии: три десятка полей, десяток шагов процесса, тексты писем. В
-- ver. 8.21 слой шаблонов убрали — тогда он стоял между вакансией и анкетой и
-- заставлял ходить по двум страницам ради одной должности. Теперь шаблон
-- возвращается, но в другой роли: это не то, чем вакансия является, а то, с
-- чего она начинается. Вакансия получает КОПИЮ анкеты, процесса и писем и
-- дальше живёт сама по себе — связи с шаблоном у неё нет, поэтому правка
-- шаблона не задевает уже открытые наборы, а править вакансию под конкретную
-- специфику можно как угодно. Создание без шаблона остаётся: "с нуля" — такой
-- же законный путь.
--
-- НАШИ ФАЙЛЫ. До сих пор файлы в анкете ходили в одну сторону: кандидат
-- присылал сканы (vac_files). Но заявление о приёме кандидат заполняет по
-- нашему образцу, и образец этот надо ему отдать — прямо у того поля, куда он
-- потом приложит заполненный документ. Отсюда vac_attachments: наш файл,
-- прикреплённый к полю анкеты.
--
-- Почему отдельная таблица, а не путь к файлу прямо в JSONB анкеты. Файл нужно
-- уметь удалить с диска, посчитать его размер и отдать под настоящим именем
-- («Заявление о приёме.docx», а не «1758…-9f3a.docx»), а анкета в JSONB
-- переписывается целиком на каждое сохранение — вместе со ссылками на файлы,
-- которых после этого может уже не быть.

-- ── Шаблоны ────────────────────────────────────────────────────────────────

-- В ver. 8.20 таблица с таким именем уже была, и означала она другое: анкета
-- жила в ней, а вакансия была её публикацией. Ver. 8.21 её удалила. Если по
-- какой-то причине на этой базе 8.21 не применялась, останавливаемся: CREATE
-- TABLE IF NOT EXISTS молча оставил бы старую таблицу, и раздел собрался бы
-- поверх чужой схемы.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vac_templates' AND column_name = 'isPublished'
  ) THEN
    RAISE EXCEPTION 'В базе лежит vac_templates первого поколения (ver. 8.20). Сначала примените ver. 8.21.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vac_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(200) NOT NULL,
  -- Для кого шаблон и чем отличается от соседнего. Видит только тот, кто
  -- заводит вакансию; кандидату описание приходит из самой вакансии.
  description   TEXT,

  form          JSONB NOT NULL DEFAULT '{"blocks": [], "steps": []}'::jsonb,
  process       JSONB NOT NULL DEFAULT '{"steps": []}'::jsonb,
  emails        JSONB NOT NULL DEFAULT '{}'::jsonb,

  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdBy"   UUID REFERENCES users (id) ON DELETE SET NULL,
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Единственная выборка списка — по порядку и названию.
CREATE INDEX IF NOT EXISTS vac_templates_order_idx ON vac_templates ("sortOrder", title);

-- Филиала, исполнителей и чатов у шаблона нет намеренно. Исполнитель шага —
-- конкретный человек в конкретном медцентре, и шаблон, который тащил бы за
-- собой кадровика из другого филиала, приносил бы больше правок, чем экономил.

-- ── Наши файлы в анкете ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vac_attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Файл принадлежит либо вакансии, либо шаблону — ровно одному из двух.
  -- Полиморфной пары ownerType + ownerId нет намеренно: два внешних ключа дают
  -- настоящий каскад при удалении, а проверка ниже не даёт завести файл ничей
  -- или сразу обоих.
  "vacancyId"    UUID REFERENCES vac_vacancies (id) ON DELETE CASCADE,
  "templateId"   UUID REFERENCES vac_templates (id) ON DELETE CASCADE,

  -- Что это за документ по-человечески: «Заявление о приёме, образец».
  -- Показывается кандидату ссылкой у поля.
  title          VARCHAR(200) NOT NULL,

  -- Имя на диске генерируем сами, имя от загрузившего храним отдельно и отдаём
  -- в Content-Disposition: кандидат должен получить «Заявление.docx», а не
  -- шестнадцатеричную строку.
  filename       VARCHAR(255) NOT NULL UNIQUE,
  "originalName" VARCHAR(255),
  "mimeType"     VARCHAR(100),
  size           INTEGER,

  "uploadedBy"   UUID REFERENCES users (id) ON DELETE SET NULL,
  "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vac_attachments_owner_chk'
  ) THEN
    ALTER TABLE vac_attachments
      ADD CONSTRAINT vac_attachments_owner_chk
      CHECK (("vacancyId" IS NULL) <> ("templateId" IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vac_attachments_vacancy_idx  ON vac_attachments ("vacancyId");
CREATE INDEX IF NOT EXISTS vac_attachments_template_idx ON vac_attachments ("templateId");

-- Ссылку на файл поле анкеты держит списком идентификаторов
-- (fields[].attachments), то есть в JSONB. Внешнего ключа оттуда нет и быть не
-- может, и это осознанно: отправленная заявка носит СНИМОК анкеты, а снимок по
-- определению неизменен. Если файл из вакансии убрали, у старых заявок ссылка
-- перестаёт разрешаться, и публичный контур просто не показывает её —
-- переписывать снимки задним числом было бы хуже.
