const express = require('express');
const { Op } = require('sequelize');
const { ReferralReport } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Получить список отчётов (с пагинацией)
router.get('/', authenticate, async (req, res) => {
  try {
    const { reportType, misUserId, limit = 50, offset = 0 } = req.query;
    const where = {};
    if (reportType) where.reportType = reportType;
    if (misUserId) where.misUserId = misUserId;

    const { count, rows } = await ReferralReport.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: { exclude: ['reportData'] } // без данных для списка
    });

    res.json({ total: count, reports: rows });
  } catch (err) {
    console.error('Get referral reports error:', err);
    res.status(500).json({ error: 'Ошибка получения архива отчётов' });
  }
});

// Получить полный отчёт по ID (включая reportData)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const report = await ReferralReport.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    res.json(report);
  } catch (err) {
    console.error('Get referral report by id error:', err);
    res.status(500).json({ error: 'Ошибка получения отчёта' });
  }
});

// Сохранить отчёт в архив
router.post('/', authenticate, async (req, res) => {
  try {
    const { reportType, title, doctorName, misUserId, dateFrom, dateTo, totalAmount, reportData } = req.body;

    if (!reportType || !title || !reportData) {
      return res.status(400).json({ error: 'reportType, title, reportData обязательны' });
    }

    const report = await ReferralReport.create({
      reportType,
      title,
      doctorName: doctorName || null,
      misUserId: misUserId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      totalAmount: totalAmount != null ? parseFloat(totalAmount) : null,
      reportData,
      createdBy: req.user?.id || null
    });

    res.status(201).json({ id: report.id, message: 'Отчёт сохранён в архив' });
  } catch (err) {
    console.error('Save referral report error:', err);
    res.status(500).json({ error: 'Ошибка сохранения отчёта' });
  }
});

// Удалить отчёт из архива
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const report = await ReferralReport.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    await report.destroy();
    res.json({ message: 'Отчёт удалён' });
  } catch (err) {
    console.error('Delete referral report error:', err);
    res.status(500).json({ error: 'Ошибка удаления отчёта' });
  }
});

module.exports = router;
