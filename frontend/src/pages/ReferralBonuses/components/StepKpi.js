import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTabSlider } from '../utils/useTabSlider';
import { parseExcelFile, rbMapNewColumns, rbParseDate } from '../utils/excelUtils';
import { fetchSourceFile } from '../utils/excelSources';
import { rbMatchClinicId, DEFAULT_CLINICS } from '../utils/clinicUtils';
import { rbParseFullName, rbParseAbbrevName } from '../utils/nameMatching';
import toast from 'react-hot-toast';
import { fetchAppointmentsFromDB, getSyncStatus, triggerSync } from '../utils/appointmentsApi';
import { buildKpiPdf } from '../utils/kpiPdfExport';
import { TabReputation } from '../../Statistics/components/Directories';

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const PERIOD_MODES = [
  { key: 'month',   label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year',    label: 'Год' },
  { key: 'range',   label: 'Диапазон' },
];

const QUARTERS = [
  { value: 1, label: 'I кв.',   months: [1, 2, 3] },
  { value: 2, label: 'II кв.',  months: [4, 5, 6] },
  { value: 3, label: 'III кв.', months: [7, 8, 9] },
  { value: 4, label: 'IV кв.',  months: [10, 11, 12] },
];

// Организационные группы клиник
const ORG_GROUPS = [
  { key: 'prestige', label: 'Альфа Престиж', subLabel: 'Альфа, Кидс, Линия', ids: ['2','3','6'], color: '#de64a1',
    nameMatch: n => (n.includes('альфа') || n.includes('кидс') || n.includes('kids') || n.includes('линия')) && !n.includes('проф') },
  { key: 'prof',     label: 'Проф',           subLabel: '',                   ids: ['1'],         color: '#9999ff',
    nameMatch: n => n.includes('проф') },
  { key: 'labgroup', label: 'Лабгрупп',       subLabel: '3К, Смайл',         ids: ['4','7'],     color: '#800080',
    nameMatch: n => n.includes('3к') || n.includes('3k') || n.includes('смайл') || n.includes('лабгрупп') },
  { key: 'sukko',    label: 'Алекс',          subLabel: 'Сукко',              ids: ['11','12'],   color: '#2d7055',
    nameMatch: n => n.includes('сукко') || n.includes('алекс') },
];

// Расписание работы клиник (hardcode): minPerDay = рабочих минут в сутках, workDays = JS day-of-week (0=вс)
const CLINIC_SCHEDULES = {
  '2':  { minPerDay: (24   - 8)   * 60, workDays: [0,1,2,3,4,5,6] }, // Альфа  8–24 пн-вс
  '3':  { minPerDay: (23   - 7.5) * 60, workDays: [0,1,2,3,4,5,6] }, // Кидс   7:30–23 пн-вс
  '6':  { minPerDay: (21   - 8)   * 60, workDays: [0,1,2,3,4,5,6] }, // Линия  8–21 пн-вс
  '1':  { minPerDay: (20   - 7.5) * 60, workDays: [0,1,2,3,4,5,6] }, // Проф   7:30–20 пн-вс
  '7':  { minPerDay: (21   - 8)   * 60, workDays: [0,1,2,3,4,5,6] }, // Смайл  8–21 пн-вс
  '4':  { minPerDay: (20   - 8)   * 60, workDays: [0,1,2,3,4,5,6] }, // 3К     8–20 пн-вс
  '11': { minPerDay: (17   - 8)   * 60, workDays: [1,2,3,4,5]     }, // Сукко  8–17 пн-пт
  '12': { minPerDay: (17   - 8)   * 60, workDays: [1,2,3,4,5]     }, // Сукко2 8–17 пн-пт
};

// Цвет конкретной клиники по её id
const _CLINIC_COLOR_MAP = Object.fromEntries(DEFAULT_CLINICS.map(c => [String(c.id), c.color]));
function getClinicColorById(clinicId) {
  return _CLINIC_COLOR_MAP[String(clinicId)] || '#94a3b8';
}

// Вспомогательная: найти цвет клиники по массиву строк (берём наиболее частую clinicId)
function rowsToClinicColor(rs) {
  const counts = {};
  for (const r of rs) if (r.clinicId) counts[r.clinicId] = (counts[r.clinicId] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? getClinicColorById(top) : '#94a3b8';
}

const KPI_TABS = [
  { key: 'general',    label: 'Общая' },
  { key: 'patients',   label: 'Пациенты' },
  { key: 'margin',     label: 'Маржинальность' },
  { key: 'efficiency', label: 'Эффективность' },
  { key: 'rooms',      label: 'Кабинеты' },
  { key: 'reputation', label: 'Репутация' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const parseNum = v => parseFloat(String(v || '').replace(/[\s\u00A0]/g, '').replace(',', '.')) || 0;
const fmt      = n => Math.round(n || 0).toLocaleString('ru-RU');
const fmtRub   = n => fmt(n) + ' ₽';
const fmtPct   = n => (n || 0).toFixed(1) + '%';

// Нормализует ФИО любого формата ("Иванов Иван Иванович" или "Иванов И. И.")
// в канонический ключ "ивановии" — для сравнения независимо от сокращения
function nameToKey(name) {
  if (!name) return '';
  const parts = String(name).replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
  if (!parts[0]) return '';
  const parsed = parts[1]?.length === 1 ? rbParseAbbrevName(name) : rbParseFullName(name);
  return parsed.last + (parsed.fi || '') + (parsed.mi || '');
}

function getPatientKey(row) {
  return row.patientCard || row.patientName || null;
}

function getPrevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function matchSourcesRange(sources, rangeStart, rangeEnd) {
  return sources.filter(s => {
    const from = s.dateFrom ? new Date(s.dateFrom) : null;
    const to   = s.dateTo   ? new Date(s.dateTo)   : null;
    if (!from || !to) return false;
    return from <= rangeEnd && to >= rangeStart;
  });
}

function getPeriodRange(mode, year, month, quarter, fromMonth, toMonth) {
  if (mode === 'quarter') {
    const [m1, , m3] = QUARTERS[quarter - 1].months;
    return { start: new Date(year, m1 - 1, 1), end: new Date(year, m3, 0, 23, 59, 59) };
  }
  if (mode === 'year') {
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59) };
  }
  if (mode === 'range') {
    const lo = Math.min(fromMonth, toMonth);
    const hi = Math.max(fromMonth, toMonth);
    return { start: new Date(year, lo - 1, 1), end: new Date(year, hi, 0, 23, 59, 59) };
  }
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59) };
}

function getPeriodLabel(mode, year, month, quarter, fromMonth, toMonth) {
  if (mode === 'quarter') return `${QUARTERS[quarter - 1].label} ${year}`;
  if (mode === 'year')    return `${year} год`;
  if (mode === 'range') {
    const lo = Math.min(fromMonth, toMonth);
    const hi = Math.max(fromMonth, toMonth);
    return lo === hi
      ? `${MONTH_NAMES[lo - 1]} ${year}`
      : `${MONTH_NAMES[lo - 1]}–${MONTH_NAMES[hi - 1]} ${year}`;
  }
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function parseRow(rawRow, cm) {
  const clinicRaw   = cm.clinic ? String(rawRow[cm.clinic] || '').trim() : '';
  const clinicId    = rbMatchClinicId(clinicRaw) || getOrgGroupByName(clinicRaw.toLowerCase())?.ids[0] || null;
  const categoryRaw = cm.category ? String(rawRow[cm.category] || '') : '';
  const categories  = categoryRaw.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);

  return {
    clinicRaw,
    clinicId,
    date:         cm.date         ? rbParseDate(rawRow[cm.date])                         : null,
    executor:     cm.executor     ? String(rawRow[cm.executor]     || '').trim()          : '',
    executorSpec: cm.executorSpec ? String(rawRow[cm.executorSpec] || '').trim()          : '',
    referrer:     cm.referrer     ? String(rawRow[cm.referrer]     || '').trim()          : '',
    referrerSpec: cm.referrerSpec ? String(rawRow[cm.referrerSpec] || '').trim()          : '',
    serviceSpec:  cm.serviceSpec  ? String(rawRow[cm.serviceSpec]  || '').trim()          : '',
    serviceName:  cm.serviceName  ? String(rawRow[cm.serviceName]  || '').trim()          : '',
    serviceCode:  cm.serviceCode  ? String(rawRow[cm.serviceCode]  || '').trim()          : '',
    servicePrice: cm.servicePrice ? parseNum(rawRow[cm.servicePrice])                     : 0,
    costPrice:    cm.costPrice    ? parseNum(rawRow[cm.costPrice])                        : 0,
    qty:          cm.qty          ? (parseNum(rawRow[cm.qty]) || 1)                       : 1,
    discount:     cm.discount     ? parseNum(rawRow[cm.discount])                         : 0,
    totalCost:    cm.totalCost    ? parseNum(rawRow[cm.totalCost])                        : 0,
    patientCard:  cm.patientCard  ? String(rawRow[cm.patientCard]  || '').trim()          : '',
    patientName:  cm.patientName  ? String(rawRow[cm.patientName]  || '').trim()          : '',
    sourceEntry:  cm.sourceEntry  ? String(rawRow[cm.sourceEntry]  || '').trim()          : '',
    categories,
    isVip: categories.includes('vip'),
    hasLK: categories.some(c => c.includes('лк пациент')),
  };
}

function getOrgGroupByName(nameLower) {
  return ORG_GROUPS.find(g => g.nameMatch(nameLower)) || null;
}

function getOrgGroup(row) {
  if (row.clinicId) {
    const g = ORG_GROUPS.find(g => g.ids.includes(row.clinicId));
    if (g) return g;
  }
  if (row.clinicRaw) return getOrgGroupByName(row.clinicRaw.toLowerCase());
  return null;
}

const _sourceRowsCache = new Map();

async function loadSourceRows(sources) {
  const allRows = [];
  for (const src of sources) {
    if (_sourceRowsCache.has(src.id)) {
      allRows.push(..._sourceRowsCache.get(src.id));
      continue;
    }
    try {
      const file    = await fetchSourceFile(src);
      const rawRows = await parseExcelFile(file);
      if (!rawRows.length) continue;
      const cm     = rbMapNewColumns(rawRows);
      const parsed = rawRows.map(r => parseRow(r, cm));
      _sourceRowsCache.set(src.id, parsed);
      allRows.push(...parsed);
    } catch (e) {
      console.error('[KPI] failed to load source', src.id, e);
    }
  }
  return allRows;
}

// ── Aggregation ───────────────────────────────────────────────────────────────
function buildPatientMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = getPatientKey(r);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { card: r.patientCard, name: r.patientName, revenue: 0, isVip: false, hasLK: false, rows: [] });
    }
    const p = map.get(key);
    p.revenue += r.totalCost;
    if (r.isVip) p.isVip = true;
    if (r.hasLK) p.hasLK = true;
    p.rows.push(r);
  }
  return map;
}

function getTop20Pct(patients) {
  const sorted = [...patients].sort((a, b) => b.revenue - a.revenue);
  const count  = Math.max(1, Math.ceil(sorted.length * 0.2));
  return sorted.slice(0, count);
}

function groupBy(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    if (!map[k]) map[k] = [];
    map[k].push(r);
  }
  return map;
}

// Разбивает значение через запятую — одна строка попадает в несколько групп
function splitComma(val) {
  return String(val || '').split(',').map(s => s.trim()).filter(Boolean);
}

function groupByMulti(rows, keysFn) {
  const map = {};
  for (const r of rows) {
    const keys = keysFn(r);
    for (const k of keys) {
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push(r);
    }
  }
  return map;
}

function revenueAndPatients(rows) {
  const revenue  = rows.reduce((s, r) => s + r.totalCost, 0);
  const patients = new Set(rows.map(getPatientKey).filter(Boolean)).size;
  return { revenue, patients, avgCheck: patients ? revenue / patients : 0 };
}

// Строит цепочки направлений по специальностям (ЛОР → КТ → Хирург → ...)
function buildReferralChains(rows) {
  // Берём первую специальность из перечисленных через запятую
  const firstSpec = s => String(s || '').split(',')[0].trim();

  // Глобальный словарь: имя врача → его специальность (из executorSpec / serviceSpec)
  const specByDoctor = {};
  for (const r of rows) {
    if (r.executor && !specByDoctor[r.executor]) {
      const s = firstSpec(r.serviceSpec || r.executorSpec);
      if (s) specByDoctor[r.executor] = s;
    }
  }

  // Диагностика: сколько строк с заполненным направителем
  const rowsWithRef = rows.filter(r => r.referrer);
  console.log('[KPI chains] строк с направителем:', rowsWithRef.length);
  if (rowsWithRef.length > 0) {
    const s = rowsWithRef[0];
    console.log('[KPI chains] пример строки:', {
      referrer: s.referrer, referrerSpec: s.referrerSpec,
      executor: s.executor, executorSpec: s.executorSpec, serviceSpec: s.serviceSpec,
      specByDoctorLookup: specByDoctor[s.referrer],
    });
  }

  // Группируем строки по пациенту
  const byPatient = {};
  for (const r of rows) {
    const key = getPatientKey(r);
    if (!key) continue;
    if (!byPatient[key]) byPatient[key] = [];
    byPatient[key].push(r);
  }

  const chainCounts = {};

  for (const patRows of Object.values(byPatient)) {
    // Пациентский словарь исполнитель → специальность (точнее глобального)
    const localSpec = {};
    for (const r of patRows) {
      if (r.executor) {
        const s = firstSpec(r.serviceSpec || r.executorSpec);
        if (s) localSpec[r.executor] = s;
      }
    }

    // Строки с направителем, отсортированные по дате
    const refRows = patRows
      .filter(r => r.referrer)
      .sort((a, b) => {
        if (!a.date || !b.date) return 0;
        return a.date - b.date;
      });

    if (!refRows.length) continue;

    let currentChain = null;
    for (const r of refRows) {
      const fromSpec = firstSpec(r.referrerSpec) || localSpec[r.referrer] || specByDoctor[r.referrer] || '';
      const toSpec   = firstSpec(r.serviceSpec)  || firstSpec(r.executorSpec) || '';
      if (!fromSpec || !toSpec || fromSpec === toSpec) continue;

      if (!currentChain) {
        currentChain = [fromSpec, toSpec];
      } else if (currentChain[currentChain.length - 1] === fromSpec) {
        currentChain.push(toSpec);
      } else {
        if (currentChain.length >= 2) {
          const k = currentChain.join(' → ');
          chainCounts[k] = (chainCounts[k] || 0) + 1;
        }
        currentChain = [fromSpec, toSpec];
      }
    }
    if (currentChain && currentChain.length >= 2) {
      const k = currentChain.join(' → ');
      chainCounts[k] = (chainCounts[k] || 0) + 1;
    }
  }

  console.log('[KPI chains] уникальных цепочек:', Object.keys(chainCounts).length, chainCounts);

  return Object.entries(chainCounts)
    .map(([name, count]) => ({ name, count, steps: name.split(' → ').length - 1 }))
    .sort((a, b) => b.count - a.count);
}

function buildReturnVisitStats(rows) {
  const byPatient = {};
  for (const r of rows) {
    const key = getPatientKey(r);
    if (!key) continue;
    if (!byPatient[key]) byPatient[key] = [];
    byPatient[key].push(r);
  }
  const stats = {};
  for (const patRows of Object.values(byPatient)) {
    const doctors = [...new Set(patRows.map(r => r.executor).filter(Boolean))];
    for (const doc of doctors) {
      if (!stats[doc]) stats[doc] = { name: doc, _rows: [], total: 0, notReturned: 0, sameDoctor: 0, otherReferred: 0, otherSelf: 0 };
      const s = stats[doc];
      const docVisits   = patRows.filter(r => r.executor === doc);
      const otherVisits = patRows.filter(r => r.executor && r.executor !== doc);
      const docKey = nameToKey(doc);
      s._rows.push(...docVisits);
      s.total++;
      if (otherVisits.length === 0 && docVisits.length === 1) s.notReturned++;
      if (docVisits.length >= 2) s.sameDoctor++;
      if (otherVisits.length > 0) {
        if (otherVisits.some(r => nameToKey(r.referrer || '') === docKey)) s.otherReferred++;
        if (otherVisits.some(r => nameToKey(r.referrer || '') !== docKey)) s.otherSelf++;
      }
    }
  }
  return Object.values(stats)
    .map(({ _rows, ...d }) => ({ ...d, color: rowsToClinicColor(_rows) }))
    .filter(d => d.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ── Appointment analysis helpers ──────────────────────────────────────────────

function parseApptTime(str) {
  if (!str) return null;
  // ISO-like: "2026-04-01 09:00:00" или "2026-04-01T09:00:00"
  const iso = Date.parse(str.replace(' ', 'T'));
  if (!isNaN(iso)) return new Date(iso);
  // dd.mm.yyyy hh:mm
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}

// Рабочих минут клиники за период (с учётом её индивидуального расписания)
function clinicWorkMinutesInPeriod(clinicId, start, end) {
  const sched = CLINIC_SCHEDULES[String(clinicId)];
  const minPerDay = sched ? sched.minPerDay : 480;
  const workDays  = sched ? sched.workDays  : [1,2,3,4,5,6]; // fallback: пн–сб

  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const fin = new Date(end);
  fin.setHours(23, 59, 59, 999);
  while (cur <= fin) {
    if (workDays.includes(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count * minPerDay;
}

// Расписания для отображения в UI (зеркало CLINIC_SCHEDULES, но с читаемыми строками)
const CLINIC_SCHEDULE_LABELS = {
  '2':  'Альфа: 08:00–24:00, пн–вс',
  '3':  'Кидс: 07:30–23:00, пн–вс',
  '6':  'Линия: 08:00–21:00, пн–вс',
  '1':  'Проф: 07:30–20:00, пн–вс',
  '7':  'Смайл: 08:00–21:00, пн–вс',
  '4':  '3К: 08:00–20:00, пн–вс',
  '11': 'Сукко: 08:00–17:00, пн–пт',
  '12': 'Сукко: 08:00–17:00, пн–пт',
};
function clinicScheduleLabel(clinicId) {
  return CLINIC_SCHEDULE_LABELS[String(clinicId)] || '';
}

// Объединение пересекающихся интервалов → сумма уникальных минут
function unionIntervalMinutes(ranges) {
  if (!ranges.length) return 0;
  const sorted = [...ranges].sort((a, b) => a.t0 - b.t0);
  let total = 0;
  let curStart = sorted[0].t0;
  let curEnd   = sorted[0].t1;
  for (let i = 1; i < sorted.length; i++) {
    const { t0, t1 } = sorted[i];
    if (t0 <= curEnd) {
      if (t1 > curEnd) curEnd = t1;
    } else {
      total += (curEnd - curStart) / 60000;
      curStart = t0;
      curEnd   = t1;
    }
  }
  total += (curEnd - curStart) / 60000;
  return total;
}

// Загрузка кабинетов: объединённое время занятости / ёмкость клиники за период.
// Используем union интервалов, чтобы перекрывающиеся приёмы (2 врача в одном кабинете)
// не давали >100%.
function buildRoomStats(appointments, start, end) {
  const map = {};
  for (const a of appointments) {
    if (a.status_id === 5 || a.status === 'refused') continue;
    const room = (a.room || '').trim();
    if (!room) continue;
    const t0 = parseApptTime(a.time_start);
    const t1 = parseApptTime(a.time_end);
    if (!t0 || !t1) continue;
    const dur = (t1 - t0) / 60000;
    if (dur <= 0 || dur > 720) continue;
    const clinicId = String(a.clinic_id || '');
    const key = `${clinicId}|${room}`;
    if (!map[key]) map[key] = { room, clinicId, ranges: [] };
    map[key].ranges.push({ t0, t1 });
  }

  return Object.values(map).map(d => {
    const clinic   = DEFAULT_CLINICS.find(c => String(c.id) === d.clinicId);
    const capacity = clinicWorkMinutesInPeriod(d.clinicId, start, end);
    const totalMin = unionIntervalMinutes(d.ranges);
    return {
      name:        d.room,
      clinicId:    d.clinicId,
      _clinicName: clinic?.name || (d.clinicId ? `Клиника ${d.clinicId}` : ''),
      totalHours:  totalMin / 60,
      capacity,
      utilPct:     capacity > 0 ? (totalMin / capacity * 100) : 0,
      color:       getClinicColorById(d.clinicId),
    };
  }).sort((a, b) => b.utilPct - a.utilPct);
}

// Средний «зазор» между последовательными визитами в одном кабинете (в минутах).
// Зазор = time_start следующего − time_end предыдущего, только в рамках одного дня.
function buildRoomGapStats(appointments) {
  const byRoom = {};
  for (const a of appointments) {
    if (a.status_id === 5 || a.status === 'refused') continue;
    const room = (a.room || '').trim();
    if (!room) continue;
    const t0 = parseApptTime(a.time_start);
    const t1 = parseApptTime(a.time_end);
    if (!t0 || !t1) continue;
    const clinicId = String(a.clinic_id || '');
    const key = `${clinicId}|${room}`;
    if (!byRoom[key]) byRoom[key] = { room, clinicId, appts: [] };
    byRoom[key].appts.push({ start: t0, end: t1 });
  }

  const results = [];
  for (const d of Object.values(byRoom)) {
    d.appts.sort((a, b) => a.start - b.start);

    const gaps = [];
    for (let i = 1; i < d.appts.length; i++) {
      const prev = d.appts[i - 1];
      const cur  = d.appts[i];
      // Только в рамках одного дня (иначе ночной разрыв искажает картину)
      if (prev.end.toDateString() !== cur.start.toDateString()) continue;
      const gapMin = (cur.start - prev.end) / 60000;
      if (gapMin >= 0) gaps.push(gapMin); // отрицательный = перекрытие (пропускаем)
    }
    if (!gaps.length) continue;

    const avg    = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    const sorted = [...gaps].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    const clinic = DEFAULT_CLINICS.find(c => String(c.id) === d.clinicId);
    results.push({
      room:        d.room,
      clinicId:    d.clinicId,
      name:        d.room,
      _clinicName: clinic?.name || (d.clinicId ? `Клиника ${d.clinicId}` : ''),
      color:       getClinicColorById(d.clinicId),
      value:       avg,
      median,
      gapCount:    gaps.length,
    });
  }

  // Сортировка: наиболее плотные кабинеты первыми (наименьший зазор)
  results.sort((a, b) => a.value - b.value);

  const allGaps = results.map(r => r.value);
  const overallAvg = allGaps.length ? allGaps.reduce((s, v) => s + v, 0) / allGaps.length : 0;

  return { rooms: results, overallAvg };
}

function getUniqueClinics(rows) {
  return [...new Set(rows.map(r => r.clinicRaw).filter(Boolean))].sort();
}

function getUniqueSpecs(rows) {
  const set = new Set();
  rows.forEach(r => splitComma(r.executorSpec).forEach(s => set.add(s)));
  return [...set].filter(Boolean).sort();
}

function filterRows(rows, clinic, spec) {
  let r = rows;
  if (clinic) r = r.filter(row => row.clinicRaw === clinic);
  if (spec)   r = r.filter(row => splitComma(row.executorSpec).includes(spec));
  return r;
}

// ── Shared UI elements ────────────────────────────────────────────────────────
const thStyle = {
  padding: '8px 10px', fontWeight: 600, color: 'var(--rb-text)',
  textAlign: 'left', borderBottom: '2px solid var(--rb-border)',
  background: '#f8fafc',
};
const tdStyle = { padding: '7px 10px', color: 'var(--rb-text)', verticalAlign: 'top' };

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: 4, background: color || '#e2e8f0', flexShrink: 0 }} />
      <div style={{ padding: '16px 20px', flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: color || 'var(--rb-text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 8, lineHeight: 1.4 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--rb-text)', margin: '22px 0 10px' }}>{children}</div>;
}

function SectionHeader({ title, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 10px', flexWrap: 'wrap' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--rb-text)' }}>{title}</div>
      {children}
    </div>
  );
}

function ChartFilter({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '3px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6,
        fontSize: 12, fontFamily: 'inherit', background: '#fff',
        color: value ? 'var(--rb-text)' : 'var(--rb-text-secondary)',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
      {[{ key: 'bar', label: 'Обычный' }, { key: 'heatmap', label: 'Детальный' }].map(m => (
        <button key={m.key} onClick={() => onChange(m.key)} style={{
          padding: '2px 10px', fontSize: 11, borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
          border: '1px solid var(--rb-border-dark)',
          background: mode === m.key ? 'var(--rb-primary)' : '#fff',
          color:      mode === m.key ? '#fff'              : 'var(--rb-text-secondary)',
        }}>{m.label}</button>
      ))}
    </div>
  );
}

// Сортировка для графиков
const CHART_SORT_OPTIONS = [
  { value: 'val-desc', label: '↓ Спад' },
  { value: 'val-asc',  label: '↑ Рост' },
  { value: 'az',       label: 'А–Я' },
  { value: 'za',       label: 'Я–А' },
];

function applyChartSort(data, mode, dataKey, labelKey) {
  const arr = [...data];
  if (mode === 'val-desc') return arr.sort((a, b) => b[dataKey] - a[dataKey]);
  if (mode === 'val-asc')  return arr.sort((a, b) => a[dataKey] - b[dataKey]);
  if (mode === 'az')       return arr.sort((a, b) => String(a[labelKey]).localeCompare(String(b[labelKey]), 'ru'));
  if (mode === 'za')       return arr.sort((a, b) => String(b[labelKey]).localeCompare(String(a[labelKey]), 'ru'));
  return arr;
}

// Горизонтальный бар-чарт (кастомный, без recharts — для плавной анимации и читаемых подписей)
function HBarChart({ data, dataKey = 'value', labelKey = 'name', color = '#4f8ef7', colorKey, maxItems, formatter, labelWidth = 220, subLabelKey, defaultSort = 'val-desc' }) {
  const [sortMode, setSortMode] = useState(defaultSort);

  const items = useMemo(() => {
    const sorted = applyChartSort(data, sortMode, dataKey, labelKey);
    return maxItems != null ? sorted.slice(0, maxItems) : sorted;
  }, [data, sortMode, dataKey, labelKey, maxItems]);

  const max = Math.max(...items.map(d => d[dataKey]), 1);

  return (
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {CHART_SORT_OPTIONS.map(o => (
          <button
            key={o.value}
            onClick={() => setSortMode(o.value)}
            style={{
              padding: '2px 9px', fontSize: 11, borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid var(--rb-border-dark)',
              background: sortMode === o.value ? 'var(--rb-primary)' : '#fff',
              color: sortMode === o.value ? '#fff' : 'var(--rb-text-secondary)',
            }}
          >{o.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, borderLeft: '2px solid #e2e8f0', paddingLeft: 8, maxHeight: 750, overflowY: 'auto' }}>
        {items.map((d, i) => {
          const pct   = (d[dataKey] / max) * 100;
          const label = formatter ? formatter(d[dataKey]) : fmt(d[dataKey]);
          const sub   = subLabelKey ? d[subLabelKey] : null;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <div style={{ width: labelWidth, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', color: 'var(--rb-text)' }} title={sub ? `${sub} ${d[labelKey]}` : d[labelKey]}>
                {sub && <span style={{ flexShrink: 0 }}>{sub}</span>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d[labelKey]}</span>
              </div>
              <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 20, position: 'relative', minWidth: 60 }}>
                <div style={{ width: `${pct}%`, background: colorKey ? (d[colorKey] || color) : color, borderRadius: 4, height: '100%', transition: 'width 0.5s cubic-bezier(.4,0,.2,1)', opacity: 0.85 }} />
              </div>
              <div style={{ width: 110, flexShrink: 0, color: 'var(--rb-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Вертикальная гистограмма
function VBarChart({ data, dataKey = 'value', labelKey = 'name', color = '#14b8a6', colorKey, formatter, chartHeight = 220 }) {
  const [sortMode, setSortMode] = useState('val-desc');

  const items = useMemo(() => applyChartSort(data, sortMode, dataKey, labelKey), [data, sortMode, dataKey, labelKey]);
  const max = Math.max(...items.map(d => d[dataKey]), 1);

  return (
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {CHART_SORT_OPTIONS.map(o => (
          <button key={o.value} onClick={() => setSortMode(o.value)} style={{
            padding: '2px 9px', fontSize: 11, borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid var(--rb-border-dark)',
            background: sortMode === o.value ? 'var(--rb-primary)' : '#fff',
            color: sortMode === o.value ? '#fff' : 'var(--rb-text-secondary)',
          }}>{o.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: chartHeight, borderBottom: '2px solid #e2e8f0' }}>
        {items.map((d, i) => {
          const pct      = d[dataKey] / max;
          const barH     = Math.max(pct * (chartHeight - 30), pct > 0 ? 2 : 0);
          const label    = formatter ? formatter(d[dataKey]) : fmt(d[dataKey]);
          const barColor = colorKey ? (d[colorKey] || color) : color;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--rb-text)', marginBottom: 4, textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{label}</div>
              <div style={{ width: '72%', height: barH, background: barColor, borderRadius: '3px 3px 0 0', opacity: 0.85, transition: 'height 0.5s cubic-bezier(.4,0,.2,1)' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, height: 70 }}>
        {items.map((d, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, paddingTop: 6, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
            <div
              style={{ fontSize: 11, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap', transform: 'rotate(-40deg)', transformOrigin: 'top center' }}
              title={d[labelKey]}
            >{d[labelKey]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Patient modal ─────────────────────────────────────────────────────────────
function PatientModal({ patient, onClose }) {
  if (!patient) return null;
  return (
    <div className="rb-modal-overlay" onClick={onClose}>
      <div className="rb-modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
        <div className="rb-modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {patient.name || 'Пациент'}
            {patient.isVip && <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>VIP</span>}
            {patient.hasLK && <span style={{ fontSize: 11, background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>ЛК</span>}
          </h3>
          <button className="rb-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rb-modal-body">
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            {patient.card && <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>№ карты: <b>{patient.card}</b></span>}
            <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
              Итого: <b style={{ color: 'var(--rb-primary)' }}>{fmtRub(patient.revenue)}</b>
            </span>
            <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>{patient.rows.length} услуг</span>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Услуга</th>
                  <th style={thStyle}>Врач</th>
                  <th style={thStyle}>Клиника</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {patient.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                    <td style={tdStyle}>{r.serviceName || '—'}</td>
                    <td style={tdStyle}>{r.executor || '—'}</td>
                    <td style={tdStyle}>{r.clinicRaw || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{fmtRub(r.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Общая
// ─────────────────────────────────────────────────────────────────────────────
function TabGeneral({ rows }) {
  const [specClinic,  setSpecClinic]  = useState('');

  const clinicOptions = useMemo(() => getUniqueClinics(rows), [rows]);

  const totalRevenue   = useMemo(() => rows.reduce((s, r) => s + r.totalCost, 0), [rows]);
  const uniquePatients = useMemo(() => new Set(rows.map(getPatientKey).filter(Boolean)).size, [rows]);

  const orgStats = useMemo(() => ORG_GROUPS.map(group => {
    const groupRows = rows.filter(r => getOrgGroup(r)?.key === group.key);
    const { revenue, patients } = revenueAndPatients(groupRows);
    return { ...group, revenue, patients };
  }), [rows]);

  const clinicStats = useMemo(() => {
    const byClinic = groupBy(rows, r => r.clinicRaw || '—');
    return Object.entries(byClinic)
      .map(([name, rs]) => ({ name, ...revenueAndPatients(rs), color: rowsToClinicColor(rs) }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const specRows  = useMemo(() => filterRows(rows, specClinic, ''), [rows, specClinic]);
  const specStats = useMemo(() => {
    const bySpec = groupByMulti(specRows, r => splitComma(r.executorSpec));
    return Object.entries(bySpec)
      .map(([name, rs]) => ({ name, ...revenueAndPatients(rs) }))
      .sort((a, b) => b.patients - a.patients);
  }, [specRows]);


  return (
    <div>
      {/* По организациям */}
      <SectionTitle>Выручка по организациям</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 12, marginBottom: 20 }}>
        {orgStats.map(g => (
          <StatCard
            key={g.key}
            label={g.label}
            value={fmtRub(g.revenue)}
            sub={g.subLabel ? `${g.subLabel} · ${fmt(g.patients)} пац.` : `${fmt(g.patients)} пациентов`}
            color={g.color}
          />
        ))}
      </div>

      {/* По клиникам */}
      <SectionTitle>По клиникам</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <PieChart
          title={`Выручка · ${fmtRub(totalRevenue)}`}
          segments={clinicStats.map(c => ({ label: c.name, value: c.revenue, color: c.color }))}
          formatter={fmtRub}
        />
        <PieChart
          title={`Пациентов · ${fmt(uniquePatients)}`}
          segments={clinicStats.map(c => ({ label: c.name, value: c.patients, color: c.color }))}
        />
      </div>

      {/* По специальностям */}
      <SectionHeader title="Пациентов по специальностям">
        <ChartFilter value={specClinic} onChange={setSpecClinic} options={clinicOptions} placeholder="Все клиники" />
      </SectionHeader>
      <HBarChart data={specStats} dataKey="patients" labelKey="name" color="#8b5cf6" />
    </div>
  );
}

// ── Donut pie chart ───────────────────────────────────────────────────────────
function PieChart({ segments, size = 200, title, centerLabel, formatter }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (!total) return null;

  const cx = size / 2, cy = size / 2;
  const R  = size * 0.42;
  const r  = size * 0.25;

  let angle = -Math.PI / 2;
  const arcs = segments.map(seg => {
    const sweep = (seg.value / total) * 2 * Math.PI;
    const end   = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const cos0 = Math.cos(angle), sin0 = Math.sin(angle);
    const cos1 = Math.cos(end),   sin1 = Math.sin(end);
    const d = [
      `M ${cx + r * cos0} ${cy + r * sin0}`,
      `L ${cx + R * cos0} ${cy + R * sin0}`,
      `A ${R} ${R} 0 ${large} 1 ${cx + R * cos1} ${cy + R * sin1}`,
      `L ${cx + r * cos1} ${cy + r * sin1}`,
      `A ${r} ${r} 0 ${large} 0 ${cx + r * cos0} ${cy + r * sin0} Z`,
    ].join(' ');
    const mid = angle + sweep / 2;
    const lx  = cx + (R + r) / 2 * Math.cos(mid);
    const ly  = cy + (R + r) / 2 * Math.sin(mid);
    const pct = seg.value / total * 100;
    angle = end;
    return { ...seg, d, lx, ly, pct, sweep };
  });

  const labelFontSize = Math.max(10, size * 0.072);

  return (
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12, padding: '16px 18px' }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--rb-text)', marginBottom: 12 }}>{title}</div>}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
          {arcs.map((seg, i) => (
            <g key={i}>
              <path d={seg.d} fill={seg.color} stroke="#fff" strokeWidth={2} />
              {seg.sweep > 0.28 && (
                <text x={seg.lx} y={seg.ly} textAnchor="middle" dominantBaseline="middle"
                  style={{ fontSize: labelFontSize, fontWeight: 700, fill: '#fff', userSelect: 'none' }}>
                  {seg.pct.toFixed(0)}%
                </text>
              )}
            </g>
          ))}
          {centerLabel && (
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: size * 0.1, fontWeight: 700, fill: 'var(--rb-text)', userSelect: 'none' }}>
              {centerLabel}
            </text>
          )}
        </svg>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          {segments.map((seg, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seg.label}</div>
                {seg.sub && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 1 }}>{seg.sub}</div>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rb-text)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {formatter ? formatter(seg.value) : seg.value.toLocaleString('ru-RU')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// Tab: Пациенты
// ─────────────────────────────────────────────────────────────────────────────
function TabPatients({ rows }) {
  const [patientModal, setPatientModal] = useState(null);
  const [avgDocClinic, setAvgDocClinic] = useState('');
  const [avgSrcClinic, setAvgSrcClinic] = useState('');
  const [top20Clinic,  setTop20Clinic]  = useState('');

  const clinicOptions = useMemo(() => getUniqueClinics(rows), [rows]);

  const patientMap = useMemo(() => buildPatientMap(rows), [rows]);
  const patients   = useMemo(() => Array.from(patientMap.values()), [patientMap]);

  // VIP: сумма скидок VIP пациентов
  const vipDiscount = useMemo(() => rows.filter(r => r.isVip && r.discount > 0).reduce((s, r) => s + r.discount, 0), [rows]);

  // Скидки (все пациенты)
  const discountRows     = useMemo(() => rows.filter(r => r.discount > 0), [rows]);
  const discountPatients = useMemo(() => new Set(discountRows.map(getPatientKey).filter(Boolean)).size, [discountRows]);
  const totalDiscount    = useMemo(() => discountRows.reduce((s, r) => s + r.discount, 0), [discountRows]);

  // ЛК (личный кабинет)
  const lkCount = useMemo(() => patients.filter(p => p.hasLK).length, [patients]);
  const lkPct   = patients.length ? (lkCount / patients.length * 100) : 0;

  // VIP пациентов именно среди тех, у кого есть скидки
  const vipDiscountPatients = useMemo(() =>
    new Set(discountRows.filter(r => r.isVip).map(getPatientKey).filter(Boolean)).size,
    [discountRows]);

  // Средний чек по врачу (с фильтром клиники)
  const avgDocRows  = useMemo(() => filterRows(rows, avgDocClinic, ''), [rows, avgDocClinic]);
  const avgByDoctor = useMemo(() => {
    const byDoc = groupBy(avgDocRows, r => r.executor || null);
    return Object.entries(byDoc)
      .map(([name, rs]) => ({ name, ...revenueAndPatients(rs), color: rowsToClinicColor(rs) }))
      .filter(d => d.patients > 0)
      .sort((a, b) => b.avgCheck - a.avgCheck);
  }, [avgDocRows]);

  // Средний чек по специальности услуги
  const avgBySpec = useMemo(() => {
    const bySpec = groupByMulti(rows, r => splitComma(r.serviceSpec));
    return Object.entries(bySpec)
      .map(([name, rs]) => ({ name, ...revenueAndPatients(rs) }))
      .filter(d => d.patients > 0)
      .sort((a, b) => b.avgCheck - a.avgCheck);
  }, [rows]);

  // Средний чек по источнику записи (с фильтром клиники)
  const avgSrcRows  = useMemo(() => filterRows(rows, avgSrcClinic, ''), [rows, avgSrcClinic]);
  const avgBySource = useMemo(() => {
    const bySrc = groupBy(avgSrcRows, r => r.sourceEntry || 'Не указан');
    return Object.entries(bySrc)
      .map(([name, rs]) => ({ name, ...revenueAndPatients(rs) }))
      .filter(d => d.patients > 0)
      .sort((a, b) => b.avgCheck - a.avgCheck);
  }, [avgSrcRows]);

  // Топ 20% (с фильтром клиники)
  const top20Rows      = useMemo(() => filterRows(rows, top20Clinic, ''), [rows, top20Clinic]);
  const top20PatMap    = useMemo(() => buildPatientMap(top20Rows), [top20Rows]);
  const top20Patients  = useMemo(() => Array.from(top20PatMap.values()), [top20PatMap]);
  const top20          = useMemo(() => getTop20Pct(top20Patients), [top20Patients]);

  return (
    <div>
      {patientModal && <PatientModal patient={patientModal} onClose={() => setPatientModal(null)} />}

      {/* Круговые диаграммы: ЛК и Скидки */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
        <PieChart
          title="Пациенты с Личным кабинетом"
          size={240}
          centerLabel={fmt(patients.length)}
          segments={[
            { label: 'С ЛК',   value: lkCount,                   color: '#10b981', sub: `${fmtPct(lkPct)} от всех` },
            { label: 'Без ЛК', value: patients.length - lkCount, color: '#ef4444', sub: `${fmtPct(100 - lkPct)} от всех` },
          ].filter(s => s.value > 0)}
        />
        {discountPatients > 0 && (
          <PieChart
            title="Пациенты со скидками"
            size={240}
            centerLabel={fmt(discountPatients)}
            segments={[
              { label: 'VIP',    value: vipDiscountPatients,                       color: '#f59e0b', sub: `Скидки: ${fmtRub(vipDiscount)}` },
              { label: 'Прочие', value: discountPatients - vipDiscountPatients,     color: '#f97316', sub: `Скидки: ${fmtRub(totalDiscount - vipDiscount)}` },
            ].filter(s => s.value > 0)}
          />
        )}
      </div>

      {/* Средний чек */}
      <SectionHeader title="Средний чек по врачам">
        <ChartFilter value={avgDocClinic} onChange={setAvgDocClinic} options={clinicOptions} placeholder="Все клиники" />
      </SectionHeader>
      <HBarChart data={avgByDoctor} dataKey="avgCheck" labelKey="name" colorKey="color" color="#4f8ef7" formatter={fmtRub} />

      <SectionTitle>Средний чек по специальностям</SectionTitle>
      <HBarChart data={avgBySpec} dataKey="avgCheck" labelKey="name" color="#8b5cf6" formatter={fmtRub} />

      <SectionHeader title="Средний чек по источнику записи">
        <ChartFilter value={avgSrcClinic} onChange={setAvgSrcClinic} options={clinicOptions} placeholder="Все клиники" />
      </SectionHeader>
      <VBarChart data={avgBySource} dataKey="avgCheck" labelKey="name" color="#14b8a6" formatter={fmtRub} />

      {/* Топ 20% */}
      <SectionHeader title={`Топ 20% пациентов по выручке (${top20.length} из ${top20Patients.length})`}>
        <ChartFilter value={top20Clinic} onChange={setTop20Clinic} options={clinicOptions} placeholder="Все клиники" />
      </SectionHeader>
      <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              <th style={{ ...thStyle, width: 36 }}>#</th>
              <th style={thStyle}>№ карты</th>
              <th style={thStyle}>ФИО пациента</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Выручка</th>
              <th style={{ ...thStyle, width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {top20.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                <td style={{ ...tdStyle, color: 'var(--rb-text-secondary)' }}>{i + 1}</td>
                <td style={tdStyle}>{p.card || '—'}</td>
                <td style={tdStyle}>
                  {p.name || '—'}
                  {p.isVip && <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: 10, fontWeight: 600 }}>VIP</span>}
                  {p.hasLK && <span style={{ marginLeft: 4, fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: 10, fontWeight: 600 }}>ЛК</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtRub(p.revenue)}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => setPatientModal(p)}
                    style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, background: '#fff', cursor: 'pointer', color: 'var(--rb-text)' }}
                  >Детали</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Маржинальность
// ─────────────────────────────────────────────────────────────────────────────
function TabMargin({ rows }) {
  const [sortKey, setSortKey] = useState('margin');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch]   = useState('');
  const [popClinic, setPopClinic] = useState('');
  const [popSpec,   setPopSpec]   = useState('');

  const clinicOptions = useMemo(() => getUniqueClinics(rows), [rows]);
  const specOptions   = useMemo(() => getUniqueSpecs(rows), [rows]);

  const services = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const name = r.serviceName;
      if (!name) continue;
      const qty = r.qty || 1;
      if (!map[name]) map[name] = { name, code: r.serviceCode || '', count: 0, sumPrice: 0, sumCost: 0 };
      map[name].count    += qty;
      map[name].sumPrice += r.servicePrice * qty;
      map[name].sumCost  += r.costPrice    * qty;
    }
    return Object.values(map).map(s => ({
      ...s,
      price:     s.count ? s.sumPrice / s.count : 0,
      cost:      s.count ? s.sumCost  / s.count : 0,
      margin:    s.sumPrice - s.sumCost,
      marginPct: s.sumPrice ? ((s.sumPrice - s.sumCost) / s.sumPrice * 100) : 0,
    }));
  }, [rows]);

  const popRows = useMemo(() => filterRows(rows, popClinic, popSpec), [rows, popClinic, popSpec]);
  const popular = useMemo(() => {
    const map = {};
    for (const r of popRows) {
      const name = r.serviceName;
      if (!name) continue;
      const qty = r.qty || 1;
      if (!map[name]) map[name] = { name, code: r.serviceCode || '', count: 0 };
      map[name].count += qty;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [popRows]);

  const hasServiceCodes = popular.some(s => s.code);

  const sorted = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = search
      ? services.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      : services;
    const dir = sortDir === 'desc' ? -1 : 1;
    const keyMap = { margin: 'margin', pct: 'marginPct', count: 'count', price: 'price' };
    return [...filtered].sort((a, b) => dir * (b[keyMap[sortKey]] - a[keyMap[sortKey]]));
  }, [services, sortKey, sortDir, search]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const sortIcon = (key) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const hasCostData = services.some(s => s.sumCost > 0);
  const hasCode = sorted.some(s => s.code);

  return (
    <div>
      <SectionHeader title="Популярные услуги (по количеству)">
        <ChartFilter value={popSpec}   onChange={setPopSpec}   options={specOptions}   placeholder="Все специальности" />
        <ChartFilter value={popClinic} onChange={setPopClinic} options={clinicOptions} placeholder="Все клиники" />
      </SectionHeader>
      <HBarChart data={popular} dataKey="count" labelKey="name" color="#8b5cf6" labelWidth={580} subLabelKey={hasServiceCodes ? 'code' : undefined} />

      <SectionTitle>Маржинальность услуг</SectionTitle>
      {!hasCostData && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 12 }}>
          Данные о себестоимости отсутствуют — колонка «Себестоимость услуги» не найдена в источниках
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию или коду услуги..."
          style={{ width: 340, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
        />
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr>
                {hasCode && <th style={{ ...thStyle, width: 90 }}>Код</th>}
                <th style={thStyle}>Услуга</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => toggleSort('count')}>
                  Кол-во{sortIcon('count')}
                </th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => toggleSort('price')}>
                  Стоимость услуги{sortIcon('price')}
                </th>
                {hasCostData && <th style={{ ...thStyle, textAlign: 'right' }}>Себестоимость</th>}
                {hasCostData && (
                  <>
                    <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => toggleSort('margin')}>
                      Маржа ₽{sortIcon('margin')}
                    </th>
                    <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => toggleSort('pct')}>
                      Маржа %{sortIcon('pct')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                  {hasCode && <td style={{ ...tdStyle, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>{s.code || '—'}</td>}
                  <td style={tdStyle}>{s.name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(s.count)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtRub(s.price)}</td>
                  {hasCostData && (
                    <td style={{ ...tdStyle, textAlign: 'right', color: s.cost > 0 ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}>
                      {s.cost > 0 ? fmtRub(s.cost) : '—'}
                    </td>
                  )}
                  {hasCostData && (
                    <>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: s.margin >= 0 ? '#16a34a' : '#dc2626' }}>
                        {fmtRub(s.margin)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: s.marginPct >= 0 ? '#16a34a' : '#dc2626' }}>
                        {s.cost > 0 ? fmtPct(s.marginPct) : '—'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctor heatmap: пациентов у врача по дням, раскраска по цвету клиники
// ─────────────────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  if (!hex || hex.length < 7) return [148, 163, 184];
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function blendToWhite(hex, ratio) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(255+(r-255)*ratio)},${Math.round(255+(g-255)*ratio)},${Math.round(255+(b-255)*ratio)})`;
}

function DoctorHeatmap({ rows, periodStart, periodEnd }) {
  const days = useMemo(() => {
    if (!periodStart || !periodEnd) return [];
    const result = [];
    const cur = new Date(periodStart); cur.setHours(0,0,0,0);
    const fin = new Date(periodEnd);   fin.setHours(23,59,59,999);
    while (cur <= fin) { result.push(new Date(cur)); cur.setDate(cur.getDate()+1); }
    return result;
  }, [periodStart, periodEnd]);

  const { doctorList, maxCount } = useMemo(() => {
    const colorByDoc = {};
    const byDoc = {};
    for (const r of rows) {
      if (!r.executor) continue;
      const name = r.executor;
      if (r.clinicId && !colorByDoc[name]) colorByDoc[name] = getClinicColorById(r.clinicId);
      if (!r.date) continue;
      const dayKey = r.date.toISOString().slice(0,10);
      const pk = getPatientKey(r);
      if (!pk) continue;
      if (!byDoc[name]) byDoc[name] = {};
      if (!byDoc[name][dayKey]) byDoc[name][dayKey] = new Set();
      byDoc[name][dayKey].add(pk);
    }
    let mx = 1;
    const doctorList = [];
    for (const [name, dayData] of Object.entries(byDoc)) {
      const dayCounts = {};
      let total = 0;
      for (const [day, set] of Object.entries(dayData)) {
        dayCounts[day] = set.size;
        total += set.size;
        if (set.size > mx) mx = set.size;
      }
      doctorList.push({ name, color: colorByDoc[name] || '#94a3b8', dayCounts, total });
    }
    doctorList.sort((a, b) => b.total - a.total);
    return { doctorList, maxCount: mx };
  }, [rows]);

  if (!doctorList.length) {
    return <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>Нет данных</div>;
  }

  // Ширина ячейки вписывается в ~750px сетки — для месяца не будет горизонтального скролла на большинстве экранов
  const CELL_W  = Math.max(24, Math.min(40, Math.floor(750 / Math.max(days.length, 1))));
  const CELL_H  = 34;
  const LABEL_W = 240;

  const multiMonth = days.length > 0 && (
    days[0].getMonth() !== days[days.length-1].getMonth() ||
    days[0].getFullYear() !== days[days.length-1].getFullYear()
  );

  return (
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ overflowX: 'auto', maxHeight: 760, overflowY: 'auto' }}>
        {/* Заголовок (липкий при вертикальном скролле) */}
        <div style={{ display: 'flex', marginBottom: 4, position: 'sticky', top: 0, background: '#fff', zIndex: 1, paddingBottom: 2 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          {days.map((d, i) => (
            <div key={i} style={{ width: CELL_W, flexShrink: 0, textAlign: 'center', fontSize: 10, color: 'var(--rb-text-secondary)', fontVariantNumeric: 'tabular-nums', lineHeight: multiMonth ? 1.3 : 1 }}>
              {multiMonth && d.getDate() === 1
                ? <><div style={{ fontSize: 9, color: '#94a3b8' }}>{MONTH_NAMES[d.getMonth()].slice(0,3)}</div><div>{d.getDate()}</div></>
                : d.getDate()
              }
            </div>
          ))}
          <div style={{ width: 48, flexShrink: 0 }} />
        </div>

        {/* Строки врачей */}
        {doctorList.map(doc => (
          <div key={doc.name} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
            <div
              style={{ width: LABEL_W, flexShrink: 0, fontSize: 12, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 10 }}
              title={doc.name}
            >
              {doc.name}
            </div>
            {days.map((d, i) => {
              const dayKey = d.toISOString().slice(0,10);
              const count  = doc.dayCounts[dayKey] || 0;
              const ratio  = count / maxCount;
              // Минимальный блендинг 25%, чтобы даже 1 пациент давал заметный оттенок
              const ar     = count ? (0.25 + ratio * 0.75) : 0;
              const bg     = count ? blendToWhite(doc.color, ar) : '#f1f5f9';
              const textCol = count === 0 ? '#e2e8f0' : (ar >= 0.70 ? '#fff' : '#374151');
              return (
                <div
                  key={i}
                  title={count ? `${doc.name}: ${count} пац. ${d.toLocaleDateString('ru-RU')}` : undefined}
                  style={{
                    width: CELL_W - 3, height: CELL_H - 4, flexShrink: 0, margin: '0 1.5px',
                    background: bg, borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: count ? 700 : 400,
                    color: textCol, fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count || ''}
                </div>
              );
            })}
            <div style={{ marginLeft: 8, fontSize: 12, color: 'var(--rb-text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', width: 40, textAlign: 'right', fontWeight: 600 }}>
              {doc.total}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ReturnVisitsTable({ data }) {
  const [sortKey, setSortKey] = useState('total');
  const [sortDir, setSortDir] = useState(-1);

  const sorted = useMemo(() => [...data].sort((a, b) => sortDir * (b[sortKey] - a[sortKey])), [data, sortKey, sortDir]);

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  const thC = key => ({
    ...thStyle, textAlign: 'right', cursor: 'pointer', userSelect: 'none',
    background: sortKey === key ? '#eef2f7' : '#f8fafc',
  });
  const arr = key => sortKey === key ? (sortDir < 0 ? ' ↓' : ' ↑') : '';

  if (!data.length) return (
    <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
      Недостаточно данных для анализа повторных визитов
    </div>
  );

  return (
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ maxHeight: 500, overflowY: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              <th style={thStyle}>Врач</th>
              <th style={thC('total')} onClick={() => handleSort('total')}>Всего пац.{arr('total')}</th>
              <th style={thC('notReturned')} onClick={() => handleSort('notReturned')}>Не вернулся{arr('notReturned')}</th>
              <th style={thC('sameDoctor')} onClick={() => handleSort('sameDoctor')}>К тому же врачу{arr('sameDoctor')}</th>
              <th style={thC('otherReferred')} onClick={() => handleSort('otherReferred')}>К другому по направлению{arr('otherReferred')}</th>
              <th style={thC('otherSelf')} onClick={() => handleSort('otherSelf')}>К другому самостоятельно{arr('otherSelf')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                <td style={tdStyle}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: d.color, marginRight: 6, verticalAlign: 'middle' }} />
                  {d.name}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{d.total}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{d.notReturned}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{d.sameDoctor}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{d.otherReferred}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{d.otherSelf}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Tab: Эффективность
// ─────────────────────────────────────────────────────────────────────────────
function TabEfficiency({ rows, periodStart, periodEnd }) {
  const [refSearch,    setRefSearch]    = useState('');
  const [docClinic,    setDocClinic]    = useState('');
  const [docSpec,      setDocSpec]      = useState('');
  const [docViewMode,  setDocViewMode]  = useState('bar');

  const clinicOptions = useMemo(() => getUniqueClinics(rows), [rows]);
  const specOptions   = useMemo(() => getUniqueSpecs(rows), [rows]);

  // Пациентов у врача (с фильтрами)
  const docRows = useMemo(() => filterRows(rows, docClinic, docSpec), [rows, docClinic, docSpec]);
  const doctorPatients = useMemo(() => {
    const byDoc = groupBy(docRows, r => r.executor || null);
    return Object.entries(byDoc)
      .map(([name, rs]) => ({ name, ...revenueAndPatients(rs), color: rowsToClinicColor(rs) }))
      .sort((a, b) => b.patients - a.patients);
  }, [docRows]);

  // Матрица рекомендаций
  const referrals = useMemo(() => {
    const pairs = {};
    for (const r of rows) {
      const ref  = r.referrer?.trim();
      const exec = r.executor?.trim();
      const refKey  = nameToKey(ref);
      const execKey = nameToKey(exec);
      if (!refKey || !execKey || refKey === execKey) continue;
      const key = `${refKey}\u0000${execKey}`;
      if (!pairs[key]) pairs[key] = { referrer: ref, executor: exec, refKey, execKey, count: 0, revenue: 0 };
      pairs[key].count++;
      pairs[key].revenue += r.totalCost;
    }
    return Object.values(pairs).sort((a, b) => b.count - a.count);
  }, [rows]);

  // Карта: канонический ключ имени → цвет клиники (строим по исполнителям у которых известен clinicId)
  const executorColorMap = useMemo(() => {
    const map = {};
    for (const r of rows) {
      if (r.executor && r.clinicId) {
        const key = nameToKey(r.executor);
        if (key && !map[key]) map[key] = getClinicColorById(r.clinicId);
      }
    }
    return map;
  }, [rows]);

  // Топ по количеству исходящих направлений
  const topReferrers = useMemo(() => {
    const map = {};
    for (const r of referrals) {
      if (!map[r.referrer]) map[r.referrer] = { name: r.referrer, refKey: r.refKey, count: 0, revenue: 0 };
      map[r.referrer].count   += r.count;
      map[r.referrer].revenue += r.revenue;
    }
    return Object.values(map)
      .map(d => ({ ...d, color: executorColorMap[d.refKey] || '#94a3b8' }))
      .sort((a, b) => b.count - a.count);
  }, [referrals, executorColorMap]);

  // Исполнители по выручке через направления
  const topByRevenue = useMemo(() => {
    const map = {};
    for (const r of referrals) {
      if (!map[r.executor]) map[r.executor] = { name: r.executor, execKey: r.execKey, count: 0, revenue: 0 };
      map[r.executor].count   += r.count;
      map[r.executor].revenue += r.revenue;
    }
    return Object.values(map)
      .map(d => ({ ...d, color: executorColorMap[d.execKey] || '#94a3b8' }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [referrals, executorColorMap]);

  const filteredReferrals = useMemo(() => {
    if (!refSearch) return referrals;
    const q = refSearch.toLowerCase();
    return referrals.filter(r =>
      r.referrer.toLowerCase().includes(q) || r.executor.toLowerCase().includes(q)
    );
  }, [referrals, refSearch]);

  // Взаимные направления: пары врачей, которые направляют друг к другу
  const mutualPairs = useMemo(() => {
    // Строим lookup по каноническим ключам — так "Иванов И.И. → Петров П.П."
    // находит обратную "Петров Петр Петрович → Иванов Иван Иванович"
    const lookup = {};
    for (const r of referrals) lookup[`${r.refKey} ${r.execKey}`] = r;
    const seen = new Set();
    const result = [];
    for (const r of referrals) {
      const pairKey = [r.refKey, r.execKey].sort().join(' ');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const reverse = lookup[`${r.execKey} ${r.refKey}`];
      if (!reverse) continue;
      result.push({ docA: r.referrer, docB: r.executor, aToB: r.count, bToA: reverse.count, total: r.count + reverse.count });
    }
    return result.sort((a, b) => b.total - a.total);
  }, [referrals]);

  const [minSteps,  setMinSteps]  = useState(1);
  const [showAll,   setShowAll]   = useState(false);

  const allChains    = useMemo(() => buildReferralChains(rows), [rows]);
  const returnVisitStats = useMemo(() => buildReturnVisitStats(rows), [rows]);
  const chainData    = useMemo(() => {
    const filtered = minSteps > 1 ? allChains.filter(c => c.steps >= minSteps) : allChains;
    return showAll ? filtered : filtered.slice(0, 10);
  }, [allChains, minSteps, showAll]);

  return (
    <div>
      <SectionHeader title="Пациентов у врача">
        <ChartFilter value={docSpec}   onChange={setDocSpec}   options={specOptions}   placeholder="Все специальности" />
        <ChartFilter value={docClinic} onChange={setDocClinic} options={clinicOptions} placeholder="Все клиники" />
        <ModeToggle mode={docViewMode} onChange={setDocViewMode} />
      </SectionHeader>
      {docViewMode === 'bar'
        ? <HBarChart data={doctorPatients} dataKey="patients" labelKey="name" colorKey="color" color="#4f8ef7" />
        : <DoctorHeatmap rows={docRows} periodStart={periodStart} periodEnd={periodEnd} />
      }

      {referrals.length > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 4 }}>
            <div>
              <SectionTitle>Кто чаще направляет</SectionTitle>
              <HBarChart data={topReferrers} dataKey="count" labelKey="name" colorKey="color" color="#f97316" />
            </div>
            <div>
              <SectionTitle>Кто приносит больше через направления</SectionTitle>
              <HBarChart data={topByRevenue} dataKey="revenue" labelKey="name" colorKey="color" color="#10b981" formatter={fmtRub} />
            </div>
          </div>

          <SectionTitle>Направления между врачами</SectionTitle>
          <div style={{ marginBottom: 10 }}>
            <input
              value={refSearch}
              onChange={e => setRefSearch(e.target.value)}
              placeholder="Поиск по врачу..."
              style={{ width: 300, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={thStyle}>Рекомендатель</th>
                    <th style={thStyle}>Исполнитель</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Кол-во</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReferrals.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                      <td style={tdStyle}>{r.referrer}</td>
                      <td style={tdStyle}>{r.executor}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{r.count}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{fmtRub(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 20, padding: '24px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, background: '#f8fafc', borderRadius: 10, border: '1px solid var(--rb-border)' }}>
          Данные о направлениях отсутствуют (колонки «ФИО рекомендателя» и «ФИО исполнителя» должны быть заполнены)
        </div>
      )}

      {/* Взаимные направления */}
      <SectionTitle>Взаимные направления между врачами</SectionTitle>
      {mutualPairs.length > 0 ? (
        <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  <th style={{ ...thStyle, width: 36 }}>#</th>
                  <th style={thStyle}>Врач А</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 70 }}>А → Б</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 70 }}>Б → А</th>
                  <th style={thStyle}>Врач Б</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 70 }}>Итого</th>
                </tr>
              </thead>
              <tbody>
                {mutualPairs.slice(0, 30).map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                    <td style={{ ...tdStyle, color: 'var(--rb-text-secondary)' }}>{i + 1}</td>
                    <td style={tdStyle}>{p.docA}</td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: '#4f8ef7' }}>{p.aToB}</td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: '#10b981' }}>{p.bToA}</td>
                    <td style={tdStyle}>{p.docB}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
          Взаимных направлений не найдено — нет пар врачей, которые направляли бы друг к другу
        </div>
      )}

      {/* Повторные визиты */}
      <SectionTitle>Повторные визиты</SectionTitle>
      <ReturnVisitsTable data={returnVisitStats} />

      {/* Внутренняя сеть направлений */}
      <SectionHeader title="Внутренняя сеть направлений">
        {[1, 2, 3, 4].map(n => (
          <button key={n} onClick={() => { setMinSteps(n); setShowAll(false); }} style={{
            padding: '2px 9px', fontSize: 11, borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid var(--rb-border-dark)',
            background: minSteps === n ? 'var(--rb-primary)' : '#fff',
            color: minSteps === n ? '#fff' : 'var(--rb-text-secondary)',
          }}>{n}+ шаг{n === 1 ? '' : n < 5 ? 'а' : 'ов'}</button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginLeft: 4 }}>
          {allChains.filter(c => c.steps >= minSteps).length} цепочек
        </span>
      </SectionHeader>
      {chainData.length > 0 ? (
        <>
          <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
            {chainData.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: i < chainData.length - 1 ? '1px solid var(--rb-border)' : 'none', fontSize: 13 }}>
                <span style={{ color: 'var(--rb-text)' }}>{c.name}</span>
                <span style={{ flexShrink: 0, marginLeft: 16, color: 'var(--rb-text)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {c.count} {c.count === 1 ? 'пациент' : c.count < 5 ? 'пациента' : 'пациентов'}
                </span>
              </div>
            ))}
          </div>
          {!showAll && allChains.filter(c => c.steps >= minSteps).length > 10 && (
            <button onClick={() => setShowAll(true)} style={{
              marginTop: 8, padding: '5px 14px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
              border: '1px solid var(--rb-border-dark)', background: '#fff',
              color: 'var(--rb-text)', fontFamily: 'inherit',
            }}>Показать все</button>
          )}
        </>
      ) : (
        <div style={{ padding: '20px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
          {allChains.length > 0
            ? `Нет цепочек с ${minSteps}+ шагами — попробуйте уменьшить фильтр`
            : 'Цепочки не найдены — для анализа нужны колонки «Специальность рекомендателя» или «Специальность услуги»'}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff heatmap: пациенты по дням для сотрудников с ролью КабинетыИРабота
// ─────────────────────────────────────────────────────────────────────────────
function abbrevName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (!parts.length) return fullName;
  const [last, first, middle] = parts;
  return last + (first ? ` ${first[0]}.` : '') + (middle ? `${middle[0]}.` : '');
}

function StaffHeatmap({ rows, doctors, periodStart, periodEnd }) {
  const cabinetsStaff = useMemo(
    () => (doctors || []).filter(d => d.roles?.includes('КабинетыИРабота')),
    [doctors],
  );

  const days = useMemo(() => {
    if (!periodStart || !periodEnd) return [];
    const result = [];
    const cur = new Date(periodStart); cur.setHours(0, 0, 0, 0);
    const fin = new Date(periodEnd);   fin.setHours(23, 59, 59, 999);
    while (cur <= fin) { result.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    return result;
  }, [periodStart, periodEnd]);

  const { staffList, maxCount } = useMemo(() => {
    const staffMap = new Map();
    for (const d of cabinetsStaff) {
      const k = nameToKey(d.name);
      if (k) staffMap.set(k, { key: k, name: d.name, short: abbrevName(d.name) });
    }

    const sets = {};
    for (const [k] of staffMap) sets[k] = {};

    for (const r of rows) {
      if (!r.executor || !r.date) continue;
      const k = nameToKey(r.executor);
      if (!sets[k]) continue;
      const dayKey = r.date.toISOString().slice(0, 10);
      const pk = getPatientKey(r);
      if (!pk) continue;
      if (!sets[k][dayKey]) sets[k][dayKey] = new Set();
      sets[k][dayKey].add(pk);
    }

    let mx = 1;
    const staffList = [];
    for (const [k, info] of staffMap) {
      const dayCounts = {};
      let total = 0;
      for (const [day, set] of Object.entries(sets[k])) {
        dayCounts[day] = set.size;
        total += set.size;
        if (set.size > mx) mx = set.size;
      }
      if (total > 0) staffList.push({ ...info, dayCounts, total });
    }
    staffList.sort((a, b) => b.total - a.total);
    return { staffList, maxCount: mx };
  }, [rows, cabinetsStaff]);

  // Красно-жёлто-зелёная шкала через HSL: 0° (красный) → 60° (жёлтый) → 120° (зелёный)
  // Минимальная насыщенность 42% lightness — даже при 1 пациенте цвет хорошо виден
  const getColor = useCallback((count) => {
    if (!count) return '#f1f5f9';
    const ratio = Math.min(count / maxCount, 1);
    const hue = ratio * 120;
    // lightness: 50% у красного, 55% у жёлтого (самый яркий), 44% у зелёного
    const lig = ratio < 0.5 ? 50 + ratio * 10 : 60 - (ratio - 0.5) * 32;
    return `hsl(${hue}, 82%, ${lig}%)`;
  }, [maxCount]);

  if (!cabinetsStaff.length) {
    return <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>Сотрудники с ролью «КабинетыИРабота» не найдены</div>;
  }
  if (!staffList.length) {
    return <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>Нет данных по сотрудникам с ролью «КабинетыИРабота» за выбранный период</div>;
  }

  // Ширина ячейки — вписываемся в ~720px зоны сетки (остальное — имена + итог)
  const CELL_W = Math.max(22, Math.min(36, Math.floor(720 / Math.max(days.length, 1))));
  const CELL_H = 34;
  const LABEL_W = 240;

  // Показываем разделитель месяца в заголовке если период > 1 месяца
  const multiMonth = days.length > 0 && (
    days[0].getMonth() !== days[days.length - 1].getMonth() ||
    days[0].getFullYear() !== days[days.length - 1].getFullYear()
  );

  return (
    // Внешняя карточка без overflow — чтобы не ломать ширину соседних блоков
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10 }}>
      {/* Скроллируемая сетка — только она горизонтально прокручивается */}
      <div style={{ overflowX: 'auto', padding: '16px 18px 8px' }}>
        {/* Заголовок: числа дней */}
        <div style={{ display: 'flex', marginBottom: 4 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          {days.map((d, i) => (
            <div key={i} style={{ width: CELL_W, flexShrink: 0, textAlign: 'center', fontSize: 10, color: 'var(--rb-text-secondary)', fontVariantNumeric: 'tabular-nums', lineHeight: multiMonth ? 1.3 : 1 }}>
              {multiMonth && d.getDate() === 1
                ? <><div style={{ fontSize: 9, color: '#94a3b8' }}>{MONTH_NAMES[d.getMonth()].slice(0, 3)}</div><div>{d.getDate()}</div></>
                : d.getDate()
              }
            </div>
          ))}
          <div style={{ width: 48, flexShrink: 0 }} />
        </div>

        {/* Строки сотрудников */}
        {staffList.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
            <div
              style={{ width: LABEL_W, flexShrink: 0, fontSize: 12, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 10 }}
              title={s.name}
            >
              {s.name}
            </div>
            {days.map((d, i) => {
              const dayKey = d.toISOString().slice(0, 10);
              const count = s.dayCounts[dayKey] || 0;
              const ratio = count / maxCount;
              // жёлтая зона (0.3–0.7) — тёмный текст, края — белый
              const textCol = count === 0 ? '#e2e8f0' : (ratio > 0.25 && ratio < 0.75 ? '#1a1a1a' : '#fff');
              return (
                <div
                  key={i}
                  title={count ? `${s.name}: ${count} пац. ${d.toLocaleDateString('ru-RU')}` : undefined}
                  style={{
                    width: CELL_W - 3, height: CELL_H - 4, flexShrink: 0, margin: '0 1.5px',
                    background: getColor(count), borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: count ? 700 : 400,
                    color: textCol,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count || ''}
                </div>
              );
            })}
            <div style={{ marginLeft: 8, fontSize: 12, color: 'var(--rb-text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', width: 40, textAlign: 'right', fontWeight: 600 }}>
              {s.total}
            </div>
          </div>
        ))}
      </div>

      {/* Легенда — вне скролла, всегда по ширине карточки */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>Пациентов в день:</span>
        {[0, Math.round(maxCount * 0.25), Math.round(maxCount * 0.5), Math.round(maxCount * 0.75), maxCount].map((v, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 18, height: 18, background: getColor(v), borderRadius: 3, border: '1px solid #e2e8f0' }} />
            <span style={{ fontSize: 10, color: 'var(--rb-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          </div>
        ))}
        <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginLeft: 8 }}>· итого за период справа</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Кабинеты
// ─────────────────────────────────────────────────────────────────────────────
function TabRooms({ periodStart, periodEnd, onAppointmentsLoaded, rows = [], doctors = [] }) {
  const [appointments, setAppointments] = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [syncStatus,   setSyncStatus]   = useState(null); // { syncing, done, total, phase, totalInDb, lastSyncAt }
  const [syncing,      setSyncing]      = useState(false);
  const [roomClinic,   setRoomClinic]   = useState('');
  const [staffMode,    setStaffMode]    = useState('bar');

  const pollRef = useRef(null);

  // ── Fetch sync status ────────────────────────────────────────────────────────
  const fetchSyncStatus = useCallback(async () => {
    try {
      const s = await getSyncStatus();
      setSyncStatus(s);
      return s;
    } catch { return null; }
  }, []);

  // ── Start polling while sync is running ──────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchSyncStatus();
      if (s && !s.syncing) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setSyncing(false);
      }
    }, 2000);
  }, [fetchSyncStatus]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Load appointments from DB when period changes ────────────────────────────
  const loadFromDB = useCallback(async () => {
    if (!periodStart || !periodEnd) return;
    setLoading(true);
    try {
      const data = await fetchAppointmentsFromDB(periodStart, periodEnd);
      setAppointments(data);
      onAppointmentsLoaded?.(data);
    } catch (e) {
      console.error('[TabRooms] DB load error:', e);
      toast.error('Ошибка загрузки визитов');
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd]);

  // Check DB on mount and whenever period changes
  useEffect(() => {
    fetchSyncStatus();
    loadFromDB();
  }, [fetchSyncStatus, loadFromDB]);

  // ── Trigger full initial sync ────────────────────────────────────────────────
  const handleFirstSync = useCallback(async () => {
    setSyncing(true);
    try {
      await triggerSync({});
      await fetchSyncStatus();
      startPolling();
    } catch (e) {
      console.error('[TabRooms] sync trigger error:', e);
      toast.error('Не удалось запустить синхронизацию');
      setSyncing(false);
    }
  }, [fetchSyncStatus, startPolling]);

  // ── Computed ─────────────────────────────────────────────────────────────────
  const clinicOptions = useMemo(() => {
    if (!appointments.length) return [];
    const ids = [...new Set(appointments.map(a => String(a.clinic_id || '')).filter(Boolean))];
    return ids.map(id => ({
      value: id,
      label: DEFAULT_CLINICS.find(c => String(c.id) === id)?.name || `Клиника ${id}`,
    })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [appointments]);

  const roomStats = useMemo(() => {
    if (!appointments.length) return [];
    const filtered = roomClinic ? appointments.filter(a => String(a.clinic_id) === roomClinic) : appointments;
    return buildRoomStats(filtered, periodStart, periodEnd);
  }, [appointments, periodStart, periodEnd, roomClinic]);

  const gapStats = useMemo(() => {
    if (!appointments.length) return null;
    const filtered = roomClinic ? appointments.filter(a => String(a.clinic_id) === roomClinic) : appointments;
    return buildRoomGapStats(filtered);
  }, [appointments, roomClinic]);

  // Суммарные пациенты по сотрудникам кабинетов (для режима «Обычный»)
  const staffBarData = useMemo(() => {
    if (!rows.length || !doctors.length) return [];
    const cabinetsStaff = doctors.filter(d => d.roles?.includes('КабинетыИРабота'));
    const staffKeys = new Map();
    for (const d of cabinetsStaff) {
      const k = nameToKey(d.name);
      if (k) staffKeys.set(k, d.name);
    }
    const byStaff = {};
    for (const r of rows) {
      if (!r.executor) continue;
      const k = nameToKey(r.executor);
      if (!staffKeys.has(k)) continue;
      const pk = getPatientKey(r);
      if (!pk) continue;
      const name = staffKeys.get(k);
      if (!byStaff[name]) byStaff[name] = new Set();
      byStaff[name].add(pk);
    }
    return Object.entries(byStaff)
      .map(([name, pats]) => ({ name, value: pats.size }))
      .sort((a, b) => b.value - a.value);
  }, [rows, doctors]);

  const fmtMin = v => {
    if (v < 1) return '< 1 мин';
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  };

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12, color: 'var(--rb-text-secondary)' }}>
        <span className="rb-spinner" style={{ width: 22, height: 22 }} />
        <span style={{ fontSize: 14 }}>Загрузка визитов из БД…</span>
      </div>
    );
  }

  // ── Sync in progress (initial load) ─────────────────────────────────────────
  if (syncing || syncStatus?.syncing) {
    const { done = 0, total = 0, phase = '' } = syncStatus || {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12, color: 'var(--rb-text-secondary)' }}>
        <span className="rb-spinner" style={{ width: 22, height: 22 }} />
        <span style={{ fontSize: 14 }}>Первичная загрузка данных из МИС…</span>
        {total > 0 && <span style={{ fontSize: 12 }}>{done} / {total} дней</span>}
        {phase && <span style={{ fontSize: 12, color: '#94a3b8' }}>{phase}</span>}
      </div>
    );
  }

  // ── Empty DB — offer initial sync ────────────────────────────────────────────
  if (!appointments.length && syncStatus && syncStatus.totalInDb === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: 'var(--rb-text-secondary)', gap: 14 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" style={{ opacity: 0.35 }}>
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <div style={{ fontSize: 14 }}>База данных визитов пуста</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Загрузим данные с 01.02.2026 по текущий день. Это займёт несколько минут.</div>
        <button
          onClick={handleFirstSync}
          style={{ padding: '8px 22px', background: 'var(--rb-primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Первичная загрузка
        </button>
      </div>
    );
  }

  // ── No data for period (but DB has records) ──────────────────────────────────
  if (!appointments.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: 'var(--rb-text-secondary)', gap: 10 }}>
        <div style={{ fontSize: 14 }}>Нет визитов за выбранный период</div>
        {syncStatus?.lastSyncAt && (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Последняя синхронизация: {new Date(syncStatus.lastSyncAt).toLocaleString('ru-RU')}
          </div>
        )}
      </div>
    );
  }

  // ── Main content ─────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Статус-строка */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        {syncStatus?.lastSyncAt && (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            Обновлено: {new Date(syncStatus.lastSyncAt).toLocaleString('ru-RU')}
          </span>
        )}
        <button
          onClick={loadFromDB}
          style={{ marginLeft: 'auto', padding: '3px 12px', fontSize: 12, border: '1px solid var(--rb-border-dark)', borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--rb-text)', fontFamily: 'inherit' }}
        >
          Обновить
        </button>
      </div>

      {/* Загрузка кабинетов */}
      <SectionHeader title="Загрузка по кабинетам">
        <select
          value={roomClinic}
          onChange={e => setRoomClinic(e.target.value)}
          style={{ padding: '3px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff', color: roomClinic ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}
        >
          <option value="">Все клиники</option>
          {clinicOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </SectionHeader>

      {roomStats.length > 0 ? (
        <HBarChart
          data={roomStats}
          dataKey="utilPct"
          labelKey="name"
          colorKey="color"
          color="#4f8ef7"
          labelWidth={200}
          subLabelKey={roomClinic ? undefined : '_clinicName'}
          formatter={v => `${v.toFixed(1)}%`}
        />
      ) : (
        <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
          Нет данных по кабинетам — визиты не содержат поле «кабинет»
        </div>
      )}

      {/* Средний зазор между визитами в кабинете */}
      <SectionTitle>Средний интервал между визитами в кабинете</SectionTitle>
      {gapStats && gapStats.rooms.length > 0 ? (
        <HBarChart
          data={gapStats.rooms}
          dataKey="value"
          labelKey="name"
          colorKey="color"
          color="#f97316"
          labelWidth={200}
          subLabelKey={roomClinic ? undefined : '_clinicName'}
          formatter={fmtMin}
          defaultSort="val-asc"
        />
      ) : (
        <div style={{ padding: '16px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
          Недостаточно данных — нужны кабинеты с 2+ визитами в один день
        </div>
      )}

      {/* Пациенты сотрудников кабинетов */}
      <SectionHeader title="Сотрудники кабинетов — пациентов за период">
        <ModeToggle mode={staffMode} onChange={setStaffMode} />
      </SectionHeader>
      {staffMode === 'bar'
        ? <HBarChart data={staffBarData} dataKey="value" labelKey="name" color="#10b981" />
        : <StaffHeatmap rows={rows} doctors={doctors} periodStart={periodStart} periodEnd={periodEnd} />
      }
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF config modal
// ─────────────────────────────────────────────────────────────────────────────
const PDF_SECTIONS = [
  { key: 'general',    label: 'Общая статистика',       sub: 'выручка по орг., клиникам, специальностям' },
  { key: 'patients',   label: 'Пациенты',               sub: 'ЛК, скидки, средний чек, источники' },
  { key: 'top20',      label: 'Топ 20% пациентов',      sub: 'список с выручкой' },
  { key: 'margin',     label: 'Маржинальность',         sub: 'популярные услуги, маржа' },
  { key: 'efficiency', label: 'Эффективность',          sub: 'направления, повторные визиты, цепочки' },
  { key: 'rooms',      label: 'Кабинеты',               sub: 'загрузка и интервалы (требует вкладки Кабинеты)', requiresAppt: true },
];

function PdfConfigModal({ rows, appointments, onClose, onExport }) {
  const [sections,     setSections]     = useState(() => Object.fromEntries(PDF_SECTIONS.map(s => [s.key, true])));
  const [clinicFilter, setClinicFilter] = useState('');
  const [specFilter,   setSpecFilter]   = useState('');

  const clinicOptions  = useMemo(() => getUniqueClinics(rows), [rows]);
  const specOptions    = useMemo(() => getUniqueSpecs(rows),   [rows]);
  const hasAppt        = appointments.length > 0;

  const availSections = PDF_SECTIONS.filter(s => !s.requiresAppt || hasAppt);
  const allOn         = availSections.every(s => sections[s.key]);
  const toggleAll     = () => setSections(prev => {
    const next = { ...prev };
    availSections.forEach(s => { next[s.key] = !allOn; });
    return next;
  });

  return (
    <div className="rb-modal-overlay" onClick={onClose}>
      <div className="rb-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="rb-modal-header">
          <h3>Настройка PDF-отчёта</h3>
          <button className="rb-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rb-modal-body">

          {/* Разделы */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text)' }}>Разделы</div>
              <button
                onClick={toggleAll}
                style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 5, cursor: 'pointer', background: '#fff', color: 'var(--rb-text-secondary)', fontFamily: 'inherit' }}
              >{allOn ? 'Снять все' : 'Выбрать все'}</button>
            </div>
            {PDF_SECTIONS.map(s => {
              const disabled = s.requiresAppt && !hasAppt;
              return (
                <label
                  key={s.key}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: disabled ? 'default' : 'pointer', borderBottom: '1px solid var(--rb-border)', opacity: disabled ? 0.45 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={!disabled && sections[s.key]}
                    disabled={disabled}
                    onChange={() => !disabled && setSections(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                    style={{ marginTop: 2, cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--rb-text)' }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 1 }}>
                      {disabled ? 'Откройте вкладку "Кабинеты" для загрузки данных' : s.sub}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Фильтры */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text)', marginBottom: 8 }}>
              Фильтры <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--rb-text-secondary)' }}>— применяются ко всем разделам</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>Клиника</label>
                <select
                  value={clinicFilter}
                  onChange={e => setClinicFilter(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', background: '#fff', color: clinicFilter ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}
                >
                  <option value="">Все клиники</option>
                  {clinicOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>Специальность</label>
                <select
                  value={specFilter}
                  onChange={e => setSpecFilter(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', background: '#fff', color: specFilter ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}
                >
                  <option value="">Все специальности</option>
                  {specOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Кнопки */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={{ padding: '7px 16px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--rb-text)', fontFamily: 'inherit' }}
            >Отмена</button>
            <button
              onClick={() => onExport({ sections, clinicFilter, specFilter })}
              disabled={!PDF_SECTIONS.some(s => sections[s.key])}
              style={{ padding: '7px 20px', border: 'none', borderRadius: 8, background: 'var(--rb-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: 'inherit', opacity: PDF_SECTIONS.some(s => sections[s.key]) ? 1 : 0.5 }}
            >Сформировать PDF</button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function StepKpi({ excelSources = [], doctors = [] }) {
  const [periodMode,   setPeriodMode]   = useState('month');
  const [selYear,      setSelYear]      = useState(() => new Date().getFullYear());
  const [selMonth,     setSelMonth]     = useState(() => new Date().getMonth() + 1);
  const [selQuarter,   setSelQuarter]   = useState(() => Math.floor(new Date().getMonth() / 3) + 1);
  const [selFromMonth, setSelFromMonth] = useState(1);
  const [selToMonth,   setSelToMonth]   = useState(() => new Date().getMonth() + 1);
  const [rows,         setRows]         = useState([]);
  const [prevRows, setPrevRows] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [loaded,        setLoaded]        = useState(false);
  const [viewMode,      setViewMode]      = useState('general');
  const [appointments,  setAppointments]  = useState([]);
  const [pdfConfigOpen, setPdfConfigOpen] = useState(false);
  const [pdfExporting,  setPdfExporting]  = useState(false);


  const { wrapRef: tabRef, sliderEl } = useTabSlider(viewMode);

  // Доступные годы из источников
  const availYears = useMemo(() => {
    const years = new Set(
      excelSources.map(s => s.dateFrom ? new Date(s.dateFrom).getFullYear() : null).filter(Boolean)
    );
    const list = [...years].sort((a, b) => b - a);
    if (!list.length) list.push(new Date().getFullYear());
    return list;
  }, [excelSources]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    try {
      const { start, end } = getPeriodRange(periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth);
      const matching = matchSourcesRange(excelSources, start, end);
      if (!matching.length) {
        setRows([]);
        setPrevRows([]);
        setLoaded(true);
        return;
      }

      let prevLoaded = [];
      if (periodMode === 'month') {
        const { year: pYear, month: pMonth } = getPrevMonth(selYear, selMonth);
        const { start: ps, end: pe } = getPeriodRange('month', pYear, pMonth, 1, 1, 1);
        const prevMatching = matchSourcesRange(excelSources, ps, pe);
        if (prevMatching.length) prevLoaded = await loadSourceRows(prevMatching);
      }

      const currentRows = await loadSourceRows(matching);
      setRows(currentRows);
      setPrevRows(prevLoaded);
      setLoaded(true);
    } catch (e) {
      console.error('[KPI] load error:', e);
      toast.error('Ошибка загрузки данных KPI');
    } finally {
      setLoading(false);
    }
  }, [periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth, excelSources]);

  // Авто-загрузка при монтировании и при смене периода
  useEffect(() => { loadData(); }, [loadData]);

  const uniquePatientsCount = useMemo(() => new Set(rows.map(getPatientKey).filter(Boolean)).size, [rows]);

  const { start: periodStart, end: periodEnd } = useMemo(
    () => getPeriodRange(periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth),
    [periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth]
  );

  const handleExportPdf = useCallback(async (config) => {
    setPdfConfigOpen(false);
    setPdfExporting(true);
    try {
      const label = getPeriodLabel(periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth);
      buildKpiPdf(rows, label, { ...config, appointments, periodStart, periodEnd, doctors });
    } catch (e) {
      console.error('[KPI PDF]', e);
      toast.error('Ошибка экспорта PDF');
    } finally {
      setPdfExporting(false);
    }
  }, [rows, appointments, periodStart, periodEnd, periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth, doctors]);

  return (
    <div style={{ padding: '16px 20px', height: '100%', overflowY: 'auto' }}>

      {pdfConfigOpen && (
        <PdfConfigModal
          rows={rows}
          appointments={appointments}
          onClose={() => setPdfConfigOpen(false)}
          onExport={handleExportPdf}
        />
      )}

      {/* Панель выбора периода */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Режим периода */}
        <div style={{ display: 'flex', gap: 3 }}>
          {PERIOD_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setPeriodMode(m.key)}
              style={{
                padding: '6px 12px', fontSize: 12, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid var(--rb-border-dark)',
                background: periodMode === m.key ? 'var(--rb-primary)' : '#fff',
                color: periodMode === m.key ? '#fff' : 'var(--rb-text)',
                fontWeight: periodMode === m.key ? 600 : 400,
              }}
            >{m.label}</button>
          ))}
        </div>

        {/* Год */}
        <select
          value={selYear}
          onChange={e => setSelYear(Number(e.target.value))}
          style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--rb-text)' }}
        >
          {availYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Месяц */}
        {periodMode === 'month' && (
          <select
            value={selMonth}
            onChange={e => setSelMonth(Number(e.target.value))}
            style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--rb-text)' }}
          >
            {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        )}

        {/* Квартал */}
        {periodMode === 'quarter' && (
          <select
            value={selQuarter}
            onChange={e => setSelQuarter(Number(e.target.value))}
            style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--rb-text)' }}
          >
            {QUARTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        )}

        {/* Диапазон */}
        {periodMode === 'range' && (
          <>
            <select
              value={selFromMonth}
              onChange={e => setSelFromMonth(Number(e.target.value))}
              style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--rb-text)' }}
            >
              {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <span style={{ fontSize: 13, color: 'var(--rb-text)' }}>—</span>
            <select
              value={selToMonth}
              onChange={e => setSelToMonth(Number(e.target.value))}
              style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--rb-text)' }}
            >
              {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </>
        )}

        {loading && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--rb-text-secondary)' }}>
            <span className="rb-spinner" style={{ width: 13, height: 13 }} />
            Загрузка…
          </span>
        )}

        {!loading && loaded && (
          <>
            <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
              {rows.length.toLocaleString('ru-RU')} строк · {fmt(uniquePatientsCount)} пациентов
              {prevRows.length > 0 && <span style={{ marginLeft: 8, color: '#94a3b8' }}>+ пред. период</span>}
            </span>
            <button
              onClick={loadData}
              title="Обновить данные"
              style={{ padding: '3px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--rb-text-secondary)', fontFamily: 'inherit', lineHeight: 1 }}
            >↻</button>
            <button
              onClick={() => setPdfConfigOpen(true)}
              disabled={pdfExporting}
              title="Экспорт в PDF"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 6,
                background: pdfExporting ? '#f1f5f9' : '#fff',
                cursor: pdfExporting ? 'default' : 'pointer',
                fontSize: 12, color: pdfExporting ? '#94a3b8' : 'var(--rb-text)',
                fontFamily: 'inherit', lineHeight: 1,
              }}
            >
              {pdfExporting
                ? <><span className="rb-spinner" style={{ width: 11, height: 11 }} /> PDF…</>
                : '↓ PDF'
              }
            </button>
          </>
        )}
      </div>

      {/* Под-вкладки — всегда видны */}
      <div className="rb-clinic-tab-wrap" ref={tabRef} style={{ marginBottom: 20 }}>
        {sliderEl}
        {KPI_TABS.map(t => (
          <button
            key={t.key}
            className={`rb-clinic-tab${viewMode === t.key ? ' active' : ''}`}
            onClick={() => setViewMode(t.key)}
          >{t.label}</button>
        ))}
      </div>

      {/* Кабинеты — всегда смонтирован, не требует Excel-источников */}
      <div style={{ display: viewMode === 'rooms' ? 'block' : 'none' }}>
        <TabRooms periodStart={periodStart} periodEnd={periodEnd} onAppointmentsLoaded={setAppointments} rows={rows} doctors={doctors} />
      </div>

      {/* Репутация — всегда смонтирована, не требует Excel-источников */}
      <div style={{ display: viewMode === 'reputation' ? 'block' : 'none' }}>
        <TabReputation
          dateFrom={periodStart.toISOString().split('T')[0]}
          dateTo={periodEnd.toISOString().split('T')[0]}
        />
      </div>

      {/* Остальные вкладки */}
      {viewMode !== 'rooms' && viewMode !== 'reputation' && (
        <>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: 'var(--rb-text-secondary)', gap: 12 }}>
              <span className="rb-spinner" style={{ width: 22, height: 22 }} />
              <span style={{ fontSize: 14 }}>Загрузка данных…</span>
            </div>
          )}

          {!loading && loaded && rows.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>
              {excelSources.length === 0
                ? <span style={{ color: '#ef4444', fontSize: 13 }}>Нет загруженных источников — добавьте файлы в разделе Архив → Источники</span>
                : `Нет данных за ${getPeriodLabel(periodMode, selYear, selMonth, selQuarter, selFromMonth, selToMonth)}`
              }
            </div>
          )}

          {loaded && rows.length > 0 && (
            <>
              {viewMode === 'general'    && <TabGeneral rows={rows} />}
              {viewMode === 'patients'   && <TabPatients rows={rows} />}
              {viewMode === 'margin'     && <TabMargin rows={rows} />}
              {viewMode === 'efficiency' && <TabEfficiency rows={rows} periodStart={periodStart} periodEnd={periodEnd} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
