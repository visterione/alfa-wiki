const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { Accreditation } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Получить все аккредитации с фильтрацией
router.get('/', authenticate, async (req, res) => {
  try {
    const { medCenter, fullName, specialty, search, sortBy = 'expirationDate', sortOrder = 'ASC' } = req.query;
    
    const where = {};
    
    if (medCenter) where.medCenter = medCenter;
    if (specialty) where.specialty = specialty;
    if (fullName) where.fullName = { [Op.iLike]: `%${fullName}%` };
    if (search) {
      where[Op.or] = [
        { fullName: { [Op.iLike]: `%${search}%` } },
        { specialty: { [Op.iLike]: `%${search}%` } },
        { comment: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const order = [[sortBy, sortOrder.toUpperCase()]];

    const accreditations = await Accreditation.findAll({ where, order });
    res.json(accreditations);
  } catch (error) {
    console.error('Get accreditations error:', error);
    res.status(500).json({ error: 'Failed to fetch accreditations' });
  }
});

// Получить уникальные специальности для выпадающего списка
router.get('/specialties', authenticate, async (req, res) => {
  try {
    const result = await Accreditation.findAll({
      attributes: ['specialty'],
      group: ['specialty'],
      order: [['specialty', 'ASC']]
    });
    res.json(result.map(r => r.specialty));
  } catch (error) {
    console.error('Get specialties error:', error);
    res.status(500).json({ error: 'Failed to fetch specialties' });
  }
});

// Статистика по аккредитациям
router.get('/stats', authenticate, async (req, res) => {
  try {
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    const [total, expired, expiringSoon, expiringIn90] = await Promise.all([
      Accreditation.count(),
      Accreditation.count({ where: { expirationDate: { [Op.lt]: today } } }),
      Accreditation.count({ where: { expirationDate: { [Op.between]: [today, in30Days] } } }),
      Accreditation.count({ where: { expirationDate: { [Op.between]: [today, in90Days] } } })
    ]);

    res.json({ total, expired, expiringSoon, expiringIn90 });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Создать аккредитацию
router.post('/', authenticate, [
  body('medCenter').isIn(['Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К']),
  body('fullName').trim().notEmpty(),
  body('specialty').trim().notEmpty(),
  body('expirationDate').isDate()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { medCenter, fullName, specialty, expirationDate, comment } = req.body;
    
    const accreditation = await Accreditation.create({
      medCenter, fullName, specialty, expirationDate, comment
    });

    res.status(201).json(accreditation);
  } catch (error) {
    console.error('Create accreditation error:', error);
    res.status(500).json({ error: 'Failed to create accreditation' });
  }
});

// Обновить аккредитацию
router.put('/:id', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    const { medCenter, fullName, specialty, expirationDate, comment } = req.body;
    
    // При изменении даты сбрасываем флаги напоминаний
    const updateData = { medCenter, fullName, specialty, comment };
    if (expirationDate && expirationDate !== accreditation.expirationDate) {
      updateData.expirationDate = expirationDate;
      updateData.reminded90 = false;
      updateData.reminded60 = false;
      updateData.reminded30 = false;
      updateData.reminded14 = false;
      updateData.reminded7 = false;
    }

    await accreditation.update(updateData);
    res.json(accreditation);
  } catch (error) {
    console.error('Update accreditation error:', error);
    res.status(500).json({ error: 'Failed to update accreditation' });
  }
});

// Удалить аккредитацию
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    await accreditation.destroy();
    res.json({ message: 'Accreditation deleted' });
  } catch (error) {
    console.error('Delete accreditation error:', error);
    res.status(500).json({ error: 'Failed to delete accreditation' });
  }
});

module.exports = router;