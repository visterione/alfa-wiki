const express = require('express');
const { body, validationResult } = require('express-validator');
const { Role, User } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all roles with user count
router.get('/', authenticate, async (req, res) => {
  try {
    const roles = await Role.findAll({
      include: [{ 
        model: User, 
        as: 'users', 
        attributes: ['id'] 
      }],
      order: [['name', 'ASC']]
    });
    res.json(roles);
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Get single role with users
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id, {
      include: [{ model: User, as: 'users', attributes: ['id', 'username', 'displayName'] }]
    });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json(role);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// Create role
router.post('/', authenticate, requireAdmin, [
  body('name').trim().notEmpty().withMessage('Role name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, permissions } = req.body;

    const existing = await Role.findOne({ where: { name } });
    if (existing) {
      return res.status(400).json({ error: 'Role name already exists' });
    }

    const defaultPermissions = {
      pages: { read: true, write: false, delete: false, admin: false },
      media: { read: true, upload: false, delete: false },
      users: { read: false, write: false, delete: false },
      settings: { read: false, write: false }
    };

    const role = await Role.create({
      name,
      description,
      permissions: permissions || defaultPermissions
    });

    res.status(201).json(role);
  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// Update role
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    if (role.isSystem) {
      return res.status(400).json({ error: 'Cannot modify system role' });
    }

    const { name, description, permissions } = req.body;

    // Check name uniqueness
    if (name && name !== role.name) {
      const existing = await Role.findOne({ where: { name } });
      if (existing) return res.status(400).json({ error: 'Role name already exists' });
    }

    await role.update({
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(permissions && { permissions })
    });

    res.json(role);
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Delete role
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    if (role.isSystem) {
      return res.status(400).json({ error: 'Cannot delete system role' });
    }

    // Check if users are assigned to this role
    const usersCount = await User.count({ where: { roleId: role.id } });
    if (usersCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete role with ${usersCount} assigned users` 
      });
    }

    await role.destroy();
    res.json({ message: 'Role deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

module.exports = router;