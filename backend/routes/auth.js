const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User, Role } = require('../models');
const { authenticate } = require('../middleware/auth');
const { generateCode, send2FACode } = require('../services/emailService');

const router = express.Router();

// Временное хранилище кодов в памяти (для обхода проблем с timezone)
const twoFactorCodes = new Map();

// Login (Step 1: проверка логина/пароля)
router.post('/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    const user = await User.findOne({
      where: { username },
      include: [{ model: Role, as: 'role' }]
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Проверяем, включена ли 2FA для пользователя
    if (user.twoFactorEnabled) {
      // Проверяем наличие email
      if (!user.email) {
        return res.status(400).json({ 
          error: 'Two-factor authentication is enabled but no email is configured. Please contact administrator.' 
        });
      }

      // Генерируем код
      const code = generateCode();
      // Время истечения: текущее время + 15 минут
      const expiresAt = Date.now() + 15 * 60 * 1000; // Храним как timestamp

      console.log('🔐 Generating 2FA code for user:', username);
      console.log('Code:', code);
      console.log('Expires at:', new Date(expiresAt).toISOString());
      console.log('Current time:', new Date().toISOString());

      // Сохраняем код в памяти
      twoFactorCodes.set(user.id, {
        code,
        expiresAt,
        attempts: 0,
        createdAt: Date.now()
      });

      // Также сохраняем в БД для совместимости (но не используем для проверки времени)
      await user.update({
        twoFactorCode: code,
        twoFactorAttempts: 0
      });

      // Отправляем код на email
      try {
        await send2FACode(user.email, code, user.displayName || user.username);
      } catch (emailError) {
        console.error('Failed to send 2FA code:', emailError);
        // Очищаем код при ошибке отправки
        twoFactorCodes.delete(user.id);
        return res.status(500).json({ 
          error: 'Failed to send verification code. Please try again or contact administrator.' 
        });
      }

      // Возвращаем специальный ответ, что требуется 2FA
      return res.json({
        requiresTwoFactor: true,
        userId: user.id,
        message: 'Verification code sent to your email'
      });
    }

    // Если 2FA не включена - обычная авторизация
    await user.update({ lastLogin: new Date() });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const userData = user.toJSON();
    delete userData.password;
    delete userData.twoFactorCode;
    delete userData.twoFactorCodeExpires;

    res.json({
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify 2FA Code (Step 2: проверка кода)
router.post('/verify-2fa', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, code } = req.body;

    const user = await User.findByPk(userId, {
      include: [{ model: Role, as: 'role' }]
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('🔍 Verifying 2FA code for user:', user.username);

    // Получаем код из памяти
    const codeData = twoFactorCodes.get(user.id);

    if (!codeData) {
      console.log('❌ No code found in memory');
      return res.status(400).json({ 
        error: 'Verification code has expired. Please login again.' 
      });
    }

    console.log('Stored code:', codeData.code);
    console.log('Provided code:', code);
    console.log('Code expires at:', new Date(codeData.expiresAt).toISOString());
    console.log('Current time:', new Date().toISOString());
    console.log('Attempts:', codeData.attempts);

    // Проверяем количество попыток
    if (codeData.attempts >= 5) {
      console.log('❌ Too many attempts');
      twoFactorCodes.delete(user.id);
      await user.update({
        twoFactorCode: null,
        twoFactorAttempts: 0
      });
      return res.status(429).json({ 
        error: 'Too many attempts. Please login again.' 
      });
    }

    // Проверяем истечение кода
    const now = Date.now();
    
    if (now > codeData.expiresAt) {
      console.log('❌ Code expired');
      console.log('Time difference (seconds):', (now - codeData.expiresAt) / 1000);
      twoFactorCodes.delete(user.id);
      await user.update({
        twoFactorCode: null,
        twoFactorAttempts: 0
      });
      return res.status(400).json({ 
        error: 'Verification code has expired. Please login again.' 
      });
    }

    // Проверяем код
    if (codeData.code !== code) {
      console.log('❌ Invalid code');
      codeData.attempts += 1;
      twoFactorCodes.set(user.id, codeData);
      
      await user.update({
        twoFactorAttempts: codeData.attempts
      });
      
      return res.status(401).json({ 
        error: 'Invalid verification code',
        attemptsLeft: 5 - codeData.attempts
      });
    }

    console.log('✅ Code verified successfully');

    // Код верный - очищаем данные 2FA
    twoFactorCodes.delete(user.id);
    await user.update({
      twoFactorCode: null,
      twoFactorAttempts: 0,
      lastLogin: new Date()
    });

    // Генерируем токен
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const userData = user.toJSON();
    delete userData.password;
    delete userData.twoFactorCode;
    delete userData.twoFactorCodeExpires;

    res.json({
      token,
      user: userData
    });
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Resend 2FA Code
router.post('/resend-2fa', [
  body('userId').notEmpty().withMessage('User ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.body;

    const user = await User.findByPk(userId);

    if (!user || !user.twoFactorEnabled || !user.email) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Генерируем новый код
    const code = generateCode();
    const expiresAt = Date.now() + 15 * 60 * 1000;

    console.log('🔄 Resending 2FA code for user:', user.username);
    console.log('New code:', code);
    console.log('Expires at:', new Date(expiresAt).toISOString());

    // Сохраняем код в памяти
    twoFactorCodes.set(user.id, {
      code,
      expiresAt,
      attempts: 0,
      createdAt: Date.now()
    });

    await user.update({
      twoFactorCode: code,
      twoFactorAttempts: 0
    });

    // Отправляем новый код
    try {
      await send2FACode(user.email, code, user.displayName || user.username);
      res.json({ message: 'New verification code sent' });
    } catch (emailError) {
      console.error('Failed to resend 2FA code:', emailError);
      twoFactorCodes.delete(user.id);
      res.status(500).json({ error: 'Failed to send verification code' });
    }
  } catch (error) {
    console.error('Resend 2FA error:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Очистка старых кодов каждые 5 минут
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [userId, codeData] of twoFactorCodes.entries()) {
    // Удаляем коды старше 20 минут
    if (now - codeData.createdAt > 20 * 60 * 1000) {
      twoFactorCodes.delete(userId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired 2FA codes from memory`);
  }
}, 5 * 60 * 1000);

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// Change password
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findByPk(req.user.id);
    const isValid = await bcrypt.compare(currentPassword, user.password);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await user.update({ password: hashedPassword });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Update profile
router.put('/profile', authenticate, [
  body('displayName').optional().trim(),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('avatar').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { displayName, email, avatar, settings } = req.body;
    
    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (email !== undefined) updateData.email = email;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (settings !== undefined) updateData.settings = settings;

    await req.user.update(updateData);

    const updatedUser = await User.findByPk(req.user.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password', 'twoFactorCode', 'twoFactorCodeExpires'] }
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Verify token
router.get('/verify', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;