'use strict';

const { Op } = require('sequelize');
const { EmailLog, User } = require('../models');
const { sendBulkEmail } = require('./emailService');

// Обрабатывает одну рассылку за заход. У notifier один экземпляр под advisory
// lock; условный UPDATE дополнительно не даёт повторно забрать ту же строку,
// если функцию однажды вызовут параллельно из теста или ручного скрипта.
async function runOnce(now = new Date()) {
  const log = await EmailLog.findOne({
    where: { status: 'scheduled', scheduledAt: { [Op.lte]: now } },
    order: [['scheduledAt', 'ASC']]
  });
  if (!log) return { sent: 0, failed: 0 };

  const [claimed] = await EmailLog.update(
    { status: 'sending' },
    { where: { id: log.id, status: 'scheduled' } }
  );
  if (!claimed) return { sent: 0, failed: 0 };

  try {
    const sender = await User.findByPk(log.sentBy, { attributes: ['displayName', 'username'] });
    const result = await sendBulkEmail({
      subject: log.subject,
      htmlContent: log.htmlContent,
      recipients: log.recipients || [],
      attachments: log.attachments || [],
      senderInfo: sender?.displayName || sender?.username || 'Альфа Вики'
    });
    const status = result.failed === 0 ? 'sent' : (result.sent === 0 ? 'failed' : 'partial');
    await log.update({
      status,
      sentAt: new Date(),
      errorDetails: result.errors.length ? JSON.stringify(result.errors) : null
    });
    return { sent: result.sent, failed: result.failed };
  } catch (error) {
    await log.update({ status: 'failed', sentAt: new Date(), errorDetails: error.message });
    throw error;
  }
}

module.exports = { runOnce };
