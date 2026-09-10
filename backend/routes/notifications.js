'use strict';

/**
 * Уведомления пациентам: шаблоны и журнал отправок (ver. 7.86, доступ — 8.02).
 *
 * Тексты правит администратор, а не программист — ровно так же, как он делал это
 * на экране Renovatio до переезда.
 *
 * Журнал до 8.02 был открыт и операторам: считалось, что на вопрос «почему
 * человек не получил напоминание» колл-центр должен отвечать сам. На деле рядом
 * с журналом в том же разделе лежали каскад, тихие часы и токены, и оператор
 * попадал туда одним промахом мимо вкладки. Настройки уехали в админку целиком,
 * и журнал уехал вместе с ними: разбирать недоставку всё равно приходится тому,
 * кто может поправить причину.
 */

const express = require('express');
const { Op } = require('sequelize');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { NotifTemplate, NotifOutbox, MedCenter, NotifBranchSettings, MessengerBot } = require('../models');
const { getChannel } = require('../services/messengers');
const templates = require('../services/notifications/templates');
const sender = require('../services/notifications/sender');
const safety = require('../services/notifications/safety');
const notifSettings = require('../services/notifications/settings');
const doctorBlocklist = require('../services/notifications/doctorBlocklist');
const imobis = require('../services/messengers/imobis');
const { NotifOutbox: Outbox } = require('../models');

const router = express.Router();

// Организации: к какой из них относится бот и по какой выбирается лицевой счёт
// у провайдера. Нужен интерфейсу заведения ботов — там организацию выбирают из
// списка, а не набирают ключом руками.
/**
 * Что сейчас разрешено отправлять наружу (ver. 8.06).
 *
 * До 8.06 интерфейс показывал один признак — «вторая ступень Fromni выключена» —
 * и этим вводил в заблуждение: предохранитель стоял внутри ветки Fromni, ниже
 * ветки Имобиса, и прямая отправка SMS через Имобис проходила мимо него вовсе.
 * Экран сообщал о безопасном режиме, которого не было.
 *
 * Поэтому отдаём состояние по каждому провайдеру, а не одну галку: утверждение
 * «наружу ничего не уходит» должно быть проверяемым, а не общим.
 */
const PROVIDER_TITLES = {
  imobis: 'Имобис (SMS напрямую)',
  fromni: 'Fromni (Notify, SMS)'
};

async function safetyState() {
  const state = await safety.read();
  return {
    providers: safety.EXTERNAL_PROVIDERS.map(name => ({
      name,
      title: PROVIDER_TITLES[name] || name,
      allowed: state.allowExternal.includes(name)
    })),
    // Ограничение круга получателей — вторая половина безопасного режима, и о
    // ней экран раньше не говорил вовсе.
    pilotPhones: state.pilotPhones,
    // Замок на сервере: переключатель виден, но не работает. Нужен на время
    // пилота, когда снятие должно требовать доступа к серверу.
    locked: state.locked,
    changedBy: state.changedBy,
    changedAt: state.changedAt
  };
}

// Адрес, по которому платформа стучится к нам. Совпадает с routes/
// messenger-webhook.js и с routes/open-line.js — менять во всех трёх.
function botWebhookUrl(bot) {
  const base = (process.env.BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');
  return `${base}/api/messenger/${bot.platform}/${bot.id}`;
}

const ORGANIZATIONS = [
  { key: 'alfa',        name: 'Альфа' },
  { key: 'alfa-deti',   name: 'Альфа Дети' },
  { key: 'alfa-liniya', name: 'Альфа Линия' },
  { key: 'alfa-prof',   name: 'Альфа Проф' },
  { key: 'alfa-smile',  name: 'Альфа Смайл' },
  { key: 'alfa-3k',     name: 'Альфа 3К' }
];

const EVENTS = [
  'created', 'moved', 'cancelled', 'reminder', 'review',
  // Приходят толчком от МИС, а не находятся опросом: готовность результатов
  // через публичное API не спросить. Пока разбор события не написан, шаблоны
  // выключены — см. migrations/ver. 7.88.
  'lab_full', 'lab_partial'
];

const TEMPLATE_CHANNELS = ['telegram', 'max', 'notify', 'sms'];

// Подстановки показываем в интерфейсе списком: администратор вставляет их
// кнопкой, а не переписывает из документации.
const PLACEHOLDERS = [
  { key: 'логин_пациента', title: 'Логин пациента', group: 'Пациент' },
  { key: 'фио_пациента', title: 'ФИО пациента', group: 'Пациент' },
  { key: 'имя_пациента', title: 'Имя пациента', group: 'Пациент' },
  { key: 'фамилия_пациента', title: 'Фамилия пациента', group: 'Пациент' },
  { key: 'отчество_пациента', title: 'Отчество пациента', group: 'Пациент' },
  { key: 'дата_и_время_начала', title: 'Дата и время начала', group: 'Визит' },
  { key: 'дата_и_время_начала_без_года', title: 'Дата и время начала (без года)', group: 'Визит' },
  { key: 'дата_и_время_начала_формат', title: 'Дата и время начала (формат)', group: 'Визит' },
  { key: 'дата_и_время_начала_формат_без_года', title: 'Дата и время начала (формат без года)', group: 'Визит' },
  { key: 'дата_начала', title: 'Дата начала', group: 'Визит' },
  { key: 'дата_начала_без_года', title: 'Дата начала (без года)', group: 'Визит' },
  { key: 'время_начала', title: 'Время начала', group: 'Визит' },
  { key: 'дата_и_время_окончания', title: 'Дата и время окончания', group: 'Визит' },
  { key: 'дата_окончания', title: 'Дата окончания', group: 'Визит' },
  { key: 'время_окончания', title: 'Время окончания', group: 'Визит' },
  { key: 'полное_фио_врача', title: 'Полное ФИО врача', group: 'Врач' },
  { key: 'фио_врача', title: 'ФИО врача', group: 'Врач' },
  { key: 'дата_резерва', title: 'Дата резерва', group: 'Резерв' },
  { key: 'дата_резерва_без_года', title: 'Дата резерва (без года)', group: 'Резерв' },
  { key: 'время_резерва', title: 'Время резерва', group: 'Резерв' },
  { key: 'дата_и_время_резерва', title: 'Дата и время резерва', group: 'Резерв' },
  { key: 'специальность_резерва', title: 'Специальность резерва', group: 'Резерв' },
  { key: 'кабинет', title: 'Кабинет', group: 'Резерв' },
  { key: 'название_организации', title: 'Название организации', group: 'Филиал' },
  { key: 'телефон_организации', title: 'Телефон организации', group: 'Филиал' },
  { key: 'название_клиники', title: 'Название клиники', group: 'Филиал' },
  { key: 'телефон_клиники', title: 'Телефон клиники', group: 'Филиал' },
  { key: 'адрес_клиники', title: 'Адрес клиники', group: 'Филиал' },
  { key: 'текущая_дата', title: 'Текущая дата', group: 'Даты' },
  { key: 'текущая_дата_без_года', title: 'Текущая дата (без года)', group: 'Даты' },
  { key: 'название_документа', title: 'Название документа', group: 'Документ' },
  { key: 'фио_автора_документа', title: 'ФИО автора документа', group: 'Документ' },
  { key: 'дата_визита', title: 'Дата визита', group: 'Документ' },
  { key: 'время_визита', title: 'Время визита', group: 'Документ' },
  { key: 'дата_документа', title: 'Дата документа', group: 'Документ' },
  { key: 'время_документа', title: 'Время документа', group: 'Документ' },
  { key: 'название_клиники_документа', title: 'Название клиники документа', group: 'Документ' },
  { key: 'день_недели', title: 'День недели', group: 'Дополнительно' },
  { key: 'старая_дата', title: 'Прежняя дата (перенос)', group: 'Дополнительно' },
  { key: 'старое_время', title: 'Прежнее время (перенос)', group: 'Дополнительно' }
];

function previewValues(medCenter = null) {
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  const clinicName = medCenter?.name || 'Альфа';
  const phones = Array.isArray(medCenter?.phones) ? medCenter.phones : [];
  const sample = {
    patientNumber: 'PAT-12345',
    patientName: 'Иванов Иван Иванович',
    doctorName: 'Петрова Мария Сергеевна',
    timeStart: start,
    timeEnd: new Date(start.getTime() + 40 * 60000),
    reservedAt: new Date(),
    reserveSpecialty: 'Терапевт',
    room: '305',
    documentName: 'Медицинское заключение',
    documentAuthorName: 'Петрова Мария Сергеевна',
    documentAt: new Date(),
    documentClinicName: clinicName
  };
  return templates.valuesFor(sample, {
    clinicName,
    clinicAddress: medCenter?.address || 'ул. Владимирская, 93',
    clinicPhone: phones[0]?.value || '+7 (861) 000-00-00',
    organizationName: 'ООО «Альфа»',
    organizationPhone: '+7 (861) 000-00-00',
    previousAt: new Date(start.getTime() - 48 * 3600 * 1000)
  });
}

router.get('/blocked-doctors', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json({ doctors: await doctorBlocklist.read() });
  } catch (err) {
    console.error('[notifications] GET /blocked-doctors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/blocked-doctors', authenticate, requireAdmin, async (req, res) => {
  try {
    const doctors = req.body?.doctors;
    if (!Array.isArray(doctors)) return res.status(400).json({ error: 'Нужен список врачей' });
    if (doctors.length > 500) return res.status(400).json({ error: 'Слишком большой список врачей' });
    res.json({ doctors: await doctorBlocklist.write(doctors) });
  } catch (err) {
    console.error('[notifications] PUT /blocked-doctors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Шаблоны ───────────────────────────────────────────────────────────────

router.get('/templates', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await NotifTemplate.findAll({
      where: { medCenterId: { [Op.ne]: null } },
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }],
      order: [['event', 'ASC'], ['beforeMinutes', 'ASC']]
    });
    const medCenters = await MedCenter.findAll({
      attributes: ['id', 'name'],
      where: { servesPatients: true, isActive: true },
      order: [['name', 'ASC']]
    });

    res.json({
      templates: rows,
      medCenters,
      events: EVENTS,
      placeholders: PLACEHOLDERS,
      // Предохранители показываем прямо здесь: без них половина отправок
      // помечается пропущенной, и это должно быть видно, а не выясняться.
      safety: await safetyState()
    });
  } catch (err) {
    console.error('[notifications] GET /templates:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/templates', authenticate, requireAdmin, async (req, res) => {
  try {
    const { event, text, smsText, channelTexts, medCenterId, beforeMinutes, withConfirm } = req.body || {};
    if (!EVENTS.includes(event)) return res.status(400).json({ error: 'Неизвестное событие' });
    if (!medCenterId) return res.status(400).json({ error: 'Нужно выбрать филиал' });

    const medCenter = await MedCenter.findOne({
      where: { id: medCenterId, servesPatients: true, isActive: true }
    });
    if (!medCenter) return res.status(400).json({ error: 'Филиал не найден или не принимает пациентов' });

    const cleanChannelTexts = {};
    for (const channel of TEMPLATE_CHANNELS) {
      const value = String(channelTexts?.[channel] ?? '').trim();
      if (value) cleanChannelTexts[channel] = value;
    }
    if (!String(text || '').trim() && Object.keys(cleanChannelTexts).length === 0) {
      return res.status(400).json({ error: 'Пустой текст' });
    }

    const row = await NotifTemplate.create({
      event,
      text: String(text || '').trim() || null,
      smsText: smsText ? String(smsText).trim() : null,
      channelTexts: cleanChannelTexts,
      medCenterId,
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
    if (!row.medCenterId) {
      return res.status(409).json({ error: 'Общие шаблоны больше не используются; примените миграцию 8.11' });
    }

    const { text, smsText, channelTexts, cascade, beforeMinutes, afterMinutes,
            frequency, withConfirm, isActive } = req.body || {};

    // Тексты каналов (ver. 8.03). Пустые ключи выбрасываем, а не храним пустыми
    // строками: «нет своего текста» и «текст из одного пробела» — разные вещи,
    // и отправщик отличает их именно по отсутствию ключа.
    let nextChannelTexts = row.channelTexts;
    if (channelTexts !== undefined && channelTexts && typeof channelTexts === 'object') {
      nextChannelTexts = {};
      for (const channel of TEMPLATE_CHANNELS) {
        const value = String(channelTexts[channel] ?? '').trim();
        if (value) nextChannelTexts[channel] = value;
      }
    }

    await row.update({
      text: text !== undefined ? String(text).trim() : row.text,
      // Пустая строка означает «нет отдельного текста для SMS» — уйдёт обычный.
      smsText: smsText !== undefined ? (String(smsText).trim() || null) : row.smsText,
      channelTexts: nextChannelTexts,
      // Пустой список означает «идти общим каскадом», поэтому в базу кладём null,
      // а не []: пустой массив прочитался бы как «не слать никуда».
      cascade: cascade !== undefined
        ? ((Array.isArray(cascade) && cascade.length) ? cascade : null)
        : row.cascade,
      afterMinutes: row.event === 'review' && afterMinutes !== undefined
        ? (Number(afterMinutes) || null) : row.afterMinutes,
      frequency: row.event === 'review' && frequency !== undefined
        ? (['each', 'daily'].includes(frequency) ? frequency : row.frequency) : row.frequency,
      beforeMinutes: row.event === 'reminder' && beforeMinutes !== undefined
        ? (Number(beforeMinutes) || null) : row.beforeMinutes,
      withConfirm: withConfirm !== undefined ? !!withConfirm : row.withConfirm,
      isActive: isActive !== undefined ? !!isActive : row.isActive
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
    res.json({ text: templates.render(text, previewValues()) });
  } catch (err) {
    console.error('[notifications] POST /templates/preview:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// ── Отчёты о доставке ─────────────────────────────────────────────────────

// Соответствие статусов провайдера нашим. «sent» у них означает «передано
// оператору, окончательный статус не получен» — это ещё не доставка.
const DELIVERED = ['delivered', 'read'];
const FAILED = ['rejected', 'undelivered', 'expired', 'deleted', 'error'];

/**
 * Приёмник статусов доставки. Адрес передаётся провайдеру в самом запросе на
 * отправку — этим прямое подключение и отличается от агрегатора, у которого
 * судьба сообщения оставалась невидимой.
 *
 * Открыт наружу без авторизации: провайдер ходит без нашего токена, подлинность
 * проверяется секретом в пути. Отвечаем 200 всегда, когда секрет сошёлся, —
 * иначе он будет копить повторы из-за нашей неготовности разобрать формат.
 */
router.all('/report/:secret', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
  const secret = process.env.NOTIF_REPORT_SECRET || process.env.MIS_EVENTS_SECRET;
  if (!secret || req.params.secret !== secret) return res.status(404).send('Not found');

  try {
    const body = req.body || {};
    const reports = Array.isArray(body) ? body : (Array.isArray(body.reports) ? body.reports : [body]);

    for (const report of reports) {
      const customId = report.custom_id || report.customId;
      const messageId = report.id || report.message_id || report.messageId;
      const status = String(report.status || report.state || '').toLowerCase();
      if (!status) continue;

      const where = customId ? { id: customId }
        : (messageId ? { externalMessageId: String(messageId) } : null);
      if (!where) continue;

      const item = await Outbox.findOne({ where });
      if (!item) continue;

      await item.update({
        deliveryStatus: status,
        deliveredAt: DELIVERED.includes(status) ? new Date() : item.deliveredAt,
        // Причину отказа сохраняем в тот же столбец, где живут наши ошибки:
        // оператору всё равно, на каком этапе не сложилось.
        error: FAILED.includes(status)
          ? (report.error || report.error_code || `провайдер: ${status}`)
          : item.error
      });

      console.log(`[report] ${item.id} → ${status}`);
    }
  } catch (err) {
    console.error('[report] не смог разобрать отчёт:', err.message);
  }

  res.status(200).json({ ok: true });
});

// ── Одобренные шаблоны Fromni ─────────────────────────────────────────────

// ── Тестовая отправка ─────────────────────────────────────────────────────

/**
 * Отправить одно сообщение на указанный номер, минуя детектор.
 *
 * Зачем: убедиться, что по SMS уходит именно наш текст, а не тот, что остался в
 * МИС. Иначе это проверяется только записью живого пациента и ожиданием.
 *
 * Предохранитель NOTIFIER_ALLOW_EXTERNAL здесь намеренно не действует: он
 * защищает от веерной рассылки по всей сети, а тут администратор вручную набрал
 * один номер и нажал кнопку. Запрещать это — значит сделать проверку
 * невозможной.
 */
router.post('/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const { phone, step, templateId, text, smsText } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Нужен номер телефона' });

    let bodyText = text;
    let bodySms = smsText;
    let bodyChannels = {};
    let sampleMedCenter = null;

    if (templateId) {
      const template = await NotifTemplate.findByPk(templateId, {
        include: [{
          model: MedCenter,
          as: 'medCenter',
          attributes: ['name', 'address', 'phones']
        }]
      });
      if (!template) return res.status(404).json({ error: 'Шаблон не найден' });
      bodyText = template.text;
      bodySms = template.smsText;
      bodyChannels = template.channelTexts || {};
      sampleMedCenter = template.medCenter;
    }
    if (!bodyText && !bodySms && Object.keys(bodyChannels).length === 0) {
      return res.status(400).json({ error: 'Нечего отправлять' });
    }

    // Подставляем те же примерные значения, что и в предпросмотре: проверяем
    // канал и текст, а не выборку из МИС.
    const values = previewValues(sampleMedCenter);

    const rendered = bodyText ? templates.render(bodyText, values) : '';
    const renderedSms = bodySms ? templates.render(bodySms, values) : null;
    const renderedChannels = Object.fromEntries(
      Object.entries(bodyChannels)
        .filter(([, value]) => value && String(value).trim())
        .map(([channel, value]) => [channel, templates.render(String(value), values)])
    );

    // Строка в очереди — чтобы проверка была видна в журнале наравне с боевыми
    // отправками, со своим исходом и причиной.
    const item = await Outbox.create({
      event: 'test',
      dedupKey: `test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      phone: String(phone),
      text: rendered,
      smsText: renderedSms,
      channelTexts: renderedChannels,
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
    const imobisConfig = await notifSettings.imobis();

    res.json({
      cascade: await notifSettings.cascade(),
      quietHours: await notifSettings.quietHours(),
      imobis: await notifSettings.imobis(),
      imobisReady: !!(process.env.IMOBIS_TOKEN || process.env.IMOBIS_TOKEN_ALFA),
      // Из чего можно собрать каскад. «bot» — наши Telegram и MAX, остальное —
      // имена ступеней Fromni, как они называются в её API.
      // Ступени с префиксом imobis: идут напрямую к провайдеру, остальные —
      // через Fromni. Подряд идущие ступени одного провайдера отправляются
      // одним запросом: их собственный каскад останавливается на доставленной.
      // Ступени, из которых собирается каскад. Список короткий намеренно:
      // ВКонтакте, Viber и WhatsApp убраны в 8.03 по решению заказчика — сеть
      // ими не пользуется, а в настройке они занимали половину списка и
      // предлагали завести то, чего не будет. Вернуть — дописать строку сюда.
      // Ступени, из которых собирается каскад. Telegram и MAX порознь с 8.04:
      // это два разных мессенджера, и приоритет между ними — решение заказчика.
      // Список короткий намеренно: ВКонтакте, Viber и WhatsApp убраны в 8.03,
      // сеть ими не пользуется.
      available: [
        { name: 'telegram',    title: 'Telegram-бот', provider: 'Вики',   channel: 'telegram' },
        { name: 'max',         title: 'MAX-бот',      provider: 'Вики',   channel: 'max' },
        { name: 'imobis:sms',  title: 'SMS напрямую', provider: 'Имобис', channel: 'sms' },
        { name: 'notify+vk',   title: 'Notify',       provider: 'Fromni', channel: 'notify' },
        { name: 'sms+webchat', title: 'SMS',          provider: 'Fromni', channel: 'sms' }
      ],
      organizations: ORGANIZATIONS,
      // Токен Имобиса правится в интерфейсе с 8.04. Сам токен наружу не отдаём —
      // только признак, что он задан: показывать секрет в ответе API незачем, а
      // «задан ли он вообще» — единственное, что нужно знать форме, чтобы не
      // затереть его пустым значением.
      //
      // Ключей Fromni здесь нет намеренно: от неё уходят в пользу собственной
      // отправки, и заводить настройку под то, что сворачивают, незачем. Она
      // продолжает работать от FROMNI_KEY_* из .env, пока нужна.
      credentials: {
        imobisTokenSet: !!(imobisConfig.token || process.env.IMOBIS_TOKEN),
        imobisTokenFromEnv: !imobisConfig.token && !!process.env.IMOBIS_TOKEN
      },
      safety: await safetyState()
    });
  } catch (err) {
    console.error('[notifications] GET /settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Счёт у Имобиса (ver. 8.02).
 *
 * Единственная цифра о деньгах, которую провайдер вообще отдаёт. Их API v3 —
 * это /balance, /info, /senders и отправка; отчёта о расходах, детализации по
 * каналам и прайса в нём нет (проверено перебором путей: несуществующие
 * отвечают 404, живые — 403 без токена). Поэтому «сколько потратили за месяц»
 * приходится считать у себя по журналу отправок, а отсюда берётся только
 * остаток на счету — чтобы рассылка не встала молча в выходные.
 */
router.get('/balance', authenticate, requireAdmin, async (req, res) => {
  try {
    const config = await notifSettings.imobis();
    const data = await imobis.balance(req.query.organization || null, !!config.sandbox, config.token);

    // Ответ у них не типизирован: в разных версиях приходило и число, и строка,
    // и объект. Приводим к числу здесь, чтобы интерфейс не гадал.
    const raw = data && (data.balance != null ? data.balance : data.result);
    const value = Number(String(raw).replace(',', '.'));

    res.json({
      balance: Number.isFinite(value) ? value : null,
      currency: (data && data.currency) || 'RUB',
      sandbox: !!config.sandbox,
      raw: data
    });
  } catch (err) {
    // Не 500: отсутствие токена или недоступность провайдера — обычное
    // состояние тестовой машины, и ронять из-за него всю вкладку незачем.
    res.json({ balance: null, error: err.message });
  }
});

router.put('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    // Именуем иначе, чем модуль imobis выше: это тело запроса, а не провайдер.
    const { cascade, quietHours, imobis: imobisPatch } = req.body || {};

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

    if (imobisPatch && typeof imobisPatch === 'object') {
      const current = await notifSettings.imobis();
      await notifSettings.write(notifSettings.IMOBIS_KEY, {
        ...current,
        // Токен правится в интерфейсе с 8.04. Пустая строка означает «вернуться
        // к .env», а не «стереть доступ»: иначе случайное сохранение пустой
        // формы обрывало бы рассылку, и понять почему было бы нечем.
        token: imobisPatch.token !== undefined ? String(imobisPatch.token || '').trim() : (current.token || ''),
        sender: imobisPatch.sender !== undefined ? String(imobisPatch.sender || '').trim() : current.sender,
        vkGroup: imobisPatch.vkGroup !== undefined ? (Number(imobisPatch.vkGroup) || null) : current.vkGroup,
        sandbox: imobisPatch.sandbox !== undefined ? !!imobisPatch.sandbox : current.sandbox
      }, 'Имобис напрямую: токен, имя отправителя, группа ВК, режим песочницы');
    }

    res.json({
      cascade: await notifSettings.cascade(),
      quietHours: await notifSettings.quietHours(),
      imobis: await notifSettings.imobis()
    });
  } catch (err) {
    console.error('[notifications] PUT /settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Предохранители: кому разрешено отправлять наружу и на какие номера (ver. 8.06).
 *
 * Отдельным маршрутом, а не полем в общих настройках, намеренно. Снятие
 * предохранителя — не рядовая правка: после него сообщения идут живым
 * пациентам. Его не должно случайно унести вместе с сохранением формы, где
 * человек менял тихие часы.
 */
router.get('/safety', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await safetyState());
  } catch (err) {
    console.error('[notifications] GET /safety:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/safety', authenticate, requireAdmin, async (req, res) => {
  try {
    const { allowExternal, pilotPhones } = req.body || {};

    const before = await safety.read();
    await safety.write({ allowExternal, pilotPhones }, req.user);
    const after = await safety.read();

    // Снятие пишем в журнал сервера отдельной строкой: по логам восстанавливают
    // порядок событий, когда выясняют, почему пациент получил два уведомления.
    const opened = after.allowExternal.filter(p => !before.allowExternal.includes(p));
    if (opened.length) {
      console.warn(`[notifications] ОТПРАВКА НАРУЖУ ВКЛЮЧЕНА: ${opened.join(', ')} — ` +
        `${req.user.displayName || req.user.username} (${req.user.id})`);
    }

    res.json(await safetyState());
  } catch (err) {
    if (err.code === 'locked') return res.status(409).json({ error: err.message });
    console.error('[notifications] PUT /safety:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Филиалы (ver. 8.03, владеют каналами с 8.05) ──────────────────────────
//
// Филиал — единица настройки: у него свои боты, свой лицевой счёт у провайдера
// и своё имя отправителя, потому что имя проходит модерацию у операторов связи
// на конкретное юрлицо. До 8.05 всё это лежало по разным основаниям — боты по
// «организации», токен одной строкой на сеть, а сам филиал был галочкой
// «подключён».
//
// Общая настройка (settings.notif_imobis) осталась основанием, а не исчезла:
// сеть чаще всего живёт на одном счету, и заставлять вписывать один токен
// девять раз значило бы менять одну беду на другую. Филиал заполняет своё поле
// только тогда, когда счёт у него действительно отдельный, — и в ответе видно,
// какое значение откуда взялось.

router.get('/branches', authenticate, requireAdmin, async (req, res) => {
  try {
    // Только филиалы, куда ходит пациент: АУП и «Направители» — подразделения
    // для учёта, и предлагать завести им рассылку значит предлагать рассылать
    // туда, где рассылать некому (ver. 8.04).
    const medCenters = await MedCenter.findAll({
      attributes: ['id', 'name', 'botOrganization'],
      where: { servesPatients: true },
      order: [['name', 'ASC']]
    });

    const rows = await NotifBranchSettings.findAll();
    const byId = new Map(rows.map(r => [r.medCenterId, r.toJSON()]));

    const bots = await MessengerBot.findAll({
      order: [['platform', 'ASC']]
    });

    const common = await notifSettings.imobis();

    // Состояние вебхука спрашиваем у платформы: строка в базе говорит, каким
    // режим задумывался, а не каким он получился. Расхождение между ними —
    // самая частая причина «бот молчит», и видно её только отсюда.
    const botView = await Promise.all(bots.map(async (bot) => {
      let webhook;
      try {
        const info = await getChannel(bot.platform).getWebhookInfo(bot.token);
        webhook = { url: info.url || '', error: info.last_error_message || null, pending: info.pending_update_count || 0 };
      } catch (err) {
        webhook = { url: '', error: err.message, pending: 0 };
      }
      return {
        id: bot.id,
        medCenterId: bot.medCenterId,
        platform: bot.platform,
        organization: bot.organization,
        username: bot.username,
        deliveryMode: bot.deliveryMode,
        isActive: bot.isActive,
        misCategoryId: bot.misCategoryId,
        tokenTail: bot.token ? `…${String(bot.token).slice(-6)}` : '',
        expectedWebhook: botWebhookUrl(bot),
        webhook
      };
    }));

    res.json({
      branches: medCenters.map(mc => {
        const own = byId.get(mc.id) || null;
        const ownImobis = (own && own.imobis) || {};

        return {
          medCenterId: mc.id,
          name: mc.name,
          organization: mc.botOrganization,
          isEnabled: own ? own.isEnabled !== false : true,
          quietHours: own ? own.quietHours : null,
          bots: botView.filter(b => b.medCenterId === mc.id),
          // Токен наружу не отдаём — только откуда он берётся у этого филиала.
          // Секрет в ответе API незачем, а «свой или общий» это единственное,
          // что нужно знать форме, чтобы не затереть его пустым значением.
          imobis: {
            sender: ownImobis.sender || '',
            senderInherited: !ownImobis.sender ? (common.sender || '') : null,
            tokenSet: !!ownImobis.token,
            tokenInherited: !ownImobis.token && !!(common.token || process.env.IMOBIS_TOKEN)
          },
          configured: !!own
        };
      }),
      // Боты без филиала: проверочные и те, что не встали при переносе. Прятать
      // их нельзя — иначе бот работает, а в настройке его нет.
      orphanBots: botView.filter(b => !b.medCenterId)
    });
  } catch (err) {
    console.error('[notifications] GET /branches:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/branches/:medCenterId', authenticate, requireAdmin, async (req, res) => {
  try {
    const medCenter = await MedCenter.findByPk(req.params.medCenterId);
    if (!medCenter) return res.status(404).json({ error: 'Филиал не найден' });

    const { quietHours, imobis, isEnabled } = req.body || {};

    const patch = {};
    if (quietHours !== undefined) patch.quietHours = quietHours || null;
    if (isEnabled !== undefined) patch.isEnabled = !!isEnabled;

    if (imobis !== undefined) {
      const [existing] = await NotifBranchSettings.findOrCreate({
        where: { medCenterId: req.params.medCenterId },
        defaults: { medCenterId: req.params.medCenterId }
      });
      const current = existing.imobis || {};
      const next = { ...current };

      // Пустая строка означает «вернуться к общей настройке», а не «стереть
      // доступ»: филиал без своего счёта — обычное состояние, а не поломка.
      if (imobis.sender !== undefined) {
        const value = String(imobis.sender || '').trim();
        if (value) next.sender = value; else delete next.sender;
      }
      if (imobis.token !== undefined) {
        const value = String(imobis.token || '').trim();
        if (value) next.token = value; else delete next.token;
      }
      patch.imobis = Object.keys(next).length ? next : null;
    }

    const [row] = await NotifBranchSettings.findOrCreate({
      where: { medCenterId: req.params.medCenterId },
      defaults: { medCenterId: req.params.medCenterId, ...patch }
    });
    await row.update(patch);

    // Настройки филиалов лежат в памяти отправщика минуту — сбрасываем, чтобы
    // правка подействовала сразу, а не «когда-нибудь в течение минуты».
    notifSettings.forgetBranch(req.params.medCenterId);

    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] PUT /branches/:medCenterId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Журнал ────────────────────────────────────────────────────────────────

router.get('/outbox', authenticate, requireAdmin, async (req, res) => {
  try {
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
