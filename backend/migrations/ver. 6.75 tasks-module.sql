-- ver. 6.75 — модуль «Задачи»: части задач, согласование срока, загрузка в
-- часах, команды как граница видимости.
--
-- Заменяет канбан-доску целиком. Старые kanban_boards / kanban_tasks /
-- board_permissions удаляются в конце файла: доской практически не
-- пользовались, данных, которые стоило бы переносить, там нет. Это решение
-- заказчика, а не следствие сложности миграции.
--
-- Три вещи, которые отличают этот модуль от обычной доски и объясняют, почему
-- схема выглядит именно так:
--
--   1) **Задача состоит из частей.** Часть — это то, у чего есть исполнитель,
--      оценка в часах и срок. Задача сама по себе ни того, ни другого, ни
--      третьего не имеет. Один исполнитель — это задача с одной частью, а не
--      особый случай в схеме.
--
--   2) **Срок — согласование, а не поле.** Автор предлагает, исполнитель либо
--      ставит в план, либо предлагает свой. Пока не поставил — часть висит во
--      входящих со статусом «не обработана», и на доске она обязана выглядеть
--      именно так, а не как «работа идёт».
--
--   3) **Загрузка считается в часах от личной нормы.** Норма своя у каждого,
--      поэтому «переработка» у разных людей наступает в разных точках. Одной
--      цифры на компанию здесь быть не может.
--
-- Рабочие блоки времени отдельной таблицей НЕ заводятся: они живут в
-- calendar_events. Два календаря в одном приложении — это два места, где лежит
-- день сотрудника, и человек обязан смотреть в оба. См. раздел 10.
--
-- Миграция аддитивна и идемпотентна, кроме последнего раздела (снос канбана).
-- Повторный запуск безопасен.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. СПРАВОЧНИК ПРОЕКТОВ
-- ─────────────────────────────────────────────────────────────────────────────
-- Сквозной, без привязки к медцентру: проект — это чаще всего ровно то общее,
-- что связывает филиалы, и раскладывать его по клиникам значит плодить пять
-- «Онбордингов». Границу видимости даёт команда (раздел 2), а не проект.
--
-- Заводится отдельным правом в админке. Если разрешить создание всем, кто
-- ставит задачу, справочник за месяц зарастает парой «Отчёт» / «Отчёты».
CREATE TABLE IF NOT EXISTS task_projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(160) NOT NULL,
  color        VARCHAR(20),
  "sortOrder"  INTEGER NOT NULL DEFAULT 100,
  "isArchived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy"  UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_projects_name_uniq
  ON task_projects (lower(name));

COMMENT ON TABLE task_projects IS 'Справочник проектов модуля «Задачи», ver. 6.75';

-- Наполняется вручную: значения из прототипа (Аврора, Платформа, Онбординг)
-- выдуманные, сидить их в боевую базу нельзя.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. КОМАНДЫ — ГРАНИЦА ВИДИМОСТИ, А НЕ ПАПКА
-- ─────────────────────────────────────────────────────────────────────────────
-- Досок как сущности в модуле нет. В канбане каждый заводил свою доску и раздавал
-- права на неё; здесь доска — представление поверх всех задач, а кто чью
-- загрузку видит, решает команда. Поэтому board_permissions не переделываются,
-- а заменяются вот этим.
--
-- Филиал берётся из справочника медцентров (ver. 6.67), второго списка клиник
-- не заводим.
CREATE TABLE IF NOT EXISTS task_teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(160) NOT NULL,
  "medCenterId" UUID REFERENCES med_centers(id) ON DELETE SET NULL,
  access        VARCHAR(20) NOT NULL DEFAULT 'all'
                CHECK (access IN ('all', 'members', 'invite')),
  -- Скрытая команда не показывается как «нет доступа» — для того, кому она не
  -- открыта, её просто не существует: ни в списках, ни в поиске, ни в фильтрах.
  -- Разница принципиальная: строка «нет доступа» сама по себе сообщает, что
  -- команда есть, а этого достаточно, чтобы понять, что в компании происходит
  -- найм или реорганизация.
  "isHidden"    BOOLEAN NOT NULL DEFAULT FALSE,
  "ownerId"     UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_teams_med_center_idx ON task_teams ("medCenterId");
CREATE INDEX IF NOT EXISTS task_teams_hidden_idx     ON task_teams ("isHidden");

COMMENT ON TABLE task_teams IS 'Команды: филиал, уровень доступа, скрытость. Граница видимости загрузки';

-- Участники и смотрящие в одной таблице: «может смотреть, не будучи участником»
-- отличается от участия ровно одним полем, и разводить это по двум таблицам
-- значит дублировать все выборки прав.
CREATE TABLE IF NOT EXISTS task_team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId"    UUID NOT NULL REFERENCES task_teams(id) ON DELETE CASCADE,
  "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- member — участник, его загрузка попадает в командный срез;
  -- viewer  — смотрит загрузку команды, сам в неё не входит;
  -- lead    — ставит задачи и меняет нормы участникам.
  role        VARCHAR(20) NOT NULL DEFAULT 'member'
              CHECK (role IN ('member', 'viewer', 'lead')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("teamId", "userId")
);

CREATE INDEX IF NOT EXISTS task_team_members_user_idx ON task_team_members ("userId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ЗАДАЧА — КОНТЕЙНЕР
-- ─────────────────────────────────────────────────────────────────────────────
-- Ни исполнителя, ни срока, ни оценки здесь нет: всё это принадлежит частям.
--
-- Статуса тоже нет, и это не упущение. Статус задачи выводится из статусов её
-- частей (все done → готово; есть stuck → анализируется; есть work → в работе).
-- Хранить его рядом с частями означает завести два источника правды, которые
-- разойдутся на первом же переносе.
--
-- Привязки к команде нет намеренно: доска фильтрует задачи по исполнителям,
-- попавшим в область видимости, а не по ярлыку на задаче. Иначе задачу можно
-- было бы спрятать от её собственного исполнителя.
CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(500) NOT NULL,
  description   TEXT,
  "projectId"   UUID REFERENCES task_projects(id) ON DELETE SET NULL,
  "authorId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  "isArchived"  BOOLEAN NOT NULL DEFAULT FALSE,
  "archivedAt"  TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_author_idx   ON tasks ("authorId");
CREATE INDEX IF NOT EXISTS tasks_project_idx  ON tasks ("projectId");
CREATE INDEX IF NOT EXISTS tasks_archived_idx ON tasks ("isArchived");

COMMENT ON TABLE tasks IS 'Задача-контейнер. Исполнители, сроки и оценки — в task_parts';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ЧАСТИ ЗАДАЧИ
-- ─────────────────────────────────────────────────────────────────────────────
-- Один исполнитель — это одна часть, а не отдельный случай. Формат задачи
-- (одна на всех / разделена / смешанная) не хранится: он выводится из того,
-- сколько у частей исполнителей.
--
-- «Одна на всех» означает, что оценка в часах тратится каждым участником:
-- 2 ч на троих — это 2 ч в календаре у каждого и 6 ч трудозатрат.
CREATE TABLE IF NOT EXISTS task_parts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title           VARCHAR(500) NOT NULL,
  "estimateHours" NUMERIC(5,2) NOT NULL CHECK ("estimateHours" > 0),
  -- Срок, предложенный автором. Меняется в обе стороны при согласовании,
  -- поэтому каждое изменение обязано оставлять след в task_history.
  "dueDate"       DATE NOT NULL,
  -- new    — исполнитель ещё не разобрал (лежит во входящих);
  -- plan   — поставлена в план, но день ещё не наступил;
  -- work   — в работе;
  -- review — на проверке;
  -- done   — готово;
  -- stuck  — переносится третий раз подряд, требует решения.
  status          VARCHAR(20) NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'plan', 'work', 'review', 'done', 'stuck')),
  -- На этом счётчике держится правило, ради которого модуль и затевался: после
  -- третьего переноса кнопки «перенести ещё раз» больше нет, система просит
  -- решение — разбить, передоговориться или отменить.
  "moveCount"     INTEGER NOT NULL DEFAULT 0,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_parts_task_idx   ON task_parts ("taskId");
CREATE INDEX IF NOT EXISTS task_parts_status_idx ON task_parts (status);
CREATE INDEX IF NOT EXISTS task_parts_due_idx    ON task_parts ("dueDate");

-- Связи «после»: часть не предлагается исполнителю в календарь, пока
-- предыдущая не готова. Отдельной таблицей, а не массивом в JSONB, потому что
-- по этим рёбрам строится схема и проверяется отсутствие циклов.
CREATE TABLE IF NOT EXISTS task_part_deps (
  "partId"      UUID NOT NULL REFERENCES task_parts(id) ON DELETE CASCADE,
  "afterPartId" UUID NOT NULL REFERENCES task_parts(id) ON DELETE CASCADE,
  PRIMARY KEY ("partId", "afterPartId"),
  CHECK ("partId" <> "afterPartId")
);

-- Исполнители части. Своя строка на человека, а не массив id, потому что
-- состояние у каждого своё: в общей задаче один участник уже поставил её в план
-- на четверг, второй ещё не разобрал. Массив этого выразить не может.
CREATE TABLE IF NOT EXISTS task_part_assignees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "partId"      UUID NOT NULL REFERENCES task_parts(id) ON DELETE CASCADE,
  "userId"      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL — человек ещё не поставил часть в план, она висит у него во входящих.
  -- Именно это отличает «не обработана» от «работа идёт».
  "plannedDate" DATE,
  "declinedAt"  TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("partId", "userId")
);

CREATE INDEX IF NOT EXISTS task_part_assignees_user_idx
  ON task_part_assignees ("userId", "plannedDate");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ИСТОРИЯ
-- ─────────────────────────────────────────────────────────────────────────────
-- «Срок — согласование, а не поле, поэтому у него есть история». Сюда же
-- ложится обязательное объяснение, когда автор продавливает задачу в день, где
-- она не помещается: обойти проверку можно всегда, но не молча.
CREATE TABLE IF NOT EXISTS task_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  "partId"    UUID REFERENCES task_parts(id) ON DELETE SET NULL,
  "userId"    UUID REFERENCES users(id) ON DELETE SET NULL,
  -- created, planned, proposed_date, accepted_date, declined, moved, split,
  -- forced, status_changed, cancelled
  action      VARCHAR(40) NOT NULL,
  -- Детали события: старый и новый срок, текст объяснения при forced, цифра
  -- занятости на момент предложения срока.
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_history_task_idx ON task_history ("taskId", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. НОРМА РАБОЧЕГО ДНЯ
-- ─────────────────────────────────────────────────────────────────────────────
-- Не длина смены, а честное время на задачи: рабочий день минус встречи,
-- переключения и перерывы. Своя у каждого — у подрядчика на part-time и у
-- поддержки со сменным графиком она не может быть одной.
--
-- NULL означает «человек в модуле не заведён», и это не то же самое, что
-- норма 0: во втором случае ему нельзя ставить задачи, в первом он просто не
-- участвует в планировании.
--
-- Имя намеренно не HourNorm: та таблица принадлежит зарплатному модулю и хранит
-- норму часов на специальность за месяц — совсем другая величина.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "dailyNormHours" NUMERIC(4,2)
  CHECK ("dailyNormHours" IS NULL OR ("dailyNormHours" > 0 AND "dailyNormHours" <= 24));

COMMENT ON COLUMN users."dailyNormHours" IS
  'Личная норма рабочего дня в часах для модуля «Задачи». NULL — не заведён в модуле';

-- Норму меняет руководитель, и это разговор с человеком, а не тихая настройка:
-- в интерфейсе видно, кому и когда её правили.
CREATE TABLE IF NOT EXISTS task_norm_changes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "oldValue"   NUMERIC(4,2),
  "newValue"   NUMERIC(4,2),
  "changedBy"  UUID REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_norm_changes_user_idx
  ON task_norm_changes ("userId", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. КАЛЕНДАРЬ: РАБОЧИЕ БЛОКИ ЖИВУТ ЗДЕСЬ ЖЕ
-- ─────────────────────────────────────────────────────────────────────────────
-- Загрузка дня — это сумма часов по событиям календаря. Отдельной таблицы
-- блоков нет намеренно: иначе у сотрудника два календаря, и ни один из них не
-- отвечает на вопрос «чем я занят в четверг».
ALTER TABLE calendar_events
  -- Событие, порождённое постановкой части задачи в план. Снимается вместе с
  -- частью: если задачу отменили, время обязано вернуться в свободное.
  ADD COLUMN IF NOT EXISTS "taskPartId" UUID
    REFERENCES task_parts(id) ON DELETE CASCADE,
  -- Плавающий блок: у него есть день и длительность, но нет времени начала.
  -- «2,4 часа в четверг» — честная формулировка для работы; делать вид, что
  -- человек знает, во сколько сядет за отчёт, значит заполнять календарь
  -- выдуманными интервалами. Встреча — наоборот, жёсткая: она в 14:00 и
  -- двигается только по согласованию.
  --
  -- Существующий день-вью календаря обязан рисовать такие события отдельной
  -- дорожкой «план дня», иначе блок с началом в 00:00 уедет в ночь.
  ADD COLUMN IF NOT EXISTS "isFloating" BOOLEAN NOT NULL DEFAULT FALSE,
  -- Порядок плавающих блоков внутри дня: у них нет времени, но есть
  -- последовательность, и она должна переживать перезагрузку страницы.
  ADD COLUMN IF NOT EXISTS "dayOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS calendar_events_task_part_idx
  ON calendar_events ("taskPartId");
CREATE INDEX IF NOT EXISTS calendar_events_floating_idx
  ON calendar_events ("isFloating", "startTime");

-- Уровни видимости. Существующие значения (private / shared / public) не
-- переименовываются: у shared есть свой механизм — явный список sharedWith, и
-- ломать его ради красоты перечисления нельзя. Добавляются два:
--
--   busy — коллеги видят серую полосу и длительность, название скрыто;
--   team — название видно участникам команд, где человек состоит.
--
-- Содержимое событий с уровнями private и busy не отдаётся ни одному запросу
-- от имени другого пользователя — включая владельца пространства и
-- администратора филиала. Это обещание держится не в интерфейсе, а в одной
-- функции-фильтре, через которую обязана проходить любая отдача события
-- наружу, см. services/tasks/visibility.js.
COMMENT ON COLUMN calendar_events.visibility IS
  'private (только я) | busy (занято, без названия) | team (участникам команд) | shared (явный список sharedWith) | public (вся компания)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ПРАВО НА РАЗДЕЛ
-- ─────────────────────────────────────────────────────────────────────────────
-- Флаг канбана заменяется флагом нового модуля. Кто имел доступ к доске —
-- получает доступ к «Задачам»: это тот же раздел, только переделанный.
UPDATE users
SET "adminAccess" = ("adminAccess" - 'kanban')
  || jsonb_build_object('tasks', COALESCE("adminAccess" -> 'kanban', 'false'::jsonb))
WHERE "adminAccess" ? 'kanban';

-- Тем, у кого ключа канбана не было вовсе (заведены позже его сокрытия).
UPDATE users
SET "adminAccess" = COALESCE("adminAccess", '{}'::jsonb) || '{"tasks": false}'::jsonb
WHERE "adminAccess" IS NULL OR NOT ("adminAccess" ? 'tasks');

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. СНОС КАНБАНА
-- ─────────────────────────────────────────────────────────────────────────────
-- Единственный неидемпотентный и необратимый раздел файла. Доской не
-- пользовались, переносить нечего — решение заказчика зафиксировано до начала
-- работ. Если на боевой базе задачи всё же появятся, этот раздел надо
-- выполнять отдельно и после выгрузки.
DROP TABLE IF EXISTS kanban_tasks     CASCADE;
DROP TABLE IF EXISTS board_permissions CASCADE;
DROP TABLE IF EXISTS kanban_boards    CASCADE;

COMMIT;
