const express = require('express');
const { PerformedServiceBonus } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

const router = express.Router();

// GET /api/performed-service-bonuses?misUserId=xxx
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    const bonuses = await PerformedServiceBonus.findAll({
      where: { misUserId },
      order: [['serviceName', 'ASC']]
    });
    res.json(bonuses);
  } catch (err) {
    console.error('Get performed bonuses error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов' });
  }
});

// POST /api/performed-service-bonuses
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, serviceCode, serviceName, bonusPercent, bonusRub, items } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });

    // Bulk mode
    if (Array.isArray(items)) {
      const clinicId = req.body.clinicId != null ? String(req.body.clinicId).trim().substring(0, 50) : '';

      const seen = new Map();
      for (const item of items) {
        if (!item.serviceCode) continue;
        seen.set(String(item.serviceCode).trim(), item);
      }
      const deduped = Array.from(seen.values());

      const existing = await PerformedServiceBonus.findAll({ where: { misUserId, clinicId, cabinetId: '' } });
      const existingNameMap = Object.fromEntries(existing.map(b => [b.serviceCode, b.serviceName]));
      const oldMap = Object.fromEntries(existing.map(b => [b.serviceCode, {
        bonusPercent: b.bonusPercent != null ? parseFloat(b.bonusPercent) : null,
        bonusRub:     b.bonusRub     != null ? parseFloat(b.bonusRub)     : null,
      }]));

      await PerformedServiceBonus.destroy({ where: { misUserId, clinicId, cabinetId: '' } });
      const created = [];
      for (const item of deduped) {
        const svcCode = String(item.serviceCode).trim().substring(0, 100);
        const svcName = String(item.serviceName || item.serviceCode).trim().substring(0, 500);
        const [bonus] = await PerformedServiceBonus.upsert({
          misUserId,
          clinicId,
          cabinetId: '',
          doctorName: (doctorName || '').substring(0, 255) || '—',
          serviceCode: svcCode,
          serviceName: svcName,
          bonusPercent: item.bonusPercent != null ? parseFloat(item.bonusPercent) : null,
          bonusRub: item.bonusRub != null ? parseFloat(item.bonusRub) : null,
          createdBy: req.user?.id || null,
        }, { conflictFields: ['misUserId', 'serviceCode', 'clinicId', 'cabinetId'], returning: true });
        created.push(bonus);
      }

      const newNameMap = Object.fromEntries(deduped.map(i => [String(i.serviceCode).trim(), i.serviceName || i.serviceCode]));
      const newMap = Object.fromEntries(deduped.map(i => [String(i.serviceCode).trim(), { bonusPercent: i.bonusPercent ?? null, bonusRub: i.bonusRub ?? null }]));
      const fmtBonus = b => b == null ? null : [b.bonusPercent != null ? `${b.bonusPercent}%` : null, b.bonusRub != null ? `${b.bonusRub} ₽` : null].filter(Boolean).join(' / ') || '—';
      const changes = [];
      const allCodes = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
      for (const code of allCodes) {
        const ov = oldMap[code];
        const nv = newMap[code];
        if (JSON.stringify(ov) !== JSON.stringify(nv)) {
          changes.push({ serviceCode: code, label: newNameMap[code] || existingNameMap[code] || code, before: fmtBonus(ov), after: fmtBonus(nv) });
        }
      }

      await logRbActivity({
        userId:     req.user?.id,
        tab:        'performed',
        action:     'update',
        entityType: 'performed_bonus',
        misUserId,
        doctorName: doctorName || null,
        clinicId:   clinicId || null,
        summary:    `Услуги ${doctorName || misUserId}: сохранено ${deduped.length}${clinicId ? `, клиника ${clinicId}` : ''}${changes.length ? `, изм. ${changes.length}` : ''}`,
        diff:       changes.length ? { changes } : null,
      });

      return res.json(created);
    }

    // Single mode
    if (!serviceCode || !serviceName) {
      return res.status(400).json({ error: 'serviceCode, serviceName обязательны' });
    }
    if (bonusPercent == null && bonusRub == null) {
      return res.status(400).json({ error: 'Укажите bonusPercent или bonusRub' });
    }
    const singleClinicId  = req.body.clinicId  != null ? String(req.body.clinicId).trim().substring(0, 50)  : '';
    const singleCabinetId = req.body.cabinetId != null ? String(req.body.cabinetId).trim().substring(0, 100) : '';

    let bonus = await PerformedServiceBonus.findOne({
      where: { misUserId, serviceCode, clinicId: singleClinicId, cabinetId: singleCabinetId }
    });
    const isNew = !bonus;
    const before = bonus ? { bonusPercent: bonus.bonusPercent, bonusRub: bonus.bonusRub } : null;

    if (bonus) {
      await bonus.update({
        doctorName: doctorName || '',
        serviceName,
        bonusPercent: bonusPercent != null ? parseFloat(bonusPercent) : null,
        bonusRub:     bonusRub    != null ? parseFloat(bonusRub)     : null,
      });
    } else {
      bonus = await PerformedServiceBonus.create({
        misUserId,
        clinicId: singleClinicId,
        cabinetId: singleCabinetId,
        doctorName: doctorName || '',
        serviceCode,
        serviceName,
        bonusPercent: bonusPercent != null ? parseFloat(bonusPercent) : null,
        bonusRub:     bonusRub    != null ? parseFloat(bonusRub)     : null,
        createdBy: req.user?.id || null,
      });
    }

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'performed',
      action:     isNew ? 'create' : 'update',
      entityType: 'performed_bonus',
      entityId:   bonus.id,
      misUserId,
      doctorName: doctorName || null,
      clinicId:   singleClinicId || null,
      summary:    `${isNew ? 'Добавлен' : 'Изменён'} бонус (услуги): ${doctorName || misUserId} — ${serviceName}`,
      diff: {
        before,
        after: { bonusPercent: bonus.bonusPercent, bonusRub: bonus.bonusRub },
      },
    });

    res.json(bonus);
  } catch (err) {
    console.error('Save performed bonus error:', err);
    res.status(500).json({ error: 'Ошибка сохранения бонуса' });
  }
});

// DELETE /api/performed-service-bonuses/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const bonus = await PerformedServiceBonus.findByPk(req.params.id);
    if (!bonus) return res.status(404).json({ error: 'Запись не найдена' });

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'performed',
      action:     'delete',
      entityType: 'performed_bonus',
      entityId:   bonus.id,
      misUserId:  bonus.misUserId,
      doctorName: bonus.doctorName || null,
      clinicId:   bonus.clinicId || null,
      summary:    `Удалён бонус (услуги): ${bonus.doctorName || bonus.misUserId} — ${bonus.serviceName}`,
      diff:       { before: { serviceCode: bonus.serviceCode, serviceName: bonus.serviceName, bonusPercent: bonus.bonusPercent, bonusRub: bonus.bonusRub } },
    });

    await PerformedServiceBonus.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete performed bonus error:', err);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// DELETE /api/performed-service-bonuses/by-service/:misUserId/:serviceCode
router.delete('/by-service/:misUserId/:serviceCode', authenticate, async (req, res) => {
  try {
    const { misUserId, serviceCode } = req.params;
    const bonuses = await PerformedServiceBonus.findAll({ where: { misUserId, serviceCode } });
    await PerformedServiceBonus.destroy({ where: { misUserId, serviceCode } });

    if (bonuses.length > 0) {
      await logRbActivity({
        userId:     req.user?.id,
        tab:        'performed',
        action:     'delete',
        entityType: 'performed_bonus',
        misUserId,
        summary:    `Удалён бонус (услуги) по коду: ${serviceCode} у ${misUserId} (${bonuses.length} записей)`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete performed bonus by service error:', err);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
