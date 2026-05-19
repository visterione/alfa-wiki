/**
 * Ежедневная синхронизация визитов из МИС
 * Расписание: 00:05 МСК = 21:05 UTC (cron запущен в UTC)
 *
 * Тянет вчерашний день и upsert-ит в mis_appointments.
 */

const cron = require('node-cron');
const { fetchAndUpsertDay } = require('../services/misAppointmentsSync');

// '5 21 * * *' = каждый день в 21:05 UTC = 00:05 МСК
cron.schedule('5 21 * * *', async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  console.log(`⏰ [misAppointmentsSyncCron] Синхронизация за ${yesterday.toLocaleDateString('ru-RU')}`);
  try {
    const cnt = await fetchAndUpsertDay(yesterday);
    console.log(`✅ [misAppointmentsSyncCron] Загружено: ${cnt} визитов`);
  } catch (e) {
    console.error(`❌ [misAppointmentsSyncCron]`, e.message);
  }
});

console.log('⏰ misAppointmentsSyncCron: зарегистрирован (00:05 МСК ежедневно)');
