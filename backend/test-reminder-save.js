/**
 * Тестовый скрипт для проверки сохранения sentReminders в БД
 * Запуск: node test-reminder-save.js
 */

require('dotenv').config();
const { CalendarEvent } = require('./models');
const { Op } = require('sequelize');

async function testReminderSave() {
  console.log('🧪 Testing sentReminders save to database...\n');

  try {
    // Найти ближайшее событие с напоминаниями
    const now = new Date();
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const event = await CalendarEvent.findOne({
      where: {
        startTime: {
          [Op.gte]: now,
          [Op.lte]: future
        },
        status: { [Op.notIn]: ['cancelled', 'completed'] },
        reminders: { [Op.ne]: null }
      }
    });

    if (!event) {
      console.log('❌ No events found for testing');
      process.exit(1);
    }

    console.log(`✅ Found event: "${event.title}" (ID: ${event.id})`);
    console.log(`Current sentReminders:`, JSON.stringify(event.sentReminders || []));

    // Добавляем тестовую запись
    const testReminder = {
      minutesBefore: 999,
      recipientId: 'test-user-id',
      sentAt: new Date().toISOString()
    };

    const sentReminders = [...(event.sentReminders || []), testReminder];

    // Помечаем поле как измененное
    event.changed('sentReminders', true);

    await event.update({
      sentReminders
    }, {
      fields: ['sentReminders']
    });

    console.log(`\n✅ Updated sentReminders in memory:`, JSON.stringify(sentReminders));

    // Перезагружаем событие из БД
    await event.reload();

    console.log(`\n🔄 Reloaded from database:`);
    console.log(`sentReminders:`, JSON.stringify(event.sentReminders || []));

    // Проверяем, есть ли наша тестовая запись
    const hasTestReminder = event.sentReminders?.some(r =>
      r.minutesBefore === 999 && r.recipientId === 'test-user-id'
    );

    if (hasTestReminder) {
      console.log('\n✅ TEST PASSED: sentReminders saved correctly!');

      // Очищаем тестовые данные
      const cleaned = event.sentReminders.filter(r => r.minutesBefore !== 999);
      event.changed('sentReminders', true);
      await event.update({ sentReminders: cleaned }, { fields: ['sentReminders'] });
      console.log('✅ Test reminder removed');
    } else {
      console.log('\n❌ TEST FAILED: sentReminders NOT saved to database!');
      console.log('This indicates a Sequelize JSONB update issue.');
    }

    process.exit(hasTestReminder ? 0 : 1);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Запуск
testReminderSave();
