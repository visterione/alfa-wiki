/**
 * Тестовый скрипт для проверки системы уведомлений
 * Запуск: node test-notifications.js
 */

require('dotenv').config();
const { User, CalendarEvent } = require('./models');
const notificationService = require('./services/notificationService');

async function testNotifications() {
  console.log('🧪 Starting notification system test...\n');

  try {
    // 1. Тест: Найти первого активного пользователя
    console.log('1️⃣ Finding active user...');
    const user = await User.findOne({
      where: { isActive: true, isBot: false },
      attributes: ['id', 'username', 'displayName']
    });

    if (!user) {
      console.error('❌ No active users found');
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.displayName || user.username} (${user.id})\n`);

    // 2. Тест: Отправить приветственное сообщение
    console.log('2️⃣ Testing welcome message...');
    try {
      await notificationService.sendWelcomeMessage(user.id);
      console.log('✅ Welcome message sent successfully\n');
    } catch (error) {
      console.error('❌ Failed to send welcome message:', error.message);
    }

    // 3. Тест: Отправить тестовое напоминание о календаре
    console.log('3️⃣ Testing calendar reminder...');
    const testEvent = {
      id: 'test-event-id',
      title: 'Тестовое событие',
      startTime: new Date(Date.now() + 60 * 60 * 1000) // Через час
    };

    try {
      await notificationService.sendCalendarReminder(user.id, testEvent, 15);
      console.log('✅ Calendar reminder sent successfully\n');
    } catch (error) {
      console.error('❌ Failed to send calendar reminder:', error.message);
    }

    // 4. Тест: Проверить существующие события с напоминаниями
    console.log('4️⃣ Checking for events with reminders...');
    const now = new Date();
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 часа

    const events = await CalendarEvent.findAll({
      where: {
        startTime: {
          [require('sequelize').Op.gte]: now,
          [require('sequelize').Op.lte]: future
        },
        status: { [require('sequelize').Op.notIn]: ['cancelled', 'completed'] }
      },
      limit: 5
    });

    console.log(`Found ${events.length} upcoming events in next 24 hours:`);
    events.forEach(event => {
      const hasReminders = event.reminders && Array.isArray(event.reminders) && event.reminders.length > 0;
      const reminderInfo = hasReminders
        ? `${event.reminders.length} reminder(s)`
        : 'no reminders';

      console.log(`  - ${event.title} (${new Date(event.startTime).toLocaleString('ru-RU')}) - ${reminderInfo}`);
    });

    console.log('\n✅ All tests completed!');
    console.log('\n💡 Next steps:');
    console.log('   1. Check the chat with Assistant in your application');
    console.log('   2. Create a calendar event with a reminder for 1-2 minutes from now');
    console.log('   3. Wait for the cron job to trigger (runs every minute)');
    console.log('   4. Check server logs for: [Calendar Reminders] messages\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Запуск
testNotifications();
