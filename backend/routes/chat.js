const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { sequelize, Chat, ChatMember, Message, MessageReaction, ChatFile, MessageDeletion, User, Role, MedCenter, UserDevice, BotToken } = require('../models');
const notificationService = require('../services/notificationService');
const invites = require('../services/chatInvites');
const botWebhookService = require('../services/botWebhookService');
const subscriptionService = require('../services/public/subscriptionService');
const messageActions = require('../services/messageActions');
const pushService = require('../services/pushService');
const voiceService = require('../services/voiceService');
const presence = require('../services/presence');
const { getUnreadCounts, recountChat } = require('../services/unreadService');
const fileAccess = require('../services/fileAccess');
const { canDeleteForAll, canPin } = require('../services/messagePermissions');
const { parsePagination } = require('../utils/pagination');
const { serializePollMessage, applyVote } = require('../utils/chatPoll');

/**
 * Бота добавили в чат или убрали — рассылаем my_chat_member и правим подписки на формы.
 * Именно это событие заменяет ручную настройку адреса чата: раньше id приходилось
 * вписывать в .env, теперь маршрутом управляет само членство бота в чате.
 *
 * Fire-and-forget: сбой уведомления не должен ломать операцию с участником.
 */
// Строка чата в списке: тот же текст, что кладётся в chats.lastMessage при
// отправке. Понадобился отдельно, когда список пришлось пересобирать после
// удаления — раньше туда попадал сырой content, и удаление сообщения с одной
// картинкой оставляло в списке пустую строку.
function messagePreviewOf(message) {
  const text = (message.content || '').trim();
  if (text) return text;
  const atts = message.attachments || [];
  if (atts.length === 0) return '';
  if (atts.length === 1 && atts[0]?.kind === 'voice') return '🎤 Голосовое сообщение';
  const suffix = atts.length > 1 ? ` (${atts.length})` : '';
  return atts.every(a => a.mimeType?.startsWith('image/')) ? `📷 Фото${suffix}` : `📎 Файл${suffix}`;
}

// Одна рассылка вместо цикла по участникам.
//
// io.to() принимает список комнат и сам отбрасывает повторы, поэтому отдельный
// emit на каждого участника — это N публикаций в Redis там, где хватает одной.
// В группе на полсотни человек разница ровно в полсотни раз, и платит за неё
// отправитель одного сообщения.
function emitToMembers(io, members, event, payload, exceptUserId = null) {
  if (!io) return;
  const ids = (members || []).map(m => String(m.userId ?? m));
  const rooms = [...new Set(ids)]
    .filter(id => !exceptUserId || id !== String(exceptUserId))
    .map(id => `user:${id}`);
  if (rooms.length === 0) return;
  io.to(rooms).emit(event, payload);
}

// Имя файла из того, что клиент присылает в attachments: там встречается и
// относительный путь, и абсолютный URL со старым хостом.
function attachmentFilename(att) {
  const raw = att?.path || att?.url || '';
  return String(raw).split('?')[0].split('/').pop() || null;
}

// Отметить, что файлы теперь принадлежат чату. Пока строка не создана, файл
// доступен только загрузившему — так работает превью до отправки сообщения.
async function registerChatFiles(attachments, chatId, messageId) {
  const names = (Array.isArray(attachments) ? attachments : [])
    .map(attachmentFilename)
    .filter(Boolean);
  if (names.length === 0) return;

  try {
    await ChatFile.bulkCreate(
      names.map(filename => ({ filename, chatId, messageId })),
      { ignoreDuplicates: true }
    );
    names.forEach(fileAccess.invalidateFile);
  } catch (err) {
    // Вложение важнее реестра: сообщение уже отправлено, и падать здесь значит
    // показать пользователю ошибку там, где всё получилось
    console.error('Failed to register chat files:', err);
  }
}

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
    // crypto вместо Math.random: имя файла — часть защиты вложения, угадываемое
    // имя обесценивало бы проверку доступа в services/fileAccess.js
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(12).toString('hex');
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
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(12).toString('hex');
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
        type: { [Op.ne]: 'system' },
        id: { [Op.notIn]: Sequelize.literal('(SELECT "messageId" FROM message_deletions WHERE "userId" = :currentUserId)') }
      },
      replacements: { currentUserId: req.user.id, cursorAt: before || null, cursorId: beforeId || null },
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
            include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
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

    const unreadByChat = await getUnreadCounts(req.user.id, chatIdsWithMessages);
    const searchMemberStatuses = presence.getStatuses([
      ...new Set(chatsData.flatMap(m => (m.chat?.members || []).map(member => member.userId)))
    ]);

    // Форматируем результат. Счётчики уже получены одним агрегатным запросом.
    const chatsWithUnreadCount = chatsData.map((m) => {
      const chat = m.chat;
      const otherMembers = chat.members.filter(member => member.userId !== req.user.id);

      let displayName = chat.name;
      let avatar = chat.avatar;

      if (chat.type === 'private' && otherMembers.length > 0) {
        const otherUser = otherMembers[0].user;
        displayName = otherUser.displayName || otherUser.username;
        avatar = otherUser.avatar;
      }

      const unreadCount = unreadByChat.get(String(chat.id)) || 0;

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
        members: chat.members.map(member => ({
          ...member.toJSON(),
          user: member.user ? {
            ...member.user.toJSON(),
            isOnline: searchMemberStatuses.get(member.userId) || false
          } : null
        })),
        unreadCount,
        createdBy: chat.createdBy
      };

      if (chat.type === 'private' && otherMembers.length > 0) {
        result.otherUser = otherMembers[0].user;
      }

      return result;
    });

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
            include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge', 'isBot', 'lastSeen'] }]
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

    const unreadByChat = await getUnreadCounts(req.user.id, memberships.map(m => m.chatId));
    const memberStatuses = presence.getStatuses([
      ...new Set(memberships.flatMap(m => (m.chat?.members || []).map(member => member.userId)))
    ]);

    // Получаем количество непрочитанных сообщений для каждого чата одним SQL.
    const chatsWithUnreadCount = memberships.map((m) => {
      const chat = m.chat;
      const otherMembers = chat.members.filter(member => member.userId !== req.user.id);

      let displayName = chat.name;
      let avatar = chat.avatar;

      if (chat.type === 'private' && otherMembers.length > 0) {
        const otherUser = otherMembers[0].user;
        displayName = otherUser.displayName || otherUser.username;
        avatar = otherUser.avatar;
      }

      const unreadCount = unreadByChat.get(String(chat.id)) || 0;

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
        members: chat.members.map(member => ({
          ...member.toJSON(),
          user: member.user ? {
            ...member.user.toJSON(),
            isOnline: memberStatuses.get(member.userId) || false
          } : null
        })),
        unreadCount,
        createdBy: chat.createdBy,
        isPinned: m.isPinned || false,
        pinnedOrder: m.pinnedOrder != null ? m.pinnedOrder : null,
        isNotificationMuted: m.isNotificationMuted || false
      };

      // Добавляем otherUser для приватных чатов (с онлайн-статусом)
      if (chat.type === 'private' && otherMembers.length > 0) {
        const otherUserId = otherMembers[0].userId;
        result.otherUser = {
          ...otherMembers[0].user.toJSON(),
          isOnline: presence.isOnline(otherUserId)
        };
        result.otherMemberLastReadAt = otherMembers[0].lastReadAt || null;
      }

      return result;
    });

    // Сортируем: Закреплённые (по pinnedOrder) → остальные по дате.
    //
    // Раньше первым шёл «ассистент», причём флаг ставился любому чату с ботом,
    // а не только настоящему Ассистенту. Из-за этого служебные чаты вроде
    // «Работа с негативом» всегда висели выше закреплённых, и порядок
    // невозможно было изменить закреплением. Кому нужен чат наверху — тот
    // его и закрепит.
    chatsWithUnreadCount.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (a.isPinned && b.isPinned) {
        return (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0);
      }
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

// Токен доступа к вложениям чатов.
//
// Клиент подставляет его в ?t= к ссылкам на файлы: заголовок Authorization
// нельзя выставить ни в <img src>, ни в системном загрузчике Android. Почему
// это отдельный токен, а не JWT — в services/fileAccess.js.
router.get('/file-token', authenticate, (req, res) => {
  res.json({
    token: fileAccess.issueToken(req.user.id),
    expiresIn: fileAccess.TOKEN_TTL_MS
  });
});

// Get unread messages count
router.get('/unread/count', authenticate, async (req, res) => {
  try {
    const unreadByChat = await getUnreadCounts(req.user.id);
    const totalUnread = [...unreadByChat.values()].reduce((sum, count) => sum + count, 0);

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
        type: { [Op.ne]: 'system' },
        id: { [Op.notIn]: Sequelize.literal('(SELECT "messageId" FROM message_deletions WHERE "userId" = :currentUserId)') }
      },
      replacements: { currentUserId: req.user.id },
      include: [{
        model: User,
        as: 'sender',
        attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge']
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

// Команды активных ботов в конкретном чате. Клиент показывает их над строкой
// ввода при наборе "/" или "\\", поэтому список не приходится дублировать во
// фронтенде и новые команды появляются там автоматически.
router.get('/:chatId/commands', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

    const botMembers = await ChatMember.findAll({
      where: { chatId },
      include: [{
        model: User,
        as: 'user',
        where: { isBot: true, isActive: true },
        attributes: ['id', 'displayName', 'username'],
        required: true
      }]
    });
    if (botMembers.length === 0) return res.json([]);

    const bots = await BotToken.findAll({
      where: { userId: botMembers.map(member => member.userId), isActive: true }
    });
    const needMention = bots.length > 1;
    const result = [];

    for (const bot of bots) {
      const builtIn = (bot.servesForms || []).length > 0 ? subscriptionService.COMMANDS : [];
      const commands = [...builtIn, ...(Array.isArray(bot.commands) ? bot.commands : [])];
      const seen = new Set();

      for (const item of commands) {
        const command = String(item?.command || '').replace(/^[/\\]+/, '').toLowerCase();
        if (!/^[a-z0-9_]{1,32}$/.test(command) || seen.has(command)) continue;
        seen.add(command);
        result.push({
          command,
          description: String(item.description || ''),
          usage: String(item.usage || ''),
          botName: bot.name,
          botUsername: bot.username,
          insertText: `/${command}${needMention ? `@${bot.username}` : ''}`
        });
      }
    }

    res.json(result.sort((a, b) => a.command.localeCompare(b.command)));
  } catch (error) {
    console.error('Get chat commands error:', error);
    res.status(500).json({ error: 'Failed to fetch chat commands' });
  }
});

// Адресаты для @-упоминаний. Группы раскрываются только в участников текущего
// чата, чтобы нельзя было уведомить или перечислить посторонних сотрудников.
router.get('/:chatId/mention-targets', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const requester = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!requester) return res.status(403).json({ error: 'Not a member of this chat' });

    const members = await ChatMember.findAll({
      where: { chatId },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'username', 'displayName', 'chatBadge'],
        include: [
          { model: Role, as: 'role', attributes: ['id', 'name'] },
          { model: Role, as: 'roles', through: { attributes: [] }, attributes: ['id', 'name'] },
          { model: MedCenter, as: 'medCenters', through: { attributes: [] }, attributes: ['id', 'name', 'displayName'] }
        ]
      }]
    });

    const targets = [];
    const grouped = new Map();
    for (const member of members) {
      const u = member.user;
      if (!u) continue;
      targets.push({ targetId: `user:${u.id}`, type: 'user', label: u.displayName || u.username, userIds: [u.id], badge: u.chatBadge });
      const roles = [...(u.roles || []), ...(u.role ? [u.role] : [])];
      for (const role of roles) {
        const key = `role:${role.id}`;
        if (!grouped.has(key)) grouped.set(key, { targetId: key, type: 'role', label: role.name, userIds: new Set() });
        grouped.get(key).userIds.add(u.id);
      }
      for (const mc of u.medCenters || []) {
        const key = `medcenter:${mc.id}`;
        if (!grouped.has(key)) grouped.set(key, { targetId: key, type: 'medcenter', label: mc.displayName || mc.name, userIds: new Set() });
        grouped.get(key).userIds.add(u.id);
      }
    }
    for (const item of grouped.values()) {
      targets.push({ ...item, userIds: [...item.userIds], count: item.userIds.size });
    }
    res.json(targets);
  } catch (error) {
    console.error('Get mention targets error:', error);
    res.status(500).json({ error: 'Failed to fetch mention targets' });
  }
});

// Get messages for a chat
router.get('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { before, beforeId } = req.query;
    const { limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Курсор — пара (createdAt, id), а не одна метка времени. Бот вываливает
    // пачку сообщений в одну миллисекунду, и на стыке страниц такие сообщения
    // либо дублировались, либо пропадали совсем. beforeId приходит не от всех
    // клиентов, поэтому старый вариант с одной меткой оставлен рабочим.
    const whereClause = { chatId };
    if (before && beforeId) {
      whereClause[Op.and] = [Sequelize.literal(
        '("Message"."createdAt", "Message"."id") < (:cursorAt::timestamptz, :cursorId::uuid)'
      )];
    } else if (before) {
      whereClause.createdAt = { [Op.lt]: new Date(before) };
    }
    // Сообщения, скрытые этим человеком «у себя» (ver. 7.29), из его истории
    // пропадают, но у остальных участников остаются на месте
    whereClause.id = { [Op.notIn]: Sequelize.literal('(SELECT "messageId" FROM message_deletions WHERE "userId" = :currentUserId)') };

    const messages = await Message.findAll({
      where: whereClause,
      replacements: { currentUserId: req.user.id },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] },
        {
          model: Message,
          as: 'replyTo',
          include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }]
        },
        {
          model: MessageReaction,
          as: 'reactions',
          include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar', 'chatBadge'] }]
        }
      ],
      // Порядок обязан совпадать с индексом messages_chat_created_id_idx,
      // иначе база всё равно уйдёт в сортировку всей выборки
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit
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
      return serializePollMessage(messageData, req.user.id);
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

    // Перекодирование меняет имя файла, поэтому в реестр пишем то, что
    // получилось на выходе, а не то, что принял multer
    await ChatFile.create({ filename: result.path.split('/').pop(), uploadedBy: req.user.id });

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

    // До отправки сообщения файл принадлежит только загрузившему — иначе
    // превью в поле ввода получало бы 403 от собственной же проверки
    await ChatFile.create({ filename: req.file.filename, uploadedBy: req.user.id });

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

// Create poll in a group chat
router.post('/:chatId/polls', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const question = String(req.body.question || '').trim();
    const optionTexts = Array.isArray(req.body.options)
      ? req.body.options.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    if (!question || question.length > 300) return res.status(400).json({ error: 'Вопрос должен содержать от 1 до 300 символов' });
    if (optionTexts.length < 2 || optionTexts.length > 10) return res.status(400).json({ error: 'Нужно указать от 2 до 10 вариантов' });
    if (optionTexts.some(value => value.length > 100)) return res.status(400).json({ error: 'Вариант ответа не должен превышать 100 символов' });

    const [chat, membership] = await Promise.all([
      Chat.findByPk(chatId),
      ChatMember.findOne({ where: { chatId, userId: req.user.id } })
    ]);
    if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Опросы доступны только в групповых чатах' });
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });
    if (membership.isReadOnly) return res.status(403).json({ error: 'You are in read-only mode in this chat' });

    const poll = {
      question,
      options: optionTexts.map(text => ({ id: crypto.randomUUID(), text })),
      multipleChoice: Boolean(req.body.multipleChoice),
      anonymous: req.body.anonymous !== false,
      votes: {},
      closedAt: null
    };
    const message = await Message.create({ chatId, senderId: req.user.id, content: question, type: 'poll', poll });
    await Promise.all([
      Chat.update({ lastMessage: `📊 ${question}`, lastMessageAt: new Date() }, { where: { id: chatId } }),
      ChatMember.update({ isHidden: false }, { where: { chatId, isHidden: true } })
    ]);
    const fullMessage = await Message.findByPk(message.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
    });
    const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
    const io = req.app.get('io');
    for (const member of members) {
      const payload = serializePollMessage(fullMessage, member.userId);
      if (io && String(member.userId) !== String(req.user.id)) {
        io.to(`user:${member.userId}`).emit('new_message', {
          message: payload,
          chat: { id: chat.id, type: chat.type, displayName: chat.name, avatar: chat.avatar }
        });
      }
    }
    pushService.notifyNewMessage({ message: fullMessage, chat: { ...chat.toJSON(), members }, senderId: req.user.id }).catch(() => {});
    res.status(201).json(serializePollMessage(fullMessage, req.user.id));
  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({ error: 'Не удалось создать опрос' });
  }
});

// Replace the current user's vote. Empty optionIds retracts the vote.
router.post('/:chatId/messages/:messageId/poll-vote', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const requestedIds = Array.isArray(req.body.optionIds) ? [...new Set(req.body.optionIds.map(String))] : [];
    const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

    const updated = await sequelize.transaction(async transaction => {
      const message = await Message.findOne({
        where: { id: messageId, chatId, type: 'poll' },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!message?.poll) return null;
      await message.update({ poll: applyVote(message.poll, req.user.id, requestedIds) }, { transaction });
      return message;
    });
    if (!updated) return res.status(404).json({ error: 'Опрос не найден' });

    const fullMessage = await Message.findByPk(updated.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
    });
    const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
    const io = req.app.get('io');
    if (io) {
      for (const member of members) {
        io.to(`user:${member.userId}`).emit('poll_updated', {
          chatId,
          message: serializePollMessage(fullMessage, member.userId)
        });
      }
    }
    res.json(serializePollMessage(fullMessage, req.user.id));
  } catch (error) {
    console.error('Vote poll error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Не удалось сохранить голос' });
  }
});

// Send message
router.post('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, attachments = [], replyToId, mentions: requestedMentions = [] } = req.body;

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

    let mentions = [];
    if (Array.isArray(requestedMentions) && requestedMentions.length > 0) {
      const memberRows = await ChatMember.findAll({
        where: { chatId },
        include: [{
          model: User, as: 'user', attributes: ['id', 'username', 'displayName'],
          include: [
            { model: Role, as: 'role', attributes: ['id', 'name'] },
            { model: Role, as: 'roles', through: { attributes: [] }, attributes: ['id', 'name'] },
            { model: MedCenter, as: 'medCenters', through: { attributes: [] }, attributes: ['id', 'name', 'displayName'] }
          ]
        }]
      });
      const allowedTargets = new Map();
      for (const row of memberRows) {
        const u = row.user;
        if (!u) continue;
        allowedTargets.set(`user:${u.id}`, { type: 'user', label: u.displayName || u.username, userIds: [String(u.id)] });
        for (const role of [...(u.roles || []), ...(u.role ? [u.role] : [])]) {
          const key = `role:${role.id}`;
          if (!allowedTargets.has(key)) allowedTargets.set(key, { type: 'role', label: role.name, userIds: [] });
          allowedTargets.get(key).userIds.push(String(u.id));
        }
        for (const mc of u.medCenters || []) {
          const key = `medcenter:${mc.id}`;
          if (!allowedTargets.has(key)) allowedTargets.set(key, { type: 'medcenter', label: mc.displayName || mc.name, userIds: [] });
          allowedTargets.get(key).userIds.push(String(u.id));
        }
      }
      mentions = requestedMentions.slice(0, 20).map(item => {
        const targetId = String(item.targetId || '').slice(0, 120);
        const allowed = allowedTargets.get(targetId);
        return allowed && { targetId, ...allowed, userIds: [...new Set(allowed.userIds)].slice(0, 500) };
      }).filter(Boolean);
    }

    const message = await Message.create({
      chatId,
      senderId: req.user.id,
      content: content?.trim() || '',
      type: messageType,
      attachments: attachments,
      mentions,
      replyToId
    });

    await registerChatFiles(attachments, chatId, message.id);

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
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] },
        { model: Message, as: 'replyTo', include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }] }
      ]
    });

    // Get chat info for notification
    const chat = await Chat.findByPk(chatId, {
      include: [{
        model: ChatMember,
        as: 'members',
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
      }]
    });

    // Emit new message event to all chat members except sender via Socket.IO.
    // Подпись чата у всех получателей одна и та же: в личном чате это имя
    // отправителя (собеседник там ровно один), в группе — название группы.
    const io = req.app.get('io');
    if (io && chat) {
      let chatDisplayName = chat.name;
      let chatAvatar = chat.avatar;

      if (chat.type === 'private') {
        const senderMember = chat.members.find(m => m.userId === req.user.id);
        if (senderMember?.user) {
          chatDisplayName = senderMember.user.displayName || senderMember.user.username;
          chatAvatar = senderMember.user.avatar;
        }
      }

      emitToMembers(io, chat.members, 'new_message', {
        message: fullMessage,
        chat: { id: chat.id, type: chat.type, displayName: chatDisplayName, avatar: chatAvatar }
      }, req.user.id);
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
    if (message.type === 'poll') {
      return res.status(400).json({ error: 'Опрос нельзя редактировать после публикации' });
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
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] },
        { model: Message, as: 'replyTo', include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }] }
      ]
    });

    // Событие правки не отправлялось вовсе: мобильный клиент его слушал, но
    // никогда не получал, и отредактированный текст менялся у собеседника
    // только после перезагрузки чата.
    const io = req.app.get('io');
    if (io) {
      const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
      emitToMembers(io, members, 'message_edited', {
        chatId,
        messageId: message.id,
        content: updatedMessage.content,
        isEdited: true
      }, req.user.id);
    }

    res.json(updatedMessage);
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Удаление сообщений: «у себя» прячет сообщение у одного человека,
// «у всех» стирает физически. Заглушек «Сообщение удалено» больше нет.
// Кому что разрешено — в services/messagePermissions.js.
/**
 * Общая механика для обоих маршрутов удаления: одиночного (совместимость со
 * старыми сборками мобильного приложения) и группового.
 */
async function deleteMessages({ req, chatId, messageIds, scope }) {
  const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
  if (!membership) {
    return { status: 403, body: { error: 'Not a member of this chat' } };
  }

  const messages = await Message.findAll({ where: { id: { [Op.in]: messageIds }, chatId } });
  if (messages.length === 0) {
    return { status: 404, body: { error: 'Messages not found' } };
  }

  const ids = messages.map(m => m.id);

  if (scope === 'me') {
    // Скрытие у себя не спрашивает разрешений: это правка своего экрана, а не
    // чужой переписки
    await MessageDeletion.bulkCreate(
      ids.map(messageId => ({ messageId, userId: req.user.id })),
      { ignoreDuplicates: true }
    );

    // Спрятанное могло быть непрочитанным — иначе счётчик остался бы висеть
    // на сообщениях, которых человек уже не видит
    await recountChat(chatId);

    const io = req.app.get('io');
    // Только своя комната: у остальных участников ничего не изменилось, а вот
    // второе устройство того же человека должно спрятать те же сообщения
    emitToMembers(io, [req.user.id], 'messages_deleted', { chatId, messageIds: ids, scope: 'me' });

    return { status: 200, body: { deleted: ids.length, scope: 'me', messageIds: ids } };
  }

  const chat = await Chat.findByPk(chatId);
  const denied = messages.filter(message => !canDeleteForAll({ message, chat, membership, user: req.user }));
  if (denied.length > 0) {
    return {
      status: 403,
      body: {
        error: denied.length === messages.length
          ? 'Эти сообщения нельзя удалить у всех'
          : `Часть сообщений нельзя удалить у всех: ${denied.length} из ${messages.length}`,
        deniedIds: denied.map(m => m.id)
      }
    };
  }

  await sequelize.transaction(async transaction => {
    // Ответы и реакции отвязываем сами, не полагаясь на FK конкретной базы:
    // ON DELETE у этих связей исторически задан не везде одинаково
    await Message.update({ replyToId: null }, { where: { replyToId: { [Op.in]: ids } }, transaction });
    await MessageReaction.destroy({ where: { messageId: { [Op.in]: ids } }, transaction });
    await MessageDeletion.destroy({ where: { messageId: { [Op.in]: ids } }, transaction });
    await Message.destroy({ where: { id: { [Op.in]: ids } }, transaction });
  });

  // Реестр вложений уходит по каскаду вместе с сообщением, но кэш ответов
  // «можно ли этому человеку этот файл» живёт ещё минуту — сбрасываем сразу
  messages.forEach(message => (message.attachments || []).forEach(att => {
    const filename = attachmentFilename(att);
    if (filename) fileAccess.invalidateFile(filename);
  }));

  // Инкремент умеет только прибавлять, а тут сообщения исчезли — счётчики
  // непрочитанных в этом чате надо пересчитать честно. Удаления редки по
  // сравнению с отправками, так что цена пересчёта здесь допустима.
  await recountChat(chatId);

  const previous = await Message.findOne({ where: { chatId }, order: [['createdAt', 'DESC']] });
  const lastMessage = previous ? messagePreviewOf(previous) : '';
  const lastMessageAt = previous?.createdAt || null;
  await Chat.update({ lastMessage, lastMessageAt }, { where: { id: chatId } });

  const io = req.app.get('io');
  const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
  emitToMembers(io, members, 'messages_deleted', {
    chatId,
    messageIds: ids,
    scope: 'all',
    lastMessage,
    lastMessageAt
  });

  return { status: 200, body: { deleted: ids.length, scope: 'all', messageIds: ids, lastMessage, lastMessageAt } };
}

// ── Медиа, файлы, голосовые и ссылки чата (ver. 7.35) ────────────────────
//
// Раньше «галерея» была тем, что успело загрузиться в ленту: последние
// полсотни сообщений плюс то, что человек долистал. Найти фотографию
// месячной давности было нельзя иначе, как пролистав до неё вручную.
//
// Каждое вложение — своя строка (jsonb_array_elements), потому что в одном
// сообщении их бывает десяток, а в галерее они самостоятельные элементы.

const MEDIA_KINDS = {
  media: `(a->>'mimeType' LIKE 'image/%' OR a->>'mimeType' LIKE 'video/%')`,
  voice: `a->>'kind' = 'voice'`,
  files: `COALESCE(a->>'kind', '') <> 'voice'
          AND COALESCE(a->>'mimeType', '') NOT LIKE 'image/%'
          AND COALESCE(a->>'mimeType', '') NOT LIKE 'video/%'`
};

router.get('/:chatId/media', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const kind = String(req.query.kind || 'media');
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 60, maxLimit: 100 });

    const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

    // Ссылки живут в тексте, а не во вложениях — отдельный запрос
    if (kind === 'links') {
      const rows = await sequelize.query(`
        SELECT m.id, m."createdAt", m."senderId", m.content,
               u."displayName", u.username
        FROM messages m
        LEFT JOIN users u ON u.id = m."senderId"
        WHERE m."chatId" = :chatId
          AND m.type <> 'system'
          AND m.content ~* 'https?://'
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md."messageId" = m.id AND md."userId" = :userId
          )
        ORDER BY m."createdAt" DESC
        LIMIT :limit OFFSET :offset
      `, { replacements: { chatId, userId: req.user.id, limit, offset }, type: sequelize.QueryTypes.SELECT });

      return res.json(rows.map(row => ({
        messageId: row.id,
        createdAt: row.createdAt,
        senderId: row.senderId,
        senderName: row.displayName || row.username,
        content: row.content,
        // Адреса вытаскиваем здесь, чтобы клиенту не пришлось повторять
        // разбор текста у себя — и одинаково в вебе и в мобилке
        urls: (row.content.match(/https?:\/\/[^\s<>"']+/g) || []).slice(0, 10)
      })));
    }

    const condition = MEDIA_KINDS[kind];
    if (!condition) return res.status(400).json({ error: 'kind must be media, files, voice or links' });

    const rows = await sequelize.query(`
      SELECT m.id, m."createdAt", m."senderId", a AS attachment,
             u."displayName", u.username
      FROM messages m
      CROSS JOIN LATERAL jsonb_array_elements(m.attachments) AS a
      LEFT JOIN users u ON u.id = m."senderId"
      WHERE m."chatId" = :chatId
        AND jsonb_typeof(m.attachments) = 'array'
        AND ${condition}
        AND NOT EXISTS (
          SELECT 1 FROM message_deletions md
          WHERE md."messageId" = m.id AND md."userId" = :userId
        )
      ORDER BY m."createdAt" DESC
      LIMIT :limit OFFSET :offset
    `, { replacements: { chatId, userId: req.user.id, limit, offset }, type: sequelize.QueryTypes.SELECT });

    res.json(rows.map(row => ({
      messageId: row.id,
      createdAt: row.createdAt,
      senderId: row.senderId,
      senderName: row.displayName || row.username,
      attachment: row.attachment
    })));
  } catch (error) {
    console.error('Get chat media error:', error);
    res.status(500).json({ error: 'Failed to load chat media' });
  }
});

// ── Закреплённые сообщения (ver. 7.33) ───────────────────────────────────
//
// Закреплённых в чате может быть несколько: в рабочей группе одинаково нужны
// и «график на неделю», и «телефон дежурного». В шапке показывается последнее,
// остальные листаются по нажатию.

const PINNED_LIMIT = 20;

function pinnedInclude() {
  return [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }];
}

router.get('/:chatId/pinned', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

    const pinned = await Message.findAll({
      where: {
        chatId,
        pinnedAt: { [Op.ne]: null },
        // Спрятанное «у себя» не должно висеть в шапке у того, кто его спрятал
        id: { [Op.notIn]: Sequelize.literal('(SELECT "messageId" FROM message_deletions WHERE "userId" = :currentUserId)') }
      },
      replacements: { currentUserId: req.user.id },
      include: pinnedInclude(),
      order: [['pinnedAt', 'DESC']],
      limit: PINNED_LIMIT
    });

    res.json(pinned);
  } catch (error) {
    console.error('Get pinned messages error:', error);
    res.status(500).json({ error: 'Failed to load pinned messages' });
  }
});

router.post('/:chatId/messages/:messageId/pin', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const pin = req.body?.pin !== false;

    const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

    const chat = await Chat.findByPk(chatId);
    if (!canPin({ chat, membership, user: req.user })) {
      return res.status(403).json({ error: 'Закреплять сообщения может только администратор группы' });
    }

    const message = await Message.findOne({ where: { id: messageId, chatId } });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.type === 'system') {
      return res.status(400).json({ error: 'Системные сообщения не закрепляются' });
    }

    if (pin) {
      const alreadyPinned = await Message.count({ where: { chatId, pinnedAt: { [Op.ne]: null } } });
      if (!message.pinnedAt && alreadyPinned >= PINNED_LIMIT) {
        // Потолок не от базы, а от шапки: листать три десятка закреплений
        // никто не станет, а старые всё равно никто не снимет
        return res.status(400).json({ error: `Больше ${PINNED_LIMIT} закреплённых в одном чате быть не может` });
      }
      await message.update({ pinnedAt: new Date(), pinnedBy: req.user.id });
    } else {
      await message.update({ pinnedAt: null, pinnedBy: null });
    }

    const updated = await Message.findByPk(message.id, { include: pinnedInclude() });

    const io = req.app.get('io');
    const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
    emitToMembers(io, members, 'message_pin_changed', {
      chatId,
      messageId: message.id,
      pinned: pin,
      message: pin ? updated : null
    });

    res.json({ pinned: pin, message: updated });
  } catch (error) {
    console.error('Pin message error:', error);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// Групповое удаление. Ради него всё и затевалось: до ver. 7.29 разобрать
// завал в чате можно было только по одному сообщению за раз.
router.post('/:chatId/messages/delete', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { messageIds, scope = 'all' } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }
    if (messageIds.length > 200) {
      // Потолок взят не из ограничений базы, а из здравого смысла: выделить
      // больше двух сотен сообщений руками нельзя, а вот прислать — можно
      return res.status(400).json({ error: 'За один раз можно удалить не больше 200 сообщений' });
    }
    if (scope !== 'me' && scope !== 'all') {
      return res.status(400).json({ error: 'scope must be "me" or "all"' });
    }

    const { status, body } = await deleteMessages({ req, chatId, messageIds, scope });
    res.status(status).json(body);
  } catch (error) {
    console.error('Bulk delete messages error:', error);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

// Одиночное удаление — прежний маршрут. Оставлен ради установленных мобильных
// сборок: они умеют только его. Права те же, что у группового; если стереть у
// всех уже нельзя (например, прошли сутки), сообщение прячется у себя.
router.delete('/:chatId/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const requestedScope = req.query.scope === 'me' ? 'me' : null;

    const message = await Message.findOne({ where: { id: messageId, chatId } });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    let scope = requestedScope;
    if (!scope) {
      const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
      const chat = await Chat.findByPk(chatId);
      scope = canDeleteForAll({ message, chat, membership, user: req.user }) ? 'all' : 'me';
    }

    const { status, body } = await deleteMessages({ req, chatId, messageIds: [messageId], scope });
    if (status !== 200) return res.status(status).json(body);

    // Старые клиенты ждут именно этих полей: hardDeleted=true означает «убери
    // сообщение из списка», message=null — что заглушки больше нет
    res.json({ ...body, message: null, hardDeleted: true });
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
      // Пересылка копирует массив вложений, но не сам файл: в чате-получателе
      // это то же имя, и доступ к нему нужно открыть отдельной строкой реестра
      await registerChatFiles(orig.attachments, targetChatId, forwarded.id);

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
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
      }]
    });

    // Последнее из пересланных — оно же идёт в сокет и в push как превью пачки
    const lastCreated = createdMessages[createdMessages.length - 1];
    const fullMsg = targetChat && lastCreated
      ? await Message.findByPk(lastCreated.id, {
          include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
        })
      : null;

    const io = req.app.get('io');
    if (io && targetChat) {
      let chatDisplayName = targetChat.name;
      let chatAvatar = targetChat.avatar;
      if (targetChat.type === 'private') {
        const senderMember = targetChat.members.find(m => m.userId === req.user.id);
        if (senderMember?.user) {
          chatDisplayName = senderMember.user.displayName || senderMember.user.username;
          chatAvatar = senderMember.user.avatar;
        }
      }
      emitToMembers(io, targetChat.members, 'new_message', {
        message: fullMsg,
        chat: { id: targetChat.id, type: targetChat.type, displayName: chatDisplayName, avatar: chatAvatar }
      }, req.user.id);
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
    // Счётчик обнуляем вместе с меткой: с ver. 7.30 он хранится, а не считается
    await membership.update({ lastReadAt, unreadCount: 0 });

    // Notify message senders that their messages have been read
    const io = req.app.get('io');
    if (io) {
      const otherMembers = await ChatMember.findAll({
        where: { chatId, userId: { [Op.ne]: req.user.id } },
        attributes: ['userId']
      });
      emitToMembers(io, otherMembers, 'messages_read', {
        chatId,
        readBy: req.user.id,
        lastReadAt: lastReadAt.toISOString()
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
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
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
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
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
        include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge'] }]
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

// ── Пригласительные ссылки (ver. 7.58) ─────────────────────────────────────
//
// Подробности замысла — в services/chatInvites.js. Здесь только маршруты.
//
// Маршруты по токену объявлены ДО маршрутов с :chatId. Пересечься они не могут
// (у первых первый сегмент — литерал «invite»), но порядок объявления избавляет
// следующего читателя от необходимости это проверять.

/** Группа по токену: во что зовут. Доступно любому сотруднику портала. */
router.get('/invite/:token', authenticate, async (req, res) => {
  try {
    const chat = await invites.findByToken(req.params.token);
    // Выключенная и несуществующая ссылка отвечают одинаково: по разнице
    // ответов можно было бы узнать о существовании группы, не входя в неё
    if (!chat) return res.status(404).json({ error: 'Ссылка недействительна' });

    res.json(await invites.preview(chat, req.user.id));
  } catch (error) {
    console.error('Invite preview error:', error);
    res.status(500).json({ error: 'Не удалось открыть приглашение' });
  }
});

/** Вступить по ссылке. */
router.post('/invite/:token/join', authenticate, async (req, res) => {
  try {
    const chat = await invites.findByToken(req.params.token);
    if (!chat) return res.status(404).json({ error: 'Ссылка недействительна' });

    const result = await invites.join(chat, req.user);
    if (!result.joined) return res.json({ chatId: result.chatId, joined: false });

    // Уведомляем и группу (в ней появился человек), и самого вошедшего: у него
    // список чатов обязан пополниться без перезагрузки
    const io = req.app.get('io');
    const members = await invites.memberIds(chat.id);
    emitToMembers(io, members, 'new_message', {
      chatId: chat.id,
      message: {
        chatId: chat.id,
        senderId: req.user.id,
        content: result.systemMessage,
        type: 'system',
        createdAt: new Date()
      }
    });
    notifyBotMembership({ chatId: chat.id, userId: req.user.id, actorId: req.user.id, status: 'member' });

    res.json({ chatId: chat.id, joined: true });
  } catch (error) {
    console.error('Invite join error:', error);
    res.status(500).json({ error: 'Не удалось вступить в группу' });
  }
});

/**
 * Состояние ссылки. Только админам группы: обычный участник не должен даже
 * знать адрес — иначе «выключено по умолчанию» ничего не стоит.
 */
async function loadGroupForInvite(req, res, next) {
  try {
    const chatRecord = await Chat.findByPk(req.params.chatId);
    if (!chatRecord || chatRecord.type !== 'group') {
      return res.status(404).json({ error: 'Группа не найдена' });
    }
    if (!(await invites.isGroupAdmin(chatRecord.id, req.user.id))) {
      return res.status(403).json({ error: 'Ссылками управляют администраторы группы' });
    }
    req.groupChat = chatRecord;
    next();
  } catch (error) {
    console.error('Invite access error:', error);
    res.status(500).json({ error: 'Не удалось проверить права' });
  }
}

router.get('/:chatId/invite', authenticate, loadGroupForInvite, (req, res) => {
  res.json(invites.describe(req.groupChat));
});

/** Включить приём по ссылке (создав её при первом включении). */
router.post('/:chatId/invite', authenticate, loadGroupForInvite, async (req, res) => {
  try {
    res.json(await invites.enable(req.groupChat, req.user.id));
  } catch (error) {
    console.error('Invite enable error:', error);
    res.status(500).json({ error: 'Не удалось включить приглашение' });
  }
});

/** Перевыпустить: старая ссылка перестаёт работать немедленно. */
router.post('/:chatId/invite/rotate', authenticate, loadGroupForInvite, async (req, res) => {
  try {
    res.json(await invites.rotate(req.groupChat, req.user.id));
  } catch (error) {
    console.error('Invite rotate error:', error);
    res.status(500).json({ error: 'Не удалось обновить ссылку' });
  }
});

/** Выключить приём. Токен остаётся — чтобы включить обратно тем же адресом. */
router.delete('/:chatId/invite', authenticate, loadGroupForInvite, async (req, res) => {
  try {
    res.json(await invites.disable(req.groupChat));
  } catch (error) {
    console.error('Invite disable error:', error);
    res.status(500).json({ error: 'Не удалось выключить приглашение' });
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
      emitToMembers(io, memberIds, 'group_deleted', { chatId });
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
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] }, attributes: ['id', 'name', 'displayName'] }
      ],
      attributes: ['id', 'username', 'displayName', 'avatar', 'chatBadge', 'position', 'email', 'isActive'],
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
// MESSAGE ACTIONS — кнопки под сообщениями бота
// ====================================================================

/**
 * Нажатие кнопки под сообщением.
 *
 * Что заявку уже взяли, видно по 👍 — его ставит сам сервер от нажавшего.
 * Отдельного состояния у кнопки нет: реакции для этого достаточно.
 */
router.post('/:chatId/messages/:messageId/actions/:actionId', authenticate, async (req, res) => {
  try {
    const { chatId, messageId, actionId } = req.params;

    const membership = await ChatMember.findOne({ where: { chatId, userId: req.user.id } });
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }
    if (membership.isReadOnly) {
      return res.status(403).json({ error: 'Вам ограничены действия в этом чате' });
    }

    const message = await Message.findOne({ where: { id: messageId, chatId } });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const action = (Array.isArray(message.actions) ? message.actions : [])
      .find(a => a.id === actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    let result = null;
    try {
      result = await messageActions.runAction(action, req.user);
    } catch (error) {
      // Ошибку показываем сотруднику как есть: «МИС недоступна», «заявка не найдена»
      console.error(`[chat] действие ${actionId} для сообщения ${messageId}:`, error.message);
      return res.status(502).json({ error: error.message });
    }

    // Сбой лайка не должен выглядеть как сбой самого действия — оно уже выполнено
    const reactions = await addThumbsUp(messageId, req.user.id).catch(err => {
      console.error('[chat] лайк после действия не поставился:', err.message);
      return null;
    });

    const io = req.app.get('io');
    if (io && reactions) {
      const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
      emitToMembers(io, members, 'message_reaction_updated', {
        chatId,
        messageId,
        reactions: reactionsPayload(reactions)
      });
    }

    res.json({ result });
  } catch (error) {
    console.error('Run message action error:', error);
    res.status(500).json({ error: 'Failed to run action' });
  }
});

/**
 * Ставит 👍 от нажавшего кнопку. Если он уже отметил сообщение другим эмодзи —
 * оставляем его выбор: реакция здесь только отметка «взято в работу», перебивать
 * ей осознанно поставленную не за чем.
 */
async function addThumbsUp(messageId, userId) {
  await MessageReaction.findOrCreate({
    where:    { messageId, userId },
    defaults: { messageId, userId, emoji: '👍' }
  });
  return aggregateReactions(messageId, userId);
}

// ====================================================================
// MESSAGE REACTIONS
// ====================================================================

// Helper: Aggregate reactions for a message
// Реакции в рассылке.
//
// Раньше каждому участнику уходил свой вариант с готовым hasReacted — то есть
// N рассылок на одну реакцию. Теперь список поставивших едет как есть, а «моя
// ли это реакция» клиент решает сам. Заодно перестал теряться users: в прежнем
// payload его не было, и после реакции по сокету пропадала аватарка того, кто
// её поставил, — до перезагрузки чата.
function reactionsPayload(aggregated) {
  return (aggregated || []).map(({ emoji, count, users }) => ({ emoji, count, users }));
}

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
      const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
      emitToMembers(io, members, 'message_reaction_updated', {
        chatId,
        messageId,
        reactions: reactionsPayload(aggregated)
      });
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
      const members = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'] });
      emitToMembers(io, members, 'message_reaction_updated', {
        chatId,
        messageId,
        reactions: reactionsPayload(aggregated)
      });
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
