/**
 * Миграция: Обновление бота Ассистент
 *
 * Описание:
 * 1. Переименовывает бота из "Ассистент" в "α-Ассистент"
 * 2. Устанавливает аватар для бота
 *
 * Запуск: node backend/migrations/update-assistant-bot.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { User } = require('../models');

// ID Ассистента - фиксированный
const ASSISTANT_ID = '00000000-0000-0000-0000-000000000001';

// Новое имя бота
const NEW_DISPLAY_NAME = 'α-Ассистент';

// Аватар бота (путь к файлу в uploads)
const AVATAR_PATH = 'uploads/avatars/assistant-avatar.png';

async function migrate() {
  try {
    console.log('🚀 Начало миграции: обновление Ассистента');

    // Находим бота
    const assistant = await User.findByPk(ASSISTANT_ID);

    if (!assistant) {
      console.error('❌ Ассистент не найден! Сначала запустите миграцию add-assistant-bot.js');
      process.exit(1);
    }

    console.log(`📋 Текущее имя: "${assistant.displayName}"`);

    // Обновляем данные
    await assistant.update({
      displayName: NEW_DISPLAY_NAME,
      avatar: AVATAR_PATH
    });

    console.log(`✅ Имя обновлено: "${NEW_DISPLAY_NAME}"`);
    console.log(`✅ Аватар установлен: "${AVATAR_PATH}"`);

    console.log('');
    console.log('🎉 Миграция успешно завершена!');
    console.log('');
    console.log('⚠️  Не забудьте добавить файл аватара:');
    console.log(`   ${AVATAR_PATH}`);

  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    const { sequelize } = require('../models');
    await sequelize.close();
  }
}

// Экспортируем константы для использования в других модулях
module.exports = { ASSISTANT_ID, NEW_DISPLAY_NAME, AVATAR_PATH };

// Запуск миграции если файл запущен напрямую
if (require.main === module) {
  migrate();
}
