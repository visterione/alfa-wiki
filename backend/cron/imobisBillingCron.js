/**
 * Обход кабинетов Имобиса (ver. 9.33): расходы по дням, статусы оплаты счетов,
 * уборка счетов прошлой недели.
 *
 * Ночью — ради расходов: вчерашние сутки к утру в отчёте уже сложены, и график
 * с подсказкой суммы встречают человека в понедельник готовыми. Днём в будни
 * ещё два прохода — только ради статуса «Оплачен»: бухгалтерия платит днём, и
 * ждать до следующей ночи, чтобы увидеть оплату, незачем. Расходы при этом
 * перезабираются за последние дни заново — это дёшево и ничему не мешает.
 *
 * Время по Москве явно, а не через UTC в уме, как у соседних задач: сутки
 * отчёта у Имобиса московские.
 */

const cron = require('node-cron');
const { syncAll } = require('../services/imobisBilling');

async function run(label) {
  try {
    const { started, log } = await syncAll();
    if (!started) return console.log(`⏭️ [imobisBillingCron] ${label}: обход уже идёт`);
    const failed = Object.values(log).filter(r => !r.ok).length;
    console.log(`✅ [imobisBillingCron] ${label}: кабинетов ${Object.keys(log).length}, с ошибкой ${failed}`);
  } catch (e) {
    console.error(`❌ [imobisBillingCron] ${label}:`, e.message);
  }
}

cron.schedule('30 5 * * *', () => run('ночной обход'), { timezone: 'Europe/Moscow' });
cron.schedule('0 13,17 * * 1-5', () => run('статусы оплаты'), { timezone: 'Europe/Moscow' });

console.log('⏰ imobisBillingCron: зарегистрирован (05:30 МСК ежедневно, 13:00 и 17:00 по будням)');
