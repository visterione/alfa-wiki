-- Виджет связи для сайтов клиник (ver. 8.06).
--
-- Кнопка в углу сайта со ссылками на наши боты и телефоном регистратуры. До сих
-- пор её рисовал Битрикс, от которого сеть уходит. Забираем не столько сам
-- виджет, сколько его настройку: на сайте остаётся неизменный тег <script>, а
-- состав каналов, цвет и номер живут здесь и меняются без правки чужого сайта.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ НАСТРОЙКИ ФИЛИАЛА. Сайтов у сети больше, чем
-- филиалов: у части центров свой сайт, у части — общий с посадочными
-- страницами, и на одном филиале со временем окажется два виджета с разным
-- набором кнопок. Ключ виджета — то, что вписано в чужую страницу, и он должен
-- пережить переименование филиала.
--
-- ПОЧЕМУ КАНАЛЫ ОДНИМ JSONB. Канал — это тип, подпись, ссылка и порядок; таблица
-- на четыре поля с сортировкой ради десятка строк на всю сеть дороже, чем
-- польза от неё. Форму проверяет services/siteWidget.js, и она же покрыта
-- тестами: в этих ссылках опаснее ошибиться, чем в большинстве наших данных —
-- они подставляются в href на публичном сайте.

CREATE TABLE IF NOT EXISTS site_widgets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Лежит открыто в коде сайта. Не секрет, но и не перебираемый: по чужому
    -- ключу видно, какие каналы у соседней клиники и куда звонят её пациенты.
    key              VARCHAR(32) NOT NULL UNIQUE,
    -- Внутреннее название («Сайт Альфа-Анапа»), наружу не отдаётся.
    name             VARCHAR(150) NOT NULL,
    "medCenterId"    UUID REFERENCES med_centers(id) ON DELETE SET NULL,
    -- [{ type, enabled, label, value }] в порядке показа кнопок.
    channels         JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Цвет, угол, отступ снизу, подписи.
    appearance       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Белый список адресов сайтов; пусто — «где угодно».
    "allowedOrigins" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "isActive"       BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy"      UUID REFERENCES users(id) ON DELETE SET NULL,
    "updatedBy"      UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_widgets_med_center_idx ON site_widgets ("medCenterId");
