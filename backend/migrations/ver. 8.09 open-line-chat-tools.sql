-- Открытая линия: передача чата, файлы от оператора и быстрые ответы (ver. 8.09).

-- Чья карточка выбрана из patientIds. Снимок карточки (имя, номер, дата
-- рождения) лежит у подписчика с 7.99, а идентификатора среди него не было — и
-- ссылку на карточку в МИС из шапки чата построить было не из чего. Взять
-- первый id из patientIds нельзя: по одному телефону заведена семья, и
-- показываем мы старшего, а выбирает его openLinePatient.pickOldest — порядок в
-- массиве тут ни при чём.
ALTER TABLE bot_subscribers ADD COLUMN IF NOT EXISTS "patientMisId" VARCHAR(20);

-- Заполняем задним числом по номеру карты: он у подписчика уже сохранён, а
-- справочник mis_patients знает, какому patient_id этот номер принадлежит. Без
-- этого зелёная кнопка «R» появилась бы у людей только после того, как снимок
-- карточки обновится сам, — а это раз в двенадцать часов и только при новом
-- сообщении.
UPDATE bot_subscribers b
SET "patientMisId" = p.patient_id
FROM mis_patients p
WHERE b."patientCard" IS NOT NULL
  AND b."patientMisId" IS NULL
  AND p.number = b."patientCard";

-- Быстрые ответы. Комплект один на сеть: колл-центр отвечает от лица клиники, и
-- «как проехать» должно звучать одинаково у всех, кто сегодня на смене.
CREATE TABLE IF NOT EXISTS omni_quick_replies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(80) NOT NULL,
  text        TEXT        NOT NULL,
  "sortOrder" INTEGER     NOT NULL DEFAULT 0,
  "createdBy" UUID        REFERENCES users(id) ON DELETE SET NULL,
  "updatedBy" UUID        REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_quick_replies_sort ON omni_quick_replies ("sortOrder");

-- Служебные отметки в ленте («обращение передано такому-то») — это записи
-- переписки, а не сообщения пациенту, и direction у них 'sys'. Колонка уже
-- VARCHAR(3), поэтому имя выбрано в три буквы: расширять её ради одной пометки
-- дороже, чем назвать пометку короче.
