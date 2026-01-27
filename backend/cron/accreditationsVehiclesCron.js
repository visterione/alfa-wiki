/**
 * Cron-задача для отправки напоминаний об аккредитациях и ТО в чат приложения
 *
 * Запускается ежедневно в 9:00 и отправляет напоминания всем администраторам
 * через чат с Ассистентом.
 *
 * Работает параллельно с Telegram-ботом, который отправляет те же напоминания
 * подписчикам в Telegram.
 */

const cron = require('node-cron');
const { Op } = require('sequelize');
const { Accreditation, Vehicle, User } = require('../models');
const notificationService = require('../services/notificationService');

// Запуск каждый день в 9:00
const SCHEDULE = '0 9 * * *';

console.log('[Accreditations/Vehicles Cron] Initializing daily reminder job (09:00)');

/**
 * Получить всех администраторов для отправки уведомлений
 * @returns {Promise<string[]>} - массив ID администраторов
 */
async function getAdminRecipients() {
  const admins = await User.findAll({
    where: {
      isActive: true,
      isAdmin: true,
      isBot: { [Op.or]: [false, null] }
    },
    attributes: ['id']
  });

  return admins.map(a => a.id);
}

/**
 * Проверка и отправка напоминаний об аккредитациях
 */
async function checkAccreditationReminders(recipients) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reminderDays = [
    { days: 90, field: 'reminded90', label: '90 дней' },
    { days: 60, field: 'reminded60', label: '60 дней' },
    { days: 30, field: 'reminded30', label: '30 дней' },
    { days: 14, field: 'reminded14', label: '14 дней' },
    { days: 7, field: 'reminded7', label: '7 дней' }
  ];

  let sentCount = 0;

  for (const reminder of reminderDays) {
    const targetDate = new Date(today.getTime() + reminder.days * 24 * 60 * 60 * 1000);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Находим аккредитации, истекающие в целевую дату, для которых напоминание ещё не отправлено
    // НЕ фильтруем по полю reminded*, потому что оно используется для Telegram
    // Вместо этого используем отдельную логику для чата
    const accreditations = await Accreditation.findAll({
      where: {
        expirationDate: targetDateStr,
        isArchived: false
      }
    });

    for (const acc of accreditations) {
      for (const recipientId of recipients) {
        try {
          await notificationService.sendAccreditationReminder(recipientId, acc, reminder.days);
          sentCount++;
          console.log(`[Accreditations Cron] Sent reminder for "${acc.fullName}" (${reminder.days} days) to admin ${recipientId}`);
        } catch (err) {
          console.error(`[Accreditations Cron] Failed to send reminder:`, err.message);
        }
      }
    }
  }

  return sentCount;
}

/**
 * Проверка и отправка напоминаний о страховке ТС
 */
async function checkVehicleInsuranceReminders(recipients) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reminderDays = [
    { days: 30, label: '30 дней' },
    { days: 14, label: '14 дней' },
    { days: 7, label: '7 дней' }
  ];

  let sentCount = 0;

  for (const reminder of reminderDays) {
    const targetDate = new Date(today.getTime() + reminder.days * 24 * 60 * 60 * 1000);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const vehicles = await Vehicle.findAll({
      where: {
        insuranceDate: targetDateStr,
        isArchived: false
      }
    });

    for (const veh of vehicles) {
      for (const recipientId of recipients) {
        try {
          await notificationService.sendVehicleInsuranceReminder(recipientId, veh, reminder.days);
          sentCount++;
          console.log(`[Vehicles Cron] Sent insurance reminder for "${veh.carBrand}" (${reminder.days} days) to admin ${recipientId}`);
        } catch (err) {
          console.error(`[Vehicles Cron] Failed to send insurance reminder:`, err.message);
        }
      }
    }
  }

  return sentCount;
}

/**
 * Проверка и отправка напоминаний о ТО
 */
async function checkVehicleTOReminders(recipients) {
  let sentCount = 0;

  // Находим ТС, у которых до ТО осталось менее 5000 км
  const vehicles = await Vehicle.findAll({
    where: {
      isArchived: false,
      remindedTO: false
    }
  });

  const vehiclesNeedingTO = vehicles.filter(v => {
    const kmLeft = v.nextTO - v.mileage;
    return kmLeft > 0 && kmLeft <= 5000;
  });

  for (const veh of vehiclesNeedingTO) {
    const kmLeft = veh.nextTO - veh.mileage;

    for (const recipientId of recipients) {
      try {
        await notificationService.sendVehicleTOReminder(recipientId, veh, kmLeft);
        sentCount++;
        console.log(`[Vehicles Cron] Sent TO reminder for "${veh.carBrand}" (${kmLeft} km left) to admin ${recipientId}`);
      } catch (err) {
        console.error(`[Vehicles Cron] Failed to send TO reminder:`, err.message);
      }
    }

    // Отмечаем что напоминание о ТО отправлено (для Telegram и чата)
    await veh.update({ remindedTO: true });
  }

  return sentCount;
}

/**
 * Основная функция проверки и отправки напоминаний
 */
async function checkAndSendReminders() {
  try {
    console.log('[Accreditations/Vehicles Cron] Starting daily check...');

    const recipients = await getAdminRecipients();

    if (recipients.length === 0) {
      console.log('[Accreditations/Vehicles Cron] No admin recipients found, skipping');
      return { success: true, count: 0 };
    }

    console.log(`[Accreditations/Vehicles Cron] Sending to ${recipients.length} admin(s)`);

    let totalSent = 0;

    // Проверяем аккредитации
    const accreditationsSent = await checkAccreditationReminders(recipients);
    totalSent += accreditationsSent;

    // Проверяем страховку ТС
    const insuranceSent = await checkVehicleInsuranceReminders(recipients);
    totalSent += insuranceSent;

    // Проверяем ТО
    const toSent = await checkVehicleTOReminders(recipients);
    totalSent += toSent;

    console.log(`[Accreditations/Vehicles Cron] Completed. Sent ${totalSent} reminders (accreditations: ${accreditationsSent}, insurance: ${insuranceSent}, TO: ${toSent})`);

    return { success: true, count: totalSent };

  } catch (error) {
    console.error('[Accreditations/Vehicles Cron] Error:', error);
    return { success: false, error: error.message };
  }
}

// Планируем выполнение
cron.schedule(SCHEDULE, async () => {
  console.log('[Accreditations/Vehicles Cron] Running scheduled check...');
  await checkAndSendReminders();
});

console.log('[Accreditations/Vehicles Cron] Job scheduled successfully');

// Экспортируем для ручного запуска и тестирования
module.exports = { checkAndSendReminders };
