const express = require('express');
const router  = express.Router();
const { RbActivityLog, User } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { Op } = require('sequelize');
const { TAB_LABELS, ACTION_LABELS } = require('../services/rbLogger');
const { canSeeAup, AUP_CLINIC_ID } = require('../services/aupFilter');

// GET /api/rb-activity-log
router.get('/', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const {
      tab,
      userId,
      misUserId,
      doctorName,
      dateFrom,
      dateTo,
      limit  = 100,
      offset = 0,
    } = req.query;

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
      include: [{
        model: User,
        as:    'user',
        attributes: ['id', 'displayName', 'username', 'avatar'],
      }],
      order:  [['created_at', 'DESC']],
      limit:  Math.min(parseInt(limit)  || 100, 500),
      offset: parseInt(offset) || 0,
    });

    const seeAup = canSeeAup(req.user);
    const result = rows.map(r => {
      const row = {
        ...r.toJSON(),
        tabLabel:    TAB_LABELS[r.tab]    || r.tab,
        actionLabel: ACTION_LABELS[r.action] || r.action,
      };
      // Защитно: не показываем изменения по клинике АУП пользователям без флага.
      if (!seeAup && row.diff && Array.isArray(row.diff.changes)) {
        row.diff = { ...row.diff, changes: row.diff.changes.filter(c => String(c.clinicId) !== AUP_CLINIC_ID) };
      }
      return row;
    });

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

module.exports = router;
