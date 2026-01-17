/**
 * Скрипт для добавления поля isArchived в таблицу accreditations
 */

const { sequelize } = require('../models');

async function addIsArchivedColumn() {
  try {
    console.log('Добавление столбца isArchived...');

    // Добавляем столбец
    await sequelize.query(`
      ALTER TABLE accreditations
      ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false;
    `);

    console.log('✓ Столбец isArchived добавлен');

    // Добавляем комментарий
    await sequelize.query(`
      COMMENT ON COLUMN accreditations."isArchived" IS 'Запись перенесена в архив';
    `);

    console.log('✓ Комментарий добавлен');

    // Создаем индекс
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_accreditations_is_archived
      ON accreditations("isArchived");
    `);

    console.log('✓ Индекс создан');

    // Проверяем результат
    const [results] = await sequelize.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'accreditations' AND column_name = 'isArchived';
    `);

    if (results.length > 0) {
      console.log('\n✓ Миграция успешно выполнена!');
      console.log('Информация о столбце:', results[0]);
    } else {
      console.log('\n✗ Столбец не найден после миграции');
    }

  } catch (error) {
    console.error('Ошибка при выполнении миграции:', error);
    throw error;
  }
}

// Запускаем миграцию
addIsArchivedColumn()
  .then(() => {
    console.log('\nГотово!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nОшибка:', error);
    process.exit(1);
  });
