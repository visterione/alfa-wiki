/**
 * Публичная карточка актива по QR — единственная часть модуля БЕЗ авторизации.
 *
 * Кабинеты сюда больше не входят: их QR висит на двери в коридоре, где ходят
 * пациенты, и перечень оборудования кабинета отдавать первому сканировавшему
 * незачем. Код с двери ведёт внутрь портала и спрашивает вход. У актива задача
 * обратная — наклейка на приборе, телефон инженера, авторизации нет.
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
const {
  WhAsset, WhAssetFile, WhRoom, WhDepartment, WhFloor, WhBuilding,
  WhMaintenanceOrder, WhRepair, WhMovement,
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

module.exports = router;
