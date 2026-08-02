const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { Chat, ChatMember, Message, MessageReaction, User, Role, MedCenter, UserDevice } = require('../models');
const notificationService = require('../services/notificationService');
const botWebhookService = require('../services/botWebhookService');
const subscriptionService = require('../services/public/subscriptionService');
const pushService = require('../services/pushService');
const voiceService = require('../services/voiceService');

/**
 * Бота добавили в чат или убрали — рассылаем my_chat_member и правим подписки на формы.
 * Именно это событие заменяет ручную настройку адреса чата: раньше id приходилось
 * вписывать в .env, теперь маршрутом управляет само членство бота в чате.
 *
 * Fire-and-forget: сбой уведомления не должен ломать операцию с участником.
 */
async function notifyBotMembership({ chatId, userId, actorId, status }) {
  try {
    const user = await User.findByPk(userId, { attributes: ['id', 'isBot'] });
    if (!user?.isBot) return;

    if (status === 'left') {
      await subscriptionService.onBotLeft(userId, chatId);
    }

    const result = await botWebhookService.onBotMembershipChange({ chatId, botUserId: userId, actorId, status });

    if (status === 'member' && result) {
      await subscriptionService.onBotJoined(result.bot, result.chat, actorId);
    }
  } catch (err) {
    console.error('[chat] уведомление о членстве бота не прошло:', err.message);
  }
}

// ID Ассистента
const ASSISTANT_ID = notificationService.ASSISTANT_ID;

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/chat-attachments';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Avatar upload configuration
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/chat-avatars';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '.jpg');
  }
});

const avatarUpload = multer({ 
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Search chats by name or message content
router.get('/search', authenticate, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return res.json([]);
    }

    const searchQuery = q.trim().toLowerCase();

    // Получаем чаты пользователя (не показываем скрытые)
    const memberships = await ChatMember.findAll({
      where: {
        userId: req.user.id,
        isHidden: false
      },
      attributes: ['chatId']
    });

    const chatIds = memberships.map(m => m.chatId);

    if (chatIds.length === 0) {
      return res.json([]);
    }

    // Ищем по содержимому сообщений и названиям файлов
    const messagesWithChats = await Message.findAll({
      where: {
        chatId: { [Op.in]: chatIds },
        [Op.or]: [
          // Поиск по содержимому сообщения
          { content: { [Op.iLike]: `%${searchQuery}%` } },
          // Поиск по названиям файлов в attachments (JSONB поле)
          // Используем CAST для преобразования JSONB в текст для поиска
          Sequelize.where(
            Sequelize.cast(Sequelize.col('attachments'), 'text'),
            { [Op.iLike]: `%${searchQuery}%` }
          )
        ],
        type: { [Op.ne]: 'system' }
      },
      attributes: ['chatId'],
      group: ['chatId'],
      raw: true
    });

    const chatIdsWithMessages = messagesWithChats.map(m => m.chatId);

    // Получаем полную информацию о найденных чатах
    const chatsData = await ChatMember.findAll({
      where: {
        userId: req.user.id,
        chatId: { [Op.in]: chatIdsWithMessages }
      },
      include: [{
        model: Chat,
        as: 'chat',
        include: [
          {
            model: ChatMember,
            as: 'members',
            include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
          },
          {
            model: Message,
            as: 'messages',
            limit: 1,
            order: [['createdAt', 'DESC']],
            separate: true,
            // Автор последнего сообщения — для строки «Имя: текст» в списке
            // чатов. Сам текст лежит готовым превью в chat.lastMessage, но
            // имени отправителя там нет.
            include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }]
          }
        ]
      }],
      order: [[{ model: Chat, as: 'chat' }, 'lastMessageAt', 'DESC NULLS LAST']]
    });

    // Форматируем результат
    const chatsWithUnreadCount = await Promise.all(chatsData.map(async (m) => {
      const chat = m.chat;
      const otherMembers = chat.members.filter(member => member.userId !== req.user.id);

      let displayName = chat.name;
      let avatar = chat.avatar;

      if (chat.type === 'private' && otherMembers.length > 0) {
        const otherUser = otherMembers[0].user;
        displayName = otherUser.displayName || otherUser.username;
        avatar = otherUser.avatar;
      }

      const lastReadDate = new Date(m.lastReadAt || 0);
      const unreadCount = await Message.count({
        where: {
          chatId: chat.id,
          createdAt: { [Op.gt]: lastReadDate },
          senderId: { [Op.ne]: req.user.id }
        }
      });

      const result = {
        id: chat.id,
        name: chat.name,
        type: chat.type,
        avatar: chat.avatar,
        displayName,
        avatarUrl: avatar,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt,
        // Кто отправил последнее сообщение. null для системных и старых чатов,
        // где сообщения ещё не приходили.
        lastMessageSender: chat.messages?.[0]?.sender
          ? {
              id: chat.messages[0].sender.id,
              displayName: chat.messages[0].sender.displayName || chat.messages[0].sender.username,
            }
          : null,
        members: chat.members,
        unreadCount,
        createdBy: chat.createdBy
      };

      if (chat.type === 'private' && otherMembers.length > 0) {
        result.otherUser = otherMembers[0].user;
      }

      return result;
    }));

    res.json(chatsWithUnreadCount);
  } catch (error) {
    console.error('Search chats error:', error);
    res.status(500).json({ error: 'Failed to search chats' });
  }
});

// Get user's chats
router.get('/', authenticate, async (req, res) => {
  try {
    // Убедимся, что у пользователя есть чат с Ассистентом (создастся если нет)
    // Не создаём для ботов
    const currentUser = await User.findByPk(req.user.id);
    if (currentUser && !currentUser.isBot) {
      try {
        await notificationService.getOrCreateAssistantChat(req.user.id);
      } catch (err) {
        console.error('Failed to ensure assistant chat:', err);
      }
    }

    const memberships = await ChatMember.findAll({
      where: {
        userId: req.user.id,
        isHidden: false // Фильтруем скрытые чаты
      },
      include: [{
        model: Chat,
        as: 'chat',
        include: [
          {
            model: ChatMember,
            as: 'members',
            include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'isBot', 'lastSeen'] }]
          },
          {
            model: Message,
            as: 'messages',
            limit: 1,
            order: [['createdAt', 'DESC']],
            separate: true,
            // Автор последнего сообщения — для строки «Имя: текст» в списке чатов
            include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }]
          }
        ]
      }],
      order: [[{ model: Chat, as: 'chat' }, 'lastMessageAt', 'DESC NULLS LAST']]
    });

    // Получаем количество непрочитанных сообщений для каждого чата
    const chatsWithUnreadCount = await Promise.all(memberships.map(async (m) => {
      const chat = m.chat;
      const otherMembers = chat.members.filter(member => member.userId !== req.user.id);

      let displayName = chat.name;
      let avatar = chat.avatar;
      let isAssistantChat = false;

      if (chat.type === 'private' && otherMembers.length > 0) {
        const otherUser = otherMembers[0].user;
        displayName = otherUser.displayName || otherUser.username;
        avatar = otherUser.avatar;
        // Проверяем, является ли это чатом с Ассистентом
        isAssistantChat = otherUser.id === ASSISTANT_ID || otherUser.isBot === true;
      }

      // Считаем точное количество непрочитанных сообщений
      const lastReadDate = new Date(m.lastReadAt || 0);
      const unreadCount = await Message.count({
        where: {
          chatId: chat.id,
          createdAt: { [Op.gt]: lastReadDate },
          senderId: { [Op.ne]: req.user.id } // Не считаем свои сообщения
        }
      });

      const result = {
        id: chat.id,
        name: chat.name,
        type: chat.type,
        avatar: chat.avatar,
        displayName,
        avatarUrl: avatar,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt,
        // Кто отправил последнее сообщение. null, если сообщений ещё не было.
        lastMessageSender: chat.messages?.[0]?.sender
          ? {
              id: chat.messages[0].sender.id,
              displayName: chat.messages[0].sender.displayName || chat.messages[0].sender.username,
            }
          : null,
        members: chat.members,
        unreadCount,
        createdBy: chat.createdBy,
        isAssistantChat, // Флаг для закрепления вверху
        isPinned: m.isPinned || false,
        pinnedOrder: m.pinnedOrder != null ? m.pinnedOrder : null,
        isNotificationMuted: m.isNotificationMuted || false
      };

      // Добавляем otherUser для приватных чатов (с онлайн-статусом)
      if (chat.type === 'private' && otherMembers.length > 0) {
        const onlineUsersMap = req.app.get('onlineUsers') || new Map();
        const otherUserId = otherMembers[0].userId;
        result.otherUser = {
          ...otherMembers[0].user.toJSON(),
          isOnline: onlineUsersMap.has(otherUserId)
        };
        result.otherMemberLastReadAt = otherMembers[0].lastReadAt || null;
      }

      return result;
    }));

    // Сортируем: Ассистент → Закреплённые (по pinnedOrder) → Остальные (по дате)
    chatsWithUnreadCount.sort((a, b) => {
      if (a.isAssistantChat && !b.isAssistantChat) return -1;
      if (!a.isAssistantChat && b.isAssistantChat) return 1;
      // Оба не ассистент: закреплённые идут перед обычными
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      // Оба закреплённые — сортируем по pinnedOrder
      if (a.isPinned && b.isPinned) {
        return (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0);
      }
      // Оба обычные — по дате
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt) : new Date(0);
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt) : new Date(0);
      return dateB - dateA;
    });

    res.json(chatsWithUnreadCount);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get unread messages count
router.get('/unread/count', authenticate, async (req, res) => {
  try {
    const memberships = await ChatMember.findAll({
      where: { userId: req.user.id },
      attributes: ['chatId', 'lastReadAt']
    });

    // Считаем общее количество непрочитанных сообщений во всех чатах
    let totalUnread = 0;
    for (const m of memberships) {
      const lastReadDate = new Date(m.lastReadAt || 0);
      const unreadCount = await Message.count({
        where: {
          chatId: m.chatId,
          createdAt: { [Op.gt]: lastReadDate },
          senderId: { [Op.ne]: req.user.id } // Не считаем свои сообщения
        }
      });
      totalUnread += unreadCount;
    }

    res.json({ unreadCount: totalUnread });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ─── Push-устройства ────────────────────────────────────────────────────────
// Объявлены ДО всех '/:chatId'-маршрутов: иначе DELETE /chat/devices попадёт
// в DELETE /chat/:chatId и вместо отписки устройства удалит чат с id 'devices'.

// Регистрация токена. Клиент вызывает при каждом запуске и при обновлении токена
// в FCM — оба случая обрабатываются одинаково.
router.post('/devices', authenticate, async (req, res) => {
  try {
    const { token, platform, provider = 'fcm', appVersion, deviceName } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }
    if (!['android', 'ios', 'web'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be android | ios | web' });
    }
    if (!['fcm', 'apns', 'webpush'].includes(provider)) {
      return res.status(400).json({ error: 'provider must be fcm | apns | webpush' });
    }

    // Токен уникален глобально: тот же телефон под другим аккаунтом должен
    // переехать на нового владельца, иначе пуши продолжат уходить прежнему.
    await UserDevice.upsert({
      userId: req.user.id,
      token,
      platform,
      provider,
      appVersion: appVersion || null,
      deviceName: deviceName || null,
      isActive: true,
      lastSeenAt: new Date(),
      failureCount: 0
    }, { conflictFields: ['token'] });

    res.json({ registered: true });
  } catch (error) {
    console.error('Register device error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Отзыв токена — вызывается при выходе из аккаунта.
// Строку не удаляем, а гасим: так остаётся видна история устройств пользователя.
router.delete('/devices', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    await UserDevice.update(
      { isActive: false },
      { where: { token, userId: req.user.id } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Unregister device error:', error);
    res.status(500).json({ error: 'Failed to unregister device' });
  }
});

// Search messages in a specific chat
router.get('/:chatId/messages/search', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { q } = req.query;

    if (!q || !q.trim()) return res.json([]);

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const messages = await Message.findAll({
      where: {
        chatId,
        content: { [Op.iLike]: `%${q.trim()}%` },
        type: { [Op.ne]: 'system' }
      },
      include: [{
        model: User,
        as: 'sender',
        attributes: ['id', 'username', 'displayName', 'avatar']
      }],
      order: [['createdAt', 'DESC']],
      limit: 200
    });

    res.json(messages);
  } catch (err) {
    console.error('Message search error:', err);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Get messages for a chat
router.get('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const whereClause = { chatId };
    if (before) {
      whereClause.createdAt = { [Op.lt]: new Date(before) };
    }

    const messages = await Message.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] },
        {
          model: Message,
          as: 'replyTo',
          include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }]
        },
        {
          model: MessageReaction,
          as: 'reactions',
          include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    // Process reactions for each message
    const messagesWithReactions = messages.map(msg => {
      const messageData = msg.toJSON();

      // Group reactions by emoji
      const grouped = {};
      if (messageData.reactions && messageData.reactions.length > 0) {
        messageData.reactions.forEach(r => {
          if (!grouped[r.emoji]) {
            grouped[r.emoji] = {
              emoji: r.emoji,
              count: 0,
              users: [],
              hasReacted: false
            };
          }
          grouped[r.emoji].count++;
          grouped[r.emoji].users.push({
            id: r.user?.id || r.userId,
            displayName: r.user?.displayName || r.user?.username,
            avatar: r.user?.avatar || null
          });
          if (r.userId === req.user.id) {
            grouped[r.emoji].hasReacted = true;
          }
        });
      }

      messageData.reactions = Object.values(grouped);
      return messageData;
    });

    res.json(messagesWithReactions.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// Загрузка голосового сообщения.
//
// Отдельный маршрут, а не флаг у /upload: здесь файл всегда перекодируется
// в общий для всех платформ формат и у него определяется длительность —
// обычным вложениям это не нужно и только замедлило бы загрузку.
router.post('/voice', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!req.file.mimetype.startsWith('audio/') && !req.file.mimetype.startsWith('video/')) {
      // Chrome отдаёт запись с MediaRecorder как video/webm, даже когда внутри
      // только звук, — поэтому video/* здесь тоже законен
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Expected an audio recording' });
    }

    const result = await voiceService.normalize(req.file);

    // Длительность от ffprobe — источник истины, но он может не отработать
    // (нет ffmpeg, битый контейнер). Тогда берём замер клиента: он считал
    // секунды во время записи и ошибается разве что на доли секунды.
    // Без длительности плеер не может нарисовать полосу прогресса.
    const clientDuration = parseFloat(req.body?.duration);
    const duration = result.duration
      ?? (Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : null);

    res.json({
      id: Date.now().toString(),
      kind: 'voice',
      name: 'Голосовое сообщение',
      path: result.path,
      mimeType: result.mimeType,
      size: result.size,
      duration,
    });
  } catch (error) {
    console.error('Voice upload error:', error);
    res.status(500).json({ error: 'Failed to upload voice message' });
  }
});

// Upload attachment
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let thumbnailPath = null;
    
    if (req.file.mimetype.startsWith('image/')) {
      const thumbnailFilename = `thumb-${req.file.filename}`;
      thumbnailPath = path.join('uploads/chat-attachments', thumbnailFilename);
      
      await sharp(req.file.path)
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);
    }

    res.json({
      id: Date.now().toString(),
      name: req.file.originalname,
      path: req.file.path.replace(/\\/g, '/'),
      thumbnailPath: thumbnailPath ? thumbnailPath.replace(/\\/g, '/') : null,
      mimeType: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Send message
router.post('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, attachments = [], replyToId } = req.body;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Проверка индивидуальной заглушки "только чтение"
    if (membership.isReadOnly) {
      return res.status(403).json({ error: 'You are in read-only mode in this chat' });
    }

    let messageType = 'text';
    if (attachments.length > 0) {
      // Голосовое всегда одно и приходит одно — смешивать его с другими
      // вложениями клиенты не умеют и не должны
      if (attachments.length === 1 && attachments[0]?.kind === 'voice') {
        messageType = 'voice';
      } else {
        messageType = attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file';
      }
    }

    const message = await Message.create({
      chatId,
      senderId: req.user.id,
      content: content?.trim() || '',
      type: messageType,
      attachments: attachments,
      replyToId
    });

    let lastMessagePreview = content?.trim() || '';
    if (attachments.length > 0 && !lastMessagePreview) {
      const allImages = attachments.every(a => a.mimeType?.startsWith('image/'));
      lastMessagePreview = messageType === 'voice'
        ? '🎤 Голосовое сообщение'
        : allImages
          ? `📷 Фото${attachments.length > 1 ? ` (${attachments.length})` : ''}`
          : `📎 Файл${attachments.length > 1 ? ` (${attachments.length})` : ''}`;
    }

    await Chat.update(
      { lastMessage: lastMessagePreview, lastMessageAt: new Date() },
      { where: { id: chatId } }
    );

    // При новом сообщении восстанавливаем чат для всех участников, у кого он был скрыт
    await ChatMember.update(
      { isHidden: false },
      { where: { chatId, isHidden: true } }
    );

    const fullMessage = await Message.findByPk(message.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] },
        { model: Message, as: 'replyTo', include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }] }
      ]
    });

    // Get chat info for notification
    const chat = await Chat.findByPk(chatId, {
      include: [{
        model: ChatMember,
        as: 'members',
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
      }]
    });

    // Emit new message event to all chat members except sender via Socket.IO
    const io = req.app.get('io');
    if (io && chat) {
      chat.members.forEach(member => {
        if (member.userId !== req.user.id) {
          // Get chat display name
          let chatDisplayName = chat.name;
          let chatAvatar = chat.avatar;

          if (chat.type === 'private') {
            const otherMember = chat.members.find(m => m.userId === req.user.id);
            if (otherMember?.user) {
              chatDisplayName = otherMember.user.displayName || otherMember.user.username;
              chatAvatar = otherMember.user.avatar;
            }
          }

          io.to(`user:${member.userId}`).emit('new_message', {
            message: fullMessage,
            chat: {
              id: chat.id,
              type: chat.type,
              displayName: chatDisplayName,
              avatar: chatAvatar
            }
          });
        }
      });
    }

    // Push на мобильные устройства (fire-and-forget).
    // Сокет доставляет сообщение только пока приложение открыто; всё остальное
    // время работает этот канал.
    if (chat) {
      pushService.notifyNewMessage({ message: fullMessage, chat, senderId: req.user.id }).catch(() => {});
    }

    // Deliver message to any bots in this chat (fire-and-forget)
    botWebhookService.onNewMessage(fullMessage).catch(() => {});

    // /-команды управления подписками на формы обрабатывает сам бэкенд
    subscriptionService.handleCommand(fullMessage).catch(() => {});

    res.status(201).json(fullMessage);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Edit message
router.put('/:chatId/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const message = await Message.findOne({
      where: { id: messageId, chatId }
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== req.user.id) {
      return res.status(403).json({ error: 'Can only edit own messages' });
    }

    if (message.type === 'system') {
      return res.status(400).json({ error: 'Cannot edit system messages' });
    }

    if (message.forwardedFrom) {
      return res.status(400).json({ error: 'Cannot edit forwarded messages' });
    }

    await message.update({
      content: content.trim(),
      isEdited: true,
      editedAt: new Date()
    });

    // Обновляем lastMessage в чате, если это последнее сообщение
    const lastMessage = await Message.findOne({
      where: { chatId },
      order: [['createdAt', 'DESC']]
    });

    if (lastMessage && lastMessage.id === message.id) {
      let lastMessagePreview = content.trim();
      if (message.attachments && message.attachments.length > 0 && !lastMessagePreview) {
        const allImages = message.attachments.every(a => a.mimeType?.startsWith('image/'));
        lastMessagePreview = allImages
          ? `📷 Фото${message.attachments.length > 1 ? ` (${message.attachments.length})` : ''}`
          : `📎 Файл${message.attachments.length > 1 ? ` (${message.attachments.length})` : ''}`;
      }

      await Chat.update(
        { lastMessage: lastMessagePreview },
        { where: { id: chatId } }
      );
    }

    const updatedMessage = await Message.findByPk(message.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] },
        { model: Message, as: 'replyTo', include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }] }
      ]
    });

    res.json(updatedMessage);
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete message
router.delete('/:chatId/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;

    const message = await Message.findOne({
      where: { id: messageId, chatId }
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== req.user.id) {
      return res.status(403).json({ error: 'Can only delete own messages' });
    }

    if (message.type === 'system') {
      return res.status(400).json({ error: 'Cannot delete system messages' });
    }

    // Вместо физического удаления, помечаем как удалённое
    await message.update({
      content: 'Сообщение удалено',
      attachments: [],
      type: 'system'
    });

    // Обновляем lastMessage в чате, если это последнее сообщение
    const lastMessage = await Message.findOne({
      where: { chatId },
      order: [['createdAt', 'DESC']]
    });

    if (lastMessage && lastMessage.id === message.id) {
      await Chat.update(
        { lastMessage: 'Сообщение удалено' },
        { where: { id: chatId } }
      );
    }

    const updatedMessage = await Message.findByPk(message.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] },
        { model: Message, as: 'replyTo', include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }] }
      ]
    });

    res.json(updatedMessage);
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Forward messages to another chat
router.post('/forward', authenticate, async (req, res) => {
  try {
    const { messageIds, targetChatId } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }
    if (!targetChatId) {
      return res.status(400).json({ error: 'targetChatId is required' });
    }

    // Check user is member of target chat
    const targetMembership = await ChatMember.findOne({
      where: { chatId: targetChatId, userId: req.user.id }
    });
    if (!targetMembership) {
      return res.status(403).json({ error: 'Not a member of target chat' });
    }

    // Fetch original messages (preserve order)
    const originalMessages = await Message.findAll({
      where: { id: { [Op.in]: messageIds } },
      include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }],
      order: [['createdAt', 'ASC']]
    });

    if (originalMessages.length === 0) {
      return res.status(404).json({ error: 'Messages not found' });
    }

    const createdMessages = [];
    for (const orig of originalMessages) {
      if (orig.type === 'system') continue;

      let msgType = 'text';
      if (orig.attachments && orig.attachments.length > 0) {
        msgType = orig.attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file';
      }

      const forwarded = await Message.create({
        chatId: targetChatId,
        senderId: req.user.id,
        content: orig.content || '',
        type: msgType,
        attachments: orig.attachments || [],
        forwardedFrom: {
          senderId: orig.senderId,
          senderName: orig.sender?.displayName || orig.sender?.username || 'Неизвестный',
          originalChatId: orig.chatId
        }
      });
      createdMessages.push(forwarded);
    }

    if (createdMessages.length === 0) {
      return res.status(400).json({ error: 'No messages to forward' });
    }

    // Build last message preview
    const lastOrig = originalMessages[originalMessages.length - 1];
    let lastMessagePreview = `📨 Переслано: ${lastOrig.content || ''}`;
    if (!lastOrig.content && lastOrig.attachments?.length > 0) {
      const allImages = lastOrig.attachments.every(a => a.mimeType?.startsWith('image/'));
      lastMessagePreview = allImages ? '📨 Переслано: 📷 Фото' : '📨 Переслано: 📎 Файл';
    }

    await Chat.update(
      { lastMessage: lastMessagePreview, lastMessageAt: new Date() },
      { where: { id: targetChatId } }
    );

    // Restore hidden chat for all members
    await ChatMember.update(
      { isHidden: false },
      { where: { chatId: targetChatId, isHidden: true } }
    );

    // Notify target chat members via Socket.IO
    const targetChat = await Chat.findByPk(targetChatId, {
      include: [{
        model: ChatMember,
        as: 'members',
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
      }]
    });

    // Последнее из пересланных — оно же идёт в сокет и в push как превью пачки
    const lastCreated = createdMessages[createdMessages.length - 1];
    const fullMsg = targetChat && lastCreated
      ? await Message.findByPk(lastCreated.id, {
          include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        })
      : null;

    const io = req.app.get('io');
    if (io && targetChat) {
      targetChat.members.forEach(member => {
        if (member.userId !== req.user.id) {
          let chatDisplayName = targetChat.name;
          let chatAvatar = targetChat.avatar;
          if (targetChat.type === 'private') {
            const senderMember = targetChat.members.find(m => m.userId === req.user.id);
            if (senderMember?.user) {
              chatDisplayName = senderMember.user.displayName || senderMember.user.username;
              chatAvatar = senderMember.user.avatar;
            }
          }
          io.to(`user:${member.userId}`).emit('new_message', {
            message: fullMsg,
            chat: { id: targetChat.id, type: targetChat.type, displayName: chatDisplayName, avatar: chatAvatar }
          });
        }
      });
    }

    if (targetChat && fullMsg) {
      pushService.notifyNewMessage({ message: fullMsg, chat: targetChat, senderId: req.user.id }).catch(() => {});
    }

    res.status(201).json({ forwarded: createdMessages.length });
  } catch (error) {
    console.error('Forward messages error:', error);
    res.status(500).json({ error: 'Failed to forward messages' });
  }
});

// Mark chat as read
router.post('/:chatId/read', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const lastReadAt = new Date();
    await membership.update({ lastReadAt });

    // Notify message senders that their messages have been read
    const io = req.app.get('io');
    if (io) {
      const otherMembers = await ChatMember.findAll({
        where: { chatId, userId: { [Op.ne]: req.user.id } }
      });
      otherMembers.forEach(m => {
        io.to(`user:${m.userId}`).emit('messages_read', {
          chatId,
          readBy: req.user.id,
          lastReadAt: lastReadAt.toISOString()
        });
      });
    }

    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Create private chat
router.post('/private', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot create chat with yourself' });
    }

    const targetUser = await User.findByPk(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingMemberships = await ChatMember.findAll({
      where: { userId: { [Op.in]: [req.user.id, userId] } },
      include: [{ model: Chat, as: 'chat', where: { type: 'private' } }]
    });

    const chatCounts = {};
    existingMemberships.forEach(m => {
      chatCounts[m.chatId] = (chatCounts[m.chatId] || 0) + 1;
    });

    const existingChatId = Object.keys(chatCounts).find(id => chatCounts[id] === 2);
    
    if (existingChatId) {
      const chat = await Chat.findByPk(existingChatId, {
        include: [{
          model: ChatMember,
          as: 'members',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        }]
      });
      return res.json(chat);
    }

    const chat = await Chat.create({
      type: 'private',
      createdBy: req.user.id
    });

    await ChatMember.bulkCreate([
      { chatId: chat.id, userId: req.user.id, role: 'admin' },
      { chatId: chat.id, userId: userId, role: 'member' }
    ]);

    const fullChat = await Chat.findByPk(chat.id, {
      include: [{
        model: ChatMember,
        as: 'members',
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
      }]
    });

    res.status(201).json(fullChat);
  } catch (error) {
    console.error('Create private chat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// Create group chat
router.post('/group', authenticate, async (req, res) => {
  try {
    const { name, memberIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const chat = await Chat.create({
      name: name.trim(),
      type: 'group',
      createdBy: req.user.id
    });

    const members = [{ chatId: chat.id, userId: req.user.id, role: 'admin' }];
    
    if (memberIds && memberIds.length > 0) {
      memberIds.forEach(userId => {
        if (userId !== req.user.id) {
          members.push({ chatId: chat.id, userId, role: 'member' });
        }
      });
    }

    await ChatMember.bulkCreate(members);

    const systemMessage = `${req.user.displayName || req.user.username} создал группу "${name.trim()}"`;
    
    await Message.create({
      chatId: chat.id,
      senderId: req.user.id,
      content: systemMessage,
      type: 'system'
    });

    // ✅ Обновляем lastMessage для превью чата
    await chat.update({
      lastMessage: systemMessage,
      lastMessageAt: new Date()
    });

    const fullChat = await Chat.findByPk(chat.id, {
      include: [{
        model: ChatMember,
        as: 'members',
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
      }]
    });

    res.status(201).json(fullChat);
  } catch (error) {
    console.error('Create group chat error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Update group chat avatar
router.post('/:chatId/avatar', authenticate, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Файл слишком большой. Максимальный размер: 5 МБ.' });
      }
      return res.status(400).json({ error: 'Ошибка загрузки файла: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterMembership = await ChatMember.findOne({ where: { chatId, userId: req.user.id, role: 'admin' } });
    if (!requesterMembership) {
      return res.status(403).json({ error: 'Only admins can update avatar' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = path.resolve(req.file.path);
    const outputPath = inputPath.replace(/\.[^.]+$/, '-processed.jpg');

    const inputBuffer = fs.readFileSync(inputPath);
    fs.unlinkSync(inputPath);

    const outputBuffer = await sharp(inputBuffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();

    fs.writeFileSync(outputPath, outputBuffer);

    if (chat.avatar) {
      const oldPath = path.join(__dirname, '..', chat.avatar);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const avatarPath = `uploads/chat-avatars/${path.basename(outputPath)}`;
    await chat.update({ avatar: avatarPath });

    res.json({ avatar: avatarPath });
  } catch (error) {
    console.error('Update chat avatar error:', error);
    res.status(500).json({ error: 'Failed to update avatar: ' + error.message });
  }
});

// Delete group chat avatar
router.delete('/:chatId/avatar', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterMembership = await ChatMember.findOne({ where: { chatId, userId: req.user.id, role: 'admin' } });
    if (!requesterMembership) {
      return res.status(403).json({ error: 'Only admins can delete avatar' });
    }

    if (chat.avatar) {
      const avatarPath = path.join(__dirname, '..', chat.avatar);
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }

    await chat.update({ avatar: null });

    res.json({ message: 'Avatar deleted' });
  } catch (error) {
    console.error('Delete chat avatar error:', error);
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

// Add member to group
router.post('/:chatId/members', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterMembership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id, role: 'admin' }
    });

    if (!requesterMembership) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }

    const existing = await ChatMember.findOne({ where: { chatId, userId } });
    if (existing) {
      return res.status(400).json({ error: 'User is already a member' });
    }

    await ChatMember.create({ chatId, userId, role: 'member' });

    notifyBotMembership({ chatId, userId, actorId: req.user.id, status: 'member' });

    const user = await User.findByPk(userId, { attributes: ['displayName', 'username'] });
    const messageContent = `${user.displayName || user.username} добавлен в группу`;
    
    await Message.create({
      chatId,
      senderId: req.user.id,
      content: messageContent,
      type: 'system'
    });

    // ✅ Обновляем lastMessage
    await Chat.update(
      { lastMessage: messageContent, lastMessageAt: new Date() },
      { where: { id: chatId } }
    );

    res.json({ message: 'Member added' });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Bulk add members to group (admin only)
router.post('/:chatId/members/bulk', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' });
    }

    const chatRecord = await Chat.findByPk(chatId);
    if (!chatRecord || chatRecord.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterMembership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id, role: 'admin' }
    });
    if (!requesterMembership) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }

    // Filter out already-existing members
    const existingMembers = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
    const existingIds = new Set(existingMembers.map(m => m.userId));
    const newUserIds = userIds.filter(id => !existingIds.has(id) && id !== req.user.id);

    if (newUserIds.length === 0) {
      return res.json({ added: 0, message: 'All users are already members' });
    }

    await ChatMember.bulkCreate(newUserIds.map(userId => ({ chatId, userId, role: 'member' })));

    newUserIds.forEach(userId =>
      notifyBotMembership({ chatId, userId, actorId: req.user.id, status: 'member' }));

    const newUsers = await User.findAll({
      where: { id: newUserIds },
      attributes: ['displayName', 'username']
    });
    const names = newUsers.map(u => u.displayName || u.username).join(', ');
    const systemMsg = `${req.user.displayName || req.user.username} добавил в группу: ${names}`;

    await Message.create({ chatId, senderId: req.user.id, content: systemMsg, type: 'system' });
    await Chat.update({ lastMessage: systemMsg, lastMessageAt: new Date() }, { where: { id: chatId } });

    res.json({ added: newUserIds.length, message: 'Members added' });
  } catch (error) {
    console.error('Bulk add members error:', error);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

// Set member role (admin/member) — only creator can promote/demote
router.patch('/:chatId/members/:userId/role', authenticate, async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const { role } = req.body;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    const chatRecord = await Chat.findByPk(chatId);
    if (!chatRecord || chatRecord.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Только создатель может менять роли
    if (chatRecord.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Only group creator can change member roles' });
    }

    // Нельзя изменить роль самого создателя
    if (userId === chatRecord.createdBy) {
      return res.status(400).json({ error: 'Cannot change role of group creator' });
    }

    const membership = await ChatMember.findOne({ where: { chatId, userId } });
    if (!membership) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await membership.update({ role });

    const targetUser = await User.findByPk(userId, { attributes: ['displayName', 'username'] });
    const action = role === 'admin' ? 'назначил администратором' : 'снял права администратора у';
    const systemMsg = `${req.user.displayName || req.user.username} ${action} ${targetUser.displayName || targetUser.username}`;

    await Message.create({ chatId, senderId: req.user.id, content: systemMsg, type: 'system' });
    await Chat.update({ lastMessage: systemMsg, lastMessageAt: new Date() }, { where: { id: chatId } });

    res.json({ userId, role });
  } catch (error) {
    console.error('Set member role error:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// Remove member from group
router.delete('/:chatId/members/:userId', authenticate, async (req, res) => {
  try {
    const { chatId, userId } = req.params;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterMembership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!requesterMembership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const isAdmin = requesterMembership.role === 'admin';
    const isSelf = userId === req.user.id;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    // Нельзя исключить создателя группы
    if (userId === chat.createdBy && !isSelf) {
      return res.status(403).json({ error: 'Cannot remove group creator' });
    }

    const membership = await ChatMember.findOne({ where: { chatId, userId } });
    if (!membership) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const user = await User.findByPk(userId, { attributes: ['displayName', 'username'] });

    await membership.destroy();

    notifyBotMembership({ chatId, userId, actorId: req.user.id, status: 'left' });

    const messageContent = isSelf
      ? `${user.displayName || user.username} покинул группу`
      : `${user.displayName || user.username} исключён из группы`;

    await Message.create({
      chatId,
      senderId: req.user.id,
      content: messageContent,
      type: 'system'
    });

    // ✅ Обновляем lastMessage
    await Chat.update(
      { lastMessage: messageContent, lastMessageAt: new Date() },
      { where: { id: chatId } }
    );

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Leave chat
router.delete('/:chatId/leave', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(404).json({ error: 'Not a member of this chat' });
    }

    const chat = await Chat.findByPk(chatId);
    
    if (chat.type === 'group') {
      const messageContent = `${req.user.displayName || req.user.username} покинул группу`;
      
      await Message.create({
        chatId,
        senderId: req.user.id,
        content: messageContent,
        type: 'system'
      });

      // ✅ Обновляем lastMessage
      await Chat.update(
        { lastMessage: messageContent, lastMessageAt: new Date() },
        { where: { id: chatId } }
      );
    }

    await membership.destroy();

    const remainingMembers = await ChatMember.count({ where: { chatId } });
    if (remainingMembers === 0) {
      await Message.destroy({ where: { chatId } });
      await chat.destroy();
    }

    res.json({ message: 'Left chat' });
  } catch (error) {
    console.error('Leave chat error:', error);
    res.status(500).json({ error: 'Failed to leave chat' });
  }
});

// Toggle read-only for a specific member (admin only, can't apply to creator)
router.patch('/:chatId/members/:userId/readonly', authenticate, async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const { isReadOnly } = req.body;

    const chatRecord = await Chat.findByPk(chatId);
    if (!chatRecord || chatRecord.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterMembership = await ChatMember.findOne({ where: { chatId, userId: req.user.id, role: 'admin' } });
    if (!requesterMembership) {
      return res.status(403).json({ error: 'Only admins can change read-only mode' });
    }

    if (userId === chatRecord.createdBy) {
      return res.status(400).json({ error: 'Cannot restrict group creator' });
    }

    const membership = await ChatMember.findOne({ where: { chatId, userId } });
    if (!membership) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await membership.update({ isReadOnly: Boolean(isReadOnly) });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('member_updated', { chatId, userId, isReadOnly: Boolean(isReadOnly) });
    }

    res.json({ chatId, userId, isReadOnly: Boolean(isReadOnly) });
  } catch (error) {
    console.error('Toggle member read-only error:', error);
    res.status(500).json({ error: 'Failed to update read-only mode' });
  }
});

// Delete group entirely (creator only) — removes chat for all members
router.delete('/:chatId', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chatRecord = await Chat.findByPk(chatId);
    if (!chatRecord || chatRecord.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (chatRecord.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Only group creator can delete the group' });
    }

    // Собираем ID всех участников до удаления
    const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
    const memberIds = members.map(m => m.userId);

    await Message.destroy({ where: { chatId } });
    await ChatMember.destroy({ where: { chatId } });
    await chatRecord.destroy();

    // Уведомляем всех участников через сокет
    const io = req.app.get('io');
    if (io) {
      memberIds.forEach(userId => {
        io.to(`user:${userId}`).emit('group_deleted', { chatId });
      });
    }

    res.json({ message: 'Group deleted' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Get users for chat (all authenticated users can access)
router.get('/users', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        isActive: true,
        [Op.or]: [{ isBot: false }, { isBot: null }]
      },
      include: [
        { model: Role, as: 'role' },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] }, attributes: ['id', 'name', 'displayName'] }
      ],
      attributes: ['id', 'username', 'displayName', 'avatar', 'email', 'isActive'],
      order: [['displayName', 'ASC']]
    });

    const filteredUsers = users.filter(u => u.id !== req.user.id);

    res.json(filteredUsers);
  } catch (error) {
    console.error('Get chat users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Список ботов доступных для добавления в групповые чаты
router.get('/bots', authenticate, async (req, res) => {
  try {
    const bots = await User.findAll({
      where: { isActive: true, isBot: true },
      attributes: ['id', 'username', 'displayName', 'avatar'],
      order: [['displayName', 'ASC']]
    });
    res.json(bots);
  } catch (error) {
    console.error('Get chat bots error:', error);
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

// Rename group chat (admin only)
router.patch('/:chatId/rename', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const chatRecord = await Chat.findByPk(chatId);
    if (!chatRecord || chatRecord.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id, role: 'admin' }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Only admins can rename the group' });
    }

    const oldName = chatRecord.name;
    await chatRecord.update({ name: name.trim() });

    const systemMsg = `${req.user.displayName || req.user.username} переименовал группу с "${oldName}" на "${name.trim()}"`;
    await Message.create({ chatId, senderId: req.user.id, content: systemMsg, type: 'system' });
    await Chat.update({ lastMessage: systemMsg, lastMessageAt: new Date() }, { where: { id: chatId } });

    res.json({ id: chatId, name: name.trim() });
  } catch (error) {
    console.error('Rename group error:', error);
    res.status(500).json({ error: 'Failed to rename group' });
  }
});

// Hide/unhide chat for current user
router.patch('/:chatId/hide', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { hidden } = req.body;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(404).json({ error: 'Not a member of this chat' });
    }

    await membership.update({ isHidden: hidden !== undefined ? hidden : true });

    res.json({ message: hidden ? 'Chat hidden' : 'Chat shown', isHidden: membership.isHidden });
  } catch (error) {
    console.error('Hide chat error:', error);
    res.status(500).json({ error: 'Failed to hide chat' });
  }
});

// Mute/unmute chat notifications for current user
router.patch('/:chatId/mute', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { muted } = req.body;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(404).json({ error: 'Not a member of this chat' });
    }

    const isNotificationMuted = muted !== undefined ? !!muted : !membership.isNotificationMuted;
    await membership.update({ isNotificationMuted });

    res.json({ isNotificationMuted });
  } catch (error) {
    console.error('Mute chat error:', error);
    res.status(500).json({ error: 'Failed to mute chat' });
  }
});

// Pin/unpin chat for current user
router.patch('/:chatId/pin', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { pinned } = req.body;

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(404).json({ error: 'Not a member of this chat' });
    }

    const isPinned = pinned !== undefined ? !!pinned : !membership.isPinned;

    let pinnedOrder = membership.pinnedOrder;
    if (isPinned && pinnedOrder == null) {
      // Assign the next available order
      const maxOrder = await ChatMember.max('pinnedOrder', {
        where: { userId: req.user.id, isPinned: true }
      });
      pinnedOrder = (maxOrder != null ? maxOrder : -1) + 1;
    } else if (!isPinned) {
      pinnedOrder = null;
    }

    await membership.update({ isPinned, pinnedOrder });

    res.json({ isPinned, pinnedOrder });
  } catch (error) {
    console.error('Pin chat error:', error);
    res.status(500).json({ error: 'Failed to pin chat' });
  }
});

// Reorder pinned chats
router.patch('/pins/reorder', authenticate, async (req, res) => {
  try {
    const { chatIds } = req.body; // Array of chatIds in new order

    if (!Array.isArray(chatIds)) {
      return res.status(400).json({ error: 'chatIds must be an array' });
    }

    await Promise.all(chatIds.map((chatId, index) =>
      ChatMember.update(
        { pinnedOrder: index },
        { where: { chatId, userId: req.user.id, isPinned: true } }
      )
    ));

    res.json({ message: 'Reordered' });
  } catch (error) {
    console.error('Reorder pinned chats error:', error);
    res.status(500).json({ error: 'Failed to reorder pinned chats' });
  }
});

// ====================================================================
// MESSAGE REACTIONS
// ====================================================================

// Helper: Aggregate reactions for a message
async function aggregateReactions(messageId, currentUserId) {
  const reactions = await MessageReaction.findAll({
    where: { messageId },
    include: [{
      model: User,
      as: 'user',
      attributes: ['id', 'displayName', 'username', 'avatar']
    }]
  });

  // Group by emoji
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.emoji]) {
      grouped[r.emoji] = {
        emoji: r.emoji,
        count: 0,
        users: [],
        hasReacted: false
      };
    }
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push({
      id: r.user.id,
      displayName: r.user.displayName || r.user.username,
      avatar: r.user.avatar
    });
    if (r.userId === currentUserId) {
      grouped[r.emoji].hasReacted = true;
    }
  });

  return Object.values(grouped);
}

// Add or update reaction on a message
router.post('/:chatId/messages/:messageId/reactions', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { emoji } = req.body;

    // Validate emoji
    const allowedEmojis = ['👍', '👎', '❤️', '😂', '😮', '🎉', '🔥'];
    if (!emoji || !allowedEmojis.includes(emoji)) {
      return res.status(400).json({ error: 'Invalid emoji. Allowed: 👍 👎 ❤️ 😂 😮 🎉 🔥' });
    }

    // Check membership
    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Check message exists in this chat
    const message = await Message.findOne({
      where: { id: messageId, chatId }
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Upsert reaction (update if exists, create if not)
    const [reaction, created] = await MessageReaction.upsert(
      {
        messageId,
        userId: req.user.id,
        emoji
      },
      {
        returning: true
      }
    );

    // Get aggregated reactions
    const aggregated = await aggregateReactions(messageId, req.user.id);

    // Emit Socket.IO event to all chat members
    const io = req.app.get('io');
    if (io) {
      const chat = await Chat.findByPk(chatId, {
        include: [{ model: ChatMember, as: 'members' }]
      });

      if (chat) {
        chat.members.forEach(member => {
          io.to(`user:${member.userId}`).emit('message_reaction_updated', {
            chatId,
            messageId,
            reactions: aggregated.map(({ emoji, count, hasReacted, users }) => ({
              emoji,
              count,
              hasReacted: users.some(u => u.id === member.userId)
            }))
          });
        });
      }
    }

    res.json({
      message: created ? 'Reaction added' : 'Reaction updated',
      reactions: aggregated
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// Remove reaction from a message
router.delete('/:chatId/messages/:messageId/reactions', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;

    // Check membership
    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Delete reaction
    const deleted = await MessageReaction.destroy({
      where: {
        messageId,
        userId: req.user.id
      }
    });

    if (deleted === 0) {
      return res.status(404).json({ error: 'Reaction not found' });
    }

    // Get updated aggregated reactions
    const aggregated = await aggregateReactions(messageId, req.user.id);

    // Emit Socket.IO event to all chat members
    const io = req.app.get('io');
    if (io) {
      const chat = await Chat.findByPk(chatId, {
        include: [{ model: ChatMember, as: 'members' }]
      });

      if (chat) {
        chat.members.forEach(member => {
          io.to(`user:${member.userId}`).emit('message_reaction_updated', {
            chatId,
            messageId,
            reactions: aggregated.map(({ emoji, count, hasReacted, users }) => ({
              emoji,
              count,
              hasReacted: users.some(u => u.id === member.userId)
            }))
          });
        });
      }
    }

    res.json({
      message: 'Reaction removed',
      reactions: aggregated
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

// Get detailed reactions for a message (shows who reacted)
router.get('/:chatId/messages/:messageId/reactions', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;

    // Check membership
    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Get aggregated reactions with full user info
    const aggregated = await aggregateReactions(messageId, req.user.id);

    res.json({ reactions: aggregated });
  } catch (error) {
    console.error('Get reactions error:', error);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

module.exports = router;