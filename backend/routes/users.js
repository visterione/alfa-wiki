const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { User, Role } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { send2FADisabledNotification } = require('../services/emailService');

const router = express.Router();

// Get all users (admin only)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create user
router.post('/', authenticate, requireAdmin, [
  body('username').trim().isLength({ min: 3 }).withMessage('Логин должен быть минимум 3 символа'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть минимум 6 символов')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    let { username, password, displayName, email, roleId, isAdmin, isActive, twoFactorEnabled } = req.body;

    // Проверка существования пользователя
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }

    // Обработка пустого roleId - преобразуем в null
    if (roleId === '' || roleId === undefined) {
      roleId = null;
    }

    // Если roleId передан, проверяем что такая роль существует
    if (roleId) {
      const roleExists = await Role.findByPk(roleId);
      if (!roleExists) {
        return res.status(400).json({ error: 'Указанная роль не найдена' });
      }
    }

    // Если включена 2FA, проверяем наличие email
    if (twoFactorEnabled && !email) {
      return res.status(400).json({ 
        error: 'Для включения двухфакторной аутентификации необходимо указать email' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      username,
      password: hashedPassword,
      displayName: displayName || username,
      email: email || null,
      roleId: roleId,
      isAdmin: isAdmin || false,
      isActive: isActive !== false,
      twoFactorEnabled: twoFactorEnabled || false
    });

    const created = await User.findByPk(user.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

// Update user
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    let { username, password, displayName, email, roleId, isAdmin, isActive, twoFactorEnabled } = req.body;

    // Check username uniqueness
    if (username && username !== user.username) {
      const existing = await User.findOne({ where: { username } });
      if (existing) return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }

    // Обработка пустого roleId - преобразуем в null
    if (roleId === '') {
      roleId = null;
    }

    // Если roleId передан и не null, проверяем что такая роль существует
    if (roleId) {
      const roleExists = await Role.findByPk(roleId);
      if (!roleExists) {
        return res.status(400).json({ error: 'Указанная роль не найдена' });
      }
    }

    // Если пытаются включить 2FA, проверяем наличие email
    if (twoFactorEnabled && !email && !user.email) {
      return res.status(400).json({ 
        error: 'Для включения двухфакторной аутентификации необходимо указать email' 
      });
    }

    const updateData = {
      ...(username && { username }),
      ...(displayName !== undefined && { displayName }),
      ...(email !== undefined && { email: email || null }),
      ...(roleId !== undefined && { roleId: roleId || null }),
      ...(isAdmin !== undefined && { isAdmin }),
      ...(isActive !== undefined && { isActive }),
      ...(twoFactorEnabled !== undefined && { twoFactorEnabled })
    };

    // Если отключаем 2FA - очищаем коды
    if (twoFactorEnabled === false && user.twoFactorEnabled) {
      updateData.twoFactorCode = null;
      updateData.twoFactorCodeExpires = null;
      updateData.twoFactorAttempts = 0;

      // Отправляем уведомление (не критично, если не отправится)
      if (user.email) {
        try {
          await send2FADisabledNotification(user.email, user.displayName || user.username);
        } catch (e) {
          console.warn('Failed to send 2FA disabled notification:', e);
        }
      }
    }

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    await user.update(updateData);

    const updated = await User.findByPk(user.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });

    res.json(updated);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

// Delete user
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    // Prevent self-deletion
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя' });
    }

    await user.destroy();
    res.json({ message: 'Пользователь удалён' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

module.exports = router;