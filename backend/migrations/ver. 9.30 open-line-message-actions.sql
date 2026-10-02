-- Правка, удаление и ответ с цитатой в открытой линии (ver. 9.30).
--
-- Оператор ошибся в ответе пациенту — опечатка, не тот адрес, ответ не тому
-- человеку — и исправить это было нечем: сообщение уже у пациента, а написать
-- «извините, правильно так» вторым сообщением значит оставить ошибку в
-- переписке навсегда. Оба мессенджера дают боту править и удалять свои
-- сообщения, и отвечать с цитатой на конкретное сообщение пациента.
--
--   "editedAt"     — когда правили; у пациента видно «изменено»
--   "originalText" — что было написано сначала: при разборе жалобы важно, что
--                    человек увидел первым, а не только итог
--   "deletedAt", "deletedBy" — удалено у пациента; у нас строка остаётся, с
--                    пометкой, — переписка с пациентом не должна терять следов
--   "replyToId"    — на какое сообщение этой переписки ответ (в обе стороны:
--                    оператор цитирует пациента, пациент отвечает на оператора)

ALTER TABLE omni_messages ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE omni_messages ADD COLUMN IF NOT EXISTS "originalText" TEXT;
ALTER TABLE omni_messages ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE omni_messages ADD COLUMN IF NOT EXISTS "deletedBy" UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE omni_messages ADD COLUMN IF NOT EXISTS "replyToId" UUID REFERENCES omni_messages(id) ON DELETE SET NULL;
