-- Почтовый клуб (ver. 8.79) — подписчики рассылок, пришедшие с сайтов медцентров.
--
-- До клуба список получателей собирался каждый раз заново: выгрузка CSV,
-- импорт в конструктор, отсев отписавшихся. Теперь человек сам оставляет адрес
-- в блоке «Почтовый клуб» на сайте, сайт присылает его в публичный API
-- (/api/public/v1/mail-club/subscribe), и список копится без участия людей.
-- CSV остаётся рабочим путём: от него уходят постепенно, по мере того как
-- набирается клуб.
--
-- Список у каждого медцентра свой: подписчик Альфы — не подписчик 3К. Поэтому
-- уникальна пара «адрес × медцентр», а не адрес. Отписка из письма клуба
-- переводит строку в unsubscribed только у этого медцентра; общий чёрный список
-- email_optouts остаётся как был и важнее клуба.
--
-- Подтверждения адреса письмом нет по решению заказчика — адрес записывается
-- сразу. Тем важнее consent: страница, IP и ключ, с которыми пришла подписка,
-- — единственный ответ на вопрос «откуда у вас мой адрес».
--
-- Отменить можно: таблица новая, ничего существующего миграция не меняет.

CREATE TABLE IF NOT EXISTS mail_club_subscribers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(320) NOT NULL,
    -- Клуб принадлежит клинике. Клиника ушла из справочника — рассылать её
    -- клубу больше некому и не от чьего имени.
    "medCenterId"       UUID NOT NULL REFERENCES med_centers(id) ON DELETE CASCADE,
    status              VARCHAR(16) NOT NULL DEFAULT 'active',
    source              VARCHAR(16) NOT NULL DEFAULT 'site',
    consent             JSONB NOT NULL DEFAULT '{}'::jsonb,
    "apiClientId"       UUID REFERENCES api_clients(id) ON DELETE SET NULL,
    "subscribedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "unsubscribedAt"    TIMESTAMPTZ,
    "unsubscribeSource" VARCHAR(16),
    "createdBy"         UUID REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mail_club_subscribers_status_check CHECK (status IN ('active', 'unsubscribed')),
    CONSTRAINT mail_club_subscribers_source_check CHECK (source IN ('site', 'manual'))
);

COMMENT ON TABLE mail_club_subscribers IS
  'Почтовый клуб: подписчики рассылок по медцентрам (ver. 8.79)';
COMMENT ON COLUMN mail_club_subscribers.consent IS
  'Откуда пришла подписка: { ip, userAgent, pageUrl } — ответ на «откуда у вас мой адрес»';

CREATE UNIQUE INDEX IF NOT EXISTS mail_club_subscribers_email_med_center_key
  ON mail_club_subscribers (email, "medCenterId");

-- Счёт и выборка получателей идут всегда по клубу и статусу.
CREATE INDEX IF NOT EXISTS mail_club_subscribers_med_center_status_idx
  ON mail_club_subscribers ("medCenterId", status);
