const { Chat, ChatMember, Message, User } = require('../models');

// ID Ассистента (специальный бот для общих уведомлений)
const ASSISTANT_ID = '00000000-0000-0000-0000-000000000001';

// ID Бота для работы с негативом (Reviews)
const REVIEWS_BOT_ID = '00000000-0000-0000-0000-000000000002';

let io = null;

/**
 * Инициализация сервиса уведомлений с Socket.IO
 */
function init(socketIO) {
  io = socketIO;
  console.log('✅ Notification service initialized with Socket.IO');
}

/**
 * Создание или получение чата с ботом для пользователя
 * @param {string} userId - ID пользователя
 * @param {string} botId - ID бота (ASSISTANT_ID или REVIEWS_BOT_ID)
 * @param {string} botUsername - username бота
 * @param {string} botDisplayName - отображаемое имя бота
 * @param {string} botAvatar - путь к аватарке бота (опционально)
 */
async function getOrCreateBotChat(userId, botId, botUsername, botDisplayName, botAvatar = null) {
  try {
    // Проверяем, существует ли пользователь-бот
    let bot = await User.findByPk(botId);

    if (!bot) {
      // Создаем пользователя-бота, если его нет
      bot = await User.create({
        id: botId,
        username: botUsername,
        displayName: botDisplayName,
        password: Math.random().toString(36), // Случайный пароль (не используется)
        isBot: true,
        avatar: botAvatar
      });
      console.log(`✅ Created ${botDisplayName} bot user`);
    }

    // Ищем существующий приватный чат между пользователем и ботом
    const existingMembership = await ChatMember.findOne({
      where: { userId },
      include: [{
        model: Chat,
        as: 'chat',
        where: { type: 'private' },
        include: [{
          model: ChatMember,
          as: 'members',
          where: { userId: botId }
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
      createdBy: botId
    });

    // Добавляем обоих участников
    await ChatMember.bulkCreate([
      { chatId: chat.id, userId: userId },
      { chatId: chat.id, userId: botId }
    ]);

    console.log(`✅ Created ${botDisplayName} chat for user ${userId}`);
    return chat;
  } catch (error) {
    console.error(`Error in getOrCreateBotChat (${botDisplayName}):`, error);
    throw error;
  }
}

/**
 * Создание или получение чата с Ассистентом для пользователя
 */
async function getOrCreateAssistantChat(userId) {
  return getOrCreateBotChat(userId, ASSISTANT_ID, 'assistant', 'Ассистент', null);
}

/**
 * Создание или получение чата с ботом "Работа с негативом" для пользователя
 */
async function getOrCreateReviewsChat(userId) {
  return getOrCreateBotChat(userId, REVIEWS_BOT_ID, 'reviews_bot', 'Работа с негативом', '/uploads/bot-avatars/reviews-bot.svg');
}

/**
 * Отправка сообщения пользователю от бота
 * @param {string} userId - ID получателя
 * @param {string} messageText - Текст сообщения
 * @param {object} metadata - Метаданные сообщения
 * @param {string} botId - ID бота-отправителя
 * @param {function} getChatFunction - Функция для получения чата с ботом
 */
async function sendMessageFromBot(userId, messageText, metadata = {}, botId, getChatFunction) {
  try {
    const chat = await getChatFunction(userId);

    const message = await Message.create({
      chatId: chat.id,
      senderId: botId,
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

      // Получаем информацию о боте для уведомления
      const bot = await User.findByPk(botId, {
        attributes: ['id', 'username', 'displayName', 'avatar', 'isBot']
      });

      io.to(`user:${userId}`).emit('new_message', {
        chatId: chat.id,
        message: fullMessage,
        chat: {
          id: chat.id,
          type: 'private',
          displayName: bot.displayName || bot.username,
          avatar: bot.avatar,
          isAssistantChat: true
        }
      });
    }

    return message;
  } catch (error) {
    console.error('Error sending message from bot:', error);
    throw error;
  }
}

/**
 * Отправка сообщения в чат с Ассистентом
 */
async function sendMessageToUser(userId, messageText, metadata = {}) {
  return sendMessageFromBot(userId, messageText, metadata, ASSISTANT_ID, getOrCreateAssistantChat);
}

/**
 * Отправка сообщения в чат с ботом "Работа с негативом"
 */
async function sendReviewsBotMessage(userId, messageText, metadata = {}) {
  return sendMessageFromBot(userId, messageText, metadata, REVIEWS_BOT_ID, getOrCreateReviewsChat);
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

/**
 * Отправка уведомления о создании нового отзыва
 */
async function sendReviewCreatedNotification(userId, review, board, creator) {
  const messageText = `📝 Новый отзыв создан\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Доска: ${board.name}\n` +
    `Оценка: ${'⭐'.repeat(review.rating)}\n` +
    `Создал: ${creator.displayName || creator.username}`;

  const metadata = {
    type: 'review_created',
    reviewId: review.id,
    boardId: board.id
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

/**
 * Отправка уведомления о смене статуса отзыва
 */
async function sendReviewStatusChangedNotification(userId, review, oldStatusLabel, newStatusLabel, changer, isAssignee = false) {
  const prefix = isAssignee ? '👤 Ваша задача изменила статус' : '🔄 Изменен статус отзыва';

  const messageText = `${prefix}\n\n` +
    `Пациент: ${review.patientName}\n` +
    `${oldStatusLabel} → ${newStatusLabel}\n` +
    `Изменил: ${changer.displayName || changer.username}`;

  const metadata = {
    type: 'review_status_changed',
    reviewId: review.id,
    oldStatus: review.status,
    newStatus: newStatusLabel,
    isAssignee: isAssignee
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

/**
 * Отправка уведомления о назначении ответственного за отзыв
 */
async function sendReviewAssignedNotification(userId, review, board, assigner) {
  const messageText = `👤 Вам назначен отзыв для обработки\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Доска: ${board.name}\n` +
    `Статус: ${review.status}\n` +
    `Назначил: ${assigner.displayName || assigner.username}\n\n` +
    `Пожалуйста, соберите необходимые сведения.`;

  const metadata = {
    type: 'review_assigned',
    reviewId: review.id,
    boardId: board.id
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

/**
 * Отправка уведомления о новом комментарии к отзыву
 */
async function sendReviewCommentNotification(userId, review, comment, commenter, hasAttachments = false) {
  const attachmentText = hasAttachments ? '\n📎 С вложениями' : '';

  const messageText = `💬 Новый комментарий к отзыву\n\n` +
    `Пациент: ${review.patientName}\n` +
    `От: ${commenter.displayName || commenter.username}\n` +
    `Комментарий: ${comment.substring(0, 200)}${comment.length > 200 ? '...' : ''}${attachmentText}`;

  const metadata = {
    type: 'review_comment',
    reviewId: review.id,
    hasAttachments: hasAttachments
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

/**
 * Отправка уведомления о финализации отзыва
 */
async function sendReviewFinalizedNotification(userId, review, decisionCategory, finalizer) {
  const messageText = `✅ Отзыв финализирован\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Решение: ${decisionCategory}\n` +
    `Финализировал: ${finalizer.displayName || finalizer.username}`;

  const metadata = {
    type: 'review_finalized',
    reviewId: review.id,
    decisionCategory: decisionCategory
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

module.exports = {
  ASSISTANT_ID,
  REVIEWS_BOT_ID,
  init,
  getOrCreateAssistantChat,
  getOrCreateReviewsChat,
  sendMessageToUser,
  sendReviewsBotMessage,
  sendCalendarReminder,
  sendAccreditationReminder,
  sendVehicleInsuranceReminder,
  sendVehicleTOReminder,
  sendWelcomeMessage,
  // Review notifications
  sendReviewCreatedNotification,
  sendReviewStatusChangedNotification,
  sendReviewAssignedNotification,
  sendReviewCommentNotification,
  sendReviewFinalizedNotification
};
