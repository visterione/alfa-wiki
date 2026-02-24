/**
 * Миграция: Добавление бота "Работа с негативом" для уведомлений об отзывах
 *
 * Запуск: node backend/migrations/add-reviews-bot.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { User } = require('../models');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const REVIEWS_BOT_ID = '00000000-0000-0000-0000-000000000002';

async function migrate() {
  try {
    console.log('🚀 Начало миграции: добавление бота "Работа с негативом"');

    const existing = await User.findByPk(REVIEWS_BOT_ID);

    if (existing) {
      console.log('ℹ️  Бот уже существует:', existing.displayName);
    } else {
      const randomPassword = uuidv4() + uuidv4();
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      await User.create({
        id: REVIEWS_BOT_ID,
        username: 'reviews_bot',
        password: hashedPassword,
        displayName: 'Работа с негативом',
        email: 'reviews_bot@system.local',
        avatar: '/uploads/bot-avatars/reviews-bot.svg',
        isActive: true,
        isAdmin: false,
        isBot: true,
        settings: { description: 'Системный бот для уведомлений об отзывах' }
      });

      console.log('✅ Создан бот "Работа с негативом"');
    }

    console.log('🎉 Миграция успешно завершена!');
    console.log('ID бота:', REVIEWS_BOT_ID);

  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    const { sequelize } = require('../models');
    await sequelize.close();
  }
}

module.exports = { REVIEWS_BOT_ID };

if (require.main === module) {
  migrate();
}
