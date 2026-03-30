const express = require('express');
const router = express.Router();
const { CashPayment, SalaryRecord } = require('../models');
const { authenticate } = require('../middleware/auth');

function formatFinancistName(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const [last, first, mid] = parts;
  if (mid) return `${last} ${first[0]}. ${mid[0]}.`;
  return `${last} ${first[0]}.`;
}

// POST /api/cash-payments — зафиксировать выдачу из кассы
router.post('/', authenticate, async (req, res) => {
  try {
    const { salaryRecordId, amount, note } = req.body;
    if (!salaryRecordId || amount == null) return res.status(400).json({ error: 'salaryRecordId and amount required' });

    const record = await SalaryRecord.findByPk(salaryRecordId);
    if (!record) return res.status(404).json({ error: 'Salary record not found' });

    const financistName = formatFinancistName(req.user.displayName || req.user.username || '');

    const payment = await CashPayment.create({
      salaryRecordId,
      misUserId: record.misUserId,
      doctorName: record.doctorName,
      periodLabel: record.periodLabel || (record.dateFrom ? record.dateFrom.toString().slice(0, 7) : null),
      amount: parseFloat(amount),
      issuedAt: new Date(),
      issuedByUserId: req.user.id,
      financistName,
      note: note || null,
    });

    res.json(payment);
  } catch (err) {
    console.error('POST /api/cash-payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
router.put('/:id', authenticate, async (req, res) => {
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
    }

    await payment.save();
    res.json(payment);
  } catch (err) {
    console.error('PUT /api/cash-payments/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cash-payments/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const payment = await CashPayment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Not found' });
    await payment.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/cash-payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
