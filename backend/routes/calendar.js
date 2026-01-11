const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { Op } = require('sequelize');

// Импортируем модели безопасно
let CalendarEvent, User, Accreditation, Vehicle;
try {
  const models = require('../models');
  CalendarEvent = models.CalendarEvent;
  User = models.User;
  Accreditation = models.Accreditation;
  Vehicle = models.Vehicle;
} catch (error) {
  console.error('Failed to import models:', error);
}

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// Проверка прав доступа к событию
function canAccessEvent(event, userId, isAdmin) {
  if (isAdmin) return true;
  if (event.createdBy === userId) return true;
  if (event.visibility === 'public') return true;
  if (event.visibility === 'shared' && event.sharedWith.includes(userId)) return true;
  return false;
}

// Генерация экземпляров повторяющегося события
function generateRecurringInstances(event, startDate, endDate) {
  if (!event.isRecurring || !event.recurrenceRule) return [];
  
  const instances = [];
  const rule = event.recurrenceRule;
  const eventDuration = new Date(event.endTime) - new Date(event.startTime);
  
  let currentDate = new Date(Math.max(new Date(event.startTime), new Date(startDate)));
  const end = new Date(Math.min(
    rule.endDate ? new Date(rule.endDate) : new Date('2099-12-31'),
    new Date(endDate)
  ));

  while (currentDate <= end) {
    let shouldInclude = false;

    switch (rule.frequency) {
      case 'daily':
        shouldInclude = true;
        currentDate.setDate(currentDate.getDate() + (rule.interval || 1));
        break;
      
      case 'weekly':
        if (rule.daysOfWeek && rule.daysOfWeek.includes(currentDate.getDay())) {
          shouldInclude = true;
        }
        currentDate.setDate(currentDate.getDate() + 1);
        break;
      
      case 'monthly':
        shouldInclude = true;
        currentDate.setMonth(currentDate.getMonth() + (rule.interval || 1));
        break;
      
      case 'yearly':
        shouldInclude = true;
        currentDate.setFullYear(currentDate.getFullYear() + (rule.interval || 1));
        break;
    }

    if (shouldInclude && currentDate >= new Date(startDate) && currentDate <= end) {
      instances.push({
        ...event.toJSON(),
        id: `${event.id}-${currentDate.toISOString()}`,
        startTime: new Date(currentDate),
        endTime: new Date(currentDate.getTime() + eventDuration),
        isInstance: true,
        instanceDate: currentDate.toISOString()
      });
    }
  }

  return instances;
}

// ═══════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════

// Получить события за период
router.get('/events', authenticate, async (req, res) => {
  try {
    if (!CalendarEvent) {
      return res.status(500).json({ error: 'CalendarEvent model not available' });
    }

    const { start, end, types, statuses, priorities, visibility } = req.query;
    
    const where = {
      [Op.or]: [
        { createdBy: req.user.id },
        { visibility: 'public' },
        {
          visibility: 'shared',
          sharedWith: { [Op.contains]: [req.user.id] }
        }
      ]
    };

    // Фильтр по времени
    if (start && end) {
      where[Op.and] = [
        { startTime: { [Op.lte]: new Date(end) } },
        { endTime: { [Op.gte]: new Date(start) } }
      ];
    }

    // Фильтр по типам
    if (types) {
      where.eventType = { [Op.in]: types.split(',') };
    }

    // Фильтр по статусам
    if (statuses) {
      where.status = { [Op.in]: statuses.split(',') };
    }

    // Фильтр по приоритетам
    if (priorities) {
      where.priority = { [Op.in]: priorities.split(',') };
    }

    // Фильтр по видимости
    if (visibility) {
      where.visibility = visibility;
    }

    const includeUser = User ? [
      { 
        model: User, 
        as: 'creator', 
        attributes: ['id', 'displayName', 'username', 'avatar'],
        required: false
      }
    ] : [];

    const events = await CalendarEvent.findAll({
      where,
      include: includeUser,
      order: [['startTime', 'ASC']]
    });

    // Генерируем экземпляры повторяющихся событий
    let allEvents = [...events];
    
    if (start && end) {
      const recurringEvents = events.filter(e => e.isRecurring);
      recurringEvents.forEach(event => {
        const instances = generateRecurringInstances(event, start, end);
        allEvents = allEvents.concat(instances);
      });
      
      // Убираем оригинальные повторяющиеся события из списка
      allEvents = allEvents.filter(e => !e.isRecurring || e.isInstance);
    }

    res.json(allEvents);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Failed to fetch events', details: error.message });
  }
});

// Получить индикаторы событий для календаря (количество событий по дням)
router.get('/event-indicators', authenticate, async (req, res) => {
  try {
    if (!CalendarEvent) {
      return res.json({});
    }

    const { start, end } = req.query;
    
    const events = await CalendarEvent.findAll({
      where: {
        [Op.or]: [
          { createdBy: req.user.id },
          { visibility: 'public' },
          {
            visibility: 'shared',
            sharedWith: { [Op.contains]: [req.user.id] }
          }
        ],
        startTime: { [Op.gte]: new Date(start) },
        endTime: { [Op.lte]: new Date(end) }
      },
      // ✅ ДОБАВЛЕНО: Получаем цвет события
      attributes: ['id', 'startTime', 'color', 'isRecurring', 'recurrenceRule']
    });

    // ✅ ИЗМЕНЕНО: Теперь возвращаем массивы с цветами вместо количества
    const indicators = {};
    
    events.forEach(event => {
      if (event.isRecurring) {
        const instances = generateRecurringInstances(event, start, end);
        instances.forEach(instance => {
          const dateKey = instance.startTime.toISOString().split('T')[0];
          if (!indicators[dateKey]) {
            indicators[dateKey] = [];
          }
          indicators[dateKey].push({ color: event.color || '#4a90e2' });
        });
      } else {
        const dateKey = new Date(event.startTime).toISOString().split('T')[0];
        if (!indicators[dateKey]) {
          indicators[dateKey] = [];
        }
        indicators[dateKey].push({ color: event.color || '#4a90e2' });
      }
    });

    res.json(indicators);
  } catch (error) {
    console.error('Get event indicators error:', error);
    res.status(500).json({ error: 'Failed to fetch event indicators', details: error.message });
  }
});

// Получить одно событие
router.get('/events/:id', authenticate, async (req, res) => {
  try {
    if (!CalendarEvent) {
      return res.status(500).json({ error: 'CalendarEvent model not available' });
    }

    const includeUser = User ? [
      { 
        model: User, 
        as: 'creator', 
        attributes: ['id', 'displayName', 'username', 'avatar'],
        required: false
      }
    ] : [];

    const event = await CalendarEvent.findByPk(req.params.id, {
      include: includeUser
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!canAccessEvent(event, req.user.id, req.user.isAdmin)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(event);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to fetch event', details: error.message });
  }
});

// Создать событие
router.post('/events', 
  authenticate,
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('startTime').isISO8601().withMessage('Valid start time is required'),
    body('endTime').isISO8601().withMessage('Valid end time is required'),
    body('eventType').optional().isIn([
      'personal', 'meeting', 'deadline', 'reminder', 
      'accreditation', 'vehicle_service', 'doctor_schedule'
    ])
  ],
  async (req, res) => {
    try {
      if (!CalendarEvent) {
        return res.status(500).json({ error: 'CalendarEvent model not available' });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        title, description, startTime, endTime, allDay,
        eventType, priority, status, color, location,
        isRecurring, recurrenceRule, participants, reminders,
        linkedEntityType, linkedEntityId, visibility, sharedWith
      } = req.body;

      // Проверка времени
      if (new Date(endTime) <= new Date(startTime)) {
        return res.status(400).json({ error: 'End time must be after start time' });
      }

      const event = await CalendarEvent.create({
        title,
        description,
        startTime,
        endTime,
        allDay: allDay || false,
        eventType: eventType || 'personal',
        priority: priority || 'medium',
        status: status || 'planned',
        color: color || '#4a90e2',
        location,
        isRecurring: isRecurring || false,
        recurrenceRule: isRecurring ? recurrenceRule : null,
        participants: participants || [],
        reminders: reminders || [],
        linkedEntityType,
        linkedEntityId,
        createdBy: req.user.id,
        visibility: visibility || 'private',
        sharedWith: sharedWith || []
      });

      const includeUser = User ? [
        { 
          model: User, 
          as: 'creator', 
          attributes: ['id', 'displayName', 'username', 'avatar'],
          required: false
        }
      ] : [];

      const created = await CalendarEvent.findByPk(event.id, {
        include: includeUser
      });

      res.status(201).json(created);
    } catch (error) {
      console.error('Create event error:', error);
      res.status(500).json({ error: 'Failed to create event', details: error.message });
    }
  }
);

// Обновить событие
router.put('/events/:id', authenticate, async (req, res) => {
  try {
    if (!CalendarEvent) {
      return res.status(500).json({ error: 'CalendarEvent model not available' });
    }

    const event = await CalendarEvent.findByPk(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Только создатель или админ может редактировать
    if (event.createdBy !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const {
      title, description, startTime, endTime, allDay,
      eventType, priority, status, color, location,
      isRecurring, recurrenceRule, participants, reminders,
      linkedEntityType, linkedEntityId, visibility, sharedWith
    } = req.body;

    // Проверка времени если обновляется
    if (startTime && endTime && new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    await event.update({
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
      ...(allDay !== undefined && { allDay }),
      ...(eventType !== undefined && { eventType }),
      ...(priority !== undefined && { priority }),
      ...(status !== undefined && { status }),
      ...(color !== undefined && { color }),
      ...(location !== undefined && { location }),
      ...(isRecurring !== undefined && { isRecurring }),
      ...(recurrenceRule !== undefined && { recurrenceRule }),
      ...(participants !== undefined && { participants }),
      ...(reminders !== undefined && { reminders }),
      ...(linkedEntityType !== undefined && { linkedEntityType }),
      ...(linkedEntityId !== undefined && { linkedEntityId }),
      ...(visibility !== undefined && { visibility }),
      ...(sharedWith !== undefined && { sharedWith })
    });

    const includeUser = User ? [
      { 
        model: User, 
        as: 'creator', 
        attributes: ['id', 'displayName', 'username', 'avatar'],
        required: false
      }
    ] : [];

    const updated = await CalendarEvent.findByPk(event.id, {
      include: includeUser
    });

    res.json(updated);
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Failed to update event', details: error.message });
  }
});

// Удалить событие
router.delete('/events/:id', authenticate, async (req, res) => {
  try {
    if (!CalendarEvent) {
      return res.status(500).json({ error: 'CalendarEvent model not available' });
    }

    const event = await CalendarEvent.findByPk(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Только создатель или админ может удалять
    if (event.createdBy !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await event.destroy();

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event', details: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION WITH EXISTING DATA
// ═══════════════════════════════════════════════════════════════

// Получить интегрированные события (аккредитации, ТО)
router.get('/integrated-events', authenticate, async (req, res) => {
  try {
    const { start, end, types } = req.query;
    const requestedTypes = types ? types.split(',') : ['accreditation', 'vehicle'];
    const events = [];

    // Аккредитации
    if (requestedTypes.includes('accreditation') && Accreditation) {
      try {
        const accreditations = await Accreditation.findAll({
          where: {
            expirationDate: { // Исправлено: expirationDate вместо expiryDate
              [Op.gte]: new Date(start),
              [Op.lte]: new Date(end)
            }
          }
        });

        accreditations.forEach(accr => {
          const expiryDate = new Date(accr.expirationDate); // Исправлено
          events.push({
            id: `accr-${accr.id}`,
            title: `Аккредитация: ${accr.fullName}`,
            description: `Специальность: ${accr.specialty}`,
            startTime: new Date(expiryDate.setHours(9, 0, 0)),
            endTime: new Date(expiryDate.setHours(18, 0, 0)),
            allDay: true,
            eventType: 'accreditation',
            priority: 'high',
            color: '#ef4444',
            linkedEntityType: 'accreditation',
            linkedEntityId: accr.id,
            isIntegrated: true
          });
        });
      } catch (error) {
        console.error('Failed to load accreditations:', error);
      }
    }

    // ТО транспорта
    if (requestedTypes.includes('vehicle') && Vehicle) {
      try {
        const vehicles = await Vehicle.findAll({
          where: {
            insuranceDate: {
              [Op.gte]: new Date(start),
              [Op.lte]: new Date(end)
            }
          }
        });

        vehicles.forEach(vehicle => {
          const insuranceDate = new Date(vehicle.insuranceDate);
          events.push({
            id: `vehicle-${vehicle.id}`,
            title: `ТО: ${vehicle.carBrand} ${vehicle.licensePlate}`,
            description: `Организация: ${vehicle.organization}`,
            startTime: insuranceDate,
            endTime: insuranceDate,
            allDay: true,
            eventType: 'vehicle_service',
            priority: 'medium',
            color: '#f59e0b',
            linkedEntityType: 'vehicle',
            linkedEntityId: vehicle.id,
            isIntegrated: true
          });
        });
      } catch (error) {
        console.error('Failed to load vehicles:', error);
      }
    }

    res.json(events);
  } catch (error) {
    console.error('Get integrated events error:', error);
    res.status(500).json({ error: 'Failed to fetch integrated events', details: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// UPCOMING EVENTS
// ═══════════════════════════════════════════════════════════════

// Получить предстоящие события
router.get('/upcoming', authenticate, async (req, res) => {
  try {
    if (!CalendarEvent) {
      return res.json([]);
    }

    const { days = 7 } = req.query;
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));

    const includeUser = User ? [
      { 
        model: User, 
        as: 'creator', 
        attributes: ['id', 'displayName', 'username', 'avatar'],
        required: false
      }
    ] : [];

    const events = await CalendarEvent.findAll({
      where: {
        [Op.or]: [
          { createdBy: req.user.id },
          { visibility: 'public' },
          {
            visibility: 'shared',
            sharedWith: { [Op.contains]: [req.user.id] }
          }
        ],
        startTime: {
          [Op.gte]: now,
          [Op.lte]: futureDate
        },
        status: { [Op.ne]: 'cancelled' }
      },
      include: includeUser,
      order: [['startTime', 'ASC']],
      limit: 20
    });

    res.json(events);
  } catch (error) {
    console.error('Get upcoming events error:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming events', details: error.message });
  }
});

module.exports = router;