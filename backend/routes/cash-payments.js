const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { CashPayment, SalaryRecord, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const RB_ARCHIVE_SLUG = 'rb-archive';

async function recordHistory(userId, summary) {
  try {
    const page = await Page.findOne({ where: { slug: RB_ARCHIVE_SLUG } });
    await PageHistory.create({
      pageId: page ? page.id : null,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: { pageSlug: RB_ARCHIVE_SLUG }
    });
  } catch (err) {
    console.error('cash-payments history error:', err.message);
  }
}

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

function formatFinancistName(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const [last, first, mid] = parts;
  if (mid) return `${last} ${first[0]}. ${mid[0]}.`;
  return `${last} ${first[0]}.`;
}

// POST /api/cash-payments — зафиксировать выдачу из кассы
// Два режима:
//   Привязанный:    { salaryRecordId, amount, note? }
//   Свободный:      { misUserId, doctorName, periodLabel?, amount, note? }
router.post('/',
  authenticate,
  body('salaryRecordId').optional({ nullable: true }).isUUID().withMessage('salaryRecordId должен быть UUID'),
  body('misUserId').optional({ nullable: true }).isString().trim(),
  body('doctorName').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('periodLabel').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('amount').notEmpty().withMessage('amount обязателен').isFloat({ min: 0.01 }).withMessage('amount должен быть положительным числом'),
  body('note').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  validate,
  async (req, res) => {
  try {
    const { salaryRecordId, misUserId, doctorName, periodLabel, amount, note } = req.body;

    if (!salaryRecordId && !misUserId) {
      return res.status(400).json({ error: 'Необходим salaryRecordId или misUserId' });
    }

    const financistName = formatFinancistName(req.user.displayName || req.user.username || '');

    let paymentData;
    if (salaryRecordId) {
      const record = await SalaryRecord.findByPk(salaryRecordId);
      if (!record) return res.status(404).json({ error: 'Salary record not found' });
      paymentData = {
        salaryRecordId,
        misUserId: record.misUserId,
        doctorName: record.doctorName,
        periodLabel: record.periodLabel || (record.dateFrom ? record.dateFrom.toString().slice(0, 7) : null),
      };
    } else {
      paymentData = {
        salaryRecordId: null,
        misUserId: misUserId.trim(),
        doctorName: (doctorName || '').trim(),
        periodLabel: periodLabel || null,
      };
    }

    const payment = await CashPayment.create({
      ...paymentData,
      amount: parseFloat(amount),
      issuedAt: new Date(),
      issuedByUserId: req.user.id,
      financistName,
      note: note || null,
    });

    await recordHistory(req.user.id, `Выдача из кассы: ${paymentData.doctorName || ''}, ${parseFloat(amount).toFixed(2)} ₽`);

    res.json(payment);
  } catch (err) {
    console.error('POST /api/cash-payments error:', err);
    res.status(500).json({ error: err.message });
  }
});  // end POST /api/cash-payments

// GET /api/cash-payments?misUserId=X — все выдачи по сотруднику
// GET /api/cash-payments?salaryRecordId=X — выдачи по конкретной записи
// GET /api/cash-payments — все выдачи
router.get('/', authenticate, async (req, res) => {
  try {
    const where = {};
    if (req.query.salaryRecordId) where.salaryRecordId = req.query.salaryRecordId;
    if (req.query.misUserId) where.misUserId = req.query.misUserId;

    const payments = await CashPayment.findAll({
      where,
      order: [['issuedAt', 'DESC']],
    });
    res.json(payments);
  } catch (err) {
    console.error('GET /api/cash-payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cash-payments/:id — редактировать выдачу
router.put('/:id',
  authenticate,
  param('id').isUUID().withMessage('id должен быть UUID'),
  body('amount').optional({ nullable: true }).isFloat({ min: 0.01 }).withMessage('amount должен быть положительным числом'),
  body('note').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  body('financistName').optional({ nullable: true }).isString().isLength({ max: 100 }),
  validate,
  async (req, res) => {
  try {
    const payment = await CashPayment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Not found' });
    const { amount, note, financistName } = req.body;

    const changes = {};
    if (amount != null) {
      const oldVal = parseFloat(payment.amount).toFixed(2);
      const newVal = parseFloat(amount).toFixed(2);
      if (oldVal !== newVal) changes.amount = { from: oldVal, to: newVal };
      payment.amount = parseFloat(amount);
    }
    if (note !== undefined) {
      const oldNote = payment.note || null;
      const newNote = note || null;
      if (oldNote !== newNote) changes.note = { from: oldNote, to: newNote };
      payment.note = newNote;
    }
    if (financistName !== undefined) {
      const oldName = payment.financistName || null;
      const newName = financistName || null;
      if (oldName !== newName) changes.financistName = { from: oldName, to: newName };
      payment.financistName = newName;
    }

    if (Object.keys(changes).length > 0) {
      const editorName = formatFinancistName(req.user.displayName || req.user.username || '');
      const history = Array.isArray(payment.editHistory) ? [...payment.editHistory] : [];
      history.push({ editedBy: editorName, editedAt: new Date().toISOString(), changes });
      payment.editHistory = history;
      await recordHistory(req.user.id, `Изменена выдача: ${payment.doctorName || ''}, ${parseFloat(payment.amount).toFixed(2)} ₽`);
    }

    await payment.save();
    res.json(payment);
  } catch (err) {
    console.error('PUT /api/cash-payments/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});  // end PUT /api/cash-payments/:id

// DELETE /api/cash-payments/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const payment = await CashPayment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Not found' });
    await recordHistory(req.user?.id, `Удалена выдача: ${payment.doctorName || ''}, ${parseFloat(payment.amount).toFixed(2)} ₽`);
    await payment.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/cash-payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
