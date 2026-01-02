// backend/bot/telegramBot.js
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Accreditation, Vehicle, TelegramSubscriber } = require('../models');

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot = null;

// ═══════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════

// Безопасное редактирование сообщения (игнорирует ошибку "message is not modified")
async function editMessageSafe(chatId, messageId, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...options
    });
  } catch (err) {
    // Игнорируем ошибку "message is not modified"
    if (!err.message?.includes('message is not modified')) {
      console.error('Edit message error:', err.message);
    }
  }
}

// Безопасная отправка сообщения
async function sendMessageSafe(chatId, message) {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`Failed to send to ${chatId}:`, err.message);
    if (err.response?.statusCode === 403) {
      await TelegramSubscriber.update(
        { isActive: false },
        { where: { chatId: chatId.toString() } }
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// КЛАВИАТУРЫ
// ═══════════════════════════════════════════════════════════════

const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '⚙️ Настройки уведомлений', callback_data: 'settings' }],
      [{ text: '👤 Мой профиль', callback_data: 'profile' }]
    ]
  }
};

const getSettingsKeyboard = (accEnabled, vehEnabled) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: `${accEnabled ? '✅' : '❌'} Аккредитации`, callback_data: 'toggle_accreditations' }],
      [{ text: `${vehEnabled ? '✅' : '❌'} Техобслуживание`, callback_data: 'toggle_vehicles' }],
      [{ text: '« Назад в меню', callback_data: 'main_menu' }]
    ]
  }
});

const subscribeKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '✅ Подписаться на уведомления', callback_data: 'subscribe' }]
    ]
  }
};

const unsubscribeConfirmKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '❌ Да, отписаться', callback_data: 'confirm_unsubscribe' },
        { text: '« Отмена', callback_data: 'main_menu' }
      ]
    ]
  }
};

// ═══════════════════════════════════════════════════════════════
// СООБЩЕНИЯ
// ═══════════════════════════════════════════════════════════════

const getWelcomeMessage = (name) => `🎉 *Добро пожаловать, ${name}!*

Я бот-помощник для отслеживания важных сроков:

📋 *Аккредитации* — напоминания об истечении сроков аккредитаций сотрудников

🚗 *Техобслуживание* — напоминания о страховке и ТО автомобилей

━━━━━━━━━━━━━━━━━━━━━
📅 Напоминания приходят за:
*90, 60, 30, 14 и 7 дней* до истечения срока

🔧 ТО: за *5000 км* до плановой отметки
━━━━━━━━━━━━━━━━━━━━━

Выберите действие:`;

const getMainMenuMessage = () => `📱 *Главное меню*

Выберите действие:`;

const getSettingsMessage = (accEnabled, vehEnabled) => `⚙️ *Настройки уведомлений*

Текущий статус подписок:

${accEnabled ? '✅' : '❌'} Аккредитации
${vehEnabled ? '✅' : '❌'} Техобслуживание

━━━━━━━━━━━━━━━━━━━━━

📋 *Аккредитации* — напоминания об истечении сроков аккредитаций сотрудников

🚗 *Техобслуживание* — напоминания о страховке и ТО автомобилей

━━━━━━━━━━━━━━━━━━━━━

_Нажмите на кнопку чтобы включить/отключить_`;

const getProfileMessage = (subscriber) => {
  const isActive = subscriber.isActive === true;
  const accEnabled = subscriber.subscribeAccreditations === true;
  const vehEnabled = subscriber.subscribeVehicles === true;
  
  return `👤 *Мой профиль*

━━━━━━━━━━━━━━━━━━━━━

👤 *Имя:* ${subscriber.firstName || 'Не указано'}
📛 *Username:* ${subscriber.username ? '@' + subscriber.username : 'Не указан'}
📅 *Подписка с:* ${subscriber.createdAt.toLocaleDateString('ru-RU')}

━━━━━━━━━━━━━━━━━━━━━

${isActive ? '✅' : '❌'} *Статус:* ${isActive ? 'Активен' : 'Неактивен'}

*Подписки:*
${accEnabled ? '✅' : '❌'} Аккредитации
${vehEnabled ? '✅' : '❌'} Техобслуживание`;
};

const getProfileKeyboard = (isActive) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: '⚙️ Настроить подписки', callback_data: 'settings' }],
      [{ text: isActive ? '🔕 Отписаться от всего' : '🔔 Подписаться', callback_data: isActive ? 'unsubscribe' : 'subscribe' }],
      [{ text: '« Назад в меню', callback_data: 'main_menu' }]
    ]
  }
});

// ═══════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ БОТА
// ═══════════════════════════════════════════════════════════════

function initBot() {
  if (!token) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN not set, bot disabled');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram bot started');

  // Команда /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Пользователь';
    
    try {
      const [subscriber, created] = await TelegramSubscriber.findOrCreate({
        where: { chatId: chatId.toString() },
        defaults: {
          chatId: chatId.toString(),
          username: msg.from.username,
          firstName: msg.from.first_name,
          lastName: msg.from.last_name,
          isActive: true,
          subscribeAccreditations: true,
          subscribeVehicles: true
        }
      });

      if (!created) {
        // Обновляем данные существующего подписчика
        await subscriber.update({ 
          isActive: true,
          username: msg.from.username,
          firstName: msg.from.first_name,
          lastName: msg.from.last_name
        });
      }

      await bot.sendMessage(chatId, getWelcomeMessage(firstName), { 
        parse_mode: 'Markdown',
        ...mainKeyboard 
      });
    } catch (error) {
      console.error('Start command error:', error);
      await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  });

  // Команда /menu
  bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, getMainMenuMessage(), { 
      parse_mode: 'Markdown',
      ...mainKeyboard 
    });
  });

  // Обработка callback кнопок
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
      let subscriber = await TelegramSubscriber.findOne({
        where: { chatId: chatId.toString() }
      });

      // Если подписчик не найден - создаём
      if (!subscriber) {
        subscriber = await TelegramSubscriber.create({
          chatId: chatId.toString(),
          username: query.from.username,
          firstName: query.from.first_name,
          lastName: query.from.last_name,
          isActive: true,
          subscribeAccreditations: true,
          subscribeVehicles: true
        });
      }

      // Получаем текущие значения (с учётом возможных null)
      let accEnabled = subscriber.subscribeAccreditations === true;
      let vehEnabled = subscriber.subscribeVehicles === true;
      let isActive = subscriber.isActive === true;

      switch (data) {
        case 'main_menu':
          await editMessageSafe(chatId, messageId, getMainMenuMessage(), mainKeyboard);
          break;

        case 'profile':
          await editMessageSafe(chatId, messageId, getProfileMessage(subscriber), getProfileKeyboard(isActive));
          break;

        case 'settings':
          await editMessageSafe(chatId, messageId, getSettingsMessage(accEnabled, vehEnabled), getSettingsKeyboard(accEnabled, vehEnabled));
          break;

        case 'toggle_accreditations':
          // Переключаем значение
          accEnabled = !accEnabled;
          await subscriber.update({ subscribeAccreditations: accEnabled });
          
          // Обновляем сообщение с новым статусом
          await editMessageSafe(chatId, messageId, getSettingsMessage(accEnabled, vehEnabled), getSettingsKeyboard(accEnabled, vehEnabled));
          
          await bot.answerCallbackQuery(query.id, {
            text: accEnabled ? '✅ Аккредитации включены' : '❌ Аккредитации отключены'
          });
          return;

        case 'toggle_vehicles':
          // Переключаем значение
          vehEnabled = !vehEnabled;
          await subscriber.update({ subscribeVehicles: vehEnabled });
          
          // Обновляем сообщение с новым статусом
          await editMessageSafe(chatId, messageId, getSettingsMessage(accEnabled, vehEnabled), getSettingsKeyboard(accEnabled, vehEnabled));
          
          await bot.answerCallbackQuery(query.id, {
            text: vehEnabled ? '✅ Техобслуживание включено' : '❌ Техобслуживание отключено'
          });
          return;

        case 'unsubscribe':
          await editMessageSafe(chatId, messageId, 
            '⚠️ *Вы уверены?*\n\nВы перестанете получать все уведомления.\nВы сможете подписаться снова в любой момент.',
            unsubscribeConfirmKeyboard
          );
          break;

        case 'confirm_unsubscribe':
          await subscriber.update({ isActive: false });
          await editMessageSafe(chatId, messageId,
            '🔕 *Вы отписались от уведомлений*\n\nЧтобы подписаться снова, нажмите кнопку ниже или отправьте /start',
            subscribeKeyboard
          );
          break;

        case 'subscribe':
          await subscriber.update({ 
            isActive: true,
            subscribeAccreditations: true,
            subscribeVehicles: true
          });
          await editMessageSafe(chatId, messageId,
            '✅ *Вы подписаны на уведомления!*\n\nВыберите действие:',
            mainKeyboard
          );
          break;
      }

      await bot.answerCallbackQuery(query.id);

    } catch (error) {
      console.error('Callback error:', error);
      try {
        await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка, попробуйте /start' });
      } catch (e) {}
    }
  });

  // Запускаем проверку напоминаний каждый день в 9:00
  cron.schedule('0 9 * * *', () => {
    console.log('🔔 Running daily reminder check...');
    checkAndSendReminders();
  });

  return bot;
}

// ═══════════════════════════════════════════════════════════════
// НАПОМИНАНИЯ
// ═══════════════════════════════════════════════════════════════

async function checkAndSendReminders() {
  try {
    const accSubscribers = await TelegramSubscriber.findAll({ 
      where: { isActive: true, subscribeAccreditations: true } 
    });
    
    const vehSubscribers = await TelegramSubscriber.findAll({ 
      where: { isActive: true, subscribeVehicles: true } 
    });

    if (accSubscribers.length > 0) {
      await checkAccreditationReminders(accSubscribers);
    }

    if (vehSubscribers.length > 0) {
      await checkVehicleInsuranceReminders(vehSubscribers);
      await checkVehicleTOReminders(vehSubscribers);
    }

    console.log('✅ Reminder check completed');
  } catch (error) {
    console.error('Check reminders error:', error);
  }
}

async function checkAccreditationReminders(subscribers) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reminderDays = [
    { days: 90, field: 'reminded90', emoji: '🟢', label: '90 дней' },
    { days: 60, field: 'reminded60', emoji: '🟡', label: '60 дней' },
    { days: 30, field: 'reminded30', emoji: '🟠', label: '30 дней' },
    { days: 14, field: 'reminded14', emoji: '🔴', label: '14 дней' },
    { days: 7, field: 'reminded7', emoji: '🚨', label: '7 дней' }
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
      const message = `${reminder.emoji} *НАПОМИНАНИЕ ОБ АККРЕДИТАЦИИ*

━━━━━━━━━━━━━━━━━━━━━

👤 *ФИО:* ${acc.fullName}
🏥 *Медцентр:* ${acc.medCenter}
📚 *Специальность:* ${acc.specialty}

━━━━━━━━━━━━━━━━━━━━━

📅 *Срок действия:* ${new Date(acc.expirationDate).toLocaleDateString('ru-RU')}
⏰ *Осталось:* ${reminder.label}
${acc.comment ? `\n💬 _${acc.comment}_` : ''}`;

      for (const sub of subscribers) {
        await sendMessageSafe(sub.chatId, message);
      }

      await acc.update({ [reminder.field]: true });
    }
  }
}

async function checkVehicleInsuranceReminders(subscribers) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reminderDays = [
    { days: 90, field: 'reminded90', emoji: '🟢', label: '90 дней' },
    { days: 60, field: 'reminded60', emoji: '🟡', label: '60 дней' },
    { days: 30, field: 'reminded30', emoji: '🟠', label: '30 дней' },
    { days: 14, field: 'reminded14', emoji: '🔴', label: '14 дней' },
    { days: 7, field: 'reminded7', emoji: '🚨', label: '7 дней' }
  ];

  for (const reminder of reminderDays) {
    const targetDate = new Date(today.getTime() + reminder.days * 24 * 60 * 60 * 1000);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const vehicles = await Vehicle.findAll({
      where: {
        insuranceDate: targetDateStr,
        [reminder.field]: false
      }
    });

    for (const veh of vehicles) {
      const message = `${reminder.emoji} *НАПОМИНАНИЕ О СТРАХОВКЕ*

━━━━━━━━━━━━━━━━━━━━━

🚗 *Авто:* ${veh.carBrand}
🏢 *Организация:* ${veh.organization}
🔢 *Гос. номер:* ${veh.licensePlate}
📅 *Год выпуска:* ${veh.carYear}

━━━━━━━━━━━━━━━━━━━━━

📋 *Страховка до:* ${new Date(veh.insuranceDate).toLocaleDateString('ru-RU')}
⏰ *Осталось:* ${reminder.label}
${veh.comment ? `\n💬 _${veh.comment}_` : ''}`;

      for (const sub of subscribers) {
        await sendMessageSafe(sub.chatId, message);
      }

      await veh.update({ [reminder.field]: true });
    }
  }
}

async function checkVehicleTOReminders(subscribers) {
  const vehicles = await Vehicle.findAll({
    where: { remindedTO: false }
  });

  const vehiclesNeedingTO = vehicles.filter(v => (v.nextTO - v.mileage) <= 5000 && (v.nextTO - v.mileage) > 0);

  for (const veh of vehiclesNeedingTO) {
    const kmLeft = veh.nextTO - veh.mileage;
    
    let emoji = '🟡';
    if (kmLeft <= 1000) emoji = '🚨';
    else if (kmLeft <= 3000) emoji = '🔴';

    const message = `${emoji} *НАПОМИНАНИЕ О ТЕХОБСЛУЖИВАНИИ*

━━━━━━━━━━━━━━━━━━━━━

🚗 *Авто:* ${veh.carBrand}
🏢 *Организация:* ${veh.organization}
🔢 *Гос. номер:* ${veh.licensePlate}

━━━━━━━━━━━━━━━━━━━━━

📊 *Текущий пробег:* ${veh.mileage.toLocaleString('ru-RU')} км
🎯 *ТО на:* ${veh.nextTO.toLocaleString('ru-RU')} км

⚠️ *Осталось:* ${kmLeft.toLocaleString('ru-RU')} км
${veh.comment ? `\n💬 _${veh.comment}_` : ''}`;

    for (const sub of subscribers) {
      await sendMessageSafe(sub.chatId, message);
    }

    await veh.update({ remindedTO: true });
  }
}

// Ручной запуск проверки (для тестирования)
async function manualCheck() {
  await checkAndSendReminders();
}

module.exports = { initBot, manualCheck };