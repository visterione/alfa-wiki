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

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 60000;

const WATERMARK_KEY = 'notif_watermark';
// Нахлёст назад. Часы МИС и наши могут разойтись на секунды, а пропущенное
// изменение означает неотправленное уведомление — перекрытие дешевле пропуска,
// повторы всё равно отсекает ключ идемпотентности.
const OVERLAP_MS = 90 * 1000;
const REFUSED_STATUS = 5;

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
  return {
    apptId: Number(appt.id),
    clinicId: appt.clinic_id != null ? Number(appt.clinic_id) : null,
    clinicName: appt.clinic || null,
    patientId: appt.patient_id != null ? Number(appt.patient_id) : null,
    phone: appt.patient_phone || null,
    patientName: appt.patient_name || null,
    doctorName: appt.doctor || null,
    timeStart: parseMisDate(appt.time_start),
    statusId: appt.status_id != null ? Number(appt.status_id) : null,
    confirmStatus: appt.confirm_status != null ? Number(appt.confirm_status) : null,
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
 * Один проход детектора: спрашивает изменения, кладёт события в очередь
 * отправки и двигает водяной знак.
 *
 * @returns {Promise<{checked:number, events:number}>}
 */
async function runOnce(now = new Date()) {
  const previous = await readWatermark();
  // Первый запуск: не выгребаем всю историю — иначе людям прилетят напоминания
  // о визитах годичной давности. Начинаем с этой минуты.
  const from = previous ? new Date(previous.getTime() - OVERLAP_MS) : new Date(now.getTime() - 60000);

  const rows = await fetchChanged(from, now);
  let events = 0;

  for (const row of rows) {
    const snap = toSnapshot(row);
    if (!snap.apptId) continue;

    const before = await NotifAppointment.findByPk(snap.apptId);
    const found = eventFor(before, snap);

    // Снимок обновляем всегда: даже когда писать пациенту не о чем, следующий
    // раз сравнивать надо уже с новым состоянием.
    await NotifAppointment.upsert(snap);

    if (!found) continue;
    events += await enqueue(found, snap);
  }

  await writeWatermark(now);
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
      await NotifOutbox.create({
        apptId: snap.apptId,
        event: found.event,
        dedupKey: item.dedupKey || dedupKey(found.event, snap),
        patientId: snap.patientId,
        phone: snap.phone,
        text: item.text,
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

module.exports = { runOnce, eventFor, dedupKey, parseMisDate, fetchChanged, WATERMARK_KEY, sequelize };
