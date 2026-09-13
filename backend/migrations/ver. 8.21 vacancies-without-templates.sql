-- Раздел «Вакансии»: отказ от шаблонов (ver. 8.21).
--
-- В ver. 8.20 анкета и процесс жили в шаблоне, а вакансия была его публикацией
-- в филиале. На практике это оказалось лишним слоем: чтобы завести одну
-- вакансию, приходилось ходить по двум страницам и держать в голове, что где
-- лежит. Теперь всё лежит в самой вакансии — анкета, процесс, письма,
-- исполнители и чаты.
--
-- Миграция переносит данные, а не начинает с чистого листа: ver. 8.20 уже на
-- бою. Если шаблон опубликован в нескольких филиалах, каждая его вакансия
-- получает свою копию анкеты и процесса и дальше живёт сама по себе.
--
-- Порядок важен: сначала наполняем вакансии, потом перецепляем на них всё
-- остальное, и только в конце убираем шаблоны.

BEGIN;

-- ── Вакансия получает содержимое шаблона ──────────────────────────────────

ALTER TABLE vac_vacancies
  ADD COLUMN IF NOT EXISTS form    JSONB NOT NULL DEFAULT '{"blocks": [], "steps": []}'::jsonb,
  ADD COLUMN IF NOT EXISTS process JSONB NOT NULL DEFAULT '{"steps": []}'::jsonb,
  ADD COLUMN IF NOT EXISTS emails  JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Состояние одной колонкой вместо пары флагов isOpen + isPublished у шаблона.
-- Два булевых поля на одну сущность читались как «открыта, но не опубликована»
-- — сочетание, которого не бывает.
--   draft  — собирается, по ссылке не открывается
--   open   — принимает отклики
--   closed — набор закрыт, поданные заявки доводятся
ALTER TABLE vac_vacancies
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'draft';

-- Короткий код для прямой ссылки на вакансию. Филиальный QR ведёт на список,
-- этот — сразу в конкретную анкету: так вакансию отправляют лично человеку.
-- Восемь знаков шестнадцатеричного алфавита: в нём нет ни O, ни l, ни I, то
-- есть код можно продиктовать голосом и не объяснять, «буква это или цифра».
ALTER TABLE vac_vacancies
  ADD COLUMN IF NOT EXISTS "publicCode" VARCHAR(16);

UPDATE vac_vacancies v
SET form    = COALESCE(t.form, v.form),
    process = COALESCE(t.process, v.process),
    emails  = COALESCE(t.emails, v.emails),
    status  = CASE WHEN t."isPublished" AND v."isOpen" THEN 'open'
                   WHEN v."isOpen" THEN 'draft'
                   ELSE 'closed' END
FROM vac_templates t
WHERE t.id = v."templateId";

-- Код выдаётся тем вакансиям, что уже есть. Новым его проставляет приложение.
-- Из uuid, а не из gen_random_bytes: та живёт в расширении pgcrypto, которого
-- в базе нет, а gen_random_uuid() встроена начиная с PostgreSQL 13.
UPDATE vac_vacancies
SET "publicCode" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
WHERE "publicCode" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vac_vacancies_public_code_uniq ON vac_vacancies ("publicCode");
CREATE INDEX IF NOT EXISTS vac_vacancies_status_idx ON vac_vacancies (status);

-- ── Исполнители перецепляются с шаблона на вакансию ───────────────────────
--
-- Шаблон мог быть опубликован в нескольких филиалах, поэтому одна строка
-- назначения превращается в несколько — по одной на вакансию. Филиальные
-- назначения при этом достаются только вакансии своего филиала: назначение на
-- «Альфу» не должно уехать в «Кидс».

ALTER TABLE vac_assignments ADD COLUMN IF NOT EXISTS "vacancyId" UUID;

-- Старые уникальные индексы снимаются до вставки копий, а не после. Копия
-- назначения несёт тот же templateId, stepKey, medCenterId и userId, что и
-- строка-оригинал, которая на этот момент ещё жива: пока индекс по templateId
-- на месте, первая же вставка падает на vac_assignments_branch_uniq.
DROP INDEX IF EXISTS vac_assignments_branch_uniq;
DROP INDEX IF EXISTS vac_assignments_network_uniq;
DROP INDEX IF EXISTS vac_assignments_template_idx;

INSERT INTO vac_assignments (id, "vacancyId", "templateId", "stepKey", "medCenterId", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.id, a."templateId", a."stepKey", a."medCenterId", a."userId", NOW(), NOW()
FROM vac_assignments a
JOIN vac_vacancies v ON v."templateId" = a."templateId"
WHERE a."vacancyId" IS NULL
  AND (a."medCenterId" IS NULL OR a."medCenterId" = v."medCenterId");

DELETE FROM vac_assignments WHERE "vacancyId" IS NULL;

ALTER TABLE vac_assignments ALTER COLUMN "vacancyId" SET NOT NULL;
ALTER TABLE vac_assignments
  ADD CONSTRAINT vac_assignments_vacancy_fk
  FOREIGN KEY ("vacancyId") REFERENCES vac_vacancies (id) ON DELETE CASCADE;

ALTER TABLE vac_assignments DROP COLUMN IF EXISTS "templateId";

CREATE INDEX IF NOT EXISTS vac_assignments_vacancy_idx ON vac_assignments ("vacancyId");

-- Уникальность с NULL в medCenterId обычным UNIQUE не выражается: в SQL два
-- NULL не равны, и одного человека можно было бы назначить на сетевой шаг
-- дважды. Поэтому два частичных индекса.
CREATE UNIQUE INDEX IF NOT EXISTS vac_assignments_branch_uniq
  ON vac_assignments ("vacancyId", "stepKey", "medCenterId", "userId")
  WHERE "medCenterId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vac_assignments_network_uniq
  ON vac_assignments ("vacancyId", "stepKey", "userId")
  WHERE "medCenterId" IS NULL;

-- ── Рабочие чаты — так же ─────────────────────────────────────────────────

ALTER TABLE vac_chat_links ADD COLUMN IF NOT EXISTS "vacancyId" UUID;

INSERT INTO vac_chat_links (id, "vacancyId", "templateId", "medCenterId", url, title, subtitle,
                            "avatarPath", "sortOrder", "isActive", "fetchedAt", "fetchError",
                            "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.id, c."templateId", c."medCenterId", c.url, c.title, c.subtitle,
       c."avatarPath", c."sortOrder", c."isActive", c."fetchedAt", c."fetchError", NOW(), NOW()
FROM vac_chat_links c
JOIN vac_vacancies v ON v."templateId" = c."templateId"
WHERE c."vacancyId" IS NULL
  AND (c."medCenterId" IS NULL OR c."medCenterId" = v."medCenterId");

DELETE FROM vac_chat_links WHERE "vacancyId" IS NULL;

ALTER TABLE vac_chat_links ALTER COLUMN "vacancyId" SET NOT NULL;
ALTER TABLE vac_chat_links
  ADD CONSTRAINT vac_chat_links_vacancy_fk
  FOREIGN KEY ("vacancyId") REFERENCES vac_vacancies (id) ON DELETE CASCADE;

DROP INDEX IF EXISTS vac_chat_links_template_idx;
ALTER TABLE vac_chat_links DROP COLUMN IF EXISTS "templateId";
CREATE INDEX IF NOT EXISTS vac_chat_links_vacancy_idx ON vac_chat_links ("vacancyId");

-- ── Заявка: шаблон больше не при чём ──────────────────────────────────────
--
-- Вакансия у заявки и так была, и по ней теперь считается всё: и анкета, и
-- процесс, и исполнители.

DROP INDEX IF EXISTS vac_applications_template_idx;
ALTER TABLE vac_applications DROP COLUMN IF EXISTS "templateId";

-- ── Отказ от флага isOpen и от шаблонов ───────────────────────────────────

-- Индексы снимаются до колонок: вместе с колонкой postgres удаляет их сам, и
-- обратный порядок сыпал в вывод NOTICE о том, что индекса уже нет.
DROP INDEX IF EXISTS vac_vacancies_open_idx;
DROP INDEX IF EXISTS vac_vacancies_template_idx;
ALTER TABLE vac_vacancies DROP COLUMN IF EXISTS "templateId";
ALTER TABLE vac_vacancies DROP COLUMN IF EXISTS "isOpen";

DROP TABLE IF EXISTS vac_templates;

COMMIT;
