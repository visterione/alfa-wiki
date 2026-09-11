'use strict';

/**
 * Поиск событий в МИС (ver. 7.86).
 *
 * У Renovatio есть свой движок уведомлений, но наружу он ходит через мост
 * Fromni, второй конец которого настраивается внутри МИС и нам недоступен.
 * Зато у getAppointments есть фильтр по дате изменения — поэтому вместо
 * ожидания толчка мы раз в минуту спрашиваем «что изменилось», и ответ почти
 * всегда пустой.
 *
 * События считаются сравнением со снимком (notif_appointments), а не по факту
 * попадания визита в ответ: визит меняется и по причинам, до которых пациенту
 * нет дела, — комментарий администратора, отметка об оплате. Уведомление должны
 * порождать только три вещи: появился, переехал, отменён.
 */

const axios = require('axios');
const qs = require('qs');
const { Op } = require('sequelize');
const { NotifAppointment, NotifOutbox, Setting, sequelize } = require('../../models');
const templates = require('./templates');
const doctorBlocklist = require('./doctorBlocklist');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 60000;

const WATERMARK_KEY = 'notif_watermark';
// Нахлёст назад. Часы МИС и наши могут разойтись на секунды, а пропущенное
// изменение означает неотправленное уведомление — перекрытие дешевле пропуска,
// повторы всё равно отсекает ключ идемпотентности.
const OVERLAP_MS = 90 * 1000;
// Сколько времени детектор разбирает за один заход. До 8.17 предела не было:
// окно росло от водяного знака до «сейчас», и один упавший проход делал
// следующий шире. Достаточно широкое окно перестаёт помещаться в таймаут
// getAppointments — и дальше починить это перезапуском уже нельзя, потому что
// знак лежит в базе и следующий заход просит ещё более длинный отрезок и
// падает там же. 10.09.2026 знак замер на 12:06 и не двигался сутки: наружу
// это выглядело как «уведомления просто перестали приходить», без единой
// строки в журнале.
const MAX_WINDOW_MS = 30 * 60 * 1000;
// Отрезок, который догонять уже незачем. Уведомление о записи, пролежавшее
// полдня, пациенту не нужно — он успел прийти на приём, и «вы записаны» после
// визита хуже молчания. Та же причина, по которой первый запуск не выгребает
// историю; здесь она просто применяется и к перерыву в работе.
const MAX_GAP_MS = 2 * 60 * 60 * 1000;
const REFUSED_STATUS = 5;
const COMPLETED_STATUS = 4;

// ── Общение с МИС ─────────────────────────────────────────────────────────

function misDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function parseMisDate(value) {
  if (!value) return null;
  const direct = new Date(String(value).replace(' ', 'T'));
  if (!isNaN(direct)) return direct;
  const m = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`) : null;
}

async function misRequest(endpoint, params) {
  const { data } = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: MIS_TIMEOUT }
  );
  return data;
}

async function fetchChanged(from, to) {
  // Именно первая версия метода, а не V2. V2 отдаёт один идентификатор врача,
  // клиники и пациента, а нам нужны имя, телефон и название клиники — иначе
  // подставлять в шаблон нечего. Их даёт v1 с show_patient_data, и она же
  // понимает фильтр по дате изменения.
  const data = await misRequest('getAppointments', {
    date_updated_from: misDate(from),
    date_updated_to: misDate(to),
    show_patient_data: 1
  });

  if (!data || data.error !== 0 || !Array.isArray(data.data)) return [];
  return data.data;
}

// ── Водяной знак ──────────────────────────────────────────────────────────

async function readWatermark() {
  const row = await Setting.findByPk(WATERMARK_KEY);
  const value = row && row.value && row.value.at;
  return value ? new Date(value) : null;
}

async function writeWatermark(at) {
  await Setting.upsert({
    key: WATERMARK_KEY,
    value: { at: at.toISOString() },
    description: 'Уведомления: до какого момента разобраны изменения визитов'
  });
}

// ── Разбор одного визита ──────────────────────────────────────────────────

function toSnapshot(appt) {
  const specialties = (Array.isArray(appt.services) ? appt.services : [])
    .flatMap(service => [service?.profession_title, service?.profession])
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => typeof value === 'object' ? (value.title || value.name || '') : String(value || ''))
    .map(value => value.trim())
    .filter(Boolean);

  return {
    apptId: Number(appt.id),
    clinicId: appt.clinic_id != null ? Number(appt.clinic_id) : null,
    clinicName: appt.clinic || null,
    patientId: appt.patient_id != null ? Number(appt.patient_id) : null,
    phone: appt.patient_phone || null,
    patientName: appt.patient_name || null,
    patientNumber: appt.patient_number != null ? String(appt.patient_number) : null,
    doctorId: appt.doctor_id != null ? String(appt.doctor_id) : null,
    doctorName: appt.doctor || null,
    timeStart: parseMisDate(appt.time_start),
    timeEnd: parseMisDate(appt.time_end),
    reservedAt: parseMisDate(appt.date_created),
    reserveSpecialty: [...new Set(specialties)].join(', ') || null,
    room: appt.room != null ? String(appt.room) : null,
    reserveAuthorName: appt.author_name || null,
    documentName: appt.document_name || appt.document_title || null,
    documentAuthorName: appt.document_author_name || null,
    documentAt: parseMisDate(appt.document_date || appt.document_at),
    documentClinicName: appt.document_clinic_name || null,
    statusId: appt.status_id != null ? Number(appt.status_id) : null,
    confirmStatus: appt.confirm_status != null ? Number(appt.confirm_status) : null,
    dateCompleted: parseMisDate(appt.date_completed),
    seenAt: new Date()
  };
}

/**
 * Какое событие произошло с визитом. null — ничего, о чём стоит писать пациенту.
 */
function eventFor(before, now) {
  if (now.statusId === REFUSED_STATUS) {
    return before && before.statusId === REFUSED_STATUS ? null : { event: 'cancelled' };
  }

  if (!before) return { event: 'created' };

  const wasAt = before.timeStart && before.timeStart.getTime();
  const nowAt = now.timeStart && now.timeStart.getTime();
  if (wasAt && nowAt && wasAt !== nowAt) return { event: 'moved', previousAt: before.timeStart };

  // Приём состоялся — отсюда считается просьба об отзыве. Именно переход, а не
  // сам статус: визит остаётся завершённым навсегда, и без сравнения с прошлым
  // состоянием мы просили бы отзыв при каждой последующей правке визита.
  if (now.statusId === COMPLETED_STATUS && before.statusId !== COMPLETED_STATUS) {
    return { event: 'review', completedAt: now.dateCompleted || new Date() };
  }

  return null;
}

/**
 * Ключ повтора. Значение, породившее событие, входит в ключ: перенос на другое
 * время — новое событие, а тот же перенос, увиденный дважды из-за нахлёста
 * окна, — старое.
 */
function dedupKey(event, snap) {
  const stamp = snap.timeStart ? snap.timeStart.toISOString() : 'none';
  return `${snap.apptId}:${event}:${stamp}`;
}

// ── Проход ────────────────────────────────────────────────────────────────

/**
 * Отрезок, который детектор разберёт этим заходом (ver. 8.17).
 *
 * Отвечает на два вопроса сразу: с какого момента спрашивать и по какой.
 * Верхняя граница важна не меньше нижней — именно её отсутствие однажды
 * остановило уведомления по всей сети; см. MAX_WINDOW_MS.
 *
 * @param {Date|null} previous водяной знак, null — первый запуск
 * @returns {{from:Date, to:Date, skippedFrom:Date|null}} skippedFrom — начало
 *   пропущенного перерыва, если догонять его не стали
 */
function windowFor(previous, now = new Date()) {
  // Первый запуск: не выгребаем всю историю — иначе людям прилетят напоминания
  // о визитах годичной давности. Начинаем с этой минуты.
  const since = previous ? new Date(previous.getTime() - OVERLAP_MS) : new Date(now.getTime() - 60000);

  // Перерыв больше MAX_GAP_MS не разбираем: сдвигаем знак к текущему моменту.
  // О пропуске сообщаем наружу — молча пропущенный отрезок означает молча
  // неотправленные уведомления, и узнать о нём потом неоткуда.
  const tooOld = now.getTime() - since.getTime() > MAX_GAP_MS;
  const from = tooOld ? new Date(now.getTime() - MAX_WINDOW_MS) : since;

  // Верхняя граница — не «сейчас», а ближайший шаг. Отставший детектор идёт к
  // текущему моменту получасовыми шагами, и каждый заход остаётся посильным для
  // МИС: знак двигается всегда, а не только когда догнал.
  const to = new Date(Math.min(now.getTime(), from.getTime() + MAX_WINDOW_MS));

  return { from, to, skippedFrom: tooOld ? since : null };
}

/**
 * Один проход детектора: спрашивает изменения, кладёт события в очередь
 * отправки и двигает водяной знак.
 *
 * @returns {Promise<{checked:number, events:number}>}
 */
async function runOnce(now = new Date()) {
  const { from, to, skippedFrom } = windowFor(await readWatermark(), now);
  if (skippedFrom) {
    console.warn(`[detector] перерыв с ${skippedFrom.toISOString()} — догонять не буду, ` +
      `начинаю с ${from.toISOString()}`);
  }

  const rows = await fetchChanged(from, to);
  // Один свежий снимок настройки на весь проход: изменение из админки должно
  // подхватиться следующим опросом даже когда детектор работает отдельным
  // процессом, но ходить в БД для каждого визита незачем.
  const blockedDoctors = await doctorBlocklist.readAll({ fresh: true });
  let events = 0;

  for (const row of rows) {
    // Один визит не должен уносить с собой весь проход. До 8.17 исключение
    // здесь означало, что водяной знак не запишется, — и одна кривая строка
    // останавливала уведомления по всей сети до тех пор, пока её не заметят.
    // Пропущенный визит — потеря одного уведомления, оборванный проход — всех.
    try {
      const snap = toSnapshot(row);
      if (!snap.apptId) continue;

      const before = await NotifAppointment.findByPk(snap.apptId);
      const found = eventFor(before, snap);

      // Снимок обновляем всегда: даже когда писать пациенту не о чем, следующий
      // раз сравнивать надо уже с новым состоянием.
      await NotifAppointment.upsert(snap);

      // Запрет действует не только на новое событие: если визит уже поставил
      // напоминание в очередь, а затем ему назначили служебного врача, снимаем и
      // эту старую строку. Иначе блокировка зависела бы от момента её настройки.
      const medCenterId = await doctorBlocklist.medCenterIdFor(snap);
      if (doctorBlocklist.matchesFor(snap, blockedDoctors, medCenterId)) {
        await NotifOutbox.update(
          { status: 'skipped', error: 'служебный врач: отправка заблокирована' },
          { where: { apptId: snap.apptId, status: 'pending' } }
        );
        continue;
      }

      if (!found) continue;
      events += await enqueue(found, snap);
    } catch (err) {
      console.error(`[detector] визит ${row && row.id}:`, err.message);
    }
  }

  await writeWatermark(to);
  return { checked: rows.length, events };
}

/**
 * Кладёт событие в очередь. Возвращает, сколько строк добавилось: ключ
 * идемпотентности молча отсекает повторы, и это нормальный ход событий, а не
 * ошибка.
 */
async function enqueue(found, snap) {
  const prepared = await templates.build(found.event, snap, found);
  let added = 0;

  for (const item of prepared) {
    try {
      // Отзыв «один раз за день» ставится на последний визит: если человек был
      // сегодня уже не первый раз, просьбу надо сдвинуть, а не задваивать.
      if (item.moveIfExists) {
        const existing = await NotifOutbox.findOne({ where: { dedupKey: item.dedupKey, status: 'pending' } });
        if (existing) {
          if (new Date(item.plannedAt) > new Date(existing.plannedAt)) {
            await existing.update({ plannedAt: item.plannedAt, apptId: snap.apptId, text: item.text });
          }
          continue;
        }
      }

      await NotifOutbox.create({
        apptId: snap.apptId,
        event: found.event,
        dedupKey: item.dedupKey || dedupKey(found.event, snap),
        patientId: snap.patientId,
        phone: snap.phone,
        text: item.text,
        smsText: item.smsText || null,
        channelTexts: item.channelTexts || {},
        withConfirm: item.withConfirm,
        plannedAt: item.plannedAt || new Date()
      });
      added++;
    } catch (err) {
      // Нарушение уникальности ключа — ожидаемо при нахлёсте окна.
      if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    }
  }

  // Отменённый визит: снимаем всё, что ещё не ушло по нему. Напоминание о
  // визите, которого не будет, хуже, чем отсутствие напоминания.
  if (found.event === 'cancelled' || found.event === 'moved') {
    await NotifOutbox.update(
      { status: 'skipped', error: found.event === 'cancelled' ? 'визит отменён' : 'визит перенесён' },
      { where: { apptId: snap.apptId, status: 'pending', event: 'reminder', plannedAt: { [Op.gt]: new Date() } } }
    );
  }

  return added;
}

module.exports = { runOnce, windowFor, eventFor, dedupKey, parseMisDate, toSnapshot, fetchChanged, WATERMARK_KEY, sequelize };
