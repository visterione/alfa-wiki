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
const { NotifTemplate, NotifOutbox, NotifCallRequest, MedCenter, NotifBranchSettings, MessengerBot } = require('../models');
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
  imobis: 'Имобис (SMS)',
  // Notify и только: SMS через Fromni убрана из каскада в 8.50.
  fromni: 'Fromni (Notify)',
  aicall: 'CRM партнёра (ИИ-звонки)'
};

// Что означает включённый переключатель. У ботов и SMS наружу уходит наш текст,
// у CRM — карточка пациента, и подписывать их одинаково значило бы скрыть
// разницу, ради которой предохранитель и нужен (ver. 8.52).
const PROVIDER_EFFECT = {
  aicall: 'данные пациентов уходят в CRM партнёра'
};
const DEFAULT_EFFECT = 'сообщения уходят пациентам';

/**
 * Настройка CRM филиала в том виде, в каком её можно показать (ver. 8.52).
 * Ключ наружу не отдаётся — только признак «задан» и хвост, по той же причине,
 * по какой так показан токен Имобиса: два филиала легко получают один ключ
 * вставкой из буфера, и увидеть это можно только так.
 */
const aiCallView = (config) => ({
  url: config.url || '',
  header: config.header,
  enabled: !!config.enabled,
  tokenSet: !!config.token,
  tokenTail: config.token ? `…${String(config.token).slice(-6)}` : ''
});

async function safetyState() {
  const state = await safety.read();
  return {
    providers: safety.EXTERNAL_PROVIDERS.map(name => ({
      name,
      title: PROVIDER_TITLES[name] || name,
      effect: PROVIDER_EFFECT[name] || DEFAULT_EFFECT,
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

/**
 * Адрес для настройки «уведомления о событиях» в Renovatio (ver. 8.25).
 *
 * Одна запись в МИС = одно событие, поэтому и адрес свой на каждое. Филиал в
 * адрес не входит: клиника приезжает в теле события, и по ней приёмник сам
 * находит филиал — иначе в Renovatio пришлось бы завести по записи на каждую
 * пару «филиал × событие».
 *
 * Секрет — часть пути: МИС ходит без нашего токена, и отличить её запрос от
 * постороннего больше нечем. Пустой MIS_EVENTS_SECRET означает, что приёмник
 * отвечает 404 на всё, и сказать об этом надо прямо — иначе администратор
 * заведёт настройку в МИС и будет ждать событий, которых не будет.
 */
function misEventsWebhook() {
  const base = (process.env.BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');
  const secret = process.env.MIS_EVENTS_SECRET || '';
  return {
    ready: !!secret,
    // Без секрета отдаём образец с заметным местом для него, а не рабочий
    // адрес: скопированный «как есть» он молча не заработает.
    url: secret ? `${base}/api/mis-events/${secret}` : `${base}/api/mis-events/<MIS_EVENTS_SECRET>`,
    // Имя события дописывается последним сегментом: …/mis-events/<секрет>/lab_full
    events: ['lab_full', 'lab_partial']
  };
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
    const medCenterId = String(req.query.medCenterId || '').trim();
    if (!medCenterId) return res.status(400).json({ error: 'Не указан филиал' });
    res.json({ doctors: await doctorBlocklist.read({ medCenterId }) });
  } catch (err) {
    console.error('[notifications] GET /blocked-doctors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/blocked-doctors', authenticate, requireAdmin, async (req, res) => {
  try {
    const medCenterId = String(req.body?.medCenterId || '').trim();
    const doctors = req.body?.doctors;
    if (!medCenterId) return res.status(400).json({ error: 'Не указан филиал' });
    if (!Array.isArray(doctors)) return res.status(400).json({ error: 'Нужен список врачей' });
    if (doctors.length > 500) return res.status(400).json({ error: 'Слишком большой список врачей' });
    res.json({ doctors: await doctorBlocklist.write(medCenterId, doctors) });
  } catch (err) {
    console.error('[notifications] PUT /blocked-doctors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Шаблоны ───────────────────────────────────────────────────────────────

/**
 * Настройка догоняющего звонка, приведённая к допустимому виду (ver. 8.52).
 *
 * Ноль и пустая строка означают «не звонить» и ложатся в NULL: выключение
 * должно быть отсутствием настройки, а не нулём, который в интерфейсе
 * неотличим от «сразу же».
 */
function callPatch(event, withConfirm, { callAfterMinutes, callMinLeadMinutes }) {
  if (event !== 'reminder' || !withConfirm) {
    return { callAfterMinutes: null, callMinLeadMinutes: null };
  }
  const after = Number(callAfterMinutes) || null;
  return {
    callAfterMinutes: after,
    // Порог без срока сам по себе ничего не значит — храним его только рядом с
    // включённым звонком, иначе в базе осталось бы настроенное «поздно» у
    // события, которое не звонит вовсе.
    callMinLeadMinutes: after ? (Number(callMinLeadMinutes) || null) : null
  };
}

router.get('/templates', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await NotifTemplate.findAll({
      where: { medCenterId: { [Op.ne]: null } },
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }],
      order: [['event', 'ASC'], ['beforeMinutes', 'ASC']]
    });
    // misClinicIds нужен блокировке врачей (ver. 8.31): список врачей для филиала
    // спрашивается у МИС по его клинике, а не берётся общим по сети. У Сукко
    // клиник в МИС две, поэтому это массив.
    const medCenters = await MedCenter.findAll({
      attributes: ['id', 'name', 'misClinicIds'],
      where: { servesPatients: true, isActive: true },
      order: [['name', 'ASC']]
    });

    res.json({
      templates: rows,
      medCenters,
      events: EVENTS,
      placeholders: PLACEHOLDERS,
      // Откуда филиал получает каждое событие (ver. 8.25). Настраивается здесь
      // же, рядом с текстом: «чем это событие вообще является» и «каким путём
      // оно к нам приходит» — один и тот же разговор, и разносить их по двум
      // вкладкам значило бы заставлять помнить, что где.
      eventSources: Object.fromEntries(await Promise.all(
        medCenters.map(async (mc) => [mc.id, await notifSettings.eventSourcesFor(mc.id)])
      )),
      misWebhook: misEventsWebhook(),
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
    const { event, text, smsText, channelTexts, medCenterId, beforeMinutes,
            withConfirm, withCancel, withRating, callAfterMinutes, callMinLeadMinutes } = req.body || {};
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
      withConfirm: !!withConfirm,
      withCancel: !!withConfirm && !!withCancel,
      // Кнопки оценки бывают только у просьбы об отзыве (ver. 8.49): под
      // записью оценивать ещё нечего, а под отменой — уже незачем.
      withRating: event === 'review' && !!withRating,
      // Догоняющий звонок — только у напоминания и только с кнопкой (ver. 8.52).
      // Сторожим здесь, а не одной галкой в интерфейсе: шаблон правится и
      // запросом, а последствие тут — звонок живому человеку.
      ...callPatch(event, !!withConfirm, { callAfterMinutes, callMinLeadMinutes })
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
            frequency, withConfirm, withCancel, withRating, isActive,
            callAfterMinutes, callMinLeadMinutes } = req.body || {};

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

    const nextConfirm = withConfirm !== undefined ? !!withConfirm : row.withConfirm;

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
      withConfirm: nextConfirm,
      // Отмена без подтверждения не бывает: под напоминанием осталась бы одна
      // кнопка отказа. Сторожим это здесь, а не только галкой в интерфейсе, —
      // шаблон правится и запросом, а последствие тут отправляется людям.
      withCancel: nextConfirm && (withCancel !== undefined ? !!withCancel : row.withCancel),
      // Сторожим здесь же и по той же причине, что и отмену выше: шаблон
      // правится и запросом, а кнопка оценки под подтверждением записи
      // спросила бы про приём, которого ещё не было.
      withRating: row.event === 'review'
        ? (withRating !== undefined ? !!withRating : row.withRating)
        : false,
      isActive: isActive !== undefined ? !!isActive : row.isActive,
      // Снятая кнопка «Подтверждаю» уносит и звонок: спрашивать роботом про
      // подтверждение, которого мы не предлагали, не за чем (ver. 8.52).
      ...callPatch(row.event, nextConfirm, {
        callAfterMinutes: callAfterMinutes !== undefined ? callAfterMinutes : row.callAfterMinutes,
        callMinLeadMinutes: callMinLeadMinutes !== undefined ? callMinLeadMinutes : row.callMinLeadMinutes
      })
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
    let sampleMedCenterId = null;

    if (templateId) {
      const template = await NotifTemplate.findByPk(templateId, {
        include: [{
          model: MedCenter,
          as: 'medCenter',
          attributes: ['id', 'name', 'address', 'phones']
        }]
      });
      if (!template) return res.status(404).json({ error: 'Шаблон не найден' });
      bodyText = template.text;
      bodySms = template.smsText;
      bodyChannels = template.channelTexts || {};
      sampleMedCenter = template.medCenter;
      sampleMedCenterId = template.medCenterId;
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

    // Филиал обязателен для ступеней Имобиса: счёт у каждого свой (ver. 8.25),
    // и «проверить SMS вообще» — вопрос, на который больше нет ответа. Берётся
    // из выбранного шаблона: он и так принадлежит филиалу.
    const result = await sender.sendTest(item, {
      step: step || 'auto',
      medCenterId: sampleMedCenterId
    });
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
      //
      // Notify появился прямой ступенью в 8.51. Каналом это всегда был Имобис:
      // в подключении Fromni вводился её токен Имобиса и ссылка на группу ВК,
      // то есть агрегатор пересылал запрос туда же, куда мы теперь ходим сами.
      // Лишний посредник стоил ровно того же, чего стоил у SMS: исход отправки
      // Fromni не сообщает, и «дошло ли уведомление» оставалось без ответа.
      //
      // Ступени Fromni в списке больше нет вовсе — это решение заказчика, и
      // вместе с SMS из 8.50 оно означает, что каскад к агрегатору не ходит
      // ни за чем. Код канала (services/messengers/fromni.js) оставлен на
      // месте: вернуть ступень — дописать строку сюда.
      //
      // SMS через Fromni убрана в 8.50. SMS осталась одна — прямая, через
      // Имобис, и уточнение «напрямую» в её названии стало лишним: отличать её
      // больше не от чего. Двух ступеней с одним смыслом в списке быть не
      // должно — выбирая между ними, администратор выбирал не канал, а
      // провайдера, о котором знать не обязан. Прямая ступень отвечает, дошло
      // ли сообщение, а Fromni этого не сообщает вовсе — ровно та причина, по
      // которой прямая отправка появилась в 7.95.
      available: [
        { name: 'telegram',    title: 'Telegram-бот', provider: 'Вики',   channel: 'telegram' },
        { name: 'max',         title: 'MAX-бот',      provider: 'Вики',   channel: 'max' },
        { name: 'imobis:vk',   title: 'Notify',       provider: 'Имобис', channel: 'notify' },
        { name: 'imobis:sms',  title: 'SMS',          provider: 'Имобис', channel: 'sms' }
      ],
      organizations: ORGANIZATIONS,
      // Счёта у Имобиса здесь больше нет (ver. 8.25): он свой у каждого филиала
      // и живёт в его карточке, вместе с ботами. Общая настройка сети исчезла —
      // см. миграцию 8.25 и шапку блока «Филиалы» ниже.
      //
      // Ключей Fromni здесь нет намеренно: от неё уходят в пользу собственной
      // отправки, и заводить настройку под то, что сворачивают, незачем. Она
      // продолжает работать от FROMNI_KEY_* из .env, пока нужна.
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
router.get('/branches/:medCenterId/imobis', authenticate, requireAdmin, async (req, res) => {
  try {
    const config = await notifSettings.imobisFor(req.params.medCenterId);
    if (!String(config.token || '').trim()) {
      return res.json({ balance: null, senders: [], error: 'у филиала не задан токен Имобиса' });
    }

    const [balanceResult, sendersResult, templatesResult] = await Promise.allSettled([
      imobis.balance(null, !!config.sandbox, config.token),
      // Имена отправителя спрашиваем здесь же. Имя проходит модерацию у
      // операторов, придумать его нельзя, а вписанное с опечаткой не выдаёт
      // себя ничем: SMS просто не уходит. Список из аккаунта отвечает на это
      // прямо, и ради него не приходится лезть в консоль за imobis:check.
      imobis.senders(null, !!config.sandbox, config.token),
      // Шаблоны спрашиваем ради ВК-канала (ver. 8.51): сообщение уходит там
      // только по одобренному шаблону, и пустой список — самый частый ответ на
      // «Notify не работает, хотя всё заполнено». Из консоли это видно было и
      // раньше, но лезть туда ради настройки филиала никто не станет.
      imobis.templates(null, !!config.sandbox, config.token)
    ]);

    if (balanceResult.status === 'rejected') {
      return res.json({ balance: null, senders: [], error: balanceResult.reason.message });
    }

    const data = balanceResult.value;
    // Ответ у них не типизирован: в разных версиях приходило и число, и строка,
    // и объект. Приводим к числу здесь, чтобы интерфейс не гадал.
    const raw = data && (data.balance != null ? data.balance : data.result);
    const value = Number(String(raw).replace(',', '.'));

    const senders = sendersResult.status === 'fulfilled'
      ? sendersResult.value
        .map(row => (typeof row === 'object' ? (row.name || row.sender || row.title || '') : String(row)))
        .filter(Boolean)
      : [];

    // Формат строки шаблона у них не типизирован — так же, как у имён
    // отправителя выше: приходил и объект, и строка. Берём первое похожее на
    // название и не гадаем дальше.
    const templates = templatesResult.status === 'fulfilled'
      ? templatesResult.value
        .map(row => (typeof row === 'object' ? (row.name || row.title || row.template || '') : String(row)))
        .filter(Boolean)
      : [];

    res.json({
      balance: Number.isFinite(value) ? value : null,
      currency: (data && data.currency) || 'RUB',
      sandbox: !!config.sandbox,
      templates,
      senders,
      // Имя, вписанное в карточке, но не заведённое в аккаунте, — самая тихая из
      // поломок этого модуля, поэтому отвечаем на неё прямо, а не списком.
      senderKnown: config.sender && senders.length ? senders.includes(config.sender) : null
    });
  } catch (err) {
    // Не 500: отсутствие токена или недоступность провайдера — обычное
    // состояние тестовой машины, и ронять из-за него всю вкладку незачем.
    res.json({ balance: null, senders: [], error: err.message });
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

    res.json({
      cascade: await notifSettings.cascade(),
      quietHours: await notifSettings.quietHours()
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

    const branchView = await Promise.all(medCenters.map(async (mc) => {
      const own = byId.get(mc.id) || null;
      const ownImobis = (own && own.imobis) || {};

      return {
        medCenterId: mc.id,
        name: mc.name,
        organization: mc.botOrganization,
        isEnabled: own ? own.isEnabled !== false : true,
        quietHours: own ? own.quietHours : null,
        bots: botView.filter(b => b.medCenterId === mc.id),
        // Токен наружу не отдаём — только признак, что он задан, и последние
        // символы. Секрет в ответе API незачем, а «задан ли он» — единственное,
        // что нужно знать форме, чтобы не затереть его пустым значением.
        // Хвост показываем по той же причине, по какой он показан у ботов: два
        // соседних филиала легко получают один и тот же ключ вставкой из
        // буфера, и увидеть это можно только так.
        imobis: {
          sender: ownImobis.sender || '',
          vkGroup: ownImobis.vkGroup || null,
          sandbox: !!ownImobis.sandbox,
          tokenSet: !!ownImobis.token,
          tokenTail: ownImobis.token ? `…${String(ownImobis.token).slice(-6)}` : ''
        },
        // Каким путём филиал получает каждое событие (ver. 8.25). Отдаём
        // полную карту, а не только отличия: интерфейсу нужно показать выбор
        // по каждому событию, а умолчания он повторять не должен.
        eventSources: await notifSettings.eventSourcesFor(mc.id),
        // CRM для догоняющих ИИ-звонков (ver. 8.52). Ключ наружу не отдаём по
        // той же причине, что и токен Имобиса выше, и так же показываем хвост:
        // два филиала легко получают один ключ вставкой из буфера.
        aiCall: aiCallView(notifSettings.resolveAiCall(own)),
        configured: !!own
      };
    }));

    res.json({
      branches: branchView,
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

    const { quietHours, imobis, isEnabled, eventSources, aiCall } = req.body || {};

    const patch = {};
    if (quietHours !== undefined) patch.quietHours = quietHours || null;
    if (isEnabled !== undefined) patch.isEnabled = !!isEnabled;

    // Источник события (ver. 8.25). Храним только то, что прислали, и только
    // известные значения: неизвестное имя пути означало бы событие, которое не
    // берётся ни забором, ни вебхуком, то есть молчание без следа.
    if (eventSources !== undefined && eventSources && typeof eventSources === 'object') {
      const next = {};
      for (const [event, value] of Object.entries(eventSources)) {
        if (EVENTS.includes(event) && notifSettings.SOURCES.includes(value)) next[event] = value;
      }
      patch.eventSources = Object.keys(next).length ? next : null;
    }

    if (imobis !== undefined) {
      const [existing] = await NotifBranchSettings.findOrCreate({
        where: { medCenterId: req.params.medCenterId },
        defaults: { medCenterId: req.params.medCenterId }
      });
      const current = existing.imobis || {};
      const next = { ...current };

      // Пустая строка означает «стереть», и с 8.25 это уже не «вернуться к
      // общему» — общего нет. Филиал без токена просто не отправляет SMS, и
      // форма показывает это предупреждением, а не молчит.
      //
      // Стереть при этом можно только явно переданным пустым значением: поле
      // токена в форме пустое всегда (секрет наружу не отдаётся), и если бы
      // пустая строка ехала на каждое сохранение, правка имени отправителя
      // уносила бы с собой доступ.
      if (imobis.sender !== undefined) {
        const value = String(imobis.sender || '').trim();
        if (value) next.sender = value; else delete next.sender;
      }
      if (imobis.token !== undefined) {
        const value = String(imobis.token || '').trim();
        if (value) next.token = value; else delete next.token;
      }
      // Группа ВК с 8.51 хранится так, как её ввели: ссылкой, коротким адресом
      // или числом. Раньше поле приводилось к числу, и ссылка — тот вид, в
      // котором настройка лежит у человека под рукой, — превращалась в null
      // молча: поле выглядело незаполненным, хотя его заполняли. Разбор ушёл в
      // момент отправки, services/notifications/vkGroup.js.
      if (imobis.vkGroup !== undefined) {
        const value = String(imobis.vkGroup ?? '').trim().slice(0, 200);
        if (value) next.vkGroup = value; else delete next.vkGroup;
      }
      if (imobis.sandbox !== undefined) {
        if (imobis.sandbox) next.sandbox = true; else delete next.sandbox;
      }
      patch.imobis = Object.keys(next).length ? next : null;
    }

    if (aiCall !== undefined) {
      const [existing] = await NotifBranchSettings.findOrCreate({
        where: { medCenterId: req.params.medCenterId },
        defaults: { medCenterId: req.params.medCenterId }
      });
      const next = { ...(existing.aiCall || {}) };

      // Адрес обязателен только на деле: пустой означает «стереть», и филиал
      // просто перестаёт звонить. Запрещать сохранение без него незачем —
      // настройку заполняют в два приёма, сначала адрес, потом ключ.
      if (aiCall.url !== undefined) {
        const value = String(aiCall.url || '').trim().slice(0, 500);
        if (value) next.url = value; else delete next.url;
      }
      // Ключ, как и у Имобиса, стирается только явно переданной пустотой: поле
      // в форме пустое всегда, и если бы пустая строка ехала на каждое
      // сохранение, правка адреса уносила бы с собой доступ.
      if (aiCall.token !== undefined) {
        const value = String(aiCall.token || '').trim();
        if (value) next.token = value; else delete next.token;
      }
      if (aiCall.header !== undefined) {
        const value = String(aiCall.header || '').trim().slice(0, 100);
        if (value) next.header = value; else delete next.header;
      }
      if (aiCall.enabled !== undefined) {
        if (aiCall.enabled) next.enabled = true; else delete next.enabled;
      }
      patch.aiCall = Object.keys(next).length ? next : null;
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

/**
 * Журнал отправок (фильтры и страницы — ver. 8.31).
 *
 * Строки отсюда не удаляются никогда: очередь и журнал живут в одной таблице, и
 * на вопрос «почему человек не получил напоминание» отвечать по ней же через
 * полгода. Но до 8.31 наружу отдавались только последние 50 строк и два
 * фильтра, так что вся история фактически была недоступна — на сети с тысячей
 * отправок в сутки вчерашний день уже не открывался.
 *
 * Отсюда страницы по offset, а не «показать ещё»: разбирают журнал по жалобе, с
 * известной датой, и прыгнуть к ней надо сразу.
 *
 * Отдельно фильтр по отчёту провайдера. Наш status отвечает на вопрос «мы
 * отправили», delivery_status — на «дошло», и это разные вопросы: SMS, принятая
 * Имобисом, лежит у нас как sent, а через минуту приходит отчёт rejected. Свести
 * их в один список значило бы потерять как раз те случаи, ради которых в журнал
 * и заходят.
 */
const DELIVERY_FILTERS = {
  delivered: { [Op.in]: DELIVERED },
  failed: { [Op.in]: FAILED },
  // Отчёта нет вовсе: провайдер его не присылает (боты) или ещё не прислал.
  none: { [Op.is]: null }
};

router.get('/outbox', authenticate, requireAdmin, async (req, res) => {
  try {
    const where = {};
    if (['pending', 'sent', 'failed', 'skipped'].includes(req.query.status)) {
      where.status = req.query.status;
    }
    if (EVENTS.includes(req.query.event) || req.query.event === 'test') {
      where.event = req.query.event;
    }
    if (req.query.phone) {
      where.phone = { [Op.iLike]: `%${String(req.query.phone).replace(/\D/g, '')}%` };
    }
    // Канал ищем вхождением: в столбце лежит весь маршрут каскада через «→»
    // («imobis:sms→imobis:vk»), а спрашивают про одну ступень из него.
    if (req.query.channel) {
      where.channel = { [Op.iLike]: `%${String(req.query.channel).slice(0, 32)}%` };
    }
    if (DELIVERY_FILTERS[req.query.delivery]) {
      where.deliveryStatus = DELIVERY_FILTERS[req.query.delivery];
    }
    // Ищем по времени заведения, а не отправки: у пропущенных и ждущих строк
    // sent_at пустой, и по дате отправки они бы не нашлись вовсе.
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : null;
    if ((from && !isNaN(from)) || (to && !isNaN(to))) {
      where.createdAt = {};
      if (from && !isNaN(from)) where.createdAt[Op.gte] = from;
      if (to && !isNaN(to)) where.createdAt[Op.lte] = to;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows, count } = await NotifOutbox.findAndCountAll({
      where, order: [['createdAt', 'DESC']], limit, offset
    });

    // Сводка за сутки — то, на что смотрят первым делом. Она намеренно не
    // считается по фильтру: это состояние рассылки, а не итог выборки, и
    // меняться от того, что в поиске набрали номер, не должна.
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const counts = {};
    for (const status of ['sent', 'failed', 'skipped', 'pending']) {
      counts[status] = await NotifOutbox.count({ where: { status, createdAt: { [Op.gte]: since } } });
    }

    res.json({ rows, counts, total: count, limit, offset });
  } catch (err) {
    console.error('[notifications] GET /outbox:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Журнал догоняющих звонков (ver. 8.52).
 *
 * Отдельно от журнала сообщений, потому что отвечает на другой вопрос. Там
 * спрашивают «дошло ли до человека», здесь — «почему по нему не позвонили», и
 * причин не звонить больше, чем причин позвонить: подтвердил, отменил, поздно,
 * у филиала нет CRM, предохранитель. Все они записаны в самой заявке.
 *
 * Полезная нагрузка наружу не отдаётся: в ней карточка пациента, и в списке,
 * который открывают, чтобы посмотреть статусы, ей делать нечего.
 */
router.get('/call-requests', authenticate, requireAdmin, async (req, res) => {
  try {
    const where = {};
    if (['pending', 'sent', 'failed', 'skipped'].includes(req.query.status)) {
      where.status = req.query.status;
    }
    if (req.query.phone) {
      where.phone = { [Op.iLike]: `%${String(req.query.phone).replace(/\D/g, '')}%` };
    }
    if (req.query.medCenterId) where.medCenterId = req.query.medCenterId;

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows, count } = await NotifCallRequest.findAndCountAll({
      where,
      attributes: { exclude: ['payload', 'response'] },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    // Сводка за сутки — по тем же правилам, что и у сообщений: это состояние
    // модуля, а не итог выборки, и от набранного в поиске номера не зависит.
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const counts = {};
    for (const status of ['sent', 'failed', 'skipped', 'pending']) {
      counts[status] = await NotifCallRequest.count({ where: { status, createdAt: { [Op.gte]: since } } });
    }

    res.json({ rows, counts, total: count, limit, offset });
  } catch (err) {
    console.error('[notifications] GET /call-requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
