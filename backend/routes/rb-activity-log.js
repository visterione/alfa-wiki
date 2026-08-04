const express = require('express');
const router  = express.Router();
const { RbActivityLog, User } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { Op } = require('sequelize');
const { TAB_LABELS, ACTION_LABELS } = require('../services/rbLogger');
const { canSeeAup, AUP_CLINIC_ID } = require('../services/aupFilter');
const { parsePagination } = require('../utils/pagination');

function serializeLog(record, seeAup) {
  const row = {
    ...record.toJSON(),
    tabLabel: TAB_LABELS[record.tab] || record.tab,
    actionLabel: ACTION_LABELS[record.action] || record.action,
  };

  // Защитно: не показываем изменения по клинике АУП пользователям без флага.
  if (!seeAup && row.diff && Array.isArray(row.diff.changes)) {
    row.diff = {
      ...row.diff,
      changes: row.diff.changes.filter(c => String(c.clinicId) !== AUP_CLINIC_ID),
    };
  }

  return row;
}

// GET /api/rb-activity-log
router.get('/', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    // Default remains backward-compatible for older clients. Updated clients
    // explicitly opt out and load the heavy field from /:id only when needed.
    const includeDiff = req.query.includeDiff !== 'false';
    const {
      tab,
      userId,
      misUserId,
      doctorName,
      dateFrom,
      dateTo,
    } = req.query;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });

    const where = {};

    if (tab)        where.tab       = tab;
    if (userId)     where.userId    = userId;
    if (misUserId)  where.misUserId = misUserId;
    if (doctorName) where.doctorName = { [Op.iLike]: `%${doctorName}%` };

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo)   where.createdAt[Op.lte] = new Date(dateTo + 'T23:59:59.999Z');
    }

    const { count, rows } = await RbActivityLog.findAndCountAll({
      where,
      ...(includeDiff ? {} : { attributes: { exclude: ['diff'] } }),
      include: [{
        model: User,
        as:    'user',
        attributes: ['id', 'displayName', 'username', 'avatar'],
      }],
      order:  [['created_at', 'DESC']],
      limit,
      offset,
    });

    const seeAup = canSeeAup(req.user);
    const result = rows.map(r => serializeLog(r, seeAup));

    res.json({ count, rows: result });
  } catch (err) {
    console.error('GET /api/rb-activity-log error:', err);
    res.status(500).json({ error: 'Ошибка получения журнала' });
  }
});

// GET /api/rb-activity-log/tabs — список вкладок с количеством записей
router.get('/tabs', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const { QueryTypes } = require('sequelize');

    const rows = await sequelize.query(`
      SELECT tab, COUNT(*)::int AS cnt
      FROM rb_activity_log
      GROUP BY tab
      ORDER BY cnt DESC
    `, { type: QueryTypes.SELECT });

    res.json(rows.map(r => ({ tab: r.tab, label: TAB_LABELS[r.tab] || r.tab, count: r.cnt })));
  } catch (err) {
    console.error('GET /api/rb-activity-log/tabs error:', err);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// GET /api/rb-activity-log/users — пользователи с записями в логе
router.get('/users', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const { QueryTypes } = require('sequelize');

    const rows = await sequelize.query(`
      SELECT DISTINCT u.id, u."displayName", u.username
      FROM rb_activity_log l
      JOIN users u ON u.id = l.user_id
      WHERE l.user_id IS NOT NULL
      ORDER BY u."displayName"
    `, { type: QueryTypes.SELECT });

    res.json(rows);
  } catch (err) {
    console.error('GET /api/rb-activity-log/users error:', err);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// GET /api/rb-activity-log/:id — полная запись с JSONB diff для drawer.
router.get('/:id', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const record = await RbActivityLog.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'displayName', 'username', 'avatar'],
      }],
    });

    if (!record) return res.status(404).json({ error: 'Запись журнала не найдена' });

    res.json(serializeLog(record, canSeeAup(req.user)));
  } catch (err) {
    console.error('GET /api/rb-activity-log/:id error:', err);
    res.status(500).json({ error: 'Ошибка получения записи журнала' });
  }
});

module.exports = router;
