const { Chat, ChatMember, Message, User } = require('../models');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getStatusById } = require('../config/reviewStatuses');

// ID Ассистента (специальный бот для общих уведомлений)
const ASSISTANT_ID = '00000000-0000-0000-0000-000000000001';

// ID Бота для работы с негативом (Reviews)
const REVIEWS_BOT_ID = '00000000-0000-0000-0000-000000000002';

// ID Бота АТС — пропущенные звонки
const MISSED_CALLS_BOT_ID = '00000000-0000-0000-0000-000000000003';

let io = null;

/**
 * Инициализация сервиса уведомлений с Socket.IO
 */
function init(socketIO) {
  io = socketIO;
  console.log('✅ Notification service initialized with Socket.IO');
}

/**
 * Доступ к Socket.IO из мест, где нет req (крон-джобы, воркеры).
 * @returns {import('socket.io').Server|null}
 */
function getIo() {
  return io;
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
      const randomPassword = uuidv4() + uuidv4();
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      bot = await User.create({
        id: botId,
        username: botUsername,
        displayName: botDisplayName,
        email: `${botUsername}@system.local`,
        password: hashedPassword,
        isBot: true,
        isActive: true,
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
  return getOrCreateBotChat(userId, REVIEWS_BOT_ID, 'reviews_bot', 'Работа с негативом', 'uploads/bot-avatars/reviews-bot.svg');
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

    // Восстанавливаем чат у получателя, если он его скрыл
    await ChatMember.update(
      { isHidden: false },
      { where: { chatId: chat.id, userId, isHidden: true } }
    );

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
 * Короткий заголовок и текст для push из сообщения бота.
 *
 * Сообщение бота свёрстано под чат: первая строка — что случилось, дальше поля,
 * в конце markdown-ссылка «Открыть отзыв». В шторке уведомления ссылка не
 * нажимается и только занимает место, а поля читаются подряд одной строкой.
 * Поэтому первая строка идёт заголовком, остальные — телом, ссылка отбрасывается.
 */
function pushTextFrom(messageText) {
  const lines = String(messageText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('[')); // markdown-ссылка в конце

  return {
    title: lines[0] || 'Отзывы',
    body: lines.slice(1).join(' · ').slice(0, 200),
  };
}

/**
 * Отправка сообщения в чат с ботом "Работа с негативом".
 *
 * Помимо сообщения уходит push (ver. 7.26). Раньше уведомления модуля отзывов
 * жили только в чате бота, а сообщения от ботов push не поднимают
 * (sendMessageFromBot его не шлёт) — то есть на телефон они не приходили вовсе.
 * Push несёт reviewId, поэтому по нажатию открывается сам отзыв, а не чат с
 * ботом, из которого до отзыва ещё надо дойти.
 *
 * Падение push не должно ронять уведомление: сообщение в чате уже создано, и
 * оно здесь главное.
 */
async function sendReviewsBotMessage(userId, messageText, metadata = {}) {
  const message = await sendMessageFromBot(
    userId, messageText, metadata, REVIEWS_BOT_ID, getOrCreateReviewsChat,
  );

  if (metadata.reviewId) {
    const {title, body} = pushTextFrom(messageText);
    require('./pushService').sendToUsers([userId], {
      kind: 'review',
      reviewId: metadata.reviewId,
      boardId: metadata.boardId || '',
      reviewType: metadata.type || '',
      title,
      body,
    }).catch(err => console.error('[reviews] push:', err.message));
  }

  return message;
}

/**
 * Инициализация бота АТС (создаёт пользователя-бота если его нет)
 */
async function initMissedCallsBot() {
  let bot = await User.findByPk(MISSED_CALLS_BOT_ID);
  if (!bot) {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    const randomPassword = uuidv4() + uuidv4();
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    bot = await User.create({
      id: MISSED_CALLS_BOT_ID,
      username: 'ats_bot',
      displayName: 'Пропущенные звонки',
      email: 'ats_bot@system.local',
      password: hashedPassword,
      isBot: true,
      isActive: true,
    });
    console.log('✅ Created АТС bot user');
  }
  return bot;
}

/**
 * Отправка сообщения о пропущенном звонке в групповой чат
 * @param {string} chatId - UUID группового чата
 * @param {string} text - текст сообщения
 */
async function sendMissedCallToGroup(chatId, text) {
  try {
    await initMissedCallsBot();

    const member = await ChatMember.findOne({ where: { chatId, userId: MISSED_CALLS_BOT_ID } });
    if (!member) {
      console.error(`[MissedCalls] Бот не является участником чата ${chatId}`);
      return false;
    }

    const message = await Message.create({
      chatId,
      senderId: MISSED_CALLS_BOT_ID,
      content: text,
      type: 'text'
    });

    const chat = await Chat.findByPk(chatId, {
      include: [{ model: ChatMember, as: 'members' }]
    });

    await chat.update({
      lastMessage: text,
      lastMessageAt: message.createdAt
    });

    await ChatMember.update(
      { isHidden: false },
      { where: { chatId, isHidden: true } }
    );

    if (io && chat) {
      const fullMessage = await Message.findByPk(message.id, {
        include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot'] }]
      });

      chat.members.forEach(m => {
        if (m.userId !== MISSED_CALLS_BOT_ID) {
          io.to(`user:${m.userId}`).emit('new_message', {
            message: fullMessage,
            chat: { id: chat.id, type: chat.type, displayName: chat.name, avatar: chat.avatar }
          });
        }
      });
    }

    return true;
  } catch (error) {
    console.error('[MissedCalls] Ошибка отправки в групповой чат:', error);
    return false;
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

/**
 * Отправка уведомления о создании нового отзыва
 * @param {boolean} isNegative - true если отзыв негативный (оценка 1-3)
 */
async function sendReviewCreatedNotification(userId, review, board, creator, isNegative = false) {
  const prefix = isNegative ? '📝 Новый отрицательный отзыв' : '📝 Новый положительный отзыв';
  const creatorName = creator?.displayName || creator?.username || 'Автоматически';
  const messageText = `${prefix}\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Доска: ${board.name}\n` +
    `Оценка: ${'⭐'.repeat(review.rating)}\n` +
    `Создал: ${creatorName}\n\n` +
    `[Открыть отзыв →](/reviews/board/${board.id}?review=${review.id})`;

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
  const changerName = changer?.displayName || changer?.username || 'Автоматически';

  const messageText = `${prefix}\n\n` +
    `Пациент: ${review.patientName}\n` +
    `${oldStatusLabel} → ${newStatusLabel}\n` +
    `Изменил: ${changerName}\n\n` +
    `[Открыть отзыв →](/reviews/board/${review.boardId}?review=${review.id})`;

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
  const statusLabel = getStatusById(review.status)?.label || review.status;
  const assignerName = assigner?.displayName || assigner?.username || 'Автоматически';
  const messageText = `👤 Вам назначен отзыв для обработки\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Доска: ${board.name}\n` +
    `Статус: ${statusLabel}\n` +
    `Назначил: ${assignerName}\n\n` +
    `[Открыть отзыв →](/reviews/board/${board.id}?review=${review.id})`;

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
    `Комментарий: ${comment.substring(0, 200)}${comment.length > 200 ? '...' : ''}${attachmentText}\n\n` +
    `[Открыть отзыв →](/reviews/board/${review.boardId}?review=${review.id})`;

  const metadata = {
    type: 'review_comment',
    reviewId: review.id,
    hasAttachments: hasAttachments
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

/**
 * Отправка уведомления о завершении работы по отзыву (workComplete)
 */
async function sendReviewWorkCompleteNotification(userId, review, decisionCategory, finalizer) {
  const finalizerName = finalizer?.displayName || finalizer?.username || 'Автоматически';
  const messageText = `🏁 Работа по отзыву завершена\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Решение: ${decisionCategory || '—'}\n` +
    `Завершил: ${finalizerName}\n\n` +
    `[Открыть отзыв →](/reviews/board/${review.boardId}?review=${review.id})`;

  const metadata = {
    type: 'review_work_complete',
    reviewId: review.id,
    decisionCategory: decisionCategory
  };

  return sendReviewsBotMessage(userId, messageText, metadata);
}

/**
 * Отправка уведомления об архивации отзыва (archiveReview)
 */
async function sendReviewArchivedNotification(userId, review, archivedBy) {
  const archivedByName = archivedBy?.displayName || archivedBy?.username || 'Автоматически';
  const messageText = `📦 Отзыв перемещён в архив\n\n` +
    `Пациент: ${review.patientName}\n` +
    `Архивировал: ${archivedByName}\n\n` +
    `[Открыть отзыв →](/reviews/board/${review.boardId}?review=${review.id})`;

  const metadata = {
    type: 'review_archived',
    reviewId: review.id
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
    `Финализировал: ${finalizer.displayName || finalizer.username}\n\n` +
    `[Открыть отзыв →](/reviews/board/${review.boardId}?review=${review.id})`;

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
  MISSED_CALLS_BOT_ID,
  initMissedCallsBot,
  sendMissedCallToGroup,
  init,
  getIo,
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
  sendReviewFinalizedNotification,
  sendReviewWorkCompleteNotification,
  sendReviewArchivedNotification
};
