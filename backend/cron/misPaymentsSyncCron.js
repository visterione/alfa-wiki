/**
 * Ежедневная синхронизация финансовых списаний из МИС (getPayments, type=2)
 * Расписание: 00:10 МСК = 21:10 UTC (cron запущен в UTC)
 *
 * Тянет вчерашний день и делает delete-by-day + insert в mis_payments.
 * Идёт через 5 минут после синка визитов (00:05), чтобы не бить МИС одновременно.
 */

const cron = require('node-cron');
const { fetchAndUpsertDay } = require('../services/misPaymentsSync');

// '10 21 * * *' = каждый день в 21:10 UTC = 00:10 МСК
cron.schedule('10 21 * * *', async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  console.log(`⏰ [misPaymentsSyncCron] Синхронизация за ${yesterday.toLocaleDateString('ru-RU')}`);
  try {
    const cnt = await fetchAndUpsertDay(yesterday);
    console.log(`✅ [misPaymentsSyncCron] Загружено: ${cnt} списаний`);
  } catch (e) {
    console.error(`❌ [misPaymentsSyncCron]`, e.message);
  }
});

console.log('⏰ misPaymentsSyncCron: зарегистрирован (00:10 МСК ежедневно)');
