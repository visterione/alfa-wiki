/**
 * Сервис синхронизации визитов из МИС (getAppointments v2) → таблица mis_appointments
 *
 * Экспортирует:
 *   syncState         – текущее состояние синхронизации (in-memory, сбрасывается при рестарте)
 *   fetchAndUpsertDay – загрузить один день и сохранить в БД
 *   syncDateRange     – запустить синхронизацию диапазона (fire-and-forget async)
 */

const axios = require('axios');
const qs    = require('qs');

const MIS_API_KEY  = process.env.MIS_API_KEY  || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT  = 30000;
const DELAY_BETWEEN_DAYS_MS = 400; // пауза между запросами, чтобы не перегружать МИС

// ── In-memory sync state ──────────────────────────────────────────────────────
const syncState = {
  syncing:  false,
  done:     0,
  total:    0,
  phase:    '',
  error:    null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatMisDate(date) {
  const d   = String(date.getDate()).padStart(2, '0');
  const m   = String(date.getMonth() + 1).padStart(2, '0');
  const h   = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()} ${h}:${min}`;
}

function parseApptDate(str) {
  if (!str) return null;
  const d = new Date(str.replace(' ', 'T'));
  if (!isNaN(d)) return d;
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`);
  return null;
}

async function misRequest(endpoint, params) {
  const resp = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: MIS_TIMEOUT }
  );
  return resp.data;
}

async function fetchDayFromMis(date) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 0);
  const params = { date_from: formatMisDate(start), date_to: formatMisDate(end) };

  let data;
  try {
    data = await misRequest('getAppointmentsV2', params);
  } catch {
    data = await misRequest('getAppointments', params);
  }

  if (!data || data.error !== 0 || !Array.isArray(data.data)) return [];
  return data.data;
}

// ── Public: upsert one day ────────────────────────────────────────────────────
async function fetchAndUpsertDay(date) {
  // Lazy-require to avoid circular deps at module load time
  const { MisAppointment } = require('../models');

  const appointments = await fetchDayFromMis(date);
  if (!appointments.length) return 0;

  const records = appointments.map(a => ({
    apptId:      a.id,
    clinicId:    a.clinic_id  != null ? Number(a.clinic_id)  : null,
    room:        a.room       || null,
    doctorId:    a.doctor_id  != null ? Number(a.doctor_id)  : null,
    patientId:   a.patient_id != null ? Number(a.patient_id) : null,
    timeStart:   parseApptDate(a.time_start),
    timeEnd:     parseApptDate(a.time_end),
    statusId:    a.status_id  != null ? Number(a.status_id)  : null,
    status:      a.status     || null,
    dateCreated: parseApptDate(a.date_created),
    dateUpdated: parseApptDate(a.date_updated),
    data:        a,
    syncedAt:    new Date(),
  }));

  await MisAppointment.bulkCreate(records, {
    updateOnDuplicate: [
      'clinicId', 'room', 'doctorId', 'patientId',
      'timeStart', 'timeEnd', 'statusId', 'status',
      'dateCreated', 'dateUpdated', 'data', 'syncedAt',
    ],
  });

  return records.length;
}

// ── Public: sync a date range (fire-and-forget) ───────────────────────────────
async function syncDateRange(start, end) {
  if (syncState.syncing) {
    console.warn('[misSync] Синхронизация уже запущена, пропускаем запрос');
    return;
  }

  const days = [];
  const cur = new Date(start); cur.setHours(12, 0, 0, 0);
  const fin = new Date(end);   fin.setHours(12, 0, 0, 0);
  while (cur <= fin) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  Object.assign(syncState, { syncing: true, done: 0, total: days.length, phase: 'Запуск…', error: null });
  console.log(`📅 [misSync] Начало синхронизации: ${days.length} дней [${formatMisDate(start)} → ${formatMisDate(end)}]`);

  (async () => {
    for (let i = 0; i < days.length; i++) {
      syncState.done  = i;
      syncState.phase = `${days[i].toLocaleDateString('ru-RU')} (${i + 1}/${days.length})`;
      try {
        const cnt = await fetchAndUpsertDay(days[i]);
        if (cnt) console.log(`  ✓ ${days[i].toLocaleDateString('ru-RU')}: ${cnt} записей`);
      } catch (e) {
        console.error(`  ✗ ${days[i].toLocaleDateString('ru-RU')}:`, e.message);
      }
      if (i < days.length - 1) await new Promise(r => setTimeout(r, DELAY_BETWEEN_DAYS_MS));
    }
    Object.assign(syncState, { syncing: false, done: days.length, phase: 'Завершено', error: null });
    console.log(`✅ [misSync] Синхронизация завершена (${days.length} дней)`);
  })().catch(e => {
    Object.assign(syncState, { syncing: false, error: e.message });
    console.error('❌ [misSync]', e.message);
  });
}

module.exports = { syncState, fetchAndUpsertDay, syncDateRange };
