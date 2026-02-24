/**
 * Cron-задача автосинхронизации отзывов с внешних площадок
 * Запускается четыре раза в день: в 09:00, 12:00, 15:00, 18:00 по Москве
 *
 * Подключить в server.js:
 * require('./cron/reviewSyncCron');
 */

const cron = require('node-cron');
const { syncAll } = require('../services/reviewSync');

// 09:00, 12:00, 15:00, 18:00 по Москве
cron.schedule('0 9,12,15,18 * * *', async () => {
  console.log('⏰ [ReviewSync CRON] Запуск синхронизации отзывов...');
  try {
    await syncAll();
  } catch (err) {
    console.error('❌ [ReviewSync CRON] Ошибка:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Europe/Moscow'
});

console.log('✅ Cron синхронизации отзывов инициализирован (09:00, 12:00, 15:00, 18:00 МСК)');

module.exports = { syncAll };
