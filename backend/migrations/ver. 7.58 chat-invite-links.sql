-- Пригласительные ссылки в групповые чаты (ver. 7.58).
--
-- Признак включения отдельно от токена: ссылку выключают, не отзывая её. Отзыв
-- (перевыпуск токена) ломает уже разосланные ссылки навсегда, а «выключить на
-- время совещания и включить обратно» — обычная просьба, и заставлять из-за неё
-- заново рассылать адрес незачем.
--
-- По умолчанию выключено. Ссылка открывает переписку всем, кто её получил, а в
-- рабочих группах обсуждают пациентов: включать такое молча за пользователя
-- нельзя, это должно быть его решением.

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS "inviteToken"     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "inviteEnabled"   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "inviteCreatedBy" UUID,
  ADD COLUMN IF NOT EXISTS "inviteCreatedAt" TIMESTAMP WITH TIME ZONE;

-- Уникальность частичная: NULL в токене будет у подавляющего большинства чатов
-- (все личные переписки и все группы без ссылки), и обычный UNIQUE-индекс
-- держал бы их все в дереве без всякой пользы.
CREATE UNIQUE INDEX IF NOT EXISTS chats_invite_token_idx
  ON chats ("inviteToken")
  WHERE "inviteToken" IS NOT NULL;

COMMENT ON COLUMN chats."inviteToken"   IS 'Токен пригласительной ссылки; перевыпуск ломает старые ссылки';
COMMENT ON COLUMN chats."inviteEnabled" IS 'Приём по ссылке включён; выключение не отзывает токен';
