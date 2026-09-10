-- Только фактические шаблоны филиалов (ver. 8.11).
--
-- Общий текст оказался небезопасным: ссылки на карту вписываются прямо в
-- сообщение, а в SMS используются отдельные сокращённые ссылки. Поэтому один
-- и тот же текст нельзя молча применять к разным адресам.
--
-- Сначала копируем каждый общий комплект во все действующие пациентские
-- филиалы. Если для филиала уже есть хотя бы один шаблон события, считаем его
-- комплект осознанно настроенным и ничего общего к нему не добавляем.
INSERT INTO notif_templates (
  id, event, "medCenterId", text, "smsText", "channelTexts", cascade,
  "beforeMinutes", "afterMinutes", frequency, "withConfirm", "isActive",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), common.event, mc.id, common.text, common."smsText",
  common."channelTexts", common.cascade, common."beforeMinutes",
  common."afterMinutes", common.frequency, common."withConfirm",
  common."isActive", NOW(), NOW()
FROM notif_templates common
CROSS JOIN med_centers mc
WHERE common."medCenterId" IS NULL
  AND mc."servesPatients" IS TRUE
  AND mc."isActive" IS TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM notif_templates own
    WHERE own."medCenterId" = mc.id
      AND own.event = common.event
  );

-- После копирования общего уровня больше не существует ни в данных, ни в
-- схеме: новая строка без филиала должна завершиться ошибкой, а не создать
-- неясный запасной вариант.
DELETE FROM notif_templates WHERE "medCenterId" IS NULL;

ALTER TABLE notif_templates ALTER COLUMN "medCenterId" SET NOT NULL;

COMMENT ON COLUMN notif_templates."medCenterId" IS
  'Филиал, для которого фактически настроены тексты; общих шаблонов нет';
