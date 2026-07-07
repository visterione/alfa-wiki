/**
 * Cron-задача архивации сотрудников RB, которых давно не видели в МИС.
 * Запускается ежедневно в 03:30. Переводит в архив тех, чей lastSeenAt старше 14 суток
 * (ARCHIVE_AFTER_DAYS в services/rbEmployeeRegistry). Обратимо: вернулся в МИС → снова active.
 *
 * Прогон только по БД (без обращения к МИС), поэтому лёгкий и запускается in-process.
 *
 * Подключение в server.js:
 *   require('./cron/rbEmployeeArchiveCron');
 */

const cron = require('node-cron');
const { archiveStale, ARCHIVE_AFTER_DAYS } = require('../services/rbEmployeeRegistry');

const SCHEDULE = '30 3 * * *';

console.log(`[RB Employee Archive Cron] Initializing (03:30 daily, порог ${ARCHIVE_AFTER_DAYS} дн.)`);

cron.schedule(SCHEDULE, async () => {
  try {
    const count = await archiveStale();
    console.log(`[RB Employee Archive Cron] Готово: заархивировано ${count}`);
  } catch (err) {
    console.error('[RB Employee Archive Cron] Ошибка:', err.message);
  }
});

module.exports = {};
