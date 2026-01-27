const { Chat, ChatMember, Message, User } = require('../models');

// ID Ассистента (специальный бот для уведомлений)
const ASSISTANT_ID = '00000000-0000-0000-0000-000000000001';

let io = null;

/**
 * Инициализация сервиса уведомлений с Socket.IO
 */
function init(socketIO) {
  io = socketIO;
  console.log('✅ Notification service initialized with Socket.IO');
}

/**
 * Создание или получение чата с Ассистентом для пользователя
 */
async function getOrCreateAssistantChat(userId) {
  try {
    // Проверяем, существует ли пользователь-ассистент
    let assistant = await User.findByPk(ASSISTANT_ID);

    if (!assistant) {
      // Создаем пользователя-ассистента, если его нет
      assistant = await User.create({
        id: ASSISTANT_ID,
        username: 'assistant',
        displayName: 'Ассистент',
        password: Math.random().toString(36), // Случайный пароль (не используется)
        isBot: true,
        avatar: null
      });
      console.log('✅ Created Assistant user');
    }

    // Ищем существующий приватный чат между пользователем и ассистентом
    const existingMembership = await ChatMember.findOne({
      where: { userId },
      include: [{
        model: Chat,
        as: 'chat',
        where: { type: 'private' },
        include: [{
          model: ChatMember,
          as: 'members',
          where: { userId: ASSISTANT_ID }
        }]
      }]
    });

    if (existingMembership) {
      return existingMembership.chat;
    }

    // Создаем новый приватный чат
    const chat = await Chat.create({
      type: 'private',
      name: null,
      createdBy: ASSISTANT_ID
    });

    // Добавляем обоих участников
    await ChatMember.bulkCreate([
      { chatId: chat.id, userId: userId },
      { chatId: chat.id, userId: ASSISTANT_ID }
    ]);

    console.log(`✅ Created assistant chat for user ${userId}`);
    return chat;
  } catch (error) {
    console.error('Error in getOrCreateAssistantChat:', error);
    throw error;
  }
}

/**
 * Отправка сообщения в чат с Ассистентом
 */
async function sendMessageToUser(userId, messageText, metadata = {}) {
  try {
    const chat = await getOrCreateAssistantChat(userId);

    const message = await Message.create({
      chatId: chat.id,
      senderId: ASSISTANT_ID,
      content: messageText,
      type: 'text'
    });

    // Обновляем последнее сообщение в чате
    await chat.update({
      lastMessage: messageText,
      lastMessageAt: message.createdAt
    });

    // Отправляем через Socket.IO, если доступно
    if (io) {
      // Получаем полное сообщение с информацией об отправителе
      const fullMessage = await Message.findByPk(message.id, {
        include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot'] }]
      });

      // Получаем информацию о чате для уведомления
      const assistant = await User.findByPk(ASSISTANT_ID, {
        attributes: ['id', 'username', 'displayName', 'avatar', 'isBot']
      });

      io.to(`user:${userId}`).emit('new_message', {
        chatId: chat.id,
        message: fullMessage,
        chat: {
          id: chat.id,
          type: 'private',
          displayName: assistant.displayName || assistant.username,
          avatar: assistant.avatar,
          isAssistantChat: true
        }
      });
    }

    return message;
  } catch (error) {
    console.error('Error sending message to user:', error);
    throw error;
  }
}

/**
 * Отправка напоминания о календарном событии
 */
async function sendCalendarReminder(userId, event, minutesBefore) {
  const messageText = `📅 Напоминание о событии: ${event.title}\n\nНачало: ${new Date(event.startTime).toLocaleString('ru-RU')}`;

  const metadata = {
    type: 'calendar_reminder',
    eventId: event.id,
    minutesBefore: minutesBefore
  };

  return sendMessageToUser(userId, messageText, metadata);
}

/**
 * Отправка напоминания об аккредитации
 */
async function sendAccreditationReminder(userId, accreditation, daysLeft) {
  const messageText = `🎓 Напоминание об аккредитации: ${accreditation.fullName}\n\nИстекает: ${new Date(accreditation.expirationDate).toLocaleDateString('ru-RU')}\nОсталось дней: ${daysLeft}`;

  const metadata = {
    type: 'accreditation_reminder',
    accreditationId: accreditation.id,
    daysLeft: daysLeft
  };

  return sendMessageToUser(userId, messageText, metadata);
}

/**
 * Отправка напоминания о страховке транспорта
 */
async function sendVehicleInsuranceReminder(userId, vehicle, daysLeft) {
  const messageText = `🚗 Напоминание о страховке: ${vehicle.carBrand}${vehicle.carModel ? ' ' + vehicle.carModel : ''} (${vehicle.licensePlate})\n\nИстекает: ${new Date(vehicle.insuranceExpiryDate).toLocaleDateString('ru-RU')}\nОсталось дней: ${daysLeft}`;

  const metadata = {
    type: 'vehicle_insurance_reminder',
    vehicleId: vehicle.id,
    daysLeft: daysLeft
  };

  return sendMessageToUser(userId, messageText, metadata);
}

/**
 * Отправка напоминания о ТО транспорта
 */
async function sendVehicleTOReminder(userId, vehicle, kmLeft) {
  const messageText = `🚗 Напоминание о техническом обслуживании: ${vehicle.carBrand}${vehicle.carModel ? ' ' + vehicle.carModel : ''} (${vehicle.licensePlate})\n\nДо следующего ТО осталось: ${kmLeft} км\nТекущий пробег: ${vehicle.currentMileage} км\nПробег следующего ТО: ${vehicle.nextTOMileage} км`;

  const metadata = {
    type: 'vehicle_to_reminder',
    vehicleId: vehicle.id,
    kmLeft: kmLeft
  };

  return sendMessageToUser(userId, messageText, metadata);
}

/**
 * Отправка приветственного сообщения новому пользователю
 */
async function sendWelcomeMessage(userId) {
  const messageText = `👋 Добро пожаловать в Альфа Wiki!\n\nЯ — α-Ассистент, бот для уведомлений. Через этот чат вы будете получать все важные уведомления.\n\nХорошей работы! 🚀`;

  const metadata = {
    type: 'welcome_message'
  };

  return sendMessageToUser(userId, messageText, metadata);
}

module.exports = {
  ASSISTANT_ID,
  init,
  getOrCreateAssistantChat,
  sendMessageToUser,
  sendCalendarReminder,
  sendAccreditationReminder,
  sendVehicleInsuranceReminder,
  sendVehicleTOReminder,
  sendWelcomeMessage
};
