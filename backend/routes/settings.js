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
    console.error('Get settings error:', error);
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
    console.error('Get setting error:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// Update setting
router.put('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const { value, description } = req.body;
    
    // Используем findOrCreate + update вместо upsert для надёжности
    let setting = await Setting.findByPk(req.params.key);
    
    if (setting) {
      await setting.update({ value, ...(description && { description }) });
    } else {
      setting = await Setting.create({
        key: req.params.key,
        value,
        description
      });
    }

    res.json({ key: req.params.key, value, created: !setting });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Bulk update settings
router.post('/bulk', authenticate, requireAdmin, async (req, res) => {
  try {
    // Поддержка обоих форматов: { settings: {...} } или просто {...}
    const settings = req.body.settings || req.body;
    
    console.log('Bulk update received:', JSON.stringify(settings, null, 2));
    
    if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
      return res.status(400).json({ error: 'Settings object is required' });
    }
    
    for (const [key, value] of Object.entries(settings)) {
      try {
        // Используем findOrCreate + update вместо upsert
        let setting = await Setting.findByPk(key);
        
        if (setting) {
          await setting.update({ value });
        } else {
          await Setting.create({ key, value });
        }
        
        console.log(`Setting "${key}" updated to:`, value);
      } catch (err) {
        console.error(`Error updating setting "${key}":`, err.message);
        throw err;
      }
    }

    res.json({ message: 'Settings updated' });
  } catch (error) {
    console.error('Bulk settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings', details: error.message });
  }
});

// Delete setting
router.delete('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    await Setting.destroy({ where: { key: req.params.key } });
    res.json({ message: 'Setting deleted' });
  } catch (error) {
    console.error('Delete setting error:', error);
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
    console.error('Init settings error:', error);
    res.status(500).json({ error: 'Failed to initialize settings' });
  }
});

module.exports = router;