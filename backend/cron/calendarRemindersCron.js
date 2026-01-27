/**
 * Cron-задача для отправки напоминаний о событиях календаря
 *
 * Запускается каждый час и проверяет события, для которых нужно отправить напоминания.
 * Отправляет уведомления через чат с Ассистентом.
 */

const cron = require('node-cron');
const { Op } = require('sequelize');
const { CalendarEvent, User } = require('../models');
const notificationService = require('../services/notificationService');

// Запуск каждую минуту (для тестирования, потом вернуть на '0 * * * *' - каждый час)
const SCHEDULE = '* * * * *';

console.log('[Calendar Reminders Cron] Initializing reminder job (every minute - TEST MODE)');

/**
 * Получить всех получателей напоминания для события
 * @param {Object} event - событие календаря
 * @returns {Promise<string[]>} - массив ID пользователей
 */
async function getEventRecipients(event) {
  const recipients = new Set();

  // Создатель события всегда получает напоминание
  if (event.createdBy) {
    recipients.add(event.createdBy);
  }

  // Участники события (если есть)
  if (event.participants && Array.isArray(event.participants)) {
    event.participants.forEach(p => {
      if (p.userId && p.status !== 'declined') {
        recipients.add(p.userId);
      }
    });
  }

  // Для shared событий - пользователи из sharedWith
  if (event.visibility === 'shared' && event.sharedWith && Array.isArray(event.sharedWith)) {
    event.sharedWith.forEach(userId => {
      recipients.add(userId);
    });
  }

  // Для public событий - все активные пользователи (кроме ботов)
  // Но это может быть слишком много уведомлений, поэтому пока отправляем только создателю и участникам
  // Раскомментируйте если нужны уведомления для всех:
  // if (event.visibility === 'public') {
  //   const allUsers = await User.findAll({
  //     where: { isActive: true, isBot: false },
  //     attributes: ['id']
  //   });
  //   allUsers.forEach(u => recipients.add(u.id));
  // }

  return Array.from(recipients);
}

/**
 * Проверить, было ли уже отправлено напоминание
 * @param {Object} event - событие календаря
 * @param {number} minutesBefore - за сколько минут
 * @param {string} recipientId - ID получателя
 * @returns {boolean}
 */
function wasReminderSent(event, minutesBefore, recipientId) {
  if (!event.sentReminders || !Array.isArray(event.sentReminders)) {
    return false;
  }

  return event.sentReminders.some(r =>
    r.minutesBefore === minutesBefore && r.recipientId === recipientId
  );
}

/**
 * Записать отправленное напоминание
 * @param {Object} event - событие календаря
 * @param {number} minutesBefore - за сколько минут
 * @param {string} recipientId - ID получателя
 */
async function markReminderSent(event, minutesBefore, recipientId) {
  const sentReminders = event.sentReminders || [];
  sentReminders.push({
    minutesBefore,
    recipientId,
    sentAt: new Date().toISOString()
  });

  await event.update({
    sentReminders,
    lastReminderSent: new Date()
  });
}

/**
 * Основная функция проверки и отправки напоминаний
 */
async function checkAndSendReminders() {
  try {
    const now = new Date();
    // Проверяем события в диапазоне от сейчас до сейчас + 2 часа
    // (для тестирования можно уменьшить до 5 минут)
    const maxLookAhead = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    console.log(`[Calendar Reminders] Checking events from ${now.toISOString()} to ${maxLookAhead.toISOString()}`);

    // Находим все события с напоминаниями в ближайшем будущем
    // Исключаем отменённые и завершённые события
    const events = await CalendarEvent.findAll({
      where: {
        startTime: {
          [Op.gte]: now,
          [Op.lte]: maxLookAhead
        },
        status: { [Op.notIn]: ['cancelled', 'completed'] },
        reminders: { [Op.ne]: null }
      }
    });

    console.log(`[Calendar Reminders] Found ${events.length} events to check`);

    let remindersSent = 0;

    for (const event of events) {
      // Пропускаем события без напоминаний
      if (!event.reminders || !Array.isArray(event.reminders) || event.reminders.length === 0) {
        continue;
      }

      // Проверяем только напоминания типа 'notification' (в чат)
      const notificationReminders = event.reminders.filter(r => r.type === 'notification');

      if (notificationReminders.length === 0) {
        continue;
      }

      const eventTime = new Date(event.startTime).getTime();
      const recipients = await getEventRecipients(event);

      for (const reminder of notificationReminders) {
        const minutesBefore = reminder.minutesBefore || 15;
        const reminderTime = eventTime - minutesBefore * 60 * 1000;

        // Проверяем, пора ли отправлять напоминание
        // Отправляем если время напоминания в пределах следующих 2 минут (для тестирования, потом вернуть 60 * 60 * 1000)
        if (reminderTime >= now.getTime() && reminderTime < now.getTime() + 2 * 60 * 1000) {
          for (const recipientId of recipients) {
            // Проверяем, не отправляли ли уже это напоминание
            if (wasReminderSent(event, minutesBefore, recipientId)) {
              continue;
            }

            try {
              await notificationService.sendCalendarReminder(recipientId, event, minutesBefore);
              await markReminderSent(event, minutesBefore, recipientId);
              remindersSent++;

              console.log(`[Calendar Reminders] Sent reminder for event "${event.title}" to user ${recipientId} (${minutesBefore} min before)`);
            } catch (err) {
              console.error(`[Calendar Reminders] Failed to send reminder for event ${event.id}:`, err.message);
            }
          }
        }
      }
    }

    console.log(`[Calendar Reminders] Completed. Sent ${remindersSent} reminders.`);
    return { success: true, count: remindersSent };

  } catch (error) {
    console.error('[Calendar Reminders] Error:', error);
    return { success: false, error: error.message };
  }
}

// Планируем выполнение
cron.schedule(SCHEDULE, async () => {
  console.log('[Calendar Reminders Cron] Running scheduled check...');
  await checkAndSendReminders();
});

console.log('[Calendar Reminders Cron] Job scheduled successfully (every minute - TEST MODE)');

// Экспортируем для ручного запуска и тестирования
module.exports = { checkAndSendReminders };
