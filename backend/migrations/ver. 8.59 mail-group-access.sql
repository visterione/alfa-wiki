-- Групповой доступ к почтовым ящикам (ver. 8.59).
--
-- Персональные выдачи остаются в mail_account_users. Эта таблица хранит
-- динамические правила: медцентр, роль либо их пересечение. Правило проверяется
-- при каждом обращении, поэтому новый сотрудник получает доступ вместе с
-- назначением в группу, а после выхода из неё доступ исчезает автоматически.

CREATE TABLE IF NOT EXISTS mail_account_access_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "accountId"   UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    "medCenterId" UUID REFERENCES med_centers(id) ON DELETE CASCADE,
    "roleId"      UUID REFERENCES roles(id) ON DELETE CASCADE,
    "canSend"     BOOLEAN NOT NULL DEFAULT FALSE,
    "canDelete"   BOOLEAN NOT NULL DEFAULT FALSE,
    "grantedBy"   UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT mail_account_access_rules_scope_chk
      CHECK ("medCenterId" IS NOT NULL OR "roleId" IS NOT NULL)
);

-- NULL в обычном UNIQUE не равен NULL, поэтому одинаковое правило только по
-- роли или только по медцентру иначе можно было бы создать несколько раз.
CREATE UNIQUE INDEX IF NOT EXISTS mail_account_access_rules_scope_uniq
  ON mail_account_access_rules (
    "accountId",
    COALESCE("medCenterId", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("roleId", '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS mail_account_access_rules_medcenter_idx
  ON mail_account_access_rules ("medCenterId") WHERE "medCenterId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS mail_account_access_rules_role_idx
  ON mail_account_access_rules ("roleId") WHERE "roleId" IS NOT NULL;
