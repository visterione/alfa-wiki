'use strict';

/**
 * Приёмник событий от МИС (ver. 7.88, разбор — 8.25).
 *
 * В админке Renovatio есть настройка «уведомления о событиях»: название, адрес
 * обращения и событие из списка. Это второй конец моста — тот самый, через
 * который у Fromni работали лабораторные уведомления. Готовность результатов
 * через публичное API не спросить (getPatientLabResults требует patient_key,
 * выдаваемый только по логину пациента), но спрашивать и не нужно: МИС
 * рассказывает сама.
 *
 * До 8.25 приёмник только записывал присланное: формат тела был неизвестен, а
 * гадать о нём по документации мы уже пробовали — getAppointmentsV2 стоил нам
 * вечера пустых подстановок. Записывать и дальше нечего: настоящего события от
 * МИС не приходило ни одного, и ждать его, ничего не делая, значит откладывать
 * лабораторные уведомления до дня, когда кто-нибудь заглянет в журнал.
 *
 * Поэтому разбор терпимый: имя поля ищется среди нескольких правдоподобных, а
 * тело просматривается на два уровня вглубь — {"data":{…}} и {"patient":{…}}
 * встречаются у всех, кто отдаёт события. Что не нашлось, то остаётся пустым;
 * сырое тело лежит в mis_events целиком, и по нему разбор дополняется по факту,
 * а не по догадке. Причина, по которой событие не попало в очередь, пишется
 * туда же строкой — иначе «МИС прислала, а человек не получил» выясняется
 * только сравнением двух таблиц.
 *
 * Адрес открыт наружу без авторизации: МИС ходит без нашего токена. Защищает его
 * секрет в самом пути — он же отличает событие от события, потому что в
 * настройке Renovatio одна запись = одно событие.
 */

const express = require('express');
const crypto = require('crypto');
const { MisEvent, NotifOutbox } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const templates = require('../services/notifications/templates');
const settings = require('../services/notifications/settings');
const branches = require('../services/notifications/branches');
const doctorBlocklist = require('../services/notifications/doctorBlocklist');

const router = express.Router();

// Чем именно ходит Renovatio — JSON, формой или простым текстом, — мы не знаем.
// Поэтому разбираем любое тело: непрочитанное тело означало бы пустую запись и
// ещё один заход на те же грабли.
router.use(express.json({ limit: '2mb' }));
router.use(express.urlencoded({ extended: true, limit: '2mb' }));
router.use(express.text({ type: '*/*', limit: '2mb' }));

const SECRET = process.env.MIS_EVENTS_SECRET || '';

// Заголовки храним не все: cookie и авторизация в журнале не нужны, а вот тип
// содержимого и подпись, если она есть, — нужны.
const KEEP_HEADERS = ['content-type', 'user-agent', 'x-signature', 'x-api-key', 'authorization'];

function pickHeaders(req) {
  const out = {};
  for (const name of KEEP_HEADERS) {
    const value = req.get(name);
    if (value) out[name] = name === 'authorization' ? '(есть)' : value;
  }
  return out;
}

// ── Какое это событие ─────────────────────────────────────────────────────
//
// Имя в адресе задаём мы сами, заводя запись в Renovatio, поэтому основной путь
// — наши же ключи. Синонимы нужны для второго администратора: настройку в МИС
// заводит человек, который наших ключей не видел, и запись «lab-ready» вместо
// «lab_full» не должна означать молчание.
const EVENT_ALIASES = {
  lab_full: 'lab_full',
  'lab-full': 'lab_full',
  lab: 'lab_full',
  lab_ready: 'lab_full',
  'lab-ready': 'lab_full',
  labresults: 'lab_full',
  lab_partial: 'lab_partial',
  'lab-partial': 'lab_partial',
  lab_part: 'lab_partial',
  'lab-part': 'lab_partial',
  created: 'created',
  moved: 'moved',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  reminder: 'reminder',
  review: 'review'
};

function eventKey(name) {
  const key = String(name || '').trim().toLowerCase();
  return EVENT_ALIASES[key] || null;
}

// ── Терпимый разбор тела ──────────────────────────────────────────────────

/**
 * Раскладывает тело в плоскую карту «имя поля → значение», просматривая два
 * уровня вложенности. Имя приводится к нижнему регистру без разделителей:
 * patient_phone, patientPhone и PatientPhone — одно и то же поле, и знать
 * заранее, каким из трёх способов его напишет Renovatio, мы не можем.
 */
function flatten(value, depth = 2, out = {}) {
  if (!value || typeof value !== 'object' || depth < 0) return out;

  // Сначала весь уровень целиком, и только потом вглубь. Порядок важен: первое
  // встреченное имя сильнее, а верхний уровень ближе к смыслу события, чем
  // одноимённое поле внутри вложенного объекта. Разбирая по ходу перечисления,
  // мы отдали бы победу тому, кто просто оказался левее в JSON.
  const nested = [];
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object') {
      nested.push(item);
      continue;
    }
    const name = key.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    if (!(name in out) && item !== null && item !== '') out[name] = item;
  }

  for (const item of nested) flatten(item, depth - 1, out);
  return out;
}

/** Первое непустое из перечисленных полей. */
function pick(flat, ...names) {
  for (const name of names) {
    const value = flat[name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '')];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null) return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function toDate(value) {
  if (!value) return null;
  const direct = new Date(String(value).replace(' ', 'T'));
  if (!isNaN(direct)) return direct;
  const m = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00`) : null;
}

/**
 * Снимок визита из тела события. Поля те же, что у детектора (toSnapshot), —
 * подстановки шаблона берутся из них, и расхождение здесь означало бы, что в
 * лабораторном уведомлении пусто там, где в остальных заполнено.
 */
function toSnapshot(body) {
  const flat = flatten(body);

  return {
    apptId: toNumber(pick(flat, 'appointment_id', 'appt_id', 'visit_id', 'record_id')),
    clinicId: toNumber(pick(flat, 'clinic_id', 'branch_id', 'filial_id', 'department_id')),
    clinicName: pick(flat, 'clinic', 'clinic_name', 'branch', 'filial', 'department'),
    patientId: toNumber(pick(flat, 'patient_id', 'client_id', 'card_id')),
    phone: pick(flat, 'patient_phone', 'phone', 'mobile', 'telephone', 'tel', 'msisdn'),
    patientName: pick(flat, 'patient_name', 'patient', 'client_name', 'fio', 'name'),
    patientNumber: pick(flat, 'patient_number', 'card_number', 'card', 'login'),
    doctorId: pick(flat, 'doctor_id'),
    doctorName: pick(flat, 'doctor', 'doctor_name'),
    timeStart: toDate(pick(flat, 'time_start', 'date_start', 'datetime', 'date')),
    timeEnd: toDate(pick(flat, 'time_end', 'date_end')),
    // Название исследования — то, ради чего лабораторное уведомление и
    // отправляется. В шаблоне это подстановка {{название_документа}}.
    documentName: pick(flat, 'document_name', 'document', 'analysis', 'analysis_name',
      'order_name', 'research', 'title'),
    documentAt: toDate(pick(flat, 'document_date', 'ready_date', 'date_ready', 'completed_at')),
    // Голое «id» сюда не входит намеренно: оно есть у чего угодно, и стоит ему
    // оказаться идентификатором клиники, как все лабораторные события филиала
    // схлопнутся в один ключ повтора и замолчат разом.
    orderId: pick(flat, 'order_id', 'analysis_id', 'document_id', 'research_id'),
    seenAt: new Date()
  };
}

/**
 * Ключ повтора. МИС при неудаче повторяет запрос, и один и тот же толчок не
 * должен породить два сообщения.
 *
 * Номер заказа, если он в теле есть, — лучший ключ: частичная готовность по
 * одному заказу приходит несколько раз, и день в ключе проглотил бы вторую
 * порцию. Если номера нет, ключом служит отпечаток тела: точный повтор
 * отсечётся, а по-настоящему новое событие пройдёт.
 */
function dedupKeyFor(event, snap, body) {
  if (snap.orderId) return `mis:${event}:${snap.orderId}`;
  const print = crypto.createHash('sha1').update(JSON.stringify(body || {})).digest('hex').slice(0, 24);
  return `mis:${event}:${print}`;
}

/**
 * Разбирает принятое событие и кладёт его в очередь отправки.
 *
 * @returns {Promise<string|null>} причина, по которой строки не появилось;
 *   null — событие поставлено в очередь.
 */
async function enqueue(event, body) {
  const snap = toSnapshot(body);

  const medCenterId = await branches.idFor(snap);
  if (!medCenterId) {
    return `филиал не опознан: клиника «${snap.clinicName || snap.clinicId || 'не указана'}»`;
  }

  // Тот же выбор, что и у детектора, только с другой стороны: филиал, который
  // это событие забирает сам, толчок от МИС игнорирует. Иначе оно завелось бы
  // дважды — ключи у двух путей разные, и задвоение не отсеклось бы.
  const source = await settings.eventSourceFor(medCenterId, event);
  if (source !== 'webhook') {
    return `филиал получает это событие забором, а не вебхуком`;
  }

  if (!await settings.branchEnabled(medCenterId)) {
    return 'филиал ещё не подключён к рассылке портала';
  }

  if (await doctorBlocklist.isBlocked(snap, medCenterId)) {
    return 'служебный врач: отправка заблокирована';
  }

  if (!snap.phone) return 'в теле события нет телефона пациента';

  const prepared = await templates.build(event, snap, {}, { allow: (name) => name === event });
  if (!prepared.length) return 'у филиала нет включённого шаблона на это событие';

  let added = 0;
  for (const item of prepared) {
    try {
      await NotifOutbox.create({
        apptId: snap.apptId,
        event,
        dedupKey: item.dedupKey || dedupKeyFor(event, snap, body),
        patientId: snap.patientId,
        phone: snap.phone,
        text: item.text,
        smsText: item.smsText || null,
        channelTexts: item.channelTexts || {},
        // Подтверждать нечего: кнопка «Подтверждаю» зовёт confirmAppointment, а
        // у готовности анализов визита может не быть вовсе.
        withConfirm: false,
        plannedAt: item.plannedAt || new Date()
      });
      added++;
    } catch (err) {
      if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    }
  }

  return added ? null : 'повтор: такое событие уже в очереди';
}

/**
 * Приём. Отвечаем 200 всегда, когда секрет сошёлся: неудачный разбор — наша
 * забота, а не повод заставлять МИС копить неотправленные попытки.
 *
 * Путь: /api/mis-events/<секрет>/<имя события>
 */
router.all('/:secret/:event?', async (req, res) => {
  if (!SECRET || req.params.secret !== SECRET) {
    return res.status(404).send('Not found');
  }

  const body = req.body && typeof req.body === 'object' ? req.body : { raw: String(req.body || '') };
  const name = req.params.event || null;

  let row = null;
  try {
    row = await MisEvent.create({
      event: name,
      body,
      headers: pickHeaders(req),
      method: req.method,
      query: req.query || {},
      // За nginx настоящий адрес приходит заголовком; пригодится, чтобы
      // убедиться, что зовёт действительно МИС.
      remoteAddr: req.get('x-real-ip') || req.get('x-forwarded-for') || req.ip
    });
  } catch (err) {
    console.error('[mis-events] не смог записать событие:', err.message);
  }

  try {
    const event = eventKey(name);
    const skipReason = event
      ? await enqueue(event, body)
      : `неизвестное событие «${name || 'без имени'}»`;

    if (row) await row.update({ processed: !skipReason, skipReason });
    console.log(`[mis-events] ${req.method} «${name || 'без имени'}» — ` +
      (skipReason || 'поставлено в очередь'));
  } catch (err) {
    // Разбор упал — событие всё равно записано целиком, и починить разбор можно
    // по нему же. Ронять ответ незачем: повтор от МИС принесёт то же тело.
    console.error('[mis-events] не смог разобрать событие:', err.message);
    if (row) await row.update({ skipReason: `ошибка разбора: ${err.message}` }).catch(() => {});
  }

  res.status(200).json({ ok: true });
});

/** Просмотр принятого — администратору. */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await MisEvent.findAll({
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 20, 100)
    });
    res.json(rows);
  } catch (err) {
    console.error('[mis-events] GET /:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.toSnapshot = toSnapshot;
module.exports.eventKey = eventKey;
module.exports.dedupKeyFor = dedupKeyFor;
