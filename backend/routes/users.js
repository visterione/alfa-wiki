const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { User, Role, MedCenter, UserRole, UserMedCenter, PageHistory, Page, CourseProgress, Course } = require('../models');
const { Op, Sequelize } = require('sequelize');
const { authenticate, requireAdmin, requireAdminAccess } = require('../middleware/auth');
const { send2FADisabledNotification, sendCredentials } = require('../services/emailService');
const notificationService = require('../services/notificationService');
const presence = require('../services/presence');
const axios = require('axios');
const qs = require('qs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `user-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const uploadAvatarMulter = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';

let _misCache = null;
let _misCacheTime = 0;

const misRequest = async (endpoint, params = {}) => {
  try {
    const response = await axios.post(
      `${MIS_BASE_URL}/${endpoint}`,
      qs.stringify({ api_key: MIS_API_KEY, ...params }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
    return response.data;
  } catch (err) {
    console.error(`MIS API error (${endpoint}):`, err.message);
    return null;
  }
};

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
      where: { deletedAt: null },
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

// Upload user avatar
router.post('/upload-avatar', authenticate, uploadAvatarMulter.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ avatarPath: `uploads/avatars/${req.file.filename}` });
});

// Search MIS employees
router.get('/mis-search', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (Date.now() - _misCacheTime > 5 * 60 * 1000 || !_misCache) {
      const data = await misRequest('getUsers', { show_all: 1 });
      if (!data || data.error !== 0 || !Array.isArray(data.data)) return res.status(502).json({ error: 'МИС недоступен' });
      _misCache = data.data;
      _misCacheTime = Date.now();
    }
    const results = _misCache
      .filter(u => {
        if (!q) return true;
        const name = (u.name || '').toLowerCase();
        const roles = [].concat(u.role_titles || []).join(' ').toLowerCase();
        const profs = [].concat(u.profession_titles || []).join(' ').toLowerCase();
        return name.includes(q) || roles.includes(q) || profs.includes(q);
      })
      .slice(0, 50)
      .map((u) => {
        const { id, name, email, avatar_small, role_titles, profession_titles, clinic_titles, gender, birth_date, contacts } = u;
        const phoneContact = Array.isArray(contacts)
          ? contacts.find(c => c.type === 'mobile' || c.type === 'phone' || (c.type_title || '').toLowerCase().includes('телефон'))
          : null;
        const phone = (u.phone && u.phone !== 'null') ? u.phone : (phoneContact ? phoneContact.value : '');
        const birthDate = (birth_date && birth_date !== 'null') ? birth_date : null;
        return { id, name, email, avatar_small, role_titles, profession_titles, clinic_titles, phone, gender, birth_date: birthDate };
      });
    res.json(results);
  } catch (err) {
    console.error('MIS search error:', err);
    res.status(500).json({ error: 'Ошибка поиска в МИС' });
  }
});

// Download MIS avatar to local storage
router.post('/mis-avatar', authenticate, async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (!avatarUrl) return res.status(400).json({ error: 'avatarUrl required' });
    const response = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const contentType = response.headers['content-type'] || '';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `mis-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const dir = path.join(__dirname, '..', 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), response.data);
    res.json({ avatarPath: `uploads/avatars/${filename}` });
  } catch (err) {
    console.error('MIS avatar error:', err.message);
    res.status(500).json({ error: 'Не удалось скачать аватар' });
  }
});

// Get deleted users (trash)
router.get('/trash', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const trashedUsers = await User.findAll({
      where: { deletedAt: { [Op.not]: null } },
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } },
        { model: User, as: 'deletedByUser', attributes: ['id', 'username', 'displayName'], required: false }
      ],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] },
      order: [['deletedAt', 'DESC']]
    });
    res.json(trashedUsers);
  } catch (error) {
    console.error('Get trash error:', error);
    res.status(500).json({ error: 'Ошибка загрузки корзины' });
  }
});

// Public profile — available to all authenticated users
router.get('/:id/public', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] }, attributes: ['id', 'name'] }
      ],
      attributes: ['id', 'username', 'displayName', 'avatar', 'phone', 'position', 'bio', 'isAdmin', 'createdAt', 'lastSeen']
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const completedCourses = await CourseProgress.findAll({
      where: { userId: user.id, completedAt: { [Op.ne]: null } },
      include: [{ model: Course, as: 'course', attributes: ['id', 'title', 'icon', 'estimatedDuration'] }],
      attributes: ['id', 'completedAt', 'testScore'],
      order: [['completedAt', 'DESC']]
    });

    // isOnline тут же, рядом с lastSeen: иначе профиль показывал бы «был(а) в
    // сети» человеку, который прямо сейчас онлайн (lastSeen у активных
    // обновляется раз в минуту и всегда немного в прошлом).
    res.json({ ...user.toJSON(), isOnline: presence.isOnline(user.id), completedCourses });
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
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

    let { username, password, displayName, email, avatar, phone, position, specialty, misUserId, gender, birthDate, bio, roleId, roleIds, medCenterIds, isAdmin, isActive, twoFactorEnabled, canEditDoctorCards, canEditAnalyses, canEditServices, canAccessSalary, canAccessStatistics, canAccessTopSalary, canManagePromotions, adminAccess } = req.body;

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
      avatar: avatar || null,
      phone: phone || null,
      position: position || null,
      specialty: specialty || null,
      misUserId: misUserId || null,
      gender: gender || null,
      birthDate: birthDate || null,
      bio: bio || null,
      roleId: roleId,
      isAdmin: isAdmin || false,
      isActive: isActive !== false,
      twoFactorEnabled: twoFactorEnabled || false,
      canEditDoctorCards: canEditDoctorCards || false,
      canEditAnalyses: canEditAnalyses || false,
      canEditServices: canEditServices || false,
      canAccessSalary: canAccessSalary || false,
      canAccessStatistics: canAccessStatistics || false,
      canAccessTopSalary: canAccessTopSalary || false,
      canManagePromotions: canManagePromotions || false,
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

    let { username, password, displayName, email, phone, position, specialty, misUserId, gender, birthDate, bio, roleId, roleIds, medCenterIds, isAdmin, isActive, twoFactorEnabled, canEditDoctorCards, canEditAnalyses, canEditServices, canAccessSalary, canAccessStatistics, canAccessTopSalary, canManagePromotions, adminAccess } = req.body;

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

    // Только администраторы могут менять статус суперадминистратора
    if (isAdmin !== undefined && isAdmin !== user.isAdmin && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только администраторы могут изменять статус суперадминистратора' });
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
      ...(phone !== undefined && { phone: phone || null }),
      ...(position !== undefined && { position: position || null }),
      ...(specialty !== undefined && { specialty: specialty || null }),
      ...(misUserId !== undefined && { misUserId: misUserId || null }),
      ...(gender !== undefined && { gender: gender || null }),
      ...(birthDate !== undefined && { birthDate: birthDate || null }),
      ...(bio !== undefined && { bio: bio || null }),
      ...(roleId !== undefined && { roleId: roleId || null }),
      ...(isAdmin !== undefined && { isAdmin }),
      ...(isActive !== undefined && { isActive }),
      ...(twoFactorEnabled !== undefined && { twoFactorEnabled }),
      ...(canEditDoctorCards !== undefined && { canEditDoctorCards }),
      ...(canEditAnalyses !== undefined && { canEditAnalyses }),
      ...(canEditServices !== undefined && { canEditServices }),
      ...(canAccessSalary !== undefined && { canAccessSalary }),
      ...(canAccessStatistics !== undefined && { canAccessStatistics }),
      ...(canAccessTopSalary !== undefined && { canAccessTopSalary }),
      ...(canManagePromotions !== undefined && { canManagePromotions }),
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

// Move user to trash (soft delete)
router.delete('/:id', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя' });
    }

    if (user.deletedAt) {
      return res.status(400).json({ error: 'Пользователь уже в корзине' });
    }

    await user.update({ deletedAt: new Date(), deletedBy: req.user.id, isActive: false });
    res.json({ message: 'Пользователь перемещён в корзину' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

// Restore user from trash
router.post('/:id/restore', authenticate, requireAdminAccess('users'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (!user.deletedAt) {
      return res.status(400).json({ error: 'Пользователь не в корзине' });
    }

    await user.update({ deletedAt: null, deletedBy: null, isActive: true });
    res.json({ message: 'Пользователь восстановлен' });
  } catch (error) {
    console.error('Restore user error:', error);
    res.status(500).json({ error: 'Ошибка восстановления пользователя' });
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
