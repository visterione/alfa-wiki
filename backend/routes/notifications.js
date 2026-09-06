'use strict';

/**
 * Уведомления пациентам: шаблоны и журнал отправок (ver. 7.86).
 *
 * Тексты правит администратор, а не программист — ровно так же, как он делал это
 * на экране Renovatio до переезда. Журнал открыт всем, кто работает на линии:
 * вопрос «почему человек не получил напоминание» задают операторам, и отвечать
 * на него они должны сами, а не через заявку.
 */

const express = require('express');
const { Op } = require('sequelize');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { NotifTemplate, NotifOutbox, OmniLineOperator, MedCenter } = require('../models');
const templates = require('../services/notifications/templates');
const sender = require('../services/notifications/sender');
const notifSettings = require('../services/notifications/settings');
const fromni = require('../services/messengers/fromni');
const { NotifOutbox: Outbox } = require('../models');

const router = express.Router();

const EVENTS = [
  'created', 'moved', 'cancelled', 'reminder', 'review',
  // Приходят толчком от МИС, а не находятся опросом: готовность результатов
  // через публичное API не спросить. Пока разбор события не написан, шаблоны
  // выключены — см. migrations/ver. 7.88.
  'lab_full', 'lab_partial'
];

// Подстановки показываем в интерфейсе списком: администратор вставляет их
// кнопкой, а не переписывает из документации.
const PLACEHOLDERS = [
  { key: 'имя', title: 'Имя пациента' },
  { key: 'фио', title: 'ФИО пациента' },
  { key: 'дата', title: 'Дата визита' },
  { key: 'время', title: 'Время визита' },
  { key: 'день_недели', title: 'День недели' },
  { key: 'врач', title: 'Врач (фамилия и инициалы)' },
  { key: 'врач_полностью', title: 'Врач полностью' },
  { key: 'клиника', title: 'Название клиники' },
  { key: 'адрес', title: 'Адрес клиники' },
  { key: 'телефон_клиники', title: 'Телефон клиники' },
  { key: 'старая_дата', title: 'Прежняя дата (перенос)' },
  { key: 'старое_время', title: 'Прежнее время (перенос)' }
];

/** Работает ли человек хоть на одной линии — журнал открыт только своим. */
async function isOperator(userId) {
  return (await OmniLineOperator.count({ where: { userId } })) > 0;
}

// ── Шаблоны ───────────────────────────────────────────────────────────────

router.get('/templates', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await NotifTemplate.findAll({ order: [['event', 'ASC'], ['beforeMinutes', 'ASC']] });
    const medCenters = await MedCenter.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });

    res.json({
      templates: rows,
      medCenters,
      events: EVENTS,
      placeholders: PLACEHOLDERS,
      // Предохранители показываем прямо здесь: без них половина отправок
      // помечается пропущенной, и это должно быть видно, а не выясняться.
      safety: {
        fromniAllowed: sender.ALLOW_FROMNI,
        pilotPhones: sender.PILOT_PHONES.length
      }
    });
  } catch (err) {
    console.error('[notifications] GET /templates:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/templates', authenticate, requireAdmin, async (req, res) => {
  try {
    const { event, text, smsText, medCenterId, beforeMinutes, withConfirm } = req.body || {};
    if (!EVENTS.includes(event)) return res.status(400).json({ error: 'Неизвестное событие' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой текст' });

    const row = await NotifTemplate.create({
      event,
      text: text.trim(),
      smsText: smsText ? String(smsText).trim() : null,
      medCenterId: medCenterId || null,
      beforeMinutes: event === 'reminder' ? (Number(beforeMinutes) || 1440) : null,
      withConfirm: !!withConfirm
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('[notifications] POST /templates:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/templates/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const row = await NotifTemplate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Шаблон не найден' });

    const { text, smsText, beforeMinutes, afterMinutes, frequency, withConfirm, isActive, medCenterId } = req.body || {};
    await row.update({
      text: text !== undefined ? String(text).trim() : row.text,
      // Пустая строка означает «нет отдельного текста для SMS» — уйдёт обычный.
      smsText: smsText !== undefined ? (String(smsText).trim() || null) : row.smsText,
      afterMinutes: row.event === 'review' && afterMinutes !== undefined
        ? (Number(afterMinutes) || null) : row.afterMinutes,
      frequency: row.event === 'review' && frequency !== undefined
        ? (['each', 'daily'].includes(frequency) ? frequency : row.frequency) : row.frequency,
      beforeMinutes: row.event === 'reminder' && beforeMinutes !== undefined
        ? (Number(beforeMinutes) || null) : row.beforeMinutes,
      withConfirm: withConfirm !== undefined ? !!withConfirm : row.withConfirm,
      isActive: isActive !== undefined ? !!isActive : row.isActive,
      medCenterId: medCenterId !== undefined ? (medCenterId || null) : row.medCenterId
    });
    res.json(row);
  } catch (err) {
    console.error('[notifications] PUT /templates/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/templates/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await NotifTemplate.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] DELETE /templates/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Предпросмотр: как текст будет выглядеть на живом примере. Дешевле, чем
 * записывать себя в МИС ради проверки запятой.
 */
router.post('/templates/preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const sample = {
      patientName: 'Иванов Иван Иванович',
      doctorName: 'Петрова Мария Сергеевна',
      timeStart: new Date(Date.now() + 24 * 3600 * 1000),
      clinicName: 'Альфа'
    };
    const values = templates.valuesFor(sample, {
      clinicName: sample.clinicName,
      clinicAddress: 'ул. Владимирская, 93',
      clinicPhone: '+7 (861) 000-00-00',
      previousAt: new Date(Date.now() - 48 * 3600 * 1000)
    });
    res.json({ text: templates.render(text, values) });
  } catch (err) {
    console.error('[notifications] POST /templates/preview:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ── Одобренные шаблоны Fromni ─────────────────────────────────────────────

/**
 * Что зарегистрировано у агрегатора. Метод отправки ищет совпадение с этими
 * текстами сам: нашёл — уходит Notify, не нашёл — молча SMS. Поэтому список
 * показываем рядом с полем текста, а не прячем в документации.
 */
router.get('/approved', authenticate, requireAdmin, async (req, res) => {
  const organization = req.query.organization || process.env.FROMNI_DEFAULT_ORG || 'alfa';
  try {
    res.json({ organization, templates: await fromni.templates(organization) });
  } catch (err) {
    // Недоступность агрегатора не должна ломать экран — он и без этого списка
    // полезен. Возвращаем причину, чтобы её было видно на месте.
    res.json({ organization, templates: [], error: err.message });
  }
});

// ── Тестовая отправка ─────────────────────────────────────────────────────

/**
 * Отправить одно сообщение на указанный номер, минуя детектор.
 *
 * Зачем: убедиться, что по SMS уходит именно наш текст, а не тот, что остался в
 * МИС. Иначе это проверяется только записью живого пациента и ожиданием.
 *
 * Предохранитель NOTIFIER_ALLOW_FROMNI здесь намеренно не действует: он защищает
 * от веерной рассылки по всей сети, а тут администратор вручную набрал один
 * номер и нажал кнопку. Запрещать это — значит сделать проверку невозможной.
 */
router.post('/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const { phone, step, templateId, text, smsText } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Нужен номер телефона' });

    let bodyText = text;
    let bodySms = smsText;

    if (templateId) {
      const template = await NotifTemplate.findByPk(templateId);
      if (!template) return res.status(404).json({ error: 'Шаблон не найден' });
      bodyText = template.text;
      bodySms = template.smsText;
    }
    if (!bodyText) return res.status(400).json({ error: 'Нечего отправлять' });

    // Подставляем те же примерные значения, что и в предпросмотре: проверяем
    // канал и текст, а не выборку из МИС.
    const sample = {
      patientName: 'Иванов Иван Иванович',
      doctorName: 'Петрова Мария Сергеевна',
      timeStart: new Date(Date.now() + 24 * 3600 * 1000),
      clinicName: 'Альфа'
    };
    const values = templates.valuesFor(sample, {
      clinicName: sample.clinicName,
      clinicAddress: 'ул. Владимирская, 93',
      clinicPhone: '+7 (861) 000-00-00'
    });

    const rendered = templates.render(bodyText, values);
    const renderedSms = bodySms ? templates.render(bodySms, values) : null;

    // Строка в очереди — чтобы проверка была видна в журнале наравне с боевыми
    // отправками, со своим исходом и причиной.
    const item = await Outbox.create({
      event: 'test',
      dedupKey: `test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      phone: String(phone),
      text: rendered,
      smsText: renderedSms,
      withConfirm: false,
      status: 'pending'
    });

    const result = await sender.sendTest(item, { step: step || 'auto' });
    res.json({ item: await item.reload(), result });
  } catch (err) {
    console.error('[notifications] POST /test:', err);
    res.status(500).json({ error: err.message || 'Не удалось отправить' });
  }
});

// ── Настройки рассылки ────────────────────────────────────────────────────

router.get('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json({
      cascade: await notifSettings.cascade(),
      quietHours: await notifSettings.quietHours(),
      // Из чего можно собрать каскад. «bot» — наши Telegram и MAX, остальное —
      // имена ступеней Fromni, как они называются в её API.
      available: [
        { name: 'bot', title: 'Наши боты (Telegram, MAX)' },
        { name: 'notify+vk', title: 'Notify и ВКонтакте' },
        { name: 'whatsapp-business', title: 'WhatsApp Business' },
        { name: 'viber', title: 'Viber' },
        { name: 'sms+webchat', title: 'SMS' }
      ],
      safety: { fromniAllowed: sender.ALLOW_FROMNI, pilotPhones: sender.PILOT_PHONES.length }
    });
  } catch (err) {
    console.error('[notifications] GET /settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const { cascade, quietHours } = req.body || {};

    if (Array.isArray(cascade)) {
      if (!cascade.length) return res.status(400).json({ error: 'Каскад не может быть пустым' });
      await notifSettings.write(notifSettings.CASCADE_KEY, cascade,
        'Порядок каскада уведомлений: bot — наши боты, дальше ступени Fromni');
    }

    if (quietHours && typeof quietHours === 'object') {
      await notifSettings.write(notifSettings.QUIET_KEY, {
        enabled: !!quietHours.enabled,
        from: String(quietHours.from || '21:00'),
        to: String(quietHours.to || '09:00'),
        channels: Array.isArray(quietHours.channels) ? quietHours.channels : []
      }, 'Тихие часы: сообщение откладывается до начала разрешённого времени');
    }

    res.json({ cascade: await notifSettings.cascade(), quietHours: await notifSettings.quietHours() });
  } catch (err) {
    console.error('[notifications] PUT /settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Журнал ────────────────────────────────────────────────────────────────

router.get('/outbox', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin && !await isOperator(req.user.id)) {
      return res.status(403).json({ error: 'Журнал доступен сотрудникам линии' });
    }

    const where = {};
    if (['pending', 'sent', 'failed', 'skipped'].includes(req.query.status)) {
      where.status = req.query.status;
    }
    if (req.query.phone) {
      where.phone = { [Op.iLike]: `%${String(req.query.phone).replace(/\D/g, '')}%` };
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await NotifOutbox.findAll({ where, order: [['createdAt', 'DESC']], limit });

    // Сводка за сутки — то, на что смотрят первым делом.
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const counts = {};
    for (const status of ['sent', 'failed', 'skipped', 'pending']) {
      counts[status] = await NotifOutbox.count({ where: { status, createdAt: { [Op.gte]: since } } });
    }

    res.json({ rows, counts });
  } catch (err) {
    console.error('[notifications] GET /outbox:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
