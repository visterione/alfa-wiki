'use strict';

/**
 * Cron-задача забора прайсов конкурентов из alfa-parser.
 * Запускается каждую ночь в 03:30 по Москве.
 *
 * Подключить в server.js:
 *   require('./cron/competitorPricesCron');
 *
 * Время выбрано после ночных синхронизаций с МИС (00:05 и 00:10) и до
 * утреннего прихода сотрудников. С расписанием обходов на стороне парсера
 * связывать не нужно: забор идемпотентен и просто берёт то, что там сейчас есть.
 */

const cron = require('node-cron');
const { syncAll } = require('../services/competitorPricesSync');

cron.schedule('30 3 * * *', async () => {
  console.log('⏰ [CompetitorPrices CRON] Забираем прайсы конкурентов из парсера...');
  try {
    await syncAll();
  } catch (err) {
    // syncAll уже сообщил, в чём дело; здесь важно не уронить процесс
    console.error('❌ [CompetitorPrices CRON] Ошибка:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Europe/Moscow'
});

console.log('✅ Cron забора прайсов конкурентов инициализирован (03:30 МСК)');

module.exports = { syncAll };
