const express = require('express');
const router  = express.Router();
const { StructuralDivision, DivisionAccess, User } = require('../models');
const { authenticate } = require('../middleware/auth');

// ── helpers ──────────────────────────────────────────────────────────────────

function userAttrs() {
  return ['id', 'displayName', 'username', 'avatar'];
}

// Compute myPermission for a division row given userId / isAdmin
function resolvePermission(div, userId, isAdmin, accessMap) {
  if (isAdmin) return 'owner';
  if (!div.createdBy) return 'public';      // legacy: visible to all
  if (div.createdBy === userId) return 'owner';
  return accessMap.get(div.id) || null;     // null → not visible
}

// Guard: caller must be owner or admin
async function requireOwnerOrAdmin(req, res, divId) {
  const div = await StructuralDivision.findByPk(divId);
  if (!div) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!req.user.isAdmin && div.createdBy !== req.user.id) {
    res.status(403).json({ error: 'Нет доступа' }); return null;
  }
  return div;
}

// ── GET / — list with per-user permission ────────────────────────────────────
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

// ── POST / — create (owner = current user) ───────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, doctorIds } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const row = await StructuralDivision.create({
      name: name.trim(),
      doctorIds: doctorIds || [],
      createdBy: req.user.id,
    });
    res.status(201).json({ ...row.toJSON(), myPermission: 'owner' });
  } catch (err) {
    console.error('POST structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id — update name/doctorIds ─────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const div = await StructuralDivision.findByPk(req.params.id);
    if (!div) return res.status(404).json({ error: 'Not found' });

    const userId  = req.user.id;
    const isAdmin = req.user.isAdmin;
    const myAccess = await DivisionAccess.findOne({ where: { divisionId: div.id, userId } });
    const perm = resolvePermission(div, userId, isAdmin, new Map(myAccess ? [[div.id, myAccess.permission]] : []));

    // Only owner/admin can rename; owner/edit/admin can update doctorIds and rates
    const { name, doctorIds, rates } = req.body;
    if (name !== undefined && perm !== 'owner' && !isAdmin) {
      return res.status(403).json({ error: 'Только владелец может переименовывать' });
    }
    if ((doctorIds !== undefined || rates !== undefined) && perm === null) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    await div.update({
      ...(name      !== undefined && { name: name.trim() }),
      ...(doctorIds !== undefined && { doctorIds }),
      ...(rates     !== undefined && { rates }),
    });
    res.json({ ...div.toJSON(), myPermission: perm });
  } catch (err) {
    console.error('PUT structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:id — owner/admin only ───────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const div = await requireOwnerOrAdmin(req, res, req.params.id);
    if (!div) return;
    await div.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE structural-divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/access — list who has access (owner/admin) ──────────────────────
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

// ── POST /:id/access — add or update user access (owner/admin) ───────────────
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

    const [row] = await DivisionAccess.findOrCreate({
      where: { divisionId: div.id, userId },
      defaults: { permission },
    });
    if (row.permission !== permission) await row.update({ permission });

    const u = await User.findByPk(userId, { attributes: userAttrs() });
    res.json({
      userId,
      displayName: u?.displayName || u?.username,
      avatar:      u?.avatar,
      permission:  row.permission,
    });
  } catch (err) {
    console.error('POST /:id/access error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:id/access/:userId — remove access (owner/admin) ─────────────────
router.delete('/:id/access/:userId', authenticate, async (req, res) => {
  try {
    const div = await requireOwnerOrAdmin(req, res, req.params.id);
    if (!div) return;

    const targetId = req.params.userId;

    // If removing the creator — clear createdBy on the division
    if (div.createdBy === targetId) {
      await div.update({ createdBy: null });
    }

    await DivisionAccess.destroy({ where: { divisionId: div.id, userId: targetId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /:id/access/:userId error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
