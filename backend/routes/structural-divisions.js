const express = require('express');
const router  = express.Router();
const { StructuralDivision, DivisionAccess, User, ExecutorSettings } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

function userAttrs() {
  return ['id', 'displayName', 'username', 'avatar'];
}

function resolvePermission(div, userId, isAdmin, accessMap) {
  if (isAdmin) return 'owner';
  if (!div.createdBy) return 'public';
  if (div.createdBy === userId) return 'owner';
  return accessMap.get(div.id) || null;
}

async function requireOwnerOrAdmin(req, res, divId) {
  const div = await StructuralDivision.findByPk(divId);
  if (!div) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!req.user.isAdmin && div.createdBy !== req.user.id) {
    res.status(403).json({ error: 'Нет доступа' }); return null;
  }
  return div;
}

// GET / — list
router.get('/', authenticate, async (req, res) => {
  try {
    const userId  = req.user.id;
    const isAdmin = req.user.isAdmin;

    const [rows, myAccesses] = await Promise.all([
      StructuralDivision.findAll({ order: [['name', 'ASC']] }),
      isAdmin ? [] : DivisionAccess.findAll({ where: { userId } }),
    ]);

    const accessMap = new Map(myAccesses.map(a => [a.divisionId, a.permission]));

    const result = rows
      .map(div => {
        const myPermission = resolvePermission(div, userId, isAdmin, accessMap);
        return { id: div.id, name: div.name, doctorIds: div.doctorIds, rates: div.rates || [], createdBy: div.createdBy, myPermission };
      })
      .filter(div => isAdmin || div.myPermission !== null);

    res.json(result);
  } catch (err) {
    console.error('GET structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST / — create
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, doctorIds } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const row = await StructuralDivision.create({
      name: name.trim(),
      doctorIds: doctorIds || [],
      createdBy: req.user.id,
    });
    await logRbActivity({
      userId:     req.user.id,
      tab:        'schedule',
      action:     'create',
      entityType: 'division',
      entityId:   row.id,
      summary:    `Создано подразделение: «${name.trim()}»`,
      diff:       { after: { name: name.trim(), doctorCount: (doctorIds || []).length } },
    });
    res.status(201).json({ ...row.toJSON(), myPermission: 'owner' });
  } catch (err) {
    console.error('POST structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /:id — update name/doctorIds
router.put('/:id', authenticate, async (req, res) => {
  try {
    const div = await StructuralDivision.findByPk(req.params.id);
    if (!div) return res.status(404).json({ error: 'Not found' });

    const userId  = req.user.id;
    const isAdmin = req.user.isAdmin;
    const myAccess = await DivisionAccess.findOne({ where: { divisionId: div.id, userId } });
    const perm = resolvePermission(div, userId, isAdmin, new Map(myAccess ? [[div.id, myAccess.permission]] : []));

    const { name, doctorIds, rates } = req.body;
    if (name !== undefined && perm !== 'owner' && !isAdmin) {
      return res.status(403).json({ error: 'Только владелец может переименовывать' });
    }
    if ((doctorIds !== undefined || rates !== undefined) && perm === null) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const oldDoctorIds = div.doctorIds || [];

    await div.update({
      ...(name      !== undefined && { name: name.trim() }),
      ...(doctorIds !== undefined && { doctorIds }),
      ...(rates     !== undefined && { rates }),
    });

    const textChanges = [];
    const diffChanges = [];

    if (name !== undefined && name.trim() !== div.name) {
      textChanges.push(`переименовано «${div.name}» → «${name.trim()}»`);
      diffChanges.push({ field: 'name', label: 'Название', before: div.name, after: name.trim() });
    }

    if (doctorIds !== undefined) {
      const newIds = doctorIds || [];
      const addedIds   = newIds.filter(id => !oldDoctorIds.includes(id));
      const removedIds = oldDoctorIds.filter(id => !newIds.includes(id));

      if (addedIds.length > 0 || removedIds.length > 0) {
        const allIds = [...new Set([...addedIds, ...removedIds])];
        const settings = await ExecutorSettings.findAll({ where: { misUserId: allIds }, attributes: ['misUserId', 'doctorName'] });
        const nameMap = Object.fromEntries(settings.map(s => [s.misUserId, s.doctorName || s.misUserId]));

        for (const id of addedIds) {
          const dn = nameMap[id] || id;
          textChanges.push(`добавлен ${dn}`);
          diffChanges.push({ field: 'doctor_added', label: 'Добавлен врач', before: null, after: dn });
        }
        for (const id of removedIds) {
          const dn = nameMap[id] || id;
          textChanges.push(`исключён ${dn}`);
          diffChanges.push({ field: 'doctor_removed', label: 'Исключён врач', before: dn, after: null });
        }
      }
    }

    if (textChanges.length > 0) {
      const summaryText = textChanges.slice(0, 3).join(', ') + (textChanges.length > 3 ? ` и ещё ${textChanges.length - 3}` : '');
      await logRbActivity({
        userId:     req.user.id,
        tab:        'schedule',
        action:     'update',
        entityType: 'division',
        entityId:   div.id,
        summary:    `Изменено подразделение «${div.name}»: ${summaryText}`,
        diff:       diffChanges.length > 0 ? { changes: diffChanges } : null,
      });
    }

    res.json({ ...div.toJSON(), myPermission: perm });
  } catch (err) {
    console.error('PUT structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const div = await requireOwnerOrAdmin(req, res, req.params.id);
    if (!div) return;
    await logRbActivity({
      userId:     req.user.id,
      tab:        'schedule',
      action:     'delete',
      entityType: 'division',
      entityId:   div.id,
      summary:    `Удалено подразделение «${div.name}»`,
      diff:       { before: { name: div.name, doctorCount: (div.doctorIds || []).length } },
    });
    await div.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /:id/access
router.get('/:id/access', authenticate, async (req, res) => {
  try {
    const div = await requireOwnerOrAdmin(req, res, req.params.id);
    if (!div) return;

    const [accesses, ownerUser] = await Promise.all([
      DivisionAccess.findAll({
        where: { divisionId: div.id },
        include: [{ model: User, as: 'user', attributes: userAttrs() }],
      }),
      div.createdBy ? User.findByPk(div.createdBy, { attributes: userAttrs() }) : null,
    ]);

    res.json({
      owner: ownerUser
        ? { id: ownerUser.id, displayName: ownerUser.displayName || ownerUser.username, avatar: ownerUser.avatar }
        : null,
      access: accesses.map(a => ({
        userId:      a.userId,
        displayName: a.user?.displayName || a.user?.username,
        avatar:      a.user?.avatar,
        permission:  a.permission,
      })),
    });
  } catch (err) {
    console.error('GET /:id/access error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /:id/access — grant access
router.post('/:id/access', authenticate, async (req, res) => {
  try {
    const div = await requireOwnerOrAdmin(req, res, req.params.id);
    if (!div) return;

    const { userId, permission } = req.body;
    if (!userId || !['edit', 'read'].includes(permission)) {
      return res.status(400).json({ error: 'userId and permission (edit|read) required' });
    }
    if (userId === div.createdBy) {
      return res.status(400).json({ error: 'Нельзя изменить права владельца' });
    }

    const existingAccess = await DivisionAccess.findOne({ where: { divisionId: div.id, userId } });
    const oldPermission  = existingAccess?.permission || null;

    const [row] = await DivisionAccess.findOrCreate({
      where:    { divisionId: div.id, userId },
      defaults: { permission },
    });
    if (row.permission !== permission) await row.update({ permission });

    const targetUser = await User.findByPk(userId, { attributes: userAttrs() });
    const targetName = targetUser?.displayName || targetUser?.username || userId;

    const action = oldPermission ? 'update' : 'grant';
    const permLabel = permission === 'edit' ? 'редактирование' : 'просмотр';
    const summaryParts = [`подразделение «${div.name}»`, `пользователь: ${targetName}`, `доступ: ${permLabel}`];
    if (oldPermission) summaryParts.push(`(было: ${oldPermission === 'edit' ? 'редактирование' : 'просмотр'})`);

    await logRbActivity({
      userId:     req.user.id,
      tab:        'schedule',
      action:     action === 'grant' ? 'grant' : 'update',
      entityType: 'division_access',
      entityId:   div.id,
      summary:    `Доступ к подразделению: ${summaryParts.join(', ')}`,
      diff:       {
        before: oldPermission ? { user: targetName, permission: oldPermission } : null,
        after:  { user: targetName, permission },
      },
    });

    res.json({
      userId,
      displayName: targetUser?.displayName || targetUser?.username,
      avatar:      targetUser?.avatar,
      permission:  row.permission,
    });
  } catch (err) {
    console.error('POST /:id/access error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /:id/access/:userId — revoke access
router.delete('/:id/access/:userId', authenticate, async (req, res) => {
  try {
    const div = await requireOwnerOrAdmin(req, res, req.params.id);
    if (!div) return;

    const targetId = req.params.userId;
    const targetUser = await User.findByPk(targetId, { attributes: userAttrs() });
    const existingAccess = await DivisionAccess.findOne({ where: { divisionId: div.id, userId: targetId } });

    if (div.createdBy === targetId) {
      await div.update({ createdBy: null });
    }

    await DivisionAccess.destroy({ where: { divisionId: div.id, userId: targetId } });

    await logRbActivity({
      userId:     req.user.id,
      tab:        'schedule',
      action:     'revoke',
      entityType: 'division_access',
      entityId:   div.id,
      summary:    `Отозван доступ к подразделению «${div.name}»: ${targetUser?.displayName || targetUser?.username || targetId}`,
      diff:       {
        before: { user: targetUser?.displayName || targetId, permission: existingAccess?.permission || null },
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /:id/access/:userId error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
