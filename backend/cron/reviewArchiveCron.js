/**
 * Cron-задача автоархивации отзывов
 * Запускается каждый день в 04:00 по Москве.
 * Все отзывы со статусом «Решение принято» (final) автоматически уходят в архив.
 *
 * Подключить в server.js:
 * require('./cron/reviewArchiveCron');
 */

const cron = require('node-cron');
const { archiveFinalReviews } = require('../jobs/archiveReviews');

// 04:00 по Москве
cron.schedule('0 4 * * *', async () => {
  console.log('⏰ [ReviewArchive CRON] Запуск автоархивации отзывов...');
  const result = await archiveFinalReviews();
  if (result.success) {
    if (result.count > 0) {
      console.log(`✅ [ReviewArchive CRON] Завершено: ${result.count} отзыв(ов) архивировано`);
    } else {
      console.log('✅ [ReviewArchive CRON] Завершено: нечего архивировать');
    }
  } else {
    console.error(`❌ [ReviewArchive CRON] Ошибка: ${result.error}`);
  }
}, {
  scheduled: true,
  timezone: 'Europe/Moscow'
});

console.log('✅ Cron автоархивации отзывов инициализирован (04:00 МСК)');
