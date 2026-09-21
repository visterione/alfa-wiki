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
 * ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ. Приёмника результата звонка. Вернёт ли партнёр
 * «подтвердил» и «отказался», на момент 8.52 неизвестно; когда выяснится,
 * приёмник встанет отдельным маршрутом и дёрнет те же confirmAppointment и
 * cancelAppointment, которыми пользуется кнопка. Ничего из написанного здесь
 * это не потребует переделывать.
 */

const axios = require('axios');
const { Op } = require('sequelize');
const { NotifCallRequest, NotifAppointment } = require('../../models');
const misClient = require('../misClient');
const medCenters = require('../medCenters');
const settings = require('./settings');
const safety = require('./safety');
const consent = require('./consent');

// Имя провайдера в предохранителе — см. safety.EXTERNAL_PROVIDERS.
const PROVIDER = 'aicall';

const TIMEOUT = 15000;

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
 * Что уезжает в CRM.
 *
 * Состав — наш, а не их: спецификации партнёра на момент 8.52 нет, и выдумывать
 * её за него хуже, чем отдать всё, что у нас есть, в понятной раскладке.
 * Переложить это в их формат, когда он появится, — работа одной функции здесь
 * же, и менять ради неё ни очередь, ни детектор не придётся.
 *
 * Время визита идёт дважды. `at` — машинное ISO, `atText` — то, как его назовёт
 * оператор или робот вслух. Второе не роскошь: ISO приезжает в UTC, и разница с
 * местным временем — ровно та ошибка, из-за которой человеку звонят с чужим
 * часом приёма.
 */
function buildLead(request, snap, medCenter) {
  return {
    // Почему звоним. Имя события пригодится партнёру, когда поводов станет
    // больше одного, и лучше завести его сразу, чем менять формат потом.
    event: 'visit_reminder_no_reply',
    requestId: request.id,
    createdAt: new Date().toISOString(),

    patient: {
      misId: request.patientId || null,
      name: request.patientName || null,
      phone: misClient.normalizePhone(request.phone || '') || null,
      card: snap ? snap.patientNumber : null
    },
    clinic: {
      misId: snap ? snap.clinicId : null,
      id: medCenter ? medCenter.id : request.medCenterId,
      name: (medCenter && medCenter.name) || (snap && snap.clinicName) || null
    },
    visit: {
      misId: request.apptId,
      at: request.visitAt ? new Date(request.visitAt).toISOString() : null,
      atText: localText(request.visitAt ? new Date(request.visitAt) : null),
      room: snap ? snap.room : null,
      specialty: snap ? snap.reserveSpecialty : null
    },
    doctor: {
      misId: snap ? snap.doctorId : null,
      name: request.doctorName || null
    },
    // Чтобы на их стороне было видно, что человек уже получал напоминание и
    // промолчал, — это меняет первую фразу разговора.
    reminder: {
      outboxId: request.outboxId,
      plannedCallAt: new Date(request.plannedAt).toISOString()
    }
  };
}

// ── Отправка ──────────────────────────────────────────────────────────────

async function post(config, lead) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.token) {
    // Authorization по умолчанию — со схемой Bearer, как её ждёт большинство.
    // Свой заголовок уезжает голым значением: X-Api-Key: Bearer … не бывает.
    headers[config.header] = /^authorization$/i.test(config.header)
      ? `Bearer ${config.token}`
      : config.token;
  }

  const res = await axios.post(config.url, lead, {
    headers,
    timeout: TIMEOUT,
    // Разбираем ответ сами: у чужого API отказ — такой же ответ, как согласие,
    // и записать его в заявку надо целиком, а не увидеть в виде исключения.
    validateStatus: () => true
  });
  return res;
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
  if (!await safety.allowsProvider(PROVIDER)) {
    return request.update({ status: 'skipped', error: 'ИИ-звонки: передача наружу выключена предохранителем' });
  }

  const config = await settings.aiCallFor(request.medCenterId);
  if (!config.enabled || !config.url) {
    return request.update({ status: 'skipped', error: 'у филиала не настроена CRM для звонков' });
  }

  const medCenter = request.medCenterId ? await medCenters.byId(request.medCenterId) : null;
  const lead2 = buildLead(request, snap, medCenter);
  const attempts = request.attempts + 1;

  try {
    const res = await post(config, lead2);
    const body = typeof res.data === 'object' && res.data !== null ? res.data : { raw: String(res.data ?? '') };

    if (res.status >= 200 && res.status < 300) {
      return request.update({
        status: 'sent', sentAt: new Date(), attempts,
        payload: lead2, response: body, error: null
      });
    }

    // Отказ по существу — повторять незачем: тот же лид уедет тем же и будет
    // отвергнут так же. Повторяем только то, что похоже на временную беду.
    const retriable = res.status === 429 || res.status >= 500;
    return request.update({
      status: retriable && attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
      attempts,
      payload: lead2,
      response: body,
      error: `CRM ответила ${res.status}`,
      plannedAt: retriable && attempts < MAX_ATTEMPTS ? new Date(Date.now() + RETRY_MS) : request.plannedAt
    });
  } catch (err) {
    // Сеть не дошла — это как раз временная беда.
    return request.update({
      status: attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
      attempts,
      payload: lead2,
      error: err.message,
      plannedAt: attempts < MAX_ATTEMPTS ? new Date(Date.now() + RETRY_MS) : request.plannedAt
    });
  }
}

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

module.exports = {
  runOnce, runOne, scheduleFor, drop, buildLead, isAnswered, reasonToSkip,
  PROVIDER, DEFAULT_MIN_LEAD, MAX_ATTEMPTS
};
