const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { ReleaseNote, ReleaseNoteRead, User, Role, MedCenter } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// Хелперы
// ═══════════════════════════════════════════════════════════════

// Проверка: попадает ли пользователь в аудиторию нововведения.
// Пустой массив таргета = "для всех".
function matchesAudience(note, roleIds, medCenterIds) {
  const targetRoles = Array.isArray(note.targetRoleIds) ? note.targetRoleIds : [];
  const targetMcs = Array.isArray(note.targetMedCenterIds) ? note.targetMedCenterIds : [];

  const roleOk = targetRoles.length === 0 || targetRoles.some(id => roleIds.includes(id));
  const mcOk = targetMcs.length === 0 || targetMcs.some(id => medCenterIds.includes(id));

  return roleOk && mcOk;
}

// ID ролей и медцентров текущего пользователя (из authenticate-мидлвари)
function userAudienceIds(user) {
  const roleIds = (user.roles || []).map(r => r.id);
  if (user.roleId && !roleIds.includes(user.roleId)) roleIds.push(user.roleId);
  const medCenterIds = (user.medCenters || []).map(m => m.id);
  return { roleIds, medCenterIds };
}

// Рассылка real-time события через Socket.IO пользователям из аудитории
async function notifyAudience(req, note) {
  try {
    const io = req.app.get('io');
    if (!io) return;

    const users = await User.findAll({
      where: { isActive: true },
      attributes: ['id'],
      include: [
        { model: Role, as: 'roles', through: { attributes: [] }, attributes: ['id'] },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] }, attributes: ['id'] }
      ]
    });

    const payload = {
      id: note.id,
      title: note.title,
      version: note.version,
      severity: note.severity
    };

    for (const u of users) {
      const { roleIds, medCenterIds } = userAudienceIds(u);
      if (matchesAudience(note, roleIds, medCenterIds)) {
        io.to(`user:${u.id}`).emit('new_release_note', payload);
      }
    }
  } catch (err) {
    console.error('❌ Ошибка real-time рассылки release note:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// USER ROUTES — лента нововведений
// ═══════════════════════════════════════════════════════════════

// Лента опубликованных нововведений для текущего пользователя (с пагинацией)
// Query: ?page=1&limit=10 → { items, total, page, limit, totalPages }
router.get('/', authenticate, async (req, res) => {
  try {
    const { roleIds, medCenterIds } = userAudienceIds(req.user);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    // 1) Лёгкая выборка только для фильтрации по аудитории и подсчёта total —
    //    без тяжёлого content, чтобы не тянуть все новости целиком
    const meta = await ReleaseNote.findAll({
      where: { isPublished: true },
      attributes: ['id', 'targetRoleIds', 'targetMedCenterIds', 'publishedAt'],
      order: [['publishedAt', 'DESC']]
    });
    const visibleIds = meta
      .filter(n => matchesAudience(n, roleIds, medCenterIds))
      .map(n => n.id);

    const total = visibleIds.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const pageIds = visibleIds.slice(start, start + limit);

    // 2) Полные строки только для текущей страницы
    let items = [];
    if (pageIds.length > 0) {
      const rows = await ReleaseNote.findAll({
        where: { id: { [Op.in]: pageIds } },
        order: [['publishedAt', 'DESC']],
        include: [
          { model: User, as: 'author', attributes: ['id', 'username', 'displayName'] }
        ]
      });

      const reads = await ReleaseNoteRead.findAll({
        where: { userId: req.user.id, releaseNoteId: { [Op.in]: pageIds } },
        attributes: ['releaseNoteId']
      });
      const readSet = new Set(reads.map(r => r.releaseNoteId));

      items = rows.map(n => ({ ...n.toJSON(), isRead: readSet.has(n.id) }));
    }

    res.json({ items, total, page, limit, totalPages });
  } catch (error) {
    console.error('Ошибка получения ленты нововведений:', error);
    res.status(500).json({ error: 'Ошибка получения ленты нововведений' });
  }
});

// Важные непрочитанные нововведения — для модалки «Что нового» при входе
router.get('/important-unread', authenticate, async (req, res) => {
  try {
    const { roleIds, medCenterIds } = userAudienceIds(req.user);

    const notes = await ReleaseNote.findAll({
      where: { isPublished: true, severity: 'important' },
      order: [['publishedAt', 'DESC']]
    });
    const visible = notes.filter(n => matchesAudience(n, roleIds, medCenterIds));

    const reads = await ReleaseNoteRead.findAll({
      where: { userId: req.user.id, releaseNoteId: { [Op.in]: visible.map(n => n.id) } },
      attributes: ['releaseNoteId']
    });
    const readSet = new Set(reads.map(r => r.releaseNoteId));

    res.json(visible.filter(n => !readSet.has(n.id)).map(n => n.toJSON()));
  } catch (error) {
    console.error('Ошибка получения важных нововведений:', error);
    res.status(500).json({ error: 'Ошибка получения важных нововведений' });
  }
});

// Количество непрочитанных (для badge)
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const { roleIds, medCenterIds } = userAudienceIds(req.user);

    const notes = await ReleaseNote.findAll({
      where: { isPublished: true },
      attributes: ['id', 'targetRoleIds', 'targetMedCenterIds']
    });
    const visible = notes.filter(n => matchesAudience(n, roleIds, medCenterIds));

    const reads = await ReleaseNoteRead.findAll({
      where: { userId: req.user.id, releaseNoteId: { [Op.in]: visible.map(n => n.id) } },
      attributes: ['releaseNoteId']
    });
    const readSet = new Set(reads.map(r => r.releaseNoteId));

    const count = visible.filter(n => !readSet.has(n.id)).length;
    res.json({ count });
  } catch (error) {
    console.error('Ошибка подсчёта непрочитанных нововведений:', error);
    res.status(500).json({ error: 'Ошибка подсчёта непрочитанных нововведений' });
  }
});

// Отметить нововведение прочитанным
router.post('/:id/read', authenticate, async (req, res) => {
  try {
    const note = await ReleaseNote.findByPk(req.params.id);
    if (!note || !note.isPublished) {
      return res.status(404).json({ error: 'Нововведение не найдено' });
    }

    await ReleaseNoteRead.findOrCreate({
      where: { releaseNoteId: note.id, userId: req.user.id },
      defaults: { releaseNoteId: note.id, userId: req.user.id, readAt: new Date() }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка отметки нововведения прочитанным:', error);
    res.status(500).json({ error: 'Ошибка отметки нововведения прочитанным' });
  }
});

// Отметить все прочитанными
router.post('/read-all', authenticate, async (req, res) => {
  try {
    const { roleIds, medCenterIds } = userAudienceIds(req.user);

    const notes = await ReleaseNote.findAll({
      where: { isPublished: true },
      attributes: ['id', 'targetRoleIds', 'targetMedCenterIds']
    });
    const visible = notes.filter(n => matchesAudience(n, roleIds, medCenterIds));

    for (const n of visible) {
      await ReleaseNoteRead.findOrCreate({
        where: { releaseNoteId: n.id, userId: req.user.id },
        defaults: { releaseNoteId: n.id, userId: req.user.id, readAt: new Date() }
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка отметки всех нововведений:', error);
    res.status(500).json({ error: 'Ошибка отметки всех нововведений' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES — управление нововведениями
// ═══════════════════════════════════════════════════════════════

// Справочник аудитории (роли + медцентры) для формы админки —
// чтобы не зависеть от прав на разделы «Пользователи»/«Роли»
router.get('/admin/audience-options', authenticate, requireAdminAccess('releaseNotes'), async (req, res) => {
  try {
    const [roles, medCenters] = await Promise.all([
      Role.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      // Без служебных группировок: рассылку адресуют людям, а «Направители» и
      // «АУП» — измерение зарплатного отчёта, сотрудников за ними нет.
      MedCenter.findAll({ attributes: ['id', 'name'], where: { isVirtual: false }, order: [['name', 'ASC']] })
    ]);
    res.json({ roles, medCenters });
  } catch (error) {
    console.error('Ошибка получения справочника аудитории:', error);
    res.status(500).json({ error: 'Ошибка получения справочника аудитории' });
  }
});

// Все нововведения (включая черновики) — для админки
router.get('/admin/all', authenticate, requireAdminAccess('releaseNotes'), async (req, res) => {
  try {
    const notes = await ReleaseNote.findAll({
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'author', attributes: ['id', 'username', 'displayName'] }
      ]
    });
    res.json(notes);
  } catch (error) {
    console.error('Ошибка получения нововведений (admin):', error);
    res.status(500).json({ error: 'Ошибка получения нововведений' });
  }
});

// Создать нововведение (черновик)
router.post('/',
  authenticate,
  requireAdminAccess('releaseNotes'),
  body('title').trim().notEmpty().withMessage('Заголовок обязателен'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { title, content, version, severity, targetRoleIds, targetMedCenterIds } = req.body;

      const note = await ReleaseNote.create({
        title,
        content: content || {},
        version: version || null,
        severity: severity === 'important' ? 'important' : 'info',
        targetRoleIds: Array.isArray(targetRoleIds) ? targetRoleIds : [],
        targetMedCenterIds: Array.isArray(targetMedCenterIds) ? targetMedCenterIds : [],
        isPublished: false,
        createdBy: req.user.id
      });

      res.status(201).json(note);
    } catch (error) {
      console.error('Ошибка создания нововведения:', error);
      res.status(500).json({ error: 'Ошибка создания нововведения' });
    }
  }
);

// Обновить нововведение
router.put('/:id', authenticate, requireAdminAccess('releaseNotes'), async (req, res) => {
  try {
    const note = await ReleaseNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Нововведение не найдено' });

    const { title, content, version, severity, targetRoleIds, targetMedCenterIds } = req.body;

    if (title !== undefined) note.title = title;
    if (content !== undefined) note.content = content;
    if (version !== undefined) note.version = version || null;
    if (severity !== undefined) note.severity = severity === 'important' ? 'important' : 'info';
    if (targetRoleIds !== undefined) note.targetRoleIds = Array.isArray(targetRoleIds) ? targetRoleIds : [];
    if (targetMedCenterIds !== undefined) note.targetMedCenterIds = Array.isArray(targetMedCenterIds) ? targetMedCenterIds : [];

    await note.save();
    res.json(note);
  } catch (error) {
    console.error('Ошибка обновления нововведения:', error);
    res.status(500).json({ error: 'Ошибка обновления нововведения' });
  }
});

// Опубликовать нововведение (+ real-time рассылка аудитории)
router.post('/:id/publish', authenticate, requireAdminAccess('releaseNotes'), async (req, res) => {
  try {
    const note = await ReleaseNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Нововведение не найдено' });

    const wasPublished = note.isPublished;
    note.isPublished = true;
    if (!note.publishedAt) note.publishedAt = new Date();
    await note.save();

    // Рассылаем только при первой публикации, чтобы не спамить при переизданиях
    if (!wasPublished) {
      await notifyAudience(req, note);
    }

    res.json(note);
  } catch (error) {
    console.error('Ошибка публикации нововведения:', error);
    res.status(500).json({ error: 'Ошибка публикации нововведения' });
  }
});

// Снять с публикации
router.post('/:id/unpublish', authenticate, requireAdminAccess('releaseNotes'), async (req, res) => {
  try {
    const note = await ReleaseNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Нововведение не найдено' });

    note.isPublished = false;
    await note.save();
    res.json(note);
  } catch (error) {
    console.error('Ошибка снятия с публикации:', error);
    res.status(500).json({ error: 'Ошибка снятия с публикации' });
  }
});

// Удалить нововведение
router.delete('/:id', authenticate, requireAdminAccess('releaseNotes'), async (req, res) => {
  try {
    const note = await ReleaseNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Нововведение не найдено' });

    await note.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка удаления нововведения:', error);
    res.status(500).json({ error: 'Ошибка удаления нововведения' });
  }
});

module.exports = router;
