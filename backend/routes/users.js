const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { User, Role, MedCenter, UserRole, UserMedCenter } = require('../models');
const { Op, Sequelize } = require('sequelize');
const { authenticate, requireAdmin, requireAdminAccess } = require('../middleware/auth');
const { send2FADisabledNotification, sendCredentials } = require('../services/emailService');
const notificationService = require('../services/notificationService');

const router = express.Router();

// Get basic list of users (for assignee selection, etc.) - available to all authenticated users
// Optional query param: ?access=reviews — returns only users with adminAccess.reviews=true (or isAdmin)
router.get('/list', authenticate, async (req, res) => {
  try {
    const where = { isActive: true };

    if (req.query.access === 'reviews') {
      where[Op.or] = [
        { isAdmin: true },
        Sequelize.literal(`"adminAccess"->>'reviews' = 'true'`)
      ];
    }

    const users = await User.findAll({
      attributes: ['id', 'username', 'displayName', 'avatar'],
      where,
      order: [['displayName', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Get users list error:', error);
    res.status(500).json({ error: 'Failed to fetch users list' });
  }
});

// Get all users (admin only)
router.get('/', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const users = await User.findAll({
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user
router.get('/:id', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create user
router.post('/', authenticate, requireAdminAccess('users'), [
  body('username').trim().isLength({ min: 3 }).withMessage('Логин должен быть минимум 3 символа'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть минимум 6 символов')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    let { username, password, displayName, email, roleId, roleIds, medCenterIds, isAdmin, isActive, twoFactorEnabled, canEditDoctorCards, canEditAnalyses, canEditServices, adminAccess } = req.body;

    // Проверка существования пользователя
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }

    // Обработка пустого roleId - преобразуем в null
    if (roleId === '' || roleId === undefined) {
      roleId = null;
    }

    // Если roleId передан, проверяем что такая роль существует (для обратной совместимости)
    if (roleId) {
      const roleExists = await Role.findByPk(roleId);
      if (!roleExists) {
        return res.status(400).json({ error: 'Указанная роль не найдена' });
      }
    }

    // Проверяем множественные роли
    if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
      for (const rId of roleIds) {
        const roleExists = await Role.findByPk(rId);
        if (!roleExists) {
          return res.status(400).json({ error: `Роль с ID ${rId} не найдена` });
        }
      }
    }

    // Проверяем медцентры
    if (medCenterIds && Array.isArray(medCenterIds) && medCenterIds.length > 0) {
      for (const mcId of medCenterIds) {
        const medCenterExists = await MedCenter.findByPk(mcId);
        if (!medCenterExists) {
          return res.status(400).json({ error: `Медцентр с ID ${mcId} не найден` });
        }
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
      twoFactorEnabled: twoFactorEnabled || false,
      canEditDoctorCards: canEditDoctorCards || false,
      canEditAnalyses: canEditAnalyses || false,
      canEditServices: canEditServices || false,
      adminAccess: adminAccess || {
        pages: false,
        sidebar: false,
        users: false,
        roles: false,
        media: false,
        backup: false,
        settings: false,
        courses: false
      }
    });

    // Добавляем множественные роли
    if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
      await Promise.all(
        roleIds.map(rId => UserRole.create({ userId: user.id, roleId: rId }))
      );
    }

    // Добавляем медцентры
    if (medCenterIds && Array.isArray(medCenterIds) && medCenterIds.length > 0) {
      await Promise.all(
        medCenterIds.map(mcId => UserMedCenter.create({ userId: user.id, medCenterId: mcId }))
      );
    }

    const created = await User.findByPk(user.id, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });

    // Отправляем приветственное сообщение от Ассистента
    try {
      await notificationService.sendWelcomeMessage(user.id);
      console.log(`✅ Welcome message sent to user ${user.username}`);
    } catch (welcomeError) {
      console.error('Failed to send welcome message:', welcomeError);
      // Не блокируем создание пользователя из-за ошибки отправки сообщения
    }

    // Отправляем email с учетными данными
    if (email) {
      try {
        await sendCredentials(email, username, password, displayName || username, false);
        console.log(`✅ Credentials email sent to user ${username}`);
      } catch (emailError) {
        console.error('Failed to send credentials email:', emailError);
        // Не блокируем создание пользователя из-за ошибки отправки email
      }
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

// Update user
router.put('/:id', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    let { username, password, displayName, email, roleId, roleIds, medCenterIds, isAdmin, isActive, twoFactorEnabled, canEditDoctorCards, canEditAnalyses, canEditServices, adminAccess } = req.body;

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

    // Проверяем множественные роли
    if (roleIds && Array.isArray(roleIds)) {
      for (const rId of roleIds) {
        const roleExists = await Role.findByPk(rId);
        if (!roleExists) {
          return res.status(400).json({ error: `Роль с ID ${rId} не найдена` });
        }
      }
    }

    // Проверяем медцентры
    if (medCenterIds && Array.isArray(medCenterIds)) {
      for (const mcId of medCenterIds) {
        const medCenterExists = await MedCenter.findByPk(mcId);
        if (!medCenterExists) {
          return res.status(400).json({ error: `Медцентр с ID ${mcId} не найден` });
        }
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
      ...(twoFactorEnabled !== undefined && { twoFactorEnabled }),
      ...(canEditDoctorCards !== undefined && { canEditDoctorCards }),
      ...(canEditAnalyses !== undefined && { canEditAnalyses }),
      ...(canEditServices !== undefined && { canEditServices }),
      ...(adminAccess !== undefined && { adminAccess })
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

    // Сохраняем пароль для отправки email (до хеширования)
    const plainPassword = password;

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    await user.update(updateData);

    // Отправляем email с новым паролем, если пароль был изменен и есть email
    if (plainPassword && (email || user.email)) {
      const userEmail = email || user.email;
      const userName = displayName || user.displayName || user.username;
      try {
        await sendCredentials(userEmail, user.username, plainPassword, userName, true);
        console.log(`✅ Password change email sent to user ${user.username}`);
      } catch (emailError) {
        console.error('Failed to send password change email:', emailError);
        // Не блокируем обновление пользователя из-за ошибки отправки email
      }
    }

    // Обновляем множественные роли
    if (roleIds !== undefined && Array.isArray(roleIds)) {
      // Удаляем старые связи
      await UserRole.destroy({ where: { userId: user.id } });
      // Создаём новые
      if (roleIds.length > 0) {
        await Promise.all(
          roleIds.map(rId => UserRole.create({ userId: user.id, roleId: rId }))
        );
      }
    }

    // Обновляем медцентры
    if (medCenterIds !== undefined && Array.isArray(medCenterIds)) {
      // Удаляем старые связи
      await UserMedCenter.destroy({ where: { userId: user.id } });
      // Создаём новые
      if (medCenterIds.length > 0) {
        await Promise.all(
          medCenterIds.map(mcId => UserMedCenter.create({ userId: user.id, medCenterId: mcId }))
        );
      }
    }

    const updated = await User.findByPk(user.id, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });

    res.json(updated);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

// Delete user
router.delete('/:id', authenticate, requireAdminAccess('users'), async (req, res) => {
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

// Get all medical centers
router.get('/medcenters/list', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const medCenters = await MedCenter.findAll({
      order: [['name', 'ASC']]
    });
    res.json(medCenters);
  } catch (error) {
    console.error('Get medcenters error:', error);
    res.status(500).json({ error: 'Ошибка загрузки медицинских центров' });
  }
});

module.exports = router;