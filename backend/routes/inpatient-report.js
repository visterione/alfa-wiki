'use strict';

/**
 * Отчёт по стационару: случаи стационарного лечения и деньги по ним.
 *
 * Кто лежал и сколько дней — берётся из порционного требования (снимки дней в
 * meal_requirement_stays), деньги — из МИС по карточке пациента за даты эпизода.
 * Логика в services/inpatientStats.js.
 *
 * Права — на уровне вики-страницы (Page.allowedRoles), как у самого требования:
 * здесь остаётся только проверка аутентификации. Данные персональные (ФИО
 * пациентов и суммы их лечения), так что страницу нельзя открывать шире круга,
 * которому эти цифры и так положены.
 */

const express = require('express');

const { authenticate } = require('../middleware/auth');
const stats = require('../services/inpatientStats');

const router = express.Router();

// Отбора по отделению нет: требование заполняет одна терапия, и пока второе
// отделение не заведёт свою страницу, выбирать не из чего. Сам сервис отбор
// умеет — вернуть фильтр будет одной строкой.
router.get('/report', authenticate, async (req, res) => {
  try {
    const report = await stats.getReport({
      from: String(req.query.from || ''),
      to: String(req.query.to || '')
    });
    res.json(report);
  } catch (err) {
    const status = /формате|позже|больше/.test(err.message) ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
});

router.post('/reset-cache', authenticate, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Только администратор' });
  stats.clearCache();
  res.json({ ok: true });
});

module.exports = router;
