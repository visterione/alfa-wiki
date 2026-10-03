'use strict';

/**
 * Вкладка «Счета» в админке открытой линии (ver. 9.33).
 *
 * Остатки, расходы по дням и счета текущей недели по шести кабинетам Имобиса.
 * Выписка и обход кабинетов идут в фоне — см. services/imobisBilling.js, там же
 * формула подсказки суммы.
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const billing = require('../services/imobisBilling');

const router = express.Router();

router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await billing.overview());
  } catch (err) {
    console.error('[imobis-billing] GET /:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Обновить расходы и статусы оплаты сейчас, не дожидаясь ночного обхода.
 * Отвечаем сразу: шесть входов в кабинет — это десятки секунд.
 */
router.post('/sync', authenticate, requireAdmin, async (req, res) => {
  if (billing.isSyncRunning()) return res.status(409).json({ error: 'Обновление уже идёт' });
  billing.syncAll().catch(err => console.error('[imobis-billing] sync:', err));
  res.status(202).json({ started: true });
});

router.post('/invoices', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await billing.startInvoices(req.body && req.body.items, req.user && req.user.id);
    res.status(202).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (/Сумма счёта/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error('[imobis-billing] POST /invoices:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/invoices/:id/pdf', authenticate, requireAdmin, async (req, res) => {
  try {
    const invoice = await billing.invoicePdf(req.params.id);
    if (!invoice || !invoice.pdf) return res.status(404).json({ error: 'Счёт не найден — возможно, неделя уже сменилась' });
    // Имя как у Имобиса, чтобы скачанное отсюда и из кабинета лежало в папке
    // бухгалтерии одинаково: «Счет 28B_ns459923 …».
    const name = `Счет ${invoice.number.replace('/', '_')} в системе смс-рассылок Imobis.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(invoice.pdf);
  } catch (err) {
    console.error('[imobis-billing] GET pdf:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
