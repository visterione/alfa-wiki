'use strict';

/**
 * Вернуть в очередь сообщения, отбракованные пилотным списком номеров (ver. 9.23).
 *
 * Пропуск у отправщика окончательный: строку «пропущено» он больше не берёт,
 * даже если ограничение потом сняли. Так и должно быть в обычной работе, но
 * после того как у медцентра открыли номера, отбракованное за время пилота
 * остаётся неотправленным — а пациенты по нему ещё ждут напоминаний.
 *
 * Возвращаем не всё подряд. Отправщик не проверяет, устарело ли сообщение, и
 * отправит любую ждущую строку — поэтому только то, что ещё имеет смысл:
 *   • запись, перенос и напоминание — и только по визитам, которые впереди.
 *     Напоминание о прошедшем визите или «вы записаны» после него только
 *     запутают пациента;
 *   • отмены не возвращаем: «запись отменена» через несколько дней пациент уже
 *     знает и без нас;
 *   • просьбы об отзыве — по флагу --reviews и только за последние двое суток.
 *
 * Запуск из каталога backend:
 *   npm run notifier:requeue-pilot -- "3К"            показать, что вернётся
 *   npm run notifier:requeue-pilot -- "3К" --apply    вернуть в очередь
 *   … --reviews                                       добавить свежие просьбы об отзыве
 *
 * Медцентр — по названию из справочника (поле «Название»), как он подписан в
 * журнале. Без названия — по всем медцентрам: так делать стоит, только когда
 * ограничение сняли везде.
 *
 * Перед --apply отправщик должен быть перезапущен на новом коде: старый
 * процесс отбракует возвращённое снова.
 */

require('dotenv').config();

const { Client } = require('pg');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const withReviews = args.includes('--reviews');
const medCenterName = args.find(a => !a.startsWith('--')) || null;

// Условия отбора — одни на просмотр и на возврат: вернуть должно ровно то,
// что показали.
const WHERE = `
  o.status = 'skipped'
  AND o.error LIKE 'пилот:%'
  AND ($1::text IS NULL OR mc.name = $1)
  AND (
    (o.event IN ('created', 'moved', 'reminder') AND a.time_start > NOW())
    OR ($2::boolean AND o.event = 'review' AND o."createdAt" > NOW() - INTERVAL '2 days')
  )
`;

const FROM = `
  notif_outbox o
  JOIN notif_appointments a ON a.appt_id = o.appt_id
  JOIN med_centers mc ON a.clinic_id::text = ANY(mc."misClinicIds")
`;

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  await client.connect();

  try {
    if (medCenterName) {
      const { rows } = await client.query('SELECT 1 FROM med_centers WHERE name = $1', [medCenterName]);
      if (!rows.length) {
        console.error(`Медцентра «${medCenterName}» в справочнике нет. Название — как в поле «Название» карточки медцентра.`);
        process.exitCode = 1;
        return;
      }
    }

    const { rows } = await client.query(`
      SELECT o.id, o.event, o.phone, mc.name AS medcenter, a.time_start, o."createdAt"
      FROM ${FROM}
      WHERE ${WHERE}
      ORDER BY a.time_start
    `, [medCenterName, withReviews]);

    const scope = medCenterName ? `медцентр «${medCenterName}»` : 'все медцентры';
    if (!rows.length) {
      console.log(`Возвращать нечего (${scope}): отбракованных пилотом сообщений по будущим визитам нет.`);
      return;
    }

    console.log(`${apply ? 'Возвращаю в очередь' : 'Вернётся в очередь'} (${scope}): ${rows.length}\n`);
    for (const r of rows) {
      const visit = r.time_start ? new Date(r.time_start).toLocaleString('ru-RU') : '—';
      console.log(`  ${r.event.padEnd(9)} ${String(r.phone || '').padEnd(13)} визит ${visit}   ${r.medcenter}`);
    }

    if (!apply) {
      console.log('\nЭто просмотр, в базе ничего не изменено. Чтобы вернуть — та же команда с --apply.');
      return;
    }

    // planned_at — не раньше «сейчас»: строка уйдёт ближайшим проходом
    // отправщика, а в тихие часы он сам отложит её до утра.
    const result = await client.query(`
      UPDATE notif_outbox o
      SET status = 'pending', error = NULL, attempts = '[]'::jsonb,
          planned_at = GREATEST(o.planned_at, NOW()), "updatedAt" = NOW()
      FROM notif_appointments a, med_centers mc
      WHERE a.appt_id = o.appt_id
        AND a.clinic_id::text = ANY(mc."misClinicIds")
        AND ${WHERE}
    `, [medCenterName, withReviews]);

    console.log(`\nВозвращено: ${result.rowCount}. Отправщик подхватит их в течение минуты — смотрите журнал.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Не получилось:', err.message);
  process.exit(1);
});
