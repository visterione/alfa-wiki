/**
 * Скрипт для исправления поля completedAt у существующих завершенных задач
 * Устанавливает completedAt = updatedAt для всех задач со статусом 'done' без completedAt
 */

const { KanbanTask } = require('../models');

async function fixCompletedAt() {
  try {
    console.log('Starting fix for kanban tasks completedAt field...');

    // Находим все завершенные задачи без completedAt
    const tasksToFix = await KanbanTask.findAll({
      where: {
        status: 'done',
        completedAt: null
      }
    });

    if (tasksToFix.length === 0) {
      console.log('No tasks to fix. All done tasks already have completedAt set.');
      return;
    }

    console.log(`Found ${tasksToFix.length} tasks to fix`);

    // Обновляем каждую задачу
    for (const task of tasksToFix) {
      await task.update({
        completedAt: task.updatedAt // Используем updatedAt как дату завершения
      });
      console.log(`Fixed task ${task.id}: "${task.title}"`);
    }

    console.log(`Successfully fixed ${tasksToFix.length} tasks`);
  } catch (error) {
    console.error('Error fixing completedAt:', error);
  }
}

// Запускаем скрипт
fixCompletedAt()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
