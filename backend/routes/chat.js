const express = require('express');
const { Op } = require('sequelize');
const { Chat, ChatMember, Message, User } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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
      // For private chats, get the other user's name
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
      chat.unreadCount = 0; // TODO: implement unread count
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

    // Check if private chat already exists
    const existingMemberships = await ChatMember.findAll({
      where: { userId: { [Op.in]: [req.user.id, userId] } },
      include: [{ model: Chat, as: 'chat', where: { type: 'private' } }]
    });

    // Group by chatId and find chat with both users
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

    // Create new private chat
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

    // Add creator as admin
    const members = [{ chatId: chat.id, userId: req.user.id, role: 'admin' }];
    
    // Add other members
    if (memberIds && memberIds.length > 0) {
      memberIds.forEach(userId => {
        if (userId !== req.user.id) {
          members.push({ chatId: chat.id, userId, role: 'member' });
        }
      });
    }

    await ChatMember.bulkCreate(members);

    // Create system message
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

// Get messages for a chat
router.get('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;

    // Check if user is member of chat
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

    // Update last read
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
    const { content, type = 'text', attachments, replyToId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Check if user is member of chat
    const membership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const message = await Message.create({
      chatId,
      senderId: req.user.id,
      content: content.trim(),
      type,
      attachments: attachments || [],
      replyToId
    });

    // Update chat's last message
    await Chat.update(
      { lastMessage: content.trim(), lastMessageAt: new Date() },
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

// Get all users (for starting new chat)
router.get('/users/list', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { 
        isActive: true,
        id: { [Op.ne]: req.user.id }
      },
      attributes: ['id', 'username', 'displayName', 'avatar'],
      order: [['displayName', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
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

    // Check if requester is admin
    const requesterMembership = await ChatMember.findOne({
      where: { chatId, userId: req.user.id, role: 'admin' }
    });

    if (!requesterMembership) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }

    // Check if user already member
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

    // If no members left, delete the chat
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