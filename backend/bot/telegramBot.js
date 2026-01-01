// backend/bot/telegramBot.js
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Accreditation, TelegramSubscriber } = require('../models');

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot = null;

function initBot() {
  if (!token) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN not set, bot disabled');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram bot started');

  // Команда /start - подписка на уведомления
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const [subscriber, created] = await TelegramSubscriber.findOrCreate({
        where: { chatId: chatId.toString() },
        defaults: {
          chatId: chatId.toString(),
          username: msg.from.username,
          firstName: msg.from.first_name,
          lastName: msg.from.last_name,
          isActive: true
        }
      });

      if (!created && !subscriber.isActive) {
        await subscriber.update({ isActive: true });
      }

      const message = created 
        ? '✅ Вы успешно подписались на уведомления об аккредитациях!\n\n' +
          'Вы будете получать напоминания за 90, 60, 30, 14 и 7 дней до истечения срока аккредитации.\n\n' +
          'Команды:\n/status - статус подписки\n/stats - статистика аккредитаций\n/stop - отписаться'
        : '👋 Вы уже подписаны на уведомления!\n\nКоманды:\n/status - статус подписки\n/stats - статистика\n/stop - отписаться';

      bot.sendMessage(chatId, message);
    } catch (error) {
      console.error('Start command error:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  });

  // Команда /stop - отписка
  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const subscriber = await TelegramSubscriber.findOne({
        where: { chatId: chatId.toString() }
      });

      if (subscriber) {
        await subscriber.update({ isActive: false });
        bot.sendMessage(chatId, '🔕 Вы отписались от уведомлений.\n\nЧтобы снова подписаться, отправьте /start');
      } else {
        bot.sendMessage(chatId, 'Вы не были подписаны на уведомления.');
      }
    } catch (error) {
      console.error('Stop command error:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  });

  // Команда /status - статус подписки
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const subscriber = await TelegramSubscriber.findOne({
        where: { chatId: chatId.toString() }
      });

      if (subscriber && subscriber.isActive) {
        bot.sendMessage(chatId, `✅ Вы подписаны на уведомления\n\n👤 ${subscriber.firstName || 'Пользователь'}\n📅 Подписка с: ${subscriber.createdAt.toLocaleDateString('ru-RU')}`);
      } else {
        bot.sendMessage(chatId, '❌ Вы не подписаны на уведомления.\n\nОтправьте /start чтобы подписаться.');
      }
    } catch (error) {
      console.error('Status command error:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
  });

  // Команда /stats - статистика
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const today = new Date();
      const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const in90Days = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

      const [total, expired, soon, in90] = await Promise.all([
        Accreditation.count(),
        Accreditation.count({ where: { expirationDate: { [Op.lt]: today } } }),
        Accreditation.count({ where: { expirationDate: { [Op.between]: [today, in30Days] } } }),
        Accreditation.count({ where: { expirationDate: { [Op.between]: [today, in90Days] } } })
      ]);

      bot.sendMessage(chatId, 
        `📊 *Статистика аккредитаций*\n\n` +
        `📋 Всего записей: ${total}\n` +
        `🔴 Просрочено: ${expired}\n` +
        `🟡 Истекает в течение 30 дней: ${soon}\n` +
        `🟠 Истекает в течение 90 дней: ${in90}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Stats command error:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
  });

  // Запускаем проверку напоминаний каждый день в 9:00
  cron.schedule('0 9 * * *', () => {
    console.log('🔔 Running daily accreditation check...');
    checkAndSendReminders();
  });

  return bot;
}

// Функция отправки напоминаний
async function checkAndSendReminders() {
  try {
    const subscribers = await TelegramSubscriber.findAll({ where: { isActive: true } });
    
    if (subscribers.length === 0) {
      console.log('No active subscribers');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminderDays = [
      { days: 90, field: 'reminded90', label: '90 дней' },
      { days: 60, field: 'reminded60', label: '60 дней' },
      { days: 30, field: 'reminded30', label: '30 дней' },
      { days: 14, field: 'reminded14', label: '14 дней' },
      { days: 7, field: 'reminded7', label: '7 дней' }
    ];

    for (const reminder of reminderDays) {
      const targetDate = new Date(today.getTime() + reminder.days * 24 * 60 * 60 * 1000);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      const accreditations = await Accreditation.findAll({
        where: {
          expirationDate: targetDateStr,
          [reminder.field]: false
        }
      });

      for (const acc of accreditations) {
        const message = 
          `⚠️ *Напоминание об аккредитации*\n\n` +
          `👤 *ФИО:* ${acc.fullName}\n` +
          `🏥 *Медцентр:* ${acc.medCenter}\n` +
          `📚 *Специальность:* ${acc.specialty}\n` +
          `📅 *Срок действия:* ${new Date(acc.expirationDate).toLocaleDateString('ru-RU')}\n` +
          `⏰ *Осталось:* ${reminder.label}\n` +
          (acc.comment ? `💬 *Комментарий:* ${acc.comment}` : '');

        for (const sub of subscribers) {
          try {
            await bot.sendMessage(sub.chatId, message, { parse_mode: 'Markdown' });
          } catch (err) {
            console.error(`Failed to send to ${sub.chatId}:`, err.message);
            if (err.response?.statusCode === 403) {
              await sub.update({ isActive: false });
            }
          }
        }

        await acc.update({ [reminder.field]: true });
      }
    }

    console.log('✅ Reminder check completed');
  } catch (error) {
    console.error('Check reminders error:', error);
  }
}

// Ручной запуск проверки (для тестирования)
async function manualCheck() {
  await checkAndSendReminders();
}

module.exports = { initBot, manualCheck };