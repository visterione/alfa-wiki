-- Исключения из состава открытой линии (ver. 9.23).
--
-- Правило состава (ver. 9.09) заводит в линию всех, кто подходит по роли и
-- медцентру. Под широкие правила попадают и те, кому на линии делать нечего:
-- администраторы, у которых для полного доступа прописаны все роли. Убрать
-- такого человека было нельзя — правило вернуло бы его при первой же
-- синхронизации, поэтому снятие оставляло его в составе: он получал сигналы о
-- пациентах, стоял в списке «кому передать» и считался в показателях.
--
-- Исключение — именно для этого: правило мимо исключённого проходит, а
-- заведённого руками это не касается — ручное добавление тем же действием
-- исключение снимает.

CREATE TABLE IF NOT EXISTS omni_line_exclusions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "lineId"    UUID NOT NULL REFERENCES omni_lines(id) ON DELETE CASCADE,
    "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_line_exclusions_uniq
  ON omni_line_exclusions ("lineId", "userId");
