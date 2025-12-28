const express = require('express');
const { Setting } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all settings
router.get('/', authenticate, async (req, res) => {
  try {
    const settings = await Setting.findAll();
    const result = {};
    settings.forEach(s => { result[s.key] = s.value; });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get single setting
router.get('/:key', authenticate, async (req, res) => {
  try {
    const setting = await Setting.findByPk(req.params.key);
    if (!setting) return res.status(404).json({ error: 'Setting not found' });
    res.json({ key: setting.key, value: setting.value });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// Update setting
router.put('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const { value, description } = req.body;
    
    const [setting, created] = await Setting.upsert({
      key: req.params.key,
      value,
      description
    });

    res.json({ key: req.params.key, value, created });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Bulk update settings
router.post('/bulk', authenticate, requireAdmin, async (req, res) => {
  try {
    const { settings } = req.body; // { key: value, ... }
    
    for (const [key, value] of Object.entries(settings)) {
      await Setting.upsert({ key, value });
    }

    res.json({ message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Delete setting
router.delete('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    await Setting.destroy({ where: { key: req.params.key } });
    res.json({ message: 'Setting deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

// Initialize default settings
router.post('/init', authenticate, requireAdmin, async (req, res) => {
  try {
    const defaults = {
      siteName: { value: 'Alfa Wiki', description: 'Site name' },
      siteDescription: { value: 'Medical knowledge base', description: 'Site description' },
      logo: { value: null, description: 'Logo URL' },
      primaryColor: { value: '#007AFF', description: 'Primary color' },
      accentColor: { value: '#5856D6', description: 'Accent color' },
      defaultRole: { value: null, description: 'Default role for new users' },
      allowRegistration: { value: false, description: 'Allow public registration' },
      maintenanceMode: { value: false, description: 'Maintenance mode' }
    };

    for (const [key, data] of Object.entries(defaults)) {
      const existing = await Setting.findByPk(key);
      if (!existing) {
        await Setting.create({ key, ...data });
      }
    }

    res.json({ message: 'Default settings initialized' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize settings' });
  }
});

module.exports = router;