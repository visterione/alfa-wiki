/**
 * Миграция: Добавление системного бота "Ассистент" для уведомлений в чате
 *
 * Описание:
 * 1. Добавляет поле isBot в таблицу users
 * 2. Добавляет поле sentReminders в таблицу calendar_events
 * 3. Создаёт системного пользователя "Ассистент"
 *
 * Запуск: node backend/migrations/add-assistant-bot.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize, User } = require('../models');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ID Ассистента - фиксированный для удобства использования в коде
const ASSISTANT_ID = '00000000-0000-0000-0000-000000000001';

async function migrate() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    console.log('🚀 Начало миграции: добавление Ассистента');

    // 1. Добавляем поле isBot в таблицу users (если ещё нет)
    try {
      await queryInterface.addColumn('users', 'isBot', {
        type: sequelize.Sequelize.DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
      console.log('✅ Добавлено поле isBot в таблицу users');
    } catch (err) {
      if (err.message.includes('already exists') || err.original?.code === '42701') {
        console.log('ℹ️  Поле isBot уже существует, пропускаем');
      } else {
        throw err;
      }
    }

    // 2. Добавляем поле sentReminders в таблицу calendar_events (если ещё нет)
    try {
      await queryInterface.addColumn('calendar_events', 'sentReminders', {
        type: sequelize.Sequelize.DataTypes.JSONB,
        defaultValue: []
      });
      console.log('✅ Добавлено поле sentReminders в таблицу calendar_events');
    } catch (err) {
      if (err.message.includes('already exists') || err.original?.code === '42701') {
        console.log('ℹ️  Поле sentReminders уже существует, пропускаем');
      } else {
        throw err;
      }
    }

    // 3. Проверяем, существует ли уже Ассистент
    const existingAssistant = await User.findOne({
      where: { isBot: true }
    });

    if (existingAssistant) {
      console.log('ℹ️  Ассистент уже существует:', existingAssistant.displayName);
    } else {
      // Создаём системного пользователя "Ассистент"
      // Пароль случайный и недоступен для входа
      const randomPassword = uuidv4() + uuidv4();
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      await User.create({
        id: ASSISTANT_ID,
        username: 'assistant',
        password: hashedPassword,
        displayName: 'α-Ассистент',
        email: 'assistant@system.local',
        avatar: 'uploads/avatars/assistant-avatar.png',
        isActive: true,
        isAdmin: false,
        isBot: true,
        settings: {
          description: 'Системный бот для отправки уведомлений'
        }
      });

      console.log('✅ Создан системный пользователь "Ассистент"');
    }

    console.log('');
    console.log('🎉 Миграция успешно завершена!');
    console.log('');
    console.log('Ассистент готов к работе.');
    console.log('ID Ассистента:', ASSISTANT_ID);

  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Экспортируем ID для использования в других модулях
module.exports = { ASSISTANT_ID };

// Запуск миграции если файл запущен напрямую
if (require.main === module) {
  migrate();
}
