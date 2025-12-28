const express = require('express');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Chat, ChatMember, Message, User } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Multer setup for chat avatar
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/chat-avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `chat-${req.params.chatId}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Get all chats for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const memberships = await ChatMember.findAll({
      where: { userId: req.user.id },
      include: [{
        model: Chat,
        as: 'chat',
        include: [{
          model: ChatMember,
          as: 'members',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        }]
      }],
      order: [[{ model: Chat, as: 'chat' }, 'lastMessageAt', 'DESC NULLS LAST']]
    });

    const chats = memberships.map(m => {
      const chat = m.chat.toJSON();
      if (chat.type === 'private') {
        const otherMember = chat.members.find(member => member.userId !== req.user.id);
        if (otherMember) {
          chat.displayName = otherMember.user.displayName || otherMember.user.username;
          chat.avatar = otherMember.user.avatar;
          chat.otherUser = otherMember.user;
        }
      } else {
        chat.displayName = chat.name;
      }
      chat.unreadCount = 0;
      return chat;
    });

    res.json(chats);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get or create private chat with user
router.post('/private/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    
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

    await Message.create({
      chatId: chat.id,
      senderId: req.user.id,
      content: `${req.user.displayName || req.user.username} создал группу "${name}"`,
      type: 'system'
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
router.post('/:chatId/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Only creator (admin) can update avatar
    if (chat.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Only group creator can update avatar' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Process image with sharp
    const outputPath = req.file.path.replace(/\.[^.]+$/, '-processed.jpg');
    await sharp(req.file.path)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    // Delete original file
    fs.unlinkSync(req.file.path);

    // Delete old avatar if exists
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

    const where = { chatId };
    if (before) {
      where.createdAt = { [Op.lt]: new Date(before) };
    }

    const messages = await Message.findAll({
      where,
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'displayName', 'avatar'] },
        { model: Message, as: 'replyTo', include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'displayName'] }] }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    await membership.update({ lastReadAt: new Date() });

    res.json(messages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send message
router.post('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, type = 'text', attachments = [], replyToId } = req.body;

    if ((!content || !content.trim()) && attachments.length === 0) {
      return res.status(400).json({ error: 'Message content or attachments required' });
    }

    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    let messageType = type;
    if (attachments.length > 0) {
      const allImages = attachments.every(a => a.mimeType?.startsWith('image/'));
      messageType = allImages ? 'image' : 'file';
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

    res.status(201).json(fullMessage);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
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
    await Message.create({
      chatId,
      senderId: req.user.id,
      content: `${user.displayName || user.username} добавлен в группу`,
      type: 'system'
    });

    res.json({ message: 'Member added' });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Remove member from group (kick)
router.delete('/:chatId/members/:userId', authenticate, async (req, res) => {
  try {
    const { chatId, userId } = req.params;

    const chat = await Chat.findByPk(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if requester is admin (creator)
    const requesterMembership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!requesterMembership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Only creator can kick others, or user can remove themselves
    const isCreator = chat.createdBy === req.user.id;
    const isSelf = userId === req.user.id;

    if (!isCreator && !isSelf) {
      return res.status(403).json({ error: 'Only group creator can remove members' });
    }

    // Cannot kick the creator
    if (userId === chat.createdBy && !isSelf) {
      return res.status(403).json({ error: 'Cannot remove group creator' });
    }

    const membership = await ChatMember.findOne({ where: { chatId, userId } });
    if (!membership) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const user = await User.findByPk(userId, { attributes: ['displayName', 'username'] });
    
    await membership.destroy();

    // Create system message
    const messageContent = isSelf 
      ? `${user.displayName || user.username} покинул группу`
      : `${user.displayName || user.username} исключён из группы`;

    await Message.create({
      chatId,
      senderId: req.user.id,
      content: messageContent,
      type: 'system'
    });

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
      await Message.create({
        chatId,
        senderId: req.user.id,
        content: `${req.user.displayName || req.user.username} покинул группу`,
        type: 'system'
      });
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

module.exports = router;