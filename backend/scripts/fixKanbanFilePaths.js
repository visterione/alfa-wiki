/**
 * Скрипт для исправления путей к файлам в задачах Kanban
 * Преобразует абсолютные пути в относительные (uploads/kanban/...)
 */

const { KanbanTask } = require('../models');
const path = require('path');

async function fixFilePaths() {
  try {
    console.log('Starting fix for kanban file paths...');

    // Находим все задачи с прикрепленными файлами
    const tasks = await KanbanTask.findAll({
      where: {
        attachments: {
          [require('sequelize').Op.ne]: []
        }
      }
    });

    if (tasks.length === 0) {
      console.log('No tasks with attachments found.');
      return;
    }

    console.log(`Found ${tasks.length} tasks with attachments`);

    let fixedCount = 0;
    let totalFilesFixed = 0;

    for (const task of tasks) {
      let needsUpdate = false;
      const updatedAttachments = task.attachments.map(file => {
        let filePath = file.path;
        const originalPath = filePath;

        // Проверяем, является ли путь абсолютным
        if (filePath.includes('backend\\uploads') || filePath.includes('backend/uploads')) {
          // Извлекаем относительный путь
          const uploadsIndex = filePath.indexOf('uploads');
          if (uploadsIndex !== -1) {
            filePath = filePath.substring(uploadsIndex).replace(/\\/g, '/');
            needsUpdate = true;
            totalFilesFixed++;
            console.log(`  Fixed: ${originalPath} -> ${filePath}`);
          }
        } else if (filePath.match(/^[A-Z]:\\/)) {
          // Windows абсолютный путь
          const uploadsIndex = filePath.indexOf('uploads');
          if (uploadsIndex !== -1) {
            filePath = filePath.substring(uploadsIndex).replace(/\\/g, '/');
            needsUpdate = true;
            totalFilesFixed++;
            console.log(`  Fixed: ${originalPath} -> ${filePath}`);
          }
        }

        return {
          ...file,
          path: filePath
        };
      });

      if (needsUpdate) {
        await task.update({ attachments: updatedAttachments });
        fixedCount++;
        console.log(`Updated task ${task.id}: "${task.title}" (${updatedAttachments.length} files)`);
      }
    }

    console.log(`\nSuccessfully fixed ${totalFilesFixed} files in ${fixedCount} tasks`);
  } catch (error) {
    console.error('Error fixing file paths:', error);
  }
}

// Запускаем скрипт
fixFilePaths()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
