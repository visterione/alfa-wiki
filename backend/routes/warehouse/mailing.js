/**
 * Настройка регламентной рассылки.
 *
 * Список подписок не хранится: он вычисляется из прав на отчёты. Здесь человек
 * видит, что ему положено, и может от чего угодно отказаться — почему отказ, а
 * не согласие, и почему выключить можно всё, см. services/warehouse/mailing.js.
 */

const express = require('express');
const router = express.Router();
const { WhMailOptOut, WhMailLog, User } = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse } = require('../../services/warehouse/access');
const perms = require('../../services/warehouse/permissions');
const { MAILINGS, recipientsFor, runMailing, buildFor } = require('../../services/warehouse/mailing');

/**
 * Мои рассылки: что положено по правам и что из этого выключено.
 *
 * Отдельно возвращается адрес: без него человек не поймёт, почему письма нет, —
 * а пустая почта в карточке самая частая тому причина.
 */
router.get('/subscriptions', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const optOuts = new Set(
      (await WhMailOptOut.findAll({ where: { userId: req.user.id }, attributes: ['reportCode'] }))
        .map(o => o.reportCode),
    );

    const items = Object.entries(MAILINGS)
      .filter(([code]) => perms.canReadReport(req.warehouse.perms, code))
      .map(([code, config]) => ({
        code,
        label: config.label,
        schedule: config.schedule,
        enabled: !optOuts.has(code),
      }));

    const me = await User.findByPk(req.user.id, { attributes: ['email'] });
    res.json({
      email: me?.email || null,
      // Рассылки без адреса не дойдут, и сказать об этом надо здесь, а не в логе
      // воркера, куда получатель не смотрит.
      deliverable: Boolean(me?.email && me.email.includes('@')),
      items,
    });
  } catch (err) {
    console.error('GET warehouse/mailing/subscriptions error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Включить или выключить одну рассылку себе. */
router.put('/subscriptions/:code', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { code } = req.params;
    if (!MAILINGS[code]) return res.status(404).json({ error: 'Такой рассылки нет' });
    if (!perms.canReadReport(req.warehouse.perms, code)) {
      return res.status(403).json({ error: 'Этот отчёт вам недоступен' });
    }

    if (req.body.enabled === false) {
      await WhMailOptOut.findOrCreate({ where: { userId: req.user.id, reportCode: code } });
    } else {
      await WhMailOptOut.destroy({ where: { userId: req.user.id, reportCode: code } });
    }
    res.json({ code, enabled: req.body.enabled !== false });
  } catch (err) {
    console.error('PUT warehouse/mailing/subscriptions error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Кто получит рассылку и с чем — без отправки.
 *
 * Нужно при настройке: правило получателя выведено из прав и зоны видимости, и
 * убедиться, что оно даёт ожидаемый список, надо ДО первого утра. Доступно тем,
 * кто и так раздаёт права.
 */
router.get('/preview/:code', authenticate, requireWarehouse(), async (req, res) => {
  try {
    if (!req.user.isAdmin && !req.warehouse.capabilities?.canManagePermissions) {
      return res.status(403).json({ error: 'Недоступно' });
    }
    const { code } = req.params;
    if (!MAILINGS[code]) return res.status(404).json({ error: 'Такой рассылки нет' });

    const candidates = await recipientsFor(code);
    const report = await runMailing(code, { dryRun: true });

    res.json({
      code,
      label: MAILINGS[code].label,
      schedule: MAILINGS[code].schedule,
      candidates: candidates.map(c => ({ id: c.user.id, name: c.user.displayName, email: c.user.email })),
      wouldSend: report.sent,
      wouldSkip: report.skipped,
      details: report.details,
    });
  } catch (err) {
    console.error('GET warehouse/mailing/preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Свой отчёт — тот же, что приходит письмом, но по требованию (ver. 7.25).
 *
 * Нужен мобильному приложению: push приносит короткий текст, а сам отчёт и файл
 * человек открывает здесь. Без format=file отдаётся сводка для экрана, с ним —
 * готовый XLSX, тот же самый, что уходит вложением.
 *
 * Права не проверяются отдельно: buildFor считает их тем же кодом, что и
 * рассылка, и отвечает null, если отчёт человеку не положен.
 */
router.get('/report/:code', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { code } = req.params;
    if (!MAILINGS[code]) return res.status(404).json({ error: 'Такой рассылки нет' });

    const letter = await buildFor(code, req.user);
    if (!letter) {
      // Пусто — это не ошибка: у отчёта по срокам годности «нечего сообщать»
      // нормальное состояние, и экран должен показать именно это, а не сбой.
      return res.json({ code, label: MAILINGS[code].label, empty: true });
    }

    if (req.query.format === 'file') {
      const file = (letter.attachments || [])[0];
      if (!file) return res.status(404).json({ error: 'У этого отчёта нет файла' });
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      );
      return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(file.content);
    }

    return res.json({
      code,
      label: MAILINGS[code].label,
      schedule: MAILINGS[code].schedule,
      empty: false,
      subject: letter.subject,
      itemCount: letter.itemCount,
      alert: letter.alert || null,
      fileName: (letter.attachments || [])[0]?.filename || null,
    });
  } catch (err) {
    console.error('GET warehouse/mailing/report error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/** Последние отправки — чтобы «мне не пришло» разбиралось фактами. */
router.get('/log', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const where = req.user.isAdmin || req.warehouse.capabilities?.canManagePermissions
      ? {}
      : { userId: req.user.id };
    const rows = await WhMailLog.findAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'displayName'] }],
      order: [['sentAt', 'DESC']],
      limit: 200,
    });
    res.json({ items: rows });
  } catch (err) {
    console.error('GET warehouse/mailing/log error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
