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

  // Начинаем с оригинальной даты события
  const originalStart = new Date(event.startTime);
  const requestStart = new Date(startDate);
  const requestEnd = new Date(endDate);

  // Конечная дата повторения (максимум 3 года от даты создания события)
  const maxEndDate = new Date(originalStart);
  maxEndDate.setFullYear(maxEndDate.getFullYear() + 3);

  const recurrenceEnd = rule.endDate ? new Date(rule.endDate) : maxEndDate;
  const end = recurrenceEnd < requestEnd ? recurrenceEnd : requestEnd;

  // Если событие ещё не началось, не генерируем экземпляры
  if (originalStart > end) return [];

  const interval = rule.interval || 1;
  let currentDate = new Date(originalStart);

  // Счётчик для предотвращения бесконечных циклов
  let iterationCount = 0;
  const maxIterations = 1000;

  switch (rule.frequency) {
    case 'daily':
      while (currentDate <= end && iterationCount < maxIterations) {
        if (currentDate >= requestStart && currentDate <= end) {
          instances.push(createInstance(event, currentDate, eventDuration));
        }
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + interval);
        iterationCount++;
      }
      break;

    case 'weekly':
      // Для weekly нужны дни недели
      if (!rule.daysOfWeek || rule.daysOfWeek.length === 0) {
        // Если дни не указаны, используем день оригинального события
        const originalDay = originalStart.getDay();
        rule.daysOfWeek = [originalDay === 0 ? 7 : originalDay];
      }

      // Нормализуем дни недели (1-7, где 1=Пн, 7=Вс)
      const normalizedDays = rule.daysOfWeek.map(day => day === 0 ? 7 : day).sort();

      // Начинаем с недели, в которую попадает оригинальное событие
      let weekStart = new Date(originalStart);
      const dayOfWeek = weekStart.getDay() === 0 ? 7 : weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - dayOfWeek + 1); // Понедельник этой недели

      let weekCount = 0;
      while (weekStart <= end && iterationCount < maxIterations) {
        // Проверяем каждый день на этой неделе
        for (const day of normalizedDays) {
          const instanceDate = new Date(weekStart);
          instanceDate.setDate(weekStart.getDate() + day - 1);
          instanceDate.setHours(originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds());

          if (instanceDate >= originalStart && instanceDate >= requestStart && instanceDate <= end) {
            instances.push(createInstance(event, instanceDate, eventDuration));
          }
        }

        // Переходим к следующей неделе с учётом интервала
        weekStart.setDate(weekStart.getDate() + 7 * interval);
        weekCount++;
        iterationCount++;
      }
      break;

    case 'monthly':
      const originalDay = originalStart.getDate();
      while (currentDate <= end && iterationCount < maxIterations) {
        if (currentDate >= requestStart && currentDate <= end) {
          instances.push(createInstance(event, currentDate, eventDuration));
        }
        currentDate = new Date(currentDate);
        currentDate.setMonth(currentDate.getMonth() + interval);

        // Корректировка для случаев типа 31 января -> февраль
        // Если день месяца изменился (например, 31->28), восстанавливаем оригинальный день
        if (currentDate.getDate() !== originalDay) {
          currentDate.setDate(0); // Последний день предыдущего месяца
        }
        iterationCount++;
      }
      break;

    case 'yearly':
      while (currentDate <= end && iterationCount < maxIterations) {
        if (currentDate >= requestStart && currentDate <= end) {
          instances.push(createInstance(event, currentDate, eventDuration));
        }
        currentDate = new Date(currentDate);
        currentDate.setFullYear(currentDate.getFullYear() + interval);
        iterationCount++;
      }
      break;
  }

  return instances;
}

// Вспомогательная функция для создания экземпляра события
function createInstance(event, instanceDate, eventDuration) {
  const instanceStart = new Date(instanceDate);
  const instanceEnd = new Date(instanceStart.getTime() + eventDuration);

  return {
    ...event.toJSON(),
    id: `${event.id}-${instanceStart.toISOString()}`,
    startTime: instanceStart,
    endTime: instanceEnd,
    isInstance: true,
    instanceDate: instanceStart.toISOString(),
    parentEventId: event.id
  };
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
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Для обычных событий: события должны пересекаться с запрошенным периодом
      // Для повторяющихся событий: событие должно начаться до конца периода
      // И период повторения должен пересекаться с запрошенным периодом
      where[Op.and] = [
        {
          [Op.or]: [
            // Обычные события: стандартная проверка пересечения
            {
              [Op.and]: [
                { isRecurring: { [Op.or]: [false, null] } },
                { startTime: { [Op.lte]: endDate } },
                { endTime: { [Op.gte]: startDate } }
              ]
            },
            // Повторяющиеся события: проверяем, что событие началось и период повторения активен
            {
              [Op.and]: [
                { isRecurring: true },
                { startTime: { [Op.lte]: endDate } }, // Событие должно было начаться
                {
                  [Op.or]: [
                    // Нет даты окончания повторения (или она в будущем)
                    {
                      [Op.or]: [
                        { 'recurrenceRule.endDate': { [Op.is]: null } },
                        { 'recurrenceRule.endDate': { [Op.gte]: startDate } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
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

    // ✅ ДОБАВЛЕНО: Интегрированные события (аккредитации и ТО)
    // Аккредитации
    if (Accreditation) {
      try {
        const accreditations = await Accreditation.findAll({
          where: {
            expirationDate: {
              [Op.gte]: new Date(start),
              [Op.lte]: new Date(end)
            }
          }
        });

        accreditations.forEach(accr => {
          const dateKey = new Date(accr.expirationDate).toISOString().split('T')[0];
          if (!indicators[dateKey]) {
            indicators[dateKey] = [];
          }
          indicators[dateKey].push({ color: '#ef4444' }); // Красный цвет для аккредитаций
        });
      } catch (error) {
        console.error('Failed to load accreditations for indicators:', error);
      }
    }

    // ТО транспорта
    if (Vehicle) {
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
          const dateKey = new Date(vehicle.insuranceDate).toISOString().split('T')[0];
          if (!indicators[dateKey]) {
            indicators[dateKey] = [];
          }
          indicators[dateKey].push({ color: '#f59e0b' }); // Оранжевый цвет для ТО
        });
      } catch (error) {
        console.error('Failed to load vehicles for indicators:', error);
      }
    }

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
    // (участники и sharedWith пользователи могут только просматривать и удалять)
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

    // Проверка прав на удаление:
    // 1. Создатель события
    // 2. Пользователь в списке sharedWith
    // 3. Пользователь в списке participants
    // 4. Администратор
    const isCreator = event.createdBy === req.user.id;
    const isSharedWith = event.sharedWith && event.sharedWith.includes(req.user.id);
    const isParticipant = event.participants && event.participants.some(p => {
      const userId = typeof p === 'string' ? p : p.userId;
      return userId === req.user.id;
    });
    const isAdmin = req.user.isAdmin;

    const canDelete = isCreator || isSharedWith || isParticipant || isAdmin;

    if (!canDelete) {
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
// CALENDAR SETTINGS
// ═══════════════════════════════════════════════════════════════

// Получить настройки календаря пользователя
router.get('/settings', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['settings']
    });

    const calendarSettings = user?.settings?.calendar || {
      showAccreditations: false,
      showVehicles: false
    };

    res.json(calendarSettings);
  } catch (error) {
    console.error('Get calendar settings error:', error);
    res.status(500).json({ error: 'Failed to get calendar settings' });
  }
});

// Обновить настройки календаря пользователя
router.put('/settings', authenticate, async (req, res) => {
  try {
    const { showAccreditations, showVehicles } = req.body;

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const settings = user.settings || {};
    settings.calendar = {
      showAccreditations: !!showAccreditations,
      showVehicles: !!showVehicles
    };

    await user.update({ settings });

    res.json(settings.calendar);
  } catch (error) {
    console.error('Update calendar settings error:', error);
    res.status(500).json({ error: 'Failed to update calendar settings' });
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