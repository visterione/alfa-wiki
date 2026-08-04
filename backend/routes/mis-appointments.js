/**
 * API для работы с кэшем визитов МИС (таблица mis_appointments)
 *
 * GET  /api/mis-appointments/sync/status   – статус синхронизации + статистика БД
 * POST /api/mis-appointments/sync/trigger  – запустить синхронизацию (fire-and-forget)
 *   body: { date_from?: ISO, date_to?: ISO }  (по умолчанию 2026-02-01 → вчера)
 * GET  /api/mis-appointments               – получить визиты из БД
 *   query: date_from (ISO), date_to (ISO), clinic_id, room, status_id
 */

const express = require('express');
const router  = express.Router();
const { Op }  = require('sequelize');
const { authenticate } = require('../middleware/auth');
const { MisAppointment } = require('../models');
const { syncState, syncDateRange } = require('../services/misAppointmentsSync');
const { parseRequiredDateRange } = require('../utils/dateRange');

// ── GET /sync/status ──────────────────────────────────────────────────────────
router.get('/sync/status', authenticate, async (req, res) => {
  try {
    const totalInDb  = await MisAppointment.count();
    const lastSyncAt = await MisAppointment.max('syncedAt');
    res.json({ ...syncState, totalInDb, lastSyncAt: lastSyncAt || null });
  } catch (err) {
    console.error('❌ /mis-appointments/sync/status:', err.message);
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

// ── GET / — запрос визитов из БД ─────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { clinic_id, room, status_id } = req.query;
    const range = parseRequiredDateRange(req.query);
    if (range.error) {
      return res.status(400).json({ error: 1, message: range.error });
    }

    // Без обязательного периода endpoint мог случайно выгрузить все сотни тысяч
    // визитов в память Node.js и одним ответом отправить их клиенту.
    const where = {
      timeStart: { [Op.between]: [range.start, range.end] }
    };
    if (clinic_id) where.clinicId = Number(clinic_id);
    if (room)      where.room     = room;
    if (status_id) where.statusId = Number(status_id);

    const rows = await MisAppointment.findAll({
      where,
      attributes: ['apptId', 'clinicId', 'room', 'doctorId', 'patientId', 'timeStart', 'timeEnd', 'statusId', 'status'],
      raw: true,
    });

    // Нормализуем в snake_case как возвращает МИС API напрямую
    const data = rows.map(r => ({
      id:         r.apptId,
      clinic_id:  r.clinicId,
      room:       r.room,
      doctor_id:  r.doctorId,
      patient_id: r.patientId,
      time_start: r.timeStart,
      time_end:   r.timeEnd,
      status_id:  r.statusId,
      status:     r.status,
    }));

    res.json({ error: 0, data });
  } catch (err) {
    console.error('❌ /api/mis-appointments GET:', err.message);
    res.status(500).json({ error: 1, message: err.message });
  }
});

module.exports = router;
