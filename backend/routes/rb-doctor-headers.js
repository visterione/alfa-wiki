const express = require('express');
const router  = express.Router();
const { RbDoctorHeader } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/rb-doctor-headers — list all (used for tabeel generation)
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await RbDoctorHeader.findAll();
    res.json(rows);
  } catch (err) {
    console.error('GET rb-doctor-headers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/rb-doctor-headers/:misUserId — upsert tabelNumber
router.put('/:misUserId', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.params;
    const { tabelNumber } = req.body;
    const [row] = await RbDoctorHeader.upsert(
      { misUserId, tabelNumber: tabelNumber?.trim() || null },
      { returning: true }
    );
    res.json(row);
  } catch (err) {
    console.error('PUT rb-doctor-headers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
