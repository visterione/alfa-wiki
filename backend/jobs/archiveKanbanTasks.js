const { KanbanTask } = require('../models');
const { Op } = require('sequelize');

/**
 * Автоматическая архивация завершенных задач старше 1 дня
 * Запускается ежедневно в 03:00
 */
async function archiveCompletedTasks() {
  try {
    console.log('[Kanban Archive Job] Starting auto-archive process...');

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Находим все завершенные задачи старше 1 дня, которые еще не архивированы
    const tasksToArchive = await KanbanTask.findAll({
      where: {
        status: 'done',
        archived: false,
        completedAt: {
          [Op.lte]: oneDayAgo
        }
      }
    });

    if (tasksToArchive.length === 0) {
      console.log('[Kanban Archive Job] No tasks to archive');
      return { success: true, count: 0 };
    }

    // Архивируем найденные задачи
    await Promise.all(tasksToArchive.map(task =>
      task.update({
        archived: true,
        archivedAt: new Date()
      })
    ));

    console.log(`[Kanban Archive Job] Successfully archived ${tasksToArchive.length} tasks`);
    return { success: true, count: tasksToArchive.length };
  } catch (error) {
    console.error('[Kanban Archive Job] Error archiving tasks:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { archiveCompletedTasks };
