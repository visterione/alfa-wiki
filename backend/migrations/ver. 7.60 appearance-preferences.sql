-- ver. 7.60 — персональное оформление стало общим для мобилки и веба.
--
-- Настройки жили в users.settings->'mobile', пока их применяло только
-- приложение. Теперь ту же тему и акцент показывает браузер, и namespace
-- переименован в 'appearance'. Копируем, а не переносим: установленные на
-- телефонах сборки до 7.60 читают только старый ключ, и до тех пор, пока люди
-- не обновятся, оба должны существовать. Сервер с 7.60 пишет сразу в оба.

UPDATE users
SET settings = jsonb_set(settings, '{appearance}', settings->'mobile', true)
WHERE settings ? 'mobile'
  AND jsonb_typeof(settings->'mobile') = 'object'
  AND NOT settings ? 'appearance';
