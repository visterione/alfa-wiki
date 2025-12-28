const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { User, Role } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all users (admin only)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password'] },
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
      attributes: { exclude: ['password'] }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create user
router.post('/', authenticate, requireAdmin, [
  body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('roleId').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Invalid role ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, displayName, email, roleId, isAdmin, isActive } = req.body;

    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      username,
      password: hashedPassword,
      displayName: displayName || username,
      email,
      roleId,
      isAdmin: isAdmin || false,
      isActive: isActive !== false
    });

    const created = await User.findByPk(user.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password'] }
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { username, password, displayName, email, roleId, isAdmin, isActive } = req.body;

    // Check username uniqueness
    if (username && username !== user.username) {
      const existing = await User.findOne({ where: { username } });
      if (existing) return res.status(400).json({ error: 'Username already exists' });
    }

    const updateData = {
      ...(username && { username }),
      ...(displayName !== undefined && { displayName }),
      ...(email !== undefined && { email }),
      ...(roleId !== undefined && { roleId }),
      ...(isAdmin !== undefined && { isAdmin }),
      ...(isActive !== undefined && { isActive })
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    await user.update(updateData);

    const updated = await User.findByPk(user.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password'] }
    });

    res.json(updated);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent self-deletion
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    await user.destroy();
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;