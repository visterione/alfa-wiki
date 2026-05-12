const axios = require('axios');
const qs    = require('qs');
const { Op } = require('sequelize');
const { DoctorSchedule, MisScheduleCategoryMap, RbScheduleCabinet } = require('../models');

const MIS_API_KEY  = process.env.MIS_API_KEY  || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';

// "26.05.2026" → "2026-05-26"
function parseMisDate(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('.');
  return `${y}-${m}-${d}`;
}

// "26.05.2026 09:00" → "09:00"
function parseMisTime(ddmmyyyyHHMM) {
  const parts = (ddmmyyyyHHMM || '').split(' ');
  return parts[1] || '09:00';
}

async function fetchSchedulePeriods(misUserId, month) {
  const [yyyy, mm] = month.split('-');
  const daysInMonth = new Date(Number(yyyy), Number(mm), 0).getDate();
  const timeStart = `01.${mm}.${yyyy} 00:00`;
  const timeEnd   = `${String(daysInMonth).padStart(2, '0')}.${mm}.${yyyy} 23:59`;

  console.log(`📅 МИС импорт расписания: user=${misUserId} период=${timeStart} – ${timeEnd}`);

  const response = await axios.post(
    `${MIS_BASE_URL}/getSchedulePeriods`,
    qs.stringify({ api_key: MIS_API_KEY, user_id: misUserId, time_start: timeStart, time_end: timeEnd }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  return response.data;
}

// { [clinicId]: { [roomNameLower]: cabinetId } }
const cabMapCache = {};
async function getCabinetId(clinicId, room) {
  if (room == null || room === '' || room === 0) return null;
  const key   = String(clinicId);
  const label = String(room).trim();
  if (!label) return null;
  if (!cabMapCache[key]) {
    const rows = await RbScheduleCabinet.findAll({ where: { clinicId: key } });
    cabMapCache[key] = {};
    for (const r of rows) cabMapCache[key][r.name.toLowerCase()] = r.id;
  }
  const existing = cabMapCache[key][label.toLowerCase()];
  if (existing) return existing;
  // Auto-create cabinet from MIS room name
  const created = await RbScheduleCabinet.create({ name: label, clinicId: key });
  cabMapCache[key][label.toLowerCase()] = created.id;
  console.log(`🏥 Создан кабинет из МИС: "${label}" (clinic ${key})`);
  return created.id;
}

/**
 * Import MIS schedule for one user for one month.
 * @param {string|number} misUserId
 * @param {string} month  "YYYY-MM"
 * @returns {{ imported: number, newCategories: number, month: string }}
 */
async function importForUser(misUserId, month) {
  const [yyyy, mm] = month.split('-');
  const daysInMonth = new Date(Number(yyyy), Number(mm), 0).getDate();
  const firstDay = `${yyyy}-${mm}-01`;
  const lastDay  = `${yyyy}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

  const data = await fetchSchedulePeriods(misUserId, month);

  if (!data || Number(data.error) !== 0 || !Array.isArray(data.data)) {
    throw new Error(`МИС вернул ошибку: ${JSON.stringify(data?.data ?? data)}`);
  }

  const records = data.data;
  if (records.length === 0) {
    console.log(`📅 МИС: нет записей для user=${misUserId} за ${month}`);
  }

  // ── Category map ───────────────────────────────────────────────────────────
  const existingMap = await MisScheduleCategoryMap.findAll();
  const catMap = {};
  for (const r of existingMap) catMap[r.misCategoryId] = r.rbCategoryId || null;

  // Collect unknown MIS category IDs and insert them (rb_category_id = null)
  const newMisCatIds = new Set();
  for (const r of records) {
    if (r.category_id != null && !(r.category_id in catMap)) {
      newMisCatIds.add(Number(r.category_id));
    }
  }
  for (const misCatId of newMisCatIds) {
    await MisScheduleCategoryMap.findOrCreate({
      where:    { misCategoryId: misCatId },
      defaults: { misCategoryId: misCatId, rbCategoryId: null },
    });
    catMap[misCatId] = null;
  }

  // ── Deduplicate: suppress type=1 only when type=3 records fully cover its time range ──
  // MIS sends the original type=1 alongside type=3 cancellations.
  // Cancellations may be split into sub-slots (9-15, 15-15:40, 15:40-18) that together
  // cover the original slot. We suppress type=1 only when fully covered — partial
  // cancellations (some sub-slots cancelled, others active) keep their type=1.
  const toMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const isFullyCovered = (start, end, ranges) => {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    let covered = start;
    for (const [s, e] of sorted) {
      if (s > covered) break;
      covered = Math.max(covered, e);
      if (covered >= end) return true;
    }
    return false;
  };

  const cancelledByDay = new Map(); // `${clinic}|${date}` → [[startMin, endMin], ...]
  for (const r of records) {
    if (r.type !== 3) continue;
    const key = `${r.clinic_id}|${r.date}`;
    if (!cancelledByDay.has(key)) cancelledByDay.set(key, []);
    cancelledByDay.get(key).push([toMins(parseMisTime(r.time_start)), toMins(parseMisTime(r.time_end))]);
  }

  const deduped = records.filter(r => {
    if (r.type !== 1) return true;
    const cancels = cancelledByDay.get(`${r.clinic_id}|${r.date}`);
    if (!cancels) return true;
    const start = toMins(parseMisTime(r.time_start));
    const end   = toMins(parseMisTime(r.time_end));
    return !isFullyCovered(start, end, cancels);
  });

  // ── Delete old mis_import entries for this user + month ─────────────────────
  await DoctorSchedule.destroy({
    where: {
      misUserId: String(misUserId),
      source:    'mis_import',
      dateFrom:  { [Op.gte]: firstDay },
      dateTo:    { [Op.lte]: lastDay },
    },
  });

  // ── Build new entries ──────────────────────────────────────────────────────
  const toInsert = [];
  for (const r of deduped) {
    const dateStr     = parseMisDate(r.date);
    const timeFrom    = parseMisTime(r.time_start);
    const timeTo      = parseMisTime(r.time_end);
    const clinicId    = String(r.clinic_id);
    const isCancelled = r.type === 3;
    const categoryId  = r.category_id != null ? (catMap[Number(r.category_id)] ?? null) : null;
    const cabinetId   = await getCabinetId(clinicId, r.room);

    toInsert.push({
      misUserId:  String(misUserId),
      clinicId,
      dateFrom:   dateStr,
      dateTo:     dateStr,
      pattern:    { type: 'daily' },
      timeFrom,
      timeTo,
      exceptions: isCancelled
        ? [{ date: dateStr, code: r.cancellation_reason_id != null ? String(r.cancellation_reason_id) : 'О' }]
        : [],
      categoryId,
      cabinetId,
      roleTitle:  null,
      source:     'mis_import',
      misData:    r,
    });
  }

  if (toInsert.length > 0) {
    await DoctorSchedule.bulkCreate(toInsert);
  }

  console.log(`✅ МИС импорт завершён: user=${misUserId}, ${month}, записей=${toInsert.length}, новых категорий=${newMisCatIds.size}`);

  return { imported: toInsert.length, newCategories: newMisCatIds.size, month };
}

module.exports = { importForUser };
