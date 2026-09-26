-- Учётки площадок без пароля (ver. 8.81).
--
-- В 8.80 пароль у учётной записи площадки был обязателен. Но учётка сети в
-- Яндексе пароля не имеет вовсе: в Яндекс ID входят ссылкой из письма, и
-- Альфа Парсер так и входит — ловит подтверждение, показывает его цифры на
-- странице «Площадки» и ждёт, пока по ссылке перейдёт человек.
--
-- Отменить можно, если ни у одной учётки пароль не пуст.

ALTER TABLE review_platform_accounts ALTER COLUMN "passwordEnc" DROP NOT NULL;
ALTER TABLE review_platform_accounts ALTER COLUMN "passwordIv"  DROP NOT NULL;
ALTER TABLE review_platform_accounts ALTER COLUMN "passwordTag" DROP NOT NULL;
