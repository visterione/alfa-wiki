const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { Chat, ChatMember, Message, User, Role } = require('../models');

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
            separate: true
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
            include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
          },
          {
            model: Message,
            as: 'messages',
            limit: 1,
            order: [['createdAt', 'DESC']],
            separate: true
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

      if (chat.type === 'private' && otherMembers.length > 0) {
        const otherUser = otherMembers[0].user;
        displayName = otherUser.displayName || otherUser.username;
        avatar = otherUser.avatar;
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
        members: chat.members,
        unreadCount,
        createdBy: chat.createdBy
      };

      // Добавляем otherUser для приватных чатов
      if (chat.type === 'private' && otherMembers.length > 0) {
        result.otherUser = otherMembers[0].user;
      }

      return result;
    }));

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
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    res.json(messages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to load messages' });
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

    let messageType = 'text';
    if (attachments.length > 0) {
      messageType = attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file';
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
      lastMessagePreview = allImages
        ? `📷 Фото${attachments.length > 1 ? ` (${attachments.length})` : ''}`
        : `📎 Файл${attachments.length > 1 ? ` (${attachments.length})` : ''}`;
    }

    await Chat.update(
      { lastMessage: lastMessagePreview, lastMessageAt: new Date() },
      { where: { id: chatId } }
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

    await membership.update({ lastReadAt: new Date() });

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
router.post('/:chatId/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (chat.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Only group creator can update avatar' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const outputPath = req.file.path.replace(/\.[^.]+$/, '-processed.jpg');
    await sharp(req.file.path)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    fs.unlinkSync(req.file.path);

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
    res.status(500).json({ error: 'Failed to update avatar' });
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

    if (chat.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Only group creator can delete avatar' });
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

    const isCreator = chat.createdBy === req.user.id;
    const isSelf = userId === req.user.id;

    if (!isCreator && !isSelf) {
      return res.status(403).json({ error: 'Only group creator can remove members' });
    }

    if (userId === chat.createdBy && !isSelf) {
      return res.status(403).json({ error: 'Cannot remove group creator' });
    }

    const membership = await ChatMember.findOne({ where: { chatId, userId } });
    if (!membership) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const user = await User.findByPk(userId, { attributes: ['displayName', 'username'] });
    
    await membership.destroy();

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

// Get users for chat (all authenticated users can access)
router.get('/users', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { isActive: true },
      include: [{ model: Role, as: 'role' }],
      attributes: ['id', 'username', 'displayName', 'avatar', 'email', 'isActive'],
      order: [['displayName', 'ASC']]
    });

    // Исключаем текущего пользователя
    const filteredUsers = users.filter(u => u.id !== req.user.id);

    res.json(filteredUsers);
  } catch (error) {
    console.error('Get chat users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
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

module.exports = router;