/**
 * API для работы с кэшем финансовых списаний МИС (таблица mis_payments)
 *
 * GET  /api/mis-payments/sync/status   – статус синхронизации + статистика БД
 * POST /api/mis-payments/sync/trigger  – запустить синхронизацию (fire-and-forget)
 *   body: { date_from?: ISO, date_to?: ISO }  (по умолчанию 2026-02-01 → вчера)
 * GET  /api/mis-payments               – получить списания из БД
 *   query: date_from (ISO), date_to (ISO), clinic_id, author_id,
 *          refunds_only (по умолчанию 1 — только возвраты), show_deleted (по умолчанию 0)
 */

const express = require('express');
const router  = express.Router();
const { Op }  = require('sequelize');
const { authenticate } = require('../middleware/auth');
const { MisPayment } = require('../models');
const { syncState, syncDateRange } = require('../services/misPaymentsSync');

// ── GET /sync/status ──────────────────────────────────────────────────────────
router.get('/sync/status', authenticate, async (req, res) => {
  try {
    const totalInDb  = await MisPayment.count();
    const refundsInDb = await MisPayment.count({ where: { isRefund: true } });
    const lastSyncAt = await MisPayment.max('syncedAt');
    res.json({ ...syncState, totalInDb, refundsInDb, lastSyncAt: lastSyncAt || null });
  } catch (err) {
    console.error('❌ /mis-payments/sync/status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sync/trigger ────────────────────────────────────────────────────────
router.post('/sync/trigger', authenticate, async (req, res) => {
  if (syncState.syncing) {
    return res.json({ ok: false, message: 'Синхронизация уже запущена' });
  }

  const { date_from, date_to } = req.body;
  const start = date_from ? new Date(date_from) : new Date('2026-02-01T00:00:00');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999);
  const end = date_to ? new Date(date_to) : yesterday;

  // Fire-and-forget — не блокируем ответ
  syncDateRange(start, end);

  res.json({ ok: true, message: 'Синхронизация запущена' });
});

// ── GET / — запрос списаний/возвратов из БД ──────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { date_from, date_to, clinic_id, author_id, refunds_only, show_deleted } = req.query;

    const where = {};
    // По умолчанию отдаём только возвраты
    if (refunds_only === undefined || refunds_only === '1' || refunds_only === 'true') {
      where.isRefund = true;
    }
    // По умолчанию скрываем корзину
    if (!(show_deleted === '1' || show_deleted === 'true')) {
      where.isDeleted = false;
    }
    if (date_from || date_to) {
      where.opDate = {};
      if (date_from) where.opDate[Op.gte] = new Date(date_from);
      if (date_to)   where.opDate[Op.lte] = new Date(date_to);
    }
    if (clinic_id) where.clinicId = Number(clinic_id);
    if (author_id) where.authorId = Number(author_id);

    const rows = await MisPayment.findAll({
      where,
      attributes: [
        'opDate', 'value', 'type', 'typeName', 'isRefund',
        'incomeType', 'incomeTypeName', 'invoiceNumber', 'title',
        'patientId', 'patient', 'clinicId', 'clinicName', 'isCompany',
        'authorId', 'authorName', 'device', 'isDeleted',
      ],
      order: [['opDate', 'DESC']],
      raw: true,
    });

    // Нормализуем в snake_case как возвращает МИС API напрямую
    const data = rows.map(r => ({
      date:             r.opDate,
      value:            r.value != null ? Number(r.value) : null,
      type:             r.type,
      type_name:        r.typeName,
      is_refund:        r.isRefund,
      income_type:      r.incomeType,
      income_type_name: r.incomeTypeName,
      invoice_number:   r.invoiceNumber,
      title:            r.title,
      patient_id:       r.patientId,
      patient:          r.patient,
      clinic_id:        r.clinicId,
      clinic_name:      r.clinicName,
      is_company:       r.isCompany,
      author_id:        r.authorId,
      author_name:      r.authorName,
      device:           r.device,
      is_deleted:       r.isDeleted,
    }));

    res.json({ error: 0, data });
  } catch (err) {
    console.error('❌ /api/mis-payments GET:', err.message);
    res.status(500).json({ error: 1, message: err.message });
  }
});

module.exports = router;
