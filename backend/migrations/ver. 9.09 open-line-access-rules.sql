-- Состав открытой линии по правилу: роль, медцентр или их пересечение (ver. 9.09).
--
-- До сих пор операторов заводили по одному, и за составом приходилось следить:
-- новый сотрудник колл-центра оставался без линии, пока о нём не вспомнят, а
-- уволенный числился в ней, пока его не уберут. Правило решает это так же, как
-- групповой доступ к почте (ver. 8.59): «роль», «медцентр» или «роль И медцентр».
--
-- В отличие от почты правило здесь разворачивается в строки omni_line_operators.
-- На строке состава живёт состояние — смена, старшинство, — и её читают
-- распределение обращений, передача чата, события и KPI. Переписывать их все на
-- вычисление «на лету» значило бы трогать самое нагруженное место модуля ради
-- того, что умеет и синхронизация: services/openLineAccess.js досоздаёт строки
-- подходящим людям и убирает строки у переставших подходить.

CREATE TABLE IF NOT EXISTS omni_line_access_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "lineId"      UUID NOT NULL REFERENCES omni_lines(id) ON DELETE CASCADE,
    "medCenterId" UUID REFERENCES med_centers(id) ON DELETE CASCADE,
    "roleId"      UUID REFERENCES roles(id) ON DELETE CASCADE,
    "createdBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT omni_line_access_rules_scope_chk
      CHECK ("medCenterId" IS NOT NULL OR "roleId" IS NOT NULL)
);

-- NULL в обычном UNIQUE не равен NULL: правило «только роль» иначе можно было бы
-- завести дважды.
CREATE UNIQUE INDEX IF NOT EXISTS omni_line_access_rules_scope_uniq
  ON omni_line_access_rules (
    "lineId",
    COALESCE("medCenterId", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("roleId", '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Откуда человек в составе. false — заведён руками, и правила его не трогают;
-- true — только по правилу, и строка уйдёт, когда он перестанет подходить.
-- Все существующие строки ручные, поэтому умолчание false.
ALTER TABLE omni_line_operators ADD COLUMN IF NOT EXISTS "viaRule" BOOLEAN NOT NULL DEFAULT FALSE;
