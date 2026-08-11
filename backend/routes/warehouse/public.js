/**
 * Публичные карточки по QR — единственная часть модуля БЕЗ авторизации.
 *
 * Монтируется отдельно от остального модуля именно поэтому: случайно навесить
 * authenticate на весь роутер и сломать сканирование куда проще, чем случайно
 * снять его с одного файла. Что именно отдаётся наружу и почему — см. большой
 * комментарий в начале services/warehouse/qr.js.
 *
 * Защита от перебора: токен 160-битный, плюс примитивный счётчик обращений по IP
 * в памяти процесса. Полноценный rate-limit тут не нужен и был бы обманом — за
 * ним всё равно один процесс pm2 в fork-режиме; задача счётчика — отсечь
 * скрипт, который решил пройтись по всему пространству токенов.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  WhAsset, WhAssetFile, WhRoom, WhDepartment, WhFloor, WhBuilding,
  WhMaintenanceOrder, WhRepair, WhMovement, WhStorage, WhStock, WhNomenclature, WhBatch,
} = require('../../models');
const qr = require('../../services/warehouse/qr');

// Окно и лимит подобраны так, чтобы человек с телефоном никогда их не заметил:
// он сканирует один-два прибора, а не сорок за минуту.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 40;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      return res.status(429).json({ error: 'Слишком много запросов, попробуйте через минуту' });
    }
  }

  // Подчищаем карту, иначе она растёт всю жизнь процесса. Раз в ~500 запросов
  // достаточно: записей единицы, и проход по ним стоит копейки.
  if (hits.size > 500) {
    for (const [key, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(key);
  }
  next();
}

/**
 * Цифровой паспорт актива. Только чтение, только безопасный набор полей.
 */
router.get('/a/:token', rateLimit, async (req, res) => {
  try {
    const asset = await WhAsset.findOne({
      where: { publicToken: req.params.token },
      include: [{
        model: WhRoom, as: 'room',
        include: [
          { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
          { model: WhFloor, as: 'floor', include: [{ model: WhBuilding, as: 'building', attributes: ['id', 'name'] }] },
        ],
      }],
    });
    if (!asset) return res.status(404).json({ error: 'Карточка не найдена' });

    const [maintenance, repairs, movements, files] = await Promise.all([
      WhMaintenanceOrder.findAll({
        where: { assetId: asset.id },
        attributes: ['type', 'plannedDate', 'factDate', 'status', 'result'],
        order: [['plannedDate', 'DESC']], limit: 20,
      }),
      WhRepair.findAll({
        where: { assetId: asset.id },
        attributes: ['startedAt', 'finishedAt', 'result'],
        order: [['startedAt', 'DESC']], limit: 20,
      }),
      WhMovement.findAll({
        where: { assetId: asset.id },
        attributes: ['type', 'occurredAt'],
        order: [['occurredAt', 'DESC']], limit: 50,
      }),
      WhAssetFile.findAll({ where: { assetId: asset.id, isPublic: true } }),
    ]);

    res.json(qr.toPublicAsset(asset, { maintenanceOrders: maintenance, repairs, movements, files }));
  } catch (err) {
    console.error('GET public asset card error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Карточка кабинета по QR с двери. Ещё уже, чем карточка актива: перечень
 * оборудования со статусами и ближайшее ТО. Ни остатков, ни сумм — материалы и
 * их стоимость наружу не показываются вообще.
 */
router.get('/r/:token', rateLimit, async (req, res) => {
  try {
    const room = await WhRoom.findOne({
      where: { publicToken: req.params.token },
      include: [
        { model: WhDepartment, as: 'department', attributes: ['id', 'name'] },
        { model: WhFloor, as: 'floor', include: [{ model: WhBuilding, as: 'building', attributes: ['id', 'name'] }] },
      ],
    });
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const assets = await WhAsset.findAll({
      where: { roomId: room.id, isArchived: false },
      attributes: ['inventoryNumber', 'name', 'model', 'status', 'nextMaintenanceDate', 'publicToken'],
      order: [['name', 'ASC']],
    });

    const STATUS_LABELS = {
      in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
      storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
    };

    res.json({
      room: {
        number: room.number,
        name: room.name,
        department: room.department?.name || null,
        floor: room.floor ? `${room.floor.number} этаж` : null,
        building: room.floor?.building?.name || null,
      },
      assets: assets.map(a => ({
        inventoryNumber: a.inventoryNumber,
        name: a.name,
        model: a.model,
        status: a.status,
        statusLabel: STATUS_LABELS[a.status] || a.status,
        nextMaintenanceDate: a.nextMaintenanceDate,
        cardUrl: `/p/a/${a.publicToken}`,
      })),
    });
  } catch (err) {
    console.error('GET public room card error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
