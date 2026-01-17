/**
 * Скрипт для исправления кодировки имен файлов в таблице accreditation_files
 * Исправляет неправильно сохраненные UTF-8 имена файлов
 */

const { AccreditationFile } = require('../models');

async function fixFileNamesEncoding() {
  try {
    console.log('Начинаем исправление кодировки имен файлов...');

    const files = await AccreditationFile.findAll();
    console.log(`Найдено файлов: ${files.length}`);

    let fixedCount = 0;
    for (const file of files) {
      const originalName = file.originalName;

      // Проверяем, нужно ли исправить кодировку
      // Если в имени есть знаки вопроса или странные символы, это признак проблем с кодировкой
      if (originalName && (originalName.includes('Ð') || originalName.includes('Ñ'))) {
        try {
          // Пробуем исправить кодировку
          const fixedName = Buffer.from(originalName, 'latin1').toString('utf8');

          await file.update({ originalName: fixedName });
          console.log(`Исправлено: "${originalName}" -> "${fixedName}"`);
          fixedCount++;
        } catch (err) {
          console.error(`Ошибка при исправлении файла ${file.id}:`, err.message);
        }
      }
    }

    console.log(`\nГотово! Исправлено файлов: ${fixedCount} из ${files.length}`);
  } catch (error) {
    console.error('Ошибка при исправлении кодировки:', error);
    throw error;
  }
}

// Запускаем скрипт
fixFileNamesEncoding()
  .then(() => {
    console.log('Скрипт успешно выполнен');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Скрипт завершился с ошибкой:', error);
    process.exit(1);
  });
