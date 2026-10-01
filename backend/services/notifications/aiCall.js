'use strict';

/**
 * Догоняющий ИИ-звонок молчунам (ver. 8.52).
 *
 * ЗАЧЕМ. Напоминание о визите уходит с кнопками «Подтверждаю» и «Отменить
 * запись», и нажатие тут же попадает в МИС (services/messengers/dialog.js).
 * Но нажимают не все: часть людей сообщение даже не открывает, и про них
 * колл-центр узнаёт только в день приёма. Этот модуль задаёт отложенный вопрос
 * «ответил ли он» через настроенное время после отправки и, если ответа нет,
 * отдаёт карточку пациента в CRM партнёра. Звонок делает она — у нас нет и не
 * будет ни телефонии, ни сценария разговора; наша часть заканчивается лидом.
 *
 * ЧТО СЧИТАЕТСЯ ОТВЕТОМ. Любое из двух:
 *
 *   1. нажатие кнопки в боте — заявка гасится сразу, на месте нажатия;
 *   2. confirm_status визита в МИС — его приносит детектор следующим проходом.
 *
 * Второго признака достаточно и без первого, и он же важнее: подтвердить могли
 * не кнопкой, а по телефону администратору, и такому человеку звонить тем более
 * незачем. Первый нужен из-за задержки: между нажатием и ближайшим проходом
 * детектора проходит до минуты, а срок заявки может истечь ровно в ней.
 *
 * ПОЧЕМУ ПОРОГ, А НЕ ТОЛЬКО СРОК. Срок отсчитывается от отправки, а звонок
 * имеет смысл только до приёма. Администратор вправе поставить «напомнить за
 * два часа» — тогда срок в три часа истекает, когда человек уже у кабинета.
 * Поэтому у заявки два условия, и второе гасит её молча и без звонка.
 *
 * КУДА ИМЕННО УЕЗЖАЕТ ЗАЯВКА (ver. 8.95). В LPTracker — CRM партнёра; его API
 * описан в services/notifications/lptracker.js, там же и объяснение, почему
 * кастомные поля ищутся по имени. Обратный путь появился тем же релизом:
 * приёмник итога звонка живёт в routes/public/v1/aiCall.js и зовёт applyResult()
 * ниже, которая дёргает те же confirmAppointment и cancelAppointment, которыми
 * пользуется кнопка в боте. До 8.95 формат лида был наш собственный, потому что
 * спецификации партнёра не существовало.
 */

const { Op } = require('sequelize');
const { NotifCallRequest, NotifAppointment } = require('../../models');
const misClient = require('../misClient');
const medCenters = require('../medCenters');
const settings = require('./settings');
const safety = require('./safety');
const consent = require('./consent');
const lptracker = require('./lptracker');

// Имя провайдера в предохранителе — см. safety.EXTERNAL_PROVIDERS.
const PROVIDER = 'aicall';

// Сколько раз пробовать, если CRM не ответила. Немного: заявка живёт до визита,
// и лид, доехавший с пятой попытки через час, партнёру уже не нужен.
const MAX_ATTEMPTS = 3;
const RETRY_MS = 5 * 60 * 1000;

// Статусы визита из МИС — те же, что у детектора.
const REFUSED_STATUS = 5;
const COMPLETED_STATUS = 4;

// Порог по умолчанию, если у шаблона он не задан. Заказчик проставит своё
// значение в интерфейсе; здесь важно лишь то, что умолчание не ноль — заявка
// без порога звонила бы человеку, сидящему у кабинета.
const DEFAULT_MIN_LEAD = 120;

// ── Ответил ли пациент ────────────────────────────────────────────────────

/**
 * Подтверждён ли визит по отметке МИС.
 *
 * Документация описывает confirm_status = 1 как «подтверждён», а полного
 * перечня остальных значений у нас нет. Поэтому ответом считаем любое
 * ненулевое: ошибиться в сторону «не звонить» дешевле, чем позвонить человеку,
 * который всё уже сделал, — звонок он воспримет как то, что мы его ответа не
 * заметили.
 */
const isAnswered = (snap) => !!snap && snap.confirmStatus != null && Number(snap.confirmStatus) > 0;

// ── Заведение заявки ──────────────────────────────────────────────────────

/**
 * Ставит заявку на звонок по только что отправленному напоминанию.
 *
 * Зовётся из отправщика сразу после успешной доставки, а не при заведении
 * события в очередь: срок отсчитывается от того момента, когда человек
 * сообщение получил. Между постановкой напоминания в очередь и его отправкой
 * проходят сутки, и отсчёт от постановки означал бы звонок до сообщения.
 *
 * @param {Object} item   строка очереди, уже со статусом sent
 * @param {string} medCenterId филиал визита
 * @returns {Promise<Object|null>} заявка, либо null — звонок этому событию не положен
 */
async function scheduleFor(item, medCenterId) {
  // Звонок бывает только у напоминания и только там, где была кнопка: он
  // существует затем, чтобы выяснить у молчуна то, чего не выяснила кнопка.
  if (!item || item.event !== 'reminder' || !item.withConfirm) return null;
  if (!item.callAfterMinutes || !item.apptId) return null;

  const snap = await NotifAppointment.findByPk(item.apptId);
  if (!snap || !snap.timeStart) return null;

  const plannedAt = new Date((item.sentAt || new Date()).getTime() + item.callAfterMinutes * 60000);

  try {
    return await NotifCallRequest.create({
      apptId: item.apptId,
      outboxId: item.id,
      medCenterId,
      patientId: snap.patientId,
      phone: snap.phone,
      patientName: snap.patientName,
      doctorName: snap.doctorName,
      visitAt: snap.timeStart,
      plannedAt,
      // Сравнение с null, а не «||»: ноль означает «звонить до последнего», и
      // подменять его умолчанием значило бы молча не исполнить настройку. Через
      // интерфейс ноль не завести — там пустое поле означает «не звонить», — но
      // правило должно быть одно и здесь, и в reasonToSkip, иначе заявка
      // заводится с одним порогом, а разбирается с другим.
      minLeadMinutes: item.callMinLeadMinutes != null ? item.callMinLeadMinutes : DEFAULT_MIN_LEAD
    });
  } catch (err) {
    // Заявка на это сообщение уже есть — отправщик взялся за строку повторно.
    // Ожидаемый ход событий, а не ошибка.
    if (err.name === 'SequelizeUniqueConstraintError') return null;
    throw err;
  }
}

/**
 * Гасит незакрытые заявки по визиту. Одна дверь на все причины — ответ
 * пациента, отмена, перенос, служебный врач, — потому что снаружи это всегда
 * одно и то же действие: звонить больше не надо, и надо видеть почему.
 *
 * @returns {Promise<number>} сколько заявок погасили
 */
async function drop(apptId, why) {
  if (!apptId) return 0;

  const [count] = await NotifCallRequest.update(
    { status: 'skipped', error: why },
    { where: { apptId, status: 'pending' } }
  );
  if (count) console.log(`[aicall] визит ${apptId}: заявок снято ${count} — ${why}`);
  return count;
}

// ── Лид ───────────────────────────────────────────────────────────────────

/** «22.09.2026 10:00» — как время визита называют вслух. */
function localText(date) {
  if (!date) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * Что уезжает в кастомные поля лида.
 *
 * Имена полей — их, а не наши: в проекте партнёра они уже заведены под выгрузку
 * из МИС (appointment_id, patient_name, clinic_title, time_start и остальные), и
 * сценарий робота читает именно их. Сопоставление по имени делает
 * lptracker.customFor; отсутствующее у проекта поле пропускается, а не
 * подставляется в чужое.
 *
 * ЧЕТЫРЕ ОБЯЗАТЕЛЬНЫХ. appointment_id, patient_name, time_start, clinic_title —
 * ровно то, что заказчик согласовал как состав передачи. Остальные едут потому,
 * что поля под них у партнёра есть, а в разговоре они нужны: без doctor_name
 * робот не назовёт врача, без mobile у них нет номера для набора, кроме контакта.
 *
 * ВРЕМЯ — В ДВУХ ВИДАХ. В time_start уходит время так, как его пишет МИС
 * («2026-09-22 10:00:00»): поле называется её словом и, судя по имени,
 * заполнялось из неё же. Человекочитаемое «22.09.2026 10:00» уходит в название
 * лида — оттуда его читает оператор. ISO с зоной не отдаём намеренно: в UTC
 * приём смещается на три часа, и это ровно та ошибка, из-за которой человеку
 * называют чужой час.
 */
// Имена полей, которые мы заполняем, и те четыре, без которых звонок
// бессмысленен. Держим списком, а не выводим из visitFields: проверка
// подключения должна отвечать «чего в проекте нет» до первой заявки, когда
// заполнять ещё нечего.
const FIELD_NAMES = ['appointment_id', 'patient_name', 'time_start', 'clinic_title',
  'time_end', 'clinic_id', 'doctor_name', 'doctor_id', 'patient_id', 'mobile', 'room', 'servises'];
const REQUIRED_FIELDS = ['appointment_id', 'patient_name', 'time_start', 'clinic_title'];

function visitFields(request, snap, medCenter) {
  const visitAt = request.visitAt ? new Date(request.visitAt) : null;

  return {
    appointment_id: request.apptId != null ? String(request.apptId) : null,
    patient_name: request.patientName || null,
    time_start: misText(visitAt),
    time_end: misText(snap && snap.timeEnd ? new Date(snap.timeEnd) : null),
    clinic_title: (medCenter && medCenter.name) || (snap && snap.clinicName) || null,
    clinic_id: snap && snap.clinicId != null ? String(snap.clinicId) : null,
    doctor_name: request.doctorName || null,
    doctor_id: snap && snap.doctorId ? String(snap.doctorId) : null,
    patient_id: request.patientId != null ? String(request.patientId) : null,
    mobile: misClient.normalizePhone(request.phone || '') || null,
    room: (snap && snap.room) || null,
    servises: (snap && snap.reserveSpecialty) || null
  };
}

/**
 * Название лида. Единственное, что партнёр видит в списке, не открывая карточку,
 * поэтому кладём в него то, по чему звонок узнаётся: кто, когда и куда записан.
 */
function leadName(request, snap, medCenter) {
  const clinic = (medCenter && medCenter.name) || (snap && snap.clinicName) || null;

  return ['Напоминание о визите',
    request.patientName || null,
    localText(request.visitAt ? new Date(request.visitAt) : null),
    clinic
  ].filter(Boolean).join(' · ');
}

/** «2026-09-22 10:00:00» — время так, как его пишет МИС. */
function misText(date) {
  if (!date) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// ── Отправка ──────────────────────────────────────────────────────────────

/**
 * Отдаёт заявку партнёру: контакт, потом лид на шаге, с которого у них
 * запускается автоворонка.
 *
 * Три запроса вместо одного — не расточительность, а устройство их API: лид без
 * контакта там не живёт, а контакт нужно сперва поискать, иначе на каждый визит
 * появится новая карточка с тем же номером и своей историей звонков.
 *
 * @returns {Promise<Object>} что записать в заявку: id лида и контакта, состав
 *   переданного и список полей, которых в проекте не нашлось
 */
async function send(config, request, snap, medCenter) {
  const phone = misClient.normalizePhone(request.phone || '');
  if (!phone) throw new Error('у пациента нет телефона');

  const fields = visitFields(request, snap, medCenter);
  const map = await lptracker.fieldMap(config, config.projectId);
  const { custom, missing } = lptracker.customFor(map, fields);

  const contact = await lptracker.contactFor(config, config.projectId, {
    phone,
    name: request.patientName || null
  });

  const lead = await lptracker.createLead(config, {
    projectId: config.projectId,
    contactId: contact.id,
    name: leadName(request, snap, medCenter),
    funnelId: config.funnelId || null,
    custom
  });

  if (missing.length) {
    // Пропущенное поле означает звонок без даты или без врача, и выясняться это
    // будет по записи разговора, если не сказать здесь.
    console.warn(`[aicall] в проекте ${config.projectId} нет полей: ${missing.join(', ')}`);
  }

  return {
    leadId: lead.id,
    contactId: contact.id,
    contactCreated: contact.created,
    fields,
    custom,
    missing
  };
}

/**
 * Есть ли причина не звонить, видная по самому визиту.
 *
 * Отдельно от process и без обращений к базе, потому что это единственное место,
 * где решается судьба звонка живому человеку, и проверять его надо тестами, а не
 * на бою. Возвращает причину строкой — её же запишут в заявку: «не позвонили»
 * без объяснения означало бы, что разбираться придётся по журналу МИС.
 *
 * @param {Object} request заявка
 * @param {Object|null} snap свежий снимок визита; null — снимка уже нет
 * @param {Date} now
 * @returns {string|null} причина не звонить, либо null — звонить можно
 */
function reasonToSkip(request, snap, now = new Date()) {
  // Ответ мог прийти в последнюю минуту перед сроком, поэтому спрашиваем снимок
  // заново, а не полагаемся на то, что нас успели погасить.
  if (isAnswered(snap)) return 'визит подтверждён — звонить незачем';
  if (snap && snap.statusId === REFUSED_STATUS) return 'визит отменён';
  if (snap && snap.statusId === COMPLETED_STATUS) return 'приём уже состоялся';

  // Визит мог переехать после того, как заявку завели, — порог считаем от
  // свежего времени, а не от снятого при заведении.
  const visitAt = (snap && snap.timeStart) || request.visitAt;
  if (!visitAt) return null;

  const lead = request.minLeadMinutes != null ? request.minLeadMinutes : DEFAULT_MIN_LEAD;
  if (new Date(visitAt).getTime() - now.getTime() < lead * 60000) {
    return `до визита меньше ${lead} мин — звонить поздно`;
  }

  return null;
}

/**
 * Разбирает одну заявку: перепроверяет, нужен ли ещё звонок, и отдаёт лид.
 *
 * Не `process`: так называется глобальный объект Node, и функция с этим именем
 * затенила бы его на весь модуль — ловушка, которая ждала бы первого, кто
 * захочет прочитать здесь process.env.
 */
async function runOne(request) {
  const snap = request.apptId ? await NotifAppointment.findByPk(request.apptId) : null;

  const pointless = reasonToSkip(request, snap);
  if (pointless) return request.update({ status: 'skipped', error: pointless });

  const quiet = await settings.quietHoursFor(request.medCenterId);
  if (settings.isQuiet(quiet, new Date())) {
    // Ночью не звоним, но и не выбрасываем: утром заявка вернётся сюда же и
    // либо уйдёт, либо погаснет по порогу выше. Одно правило на два случая —
    // отдельного «звонить ли ночью» в настройках нет намеренно.
    return request.update({ plannedAt: settings.nextAllowed(quiet, new Date()) });
  }

  if (!await settings.branchEnabled(request.medCenterId)) {
    return request.update({ status: 'skipped', error: 'филиал ещё не подключён к рассылке портала' });
  }

  // Отказ от оповещений закрывает и звонок. Поле в МИС называется send_sms, но
  // означает согласие на оповещения вообще (см. consent.js), а звонок робота —
  // оповещение более навязчивое, чем сообщение, а не менее.
  const allowed = await consent.check({ patientId: request.patientId, phone: request.phone });
  if (!allowed.allowed) {
    if (allowed.unknown) return request.update({ plannedAt: new Date(Date.now() + RETRY_MS), error: allowed.reason });
    return request.update({ status: 'skipped', error: allowed.reason });
  }

  if (!await safety.allowedByPilot(request.phone)) {
    return request.update({ status: 'skipped', error: 'пилот: телефон вне списка проверочных номеров' });
  }
  if (!await safety.allowsProvider(PROVIDER, request.medCenterId)) {
    return request.update({ status: 'skipped', error: 'ИИ-звонки: передача наружу выключена предохранителем филиала' });
  }

  const config = await settings.aiCallFor(request.medCenterId);
  if (!config.enabled) {
    return request.update({ status: 'skipped', error: 'у филиала выключена передача заявок в CRM' });
  }
  if (!config.login || !config.password || !config.projectId) {
    return request.update({ status: 'skipped', error: 'не настроен доступ к CRM: нужны логин, пароль и проект' });
  }

  const medCenter = request.medCenterId ? await medCenters.byId(request.medCenterId) : null;
  const attempts = request.attempts + 1;

  try {
    const done = await send(config, request, snap, medCenter);

    return request.update({
      status: 'sent', sentAt: new Date(), attempts,
      leadId: String(done.leadId),
      contactId: String(done.contactId),
      // Храним то, что уехало, а не весь ответ: на вопрос «что вы им отдали»
      // отвечать придётся дословно, и дословно — это состав полей.
      payload: { lead: done.fields, custom: done.custom, missing: done.missing },
      response: { leadId: done.leadId, contactId: done.contactId, contactCreated: done.contactCreated },
      error: missingNote(done.missing)
    });
  } catch (err) {
    // Что стоит повторить, а что нет. 401 после перевхода означает неверный
    // пароль, 400 — что лид им не годится: и то и другое повторится так же.
    // Временны только лимит, их пятисотые и оборванная сеть.
    const code = err.code || null;
    const retriable = !code || code === 503 || code === 429 || code >= 500;
    const again = retriable && attempts < MAX_ATTEMPTS;

    return request.update({
      status: again ? 'pending' : 'failed',
      attempts,
      error: err.message,
      plannedAt: again ? new Date(Date.now() + RETRY_MS) : request.plannedAt
    });
  }
}

/**
 * Приписка про поля, которых не нашлось в проекте. Заявка при этом уехала —
 * состояние «sent» не врёт, — но звонок пройдёт без даты или без врача, и видеть
 * это надо в журнале, а не в записи разговора.
 */
const missingNote = (missing) => (missing && missing.length
  ? `передано без полей, которых нет в проекте: ${missing.join(', ')}`
  : null);

/**
 * Один проход: разбирает заявки, которым подошёл срок.
 *
 * @returns {Promise<{sent:number, skipped:number, failed:number}>}
 */
async function runOnce(limit = 100) {
  const due = await NotifCallRequest.findAll({
    where: { status: 'pending', plannedAt: { [Op.lte]: new Date() } },
    order: [['plannedAt', 'ASC']],
    limit
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const request of due) {
    try {
      const done = await runOne(request);
      if (done.status === 'sent') sent++;
      else if (done.status === 'skipped') skipped++;
      else if (done.status === 'failed') failed++;
    } catch (err) {
      // Одна заявка не должна уносить проход — та же цена, что и у детектора:
      // оборванный проход означает молчание по всем остальным.
      console.error(`[aicall] заявка ${request.id}:`, err.message);
      await request.update({ status: 'failed', error: err.message });
      failed++;
    }
  }

  return { sent, skipped, failed };
}

// ── Итог звонка ───────────────────────────────────────────────────────────
//
// Обратный путь, которого не было в 8.52: партнёр сообщает, чем кончился
// разговор, и мы ставим отметку в МИС теми же двумя методами, которыми её
// ставит кнопка в боте. Без этого звонок ничего не менял: визит оставался
// активным, администратор держал под него время, и выяснялось это в день приёма.
//
// ПОЧЕМУ СЛОВАРЬ, А НЕ ОДНО ЗНАЧЕНИЕ. Исходов у звонка больше двух: не дозвон,
// автоответчик, «позвоните позже», разговор ни о чём. Для МИС значимы ровно два,
// остальные мы только записываем — но принять их надо все, иначе партнёр начнёт
// подгонять свои исходы под наши два и «автоответчик» приедет отказом.
//
// Имена принимаем и свои, и их — названиями шагов воронки, как они в проекте и
// называются. Так проще им: не надо заводить перевод на своей стороне.

const RESULTS = {
  // В МИС уходит подтверждение.
  confirmed: ['confirmed', 'confirm', 'подтвердил', 'подтвердила', 'подтверждён',
    'подтвержден', 'подтверждено', 'подтверждение'],
  // В МИС уходит отмена.
  cancelled: ['cancelled', 'canceled', 'cancel', 'refused', 'отменил', 'отменила',
    'отменено', 'отмена', 'отказ', 'ai · отказ', 'не придёт', 'не придет'],
  // Дальше — то, что мы только записываем.
  no_answer: ['no_answer', 'noanswer', 'не дозвон', 'не дозвонились', 'ai · не дозвонились',
    'недозвон', 'нет ответа'],
  voicemail: ['voicemail', 'автоответчик', 'ai · автоответчик', 'автоответчики'],
  hangup: ['hangup', 'бросил трубку', 'сбросил'],
  callback: ['callback', 'перезвонить', 'ai · перезвонить', 'позвонить позже'],
  operator: ['operator', 'перевод на кц', 'перевод на оператора', 'нужна проверка',
    'ai · нужна проверка'],
  // Разговор состоялся, ответа на вопрос о визите нет.
  unclear: ['unclear', 'без результата', 'ai · разговор без результата', 'разговор без результата']
};

// Что из этого меняет визит в МИС. Остальное — запись в заявке и ничего больше.
const TO_MIS = { confirmed: 'confirm', cancelled: 'cancel' };

/**
 * Приводит присланный исход к нашему словарю. Неизвестное значение не
 * отбрасываем: возвращаем 'other' и сохраняем присланное как есть — партнёр
 * добавит шаг воронки, не спросив нас, и потерять такой итог хуже, чем не понять.
 */
function normalizeResult(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return null;

  for (const [code, names] of Object.entries(RESULTS)) {
    if (code === raw || names.includes(raw)) return code;
  }
  return 'other';
}

/**
 * Записывает итог звонка и, если он значим, ставит отметку в МИС.
 *
 * ИДЕМПОТЕНТНО. Повтор с тем же исходом ничего не делает второй раз: у партнёра
 * вебхуки повторяются, а подтвердить визит дважды — в лучшем случае лишний запрос
 * в МИС, в худшем — отмена того, что уже отменено, задним числом.
 *
 * ОТМЕНА — ТОЛЬКО ПРЕДСТОЯЩЕГО ВИЗИТА. Перед ней спрашиваем МИС о текущем
 * состоянии, как это делает кнопка в боте (dialog.js): звонок мог состояться
 * после приёма, а «отменить состоявшийся визит» — это испорченная статистика и
 * потерянные деньги. Подтверждение так не проверяем: оно ничего не портит.
 *
 * @param {Object} input
 * @param {number} input.appointmentId визит в МИС — единственный обязательный ключ
 * @param {string} input.result        исход разговора
 * @param {Object} [input.raw]         тело запроса целиком, для журнала
 * @param {string} [input.leadId]      лид у партнёра, если прислали
 * @param {string} [input.comment]     что робот услышал, своими словами
 * @returns {Promise<Object>} что записали и что сделали в МИС
 */
async function applyResult({ appointmentId, result, raw = null, leadId = null, comment = null }) {
  const apptId = Number(appointmentId);
  if (!Number.isFinite(apptId) || apptId <= 0) {
    throw Object.assign(new Error('Нужен appointment_id — номер визита в МИС'), { status: 400 });
  }

  const code = normalizeResult(result);
  if (!code) {
    throw Object.assign(new Error('Нужен result — чем кончился разговор'), { status: 400 });
  }

  // Заявка, по которой звонили. Берём последнюю: при переносе визита заявок по
  // нему бывает несколько, и итог относится к той, что уехала последней.
  const request = await NotifCallRequest.findOne({
    where: { apptId },
    order: [['createdAt', 'DESC']]
  });
  const snap = await NotifAppointment.findByPk(apptId);

  // Ни заявки, ни визита — это не наш звонок. Отвечаем отказом, а не «ок»:
  // молчаливое согласие означало бы, что итоги уходят в пустоту, и заметить это
  // было бы неоткуда.
  if (!request && !snap) {
    throw Object.assign(new Error('Визит не найден'), { status: 404 });
  }

  // Повтор того же итога. Сверяем и с отметкой в МИС: если в прошлый раз она не
  // прошла, повтор — законный способ её поставить.
  if (request && request.result === code && ['confirmed', 'cancelled', 'none'].includes(request.misStatus)) {
    return { requestId: request.id, result: code, mis: request.misStatus, repeated: true };
  }

  let mis = 'none';
  let misError = null;

  const action = TO_MIS[code];
  if (action === 'confirm') {
    try {
      mis = await misClient.confirmAppointment(apptId) ? 'confirmed' : 'failed';
      if (mis === 'failed') misError = 'МИС не приняла подтверждение';
    } catch (err) {
      mis = 'failed';
      misError = `МИС: ${err.message}`;
    }
  } else if (action === 'cancel') {
    let current = null;
    try {
      current = await misClient.checkAppointmentStatus(apptId);
    } catch (err) {
      // Как и у кнопки: проверка здесь помощник, а не пропуск. Не ответила —
      // отменяем, потому что человек сказал, что не придёт.
      console.warn(`[aicall] статус визита ${apptId} узнать не удалось:`, err.message);
    }

    if (current && current.status && current.status !== 'upcoming') {
      mis = 'none';
      misError = current.status === 'completed'
        ? 'визит уже состоялся — отменять нечего'
        : 'визит уже был отменён';
    } else {
      try {
        // Комментарий обязателен по смыслу, а не по документации: в карточке
        // администратор видит факт отмены и не видит, чьих она рук. Без него
        // отмена роботом неотличима от отмены, сделанной кем-то из своих.
        const why = comment
          ? `Отменено пациентом в разговоре с роботом: ${String(comment).slice(0, 300)}`
          : 'Отменено пациентом в разговоре с роботом (CRM партнёра)';
        mis = await misClient.cancelAppointment(apptId, why) ? 'cancelled' : 'failed';
        if (mis === 'failed') misError = 'МИС не приняла отмену';
      } catch (err) {
        mis = 'failed';
        misError = `МИС: ${err.message}`;
      }
    }
  }

  if (request) {
    await request.update({
      result: code,
      resultAt: new Date(),
      resultRaw: raw || null,
      misStatus: mis,
      misError,
      leadId: request.leadId || (leadId ? String(leadId) : null)
    });
  }

  // Звонок состоялся — значит остальные заявки по этому визиту не нужны, чем бы
  // разговор ни кончился. Второй звонок человеку, который только что поговорил с
  // роботом, — то, за что ругают справедливо.
  await drop(apptId, `получен итог звонка: ${code}`);

  console.log(`[aicall] визит ${apptId}: итог ${code}, МИС — ${mis}${misError ? ` (${misError})` : ''}`);

  return { requestId: request ? request.id : null, result: code, mis, misError, repeated: false };
}

module.exports = {
  runOnce, runOne, scheduleFor, drop, isAnswered, reasonToSkip,
  send, visitFields, leadName, misText, localText,
  applyResult, normalizeResult, RESULTS, TO_MIS,
  FIELD_NAMES, REQUIRED_FIELDS,
  PROVIDER, DEFAULT_MIN_LEAD, MAX_ATTEMPTS
};
