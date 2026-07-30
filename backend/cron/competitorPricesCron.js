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
const { fillAllComparisons } = require('../services/competitorPriceFill');
const { autoMatchAllComparisons } = require('../services/competitorMatching');

cron.schedule('30 3 * * *', async () => {
  console.log('⏰ [CompetitorPrices CRON] Забираем прайсы конкурентов из парсера...');
  try {
    await syncAll();
  } catch (err) {
    // syncAll уже сообщил, в чём дело; здесь важно не уронить процесс
    console.error('❌ [CompetitorPrices CRON] Ошибка:', err.message);
    return;
  }

  // Новые листы и новые услуги не должны требовать отдельного ручного запуска.
  // Точные и сильные совпадения принимаются сами; спорные остаются в админке.
  try {
    const matched = await autoMatchAllComparisons();
    console.log(
      `⏰ [CompetitorPrices CRON] Автосопоставление: сравнений ${matched.comparisons}, ` +
      `принято ${matched.autoConfirmed}, переиспользовано ${matched.reused}, ` +
      `требуют проверки ${matched.review}`
    );
  } catch (err) {
    console.error('❌ [CompetitorPrices CRON] Автосопоставление не удалось:', err.message);
  }

  // Обновляем цены всех принятых соответствий. Ручные значения автоматика
  // по-прежнему не перезаписывает.
  try {
    const totals = await fillAllComparisons();
    console.log(
      `⏰ [CompetitorPrices CRON] Сравнений обновлено: ${totals.comparisons}, ` +
      `цен проставлено: ${totals.filled}, ручных не тронуто: ${totals.protectedByHuman}`
    );
  } catch (err) {
    console.error('❌ [CompetitorPrices CRON] Подстановка цен не удалась:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Europe/Moscow'
});

console.log('✅ Cron забора прайсов конкурентов инициализирован (03:30 МСК)');

module.exports = { syncAll };
