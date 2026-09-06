-- Прямое подключение Имобиса и статусы доставки (ver. 7.95).
--
-- Причина перехода не только в наценке агрегатора. Через Fromni не видно, что
-- стало с сообщением: её метод отвечает «принято», а статус уходит на её
-- callback-сервер, занятый мостом Renovatio. На вопрос «почему SMS не пришла»
-- ответить было нечем — мы это проверили на себе.
--
-- У Имобиса адрес обработчика статусов передаётся в самом запросе на отправку,
-- поэтому доставку подтверждает он нам, а не мы гадаем.

-- Идентификатор сообщения у провайдера: по нему приходит отчёт о доставке.
ALTER TABLE notif_outbox ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(64);

-- Финальный статус доставки, отдельно от нашего status. Наш означает «мы
-- отправили», этот — «дошло или нет», и это разные вопросы.
ALTER TABLE notif_outbox ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20);
ALTER TABLE notif_outbox ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS notif_outbox_external_idx ON notif_outbox (external_message_id);
