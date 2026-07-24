/**
 * Повторная доставка заявок публичного API в чат.
 * Расписание: каждую минуту.
 *
 * Заявка всегда сохранена в БД, поэтому сбой чата или бота не теряет данные —
 * недоставленные заявки добиваются здесь. Заявки, исчерпавшие лимит попыток,
 * остаются со статусом failed и разбираются руками.
 */

const cron = require('node-cron');
const { retryFailedDeliveries } = require('../services/public/submissionService');

cron.schedule('* * * * *', async () => {
  try {
    const { delivered, failed } = await retryFailedDeliveries();
    if (delivered || failed) {
      console.log(`⏰ [submissionsRetryCron] доставлено: ${delivered}, снова не вышло: ${failed}`);
    }
  } catch (e) {
    console.error('❌ [submissionsRetryCron]', e.message);
  }
});

console.log('⏰ submissionsRetryCron: зарегистрирован (ежеминутно)');
