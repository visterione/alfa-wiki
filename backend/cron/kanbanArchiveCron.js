/**
 * Cron-задача для автоматической архивации завершенных задач Kanban
 * Запускается ежедневно в 03:00
 * Архивирует задачи со статусом 'done', которые завершены более 7 дней назад
 */

const cron = require('node-cron');
const { archiveCompletedTasks } = require('../jobs/archiveKanbanTasks');

// Запуск каждый день в 03:00
const SCHEDULE = '0 3 * * *';

console.log('[Kanban Archive Cron] Initializing daily auto-archive job (03:00)');

cron.schedule(SCHEDULE, async () => {
  console.log('[Kanban Archive Cron] Running scheduled auto-archive...');
  const result = await archiveCompletedTasks();

  if (result.success) {
    if (result.count > 0) {
      console.log(`[Kanban Archive Cron] Completed: ${result.count} tasks archived`);
    } else {
      console.log('[Kanban Archive Cron] Completed: No tasks to archive');
    }
  } else {
    console.error(`[Kanban Archive Cron] Failed: ${result.error}`);
  }
});

console.log('[Kanban Archive Cron] Job scheduled successfully');

module.exports = {};
