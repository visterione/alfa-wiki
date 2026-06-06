/**
 * Миграция: Добавление поля columnSettings в review_boards
 *
 * Хранит настройки видимости участников по столбцам Kanban:
 *   { statusId: { visibleUserIds: [] } }
 *   Пустой массив = показывать всех участников
 *
 * Запуск: node backend/migrations/add-column-settings-to-review-boards.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
  const { sequelize } = require('../models');

  try {
    console.log('🚀 Миграция: добавление columnSettings в review_boards');

    const qi = sequelize.getQueryInterface();
    const tableDesc = await qi.describeTable('review_boards');

    if (tableDesc.columnSettings) {
      console.log('ℹ️  Поле columnSettings уже существует');
    } else {
      await sequelize.query(
        `ALTER TABLE review_boards ADD COLUMN "columnSettings" JSONB NOT NULL DEFAULT '{}'`
      );
      console.log('✅ Поле columnSettings добавлено');
    }


    console.log('🎉 Миграция завершена');
  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  migrate();
}
