import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { mis, directories, reviews, salaryRecords } from '../../../services/api';
import { useTabSlider } from '../../ReferralBonuses/utils/useTabSlider';
import { fetchAppointmentsFromDB } from '../../ReferralBonuses/utils/appointmentsApi';
import { fetchSourceFile } from '../../ReferralBonuses/utils/excelSources';
import { parseExcelFile, rbMapNewColumns } from '../../ReferralBonuses/utils/excelUtils';
import { rbParseFullName, rbParseAbbrevName } from '../../ReferralBonuses/utils/nameMatching';
import { DEFAULT_CLINICS } from '../../ReferralBonuses/utils/clinicUtils';
import { MapPin, Phone, UserRound, Star, MessageSquare, CheckCircle, Clock, TrendingUp, Globe, Mail, FileText, Calendar, Building2, Landmark } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';

// ── Constants ─────────────────────────────────────────────────────────────────
const DIR_TABS = [
  { key: 'clinics',     label: 'Филиалы' },
  { key: 'cabinets',    label: 'Кабинеты' },
  { key: 'doctors',     label: 'Врачи' },
  { key: 'equipment',   label: 'Оборудование' },
  { key: 'utilities',   label: 'Коммунальные' },
  { key: 'consumables', label: 'Расходники' },
  { key: 'marketing',   label: 'Маркетинг' },
];

const CONSUMABLE_UNITS = ['шт', 'пара', 'мл', 'л', 'г', 'кг', 'упак', 'ампула', 'флакон', 'таблетка'];

const BOARD_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6'];

const WEEK_DAYS = [
  { key: '1', label: 'Пн' },
  { key: '2', label: 'Вт' },
  { key: '3', label: 'Ср' },
  { key: '4', label: 'Чт' },
  { key: '5', label: 'Пт' },
  { key: '6', label: 'Сб' },
  { key: '7', label: 'Вс' },
];

const DASH = '—';

const MONTHS_RU = [
  { num: 1,  label: 'Январь'   }, { num: 2,  label: 'Февраль'  },
  { num: 3,  label: 'Март'     }, { num: 4,  label: 'Апрель'   },
  { num: 5,  label: 'Май'      }, { num: 6,  label: 'Июнь'     },
  { num: 7,  label: 'Июль'     }, { num: 8,  label: 'Август'   },
  { num: 9,  label: 'Сентябрь' }, { num: 10, label: 'Октябрь'  },
  { num: 11, label: 'Ноябрь'   }, { num: 12, label: 'Декабрь'  },
];

const UTILITY_CATEGORIES = [
  { key: 'electricity', label: 'Электроэнергия',      types: [{ key: 'electricity', label: 'Электроэнергия' }] },
  { key: 'thermal',     label: 'Тепловая энергия',    types: [{ key: 'thermal',     label: 'Тепловая энергия' }] },
  { key: 'gas',         label: 'Газ',                 types: [{ key: 'gas',         label: 'Газ' }] },
  { key: 'water', label: 'Водоснабжение', types: [], subcats: [
    { key: 'water_old', label: 'Старый корпус', types: [
      { key: 'water_old_water', label: 'Вода' },
      { key: 'water_old_neg',   label: 'Негативное воздействие' },
    ]},
    { key: 'water_new', label: 'Новый корпус', types: [
      { key: 'water_new_water', label: 'Вода' },
      { key: 'water_new_neg',   label: 'Негативное воздействие' },
    ]},
  ]},
  { key: 'telecom',     label: 'Услуги связи',        types: [
    { key: 'telecom_rt',  label: 'Ростелеком' },
    { key: 'telecom_sc',  label: 'Скарлет'    },
    { key: 'telecom_mtt', label: 'МТТ'        },
    { key: 'telecom_kf',  label: 'Комфортел'  },
    { key: 'telecom_mts', label: 'МТС ПАО'    },
  ]},
  { key: 'waste',       label: 'Вывоз отходов',       types: [
    { key: 'waste_med', label: 'Медицинские отходы'  },
    { key: 'waste_mun', label: 'Коммунальные отходы' },
  ]},
  { key: 'communal',    label: 'Коммунальные услуги', types: [
    { key: 'communal_karp', label: 'Карпенко'       },
    { key: 'communal_slav', label: 'Славянский дом' },
  ]},
  { key: 'security',    label: 'Охрана',              types: [{ key: 'security', label: 'Охрана' }] },
  { key: 'cleaning',    label: 'Уборка территории',   types: [{ key: 'cleaning', label: 'Уборка территории' }] },
];

// Returns all leaf types from a category (handles 2-level and 3-level hierarchies)
function getAllTypesFlat(cat) {
  if (cat.subcats?.length) return cat.subcats.flatMap(sc => sc.types || []);
  return cat.types || [];
}

const ALL_UTILITY_TYPES = UTILITY_CATEGORIES.flatMap(c =>
  getAllTypesFlat(c).map(t => ({ ...t, catKey: c.key, catLabel: c.label }))
);

const DEFAULT_SCHEDULE = {
  '1': { on: true,  from: '08:00', to: '20:00' },
  '2': { on: true,  from: '08:00', to: '20:00' },
  '3': { on: true,  from: '08:00', to: '20:00' },
  '4': { on: true,  from: '08:00', to: '20:00' },
  '5': { on: true,  from: '08:00', to: '20:00' },
  '6': { on: false, from: '', to: '' },
  '7': { on: false, from: '', to: '' },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────
function parseApptTime(str) {
  if (!str) return null;
  const iso = Date.parse(str.replace(' ', 'T'));
  if (!isNaN(iso)) return new Date(iso);
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}

function unionIntervalMinutes(ranges) {
  if (!ranges.length) return 0;
  const sorted = [...ranges].sort((a, b) => a.t0 - b.t0);
  let total = 0, curStart = sorted[0].t0, curEnd = sorted[0].t1;
  for (let i = 1; i < sorted.length; i++) {
    const { t0, t1 } = sorted[i];
    if (t0 <= curEnd) { if (t1 > curEnd) curEnd = t1; }
    else { total += (curEnd - curStart) / 60000; curStart = t0; curEnd = t1; }
  }
  return total + (curEnd - curStart) / 60000;
}

const MONTH_NAMES_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function nameToKey(name) {
  if (!name) return '';
  const parts = String(name).replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
  if (!parts[0]) return '';
  const parsed = parts[1]?.length === 1 ? rbParseAbbrevName(name) : rbParseFullName(name);
  return parsed.last + (parsed.fi || '') + (parsed.mi || '');
}

const parseNum = v => parseFloat(String(v || '').replace(/[\s ]/g, '').replace(',', '.')) || 0;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function formatApiDate(str) {
  if (!str) return '';
  // Already DD.MM.YYYY
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return str;
  // YYYY-MM-DD or ISO
  const d = new Date(str);
  if (!isNaN(d)) return d.toLocaleDateString('ru-RU');
  return str;
}

const fmt     = n => Math.round(n || 0).toLocaleString('ru-RU');
const fmtRub  = n => fmt(n) + ' ₽';
// Precise money formatter — preserves up to 2 decimal places (no unnecessary zeros)
const fmtRubP = n => (+(n || 0)).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽';

function scheduleToLabel(schedule) {
  if (!schedule) return DASH;
  const enabled = WEEK_DAYS.filter(d => schedule[d.key]?.on);
  if (!enabled.length) return 'Не работает';
  const groups = [];
  let cur = null;
  for (let i = 0; i < enabled.length; i++) {
    const d = enabled[i];
    const h = `${schedule[d.key].from}–${schedule[d.key].to}`;
    const idx = WEEK_DAYS.findIndex(x => x.key === d.key);
    if (cur && cur.h === h && cur.lastIdx === idx - 1) { cur.end = d.label; cur.lastIdx = idx; }
    else { cur = { start: d.label, end: d.label, h, lastIdx: idx }; groups.push(cur); }
  }
  return groups.map(g => `${g.start === g.end ? g.start : `${g.start}–${g.end}`} ${g.h}`).join(', ');
}

function scheduleWeeklyHours(schedule) {
  if (!schedule) return 0;
  return WEEK_DAYS.reduce((sum, d) => {
    const s = schedule[d.key];
    if (!s?.on || !s.from || !s.to) return sum;
    const [fh, fm] = s.from.split(':').map(Number);
    const [th, tm] = s.to.split(':').map(Number);
    return sum + (th * 60 + tm - (fh * 60 + fm)) / 60;
  }, 0);
}

function getClinicColor(clinicId) {
  return DEFAULT_CLINICS.find(x => String(x.id) === String(clinicId))?.color || '#94a3b8';
}

// Match a review board by name to a DEFAULT_CLINICS entry for consistent brand colors
function getBoardColor(boardName) {
  if (!boardName) return '#94a3b8';
  const lower = boardName.toLowerCase();
  const match = DEFAULT_CLINICS.find(c =>
    lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lower)
  );
  return match?.color || '#94a3b8';
}
function getClinicName(clinicId) {
  return DEFAULT_CLINICS.find(x => String(x.id) === String(clinicId))?.name || `Клиника ${clinicId}`;
}

function getReviewDoctorName(review) {
  const candidates = [
    review?.doctorName,
    review?.doctor_name,
    review?.doctor?.name,
    review?.doctor?.fullName,
    review?.doctor?.full_name,
    review?.attendingDoctor,
    review?.attending_doctor,
    review?.attendingDoctorName,
    review?.attending_doctor_name,
  ];
  const value = candidates.find(v => String(v || '').trim());
  return value ? String(value).trim() : '';
}

// Find the most recent period that has sources and return matching sources + label.
// Falls back to the latest available period if current month has no data.
function findLatestPeriodSources(sources) {
  if (!sources.length) return { matched: [], label: '' };
  let latestTo = null;
  for (const s of sources) {
    const to = s.dateTo ? new Date(s.dateTo) : null;
    if (to && (!latestTo || to > latestTo)) latestTo = to;
  }
  if (!latestTo) return { matched: sources, label: '' };
  const year  = latestTo.getFullYear();
  const month = latestTo.getMonth(); // 0-indexed
  const start = new Date(year, month, 1);
  const end   = new Date(year, month + 1, 0, 23, 59, 59);
  const matched = sources.filter(s => {
    const from = s.dateFrom ? new Date(s.dateFrom) : null;
    const to   = s.dateTo   ? new Date(s.dateTo)   : null;
    return from && to && from <= end && to >= start;
  });
  return { matched: matched.length ? matched : sources, label: `${MONTH_NAMES_RU[month]} ${year}` };
}

async function loadDoctorStats(sources) {
  const byKey = {};
  for (const src of sources) {
    try {
      const file    = await fetchSourceFile(src);
      const rawRows = await parseExcelFile(file);
      if (!rawRows.length) continue;
      const cm = rbMapNewColumns(rawRows);
      for (const r of rawRows) {
        const exec = cm.executor ? String(r[cm.executor] || '').trim() : '';
        if (!exec) continue;
        const key     = nameToKey(exec);
        if (!key) continue;
        const revenue    = parseNum(cm.totalCost ? r[cm.totalCost] : (cm.servicePrice ? r[cm.servicePrice] : 0));
        const patient    = (cm.patientCard ? String(r[cm.patientCard] || '').trim() : '')
                        || (cm.patientName ? String(r[cm.patientName] || '').trim() : '');
        const invoiceNum = cm.invoiceNum ? String(r[cm.invoiceNum] || '').trim() : '';
        if (!byKey[key]) byKey[key] = { executor: exec, appts: 0, revenue: 0, patients: {}, invoices: new Set() };
        byKey[key].appts++;
        byKey[key].revenue += revenue;
        if (patient) byKey[key].patients[patient] = (byKey[key].patients[patient] || 0) + 1;
        if (invoiceNum) byKey[key].invoices.add(invoiceNum);
      }
    } catch (e) {
      console.error('[Directories] source load error', src?.id, e);
    }
  }
  const result = {};
  for (const [key, d] of Object.entries(byKey)) {
    const invoiceCount = d.invoices.size > 0 ? d.invoices.size : d.appts;
    result[key] = {
      appts:          d.appts,
      revenue:        d.revenue,
      avgCheck:       invoiceCount > 0 ? d.revenue / invoiceCount : 0,
      repeatPatients: Object.values(d.patients).filter(v => v > 1).length,
    };
  }
  return result;
}

function normServiceName(str) {
  return String(str || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function loadConsumableStats(sources, norms) {
  const normByName = {};
  for (const n of norms) {
    const k = normServiceName(n.serviceName || '');
    if (!k) continue;
    if (!normByName[k]) normByName[k] = [];
    normByName[k].push(n);
  }

  const byDoctor = {};
  for (const src of sources) {
    try {
      const file    = await fetchSourceFile(src);
      const rawRows = await parseExcelFile(file);
      if (!rawRows.length) continue;
      const cm = rbMapNewColumns(rawRows);
      for (const r of rawRows) {
        const exec    = cm.executor    ? String(r[cm.executor]    || '').trim() : '';
        const svcName = cm.serviceName ? String(r[cm.serviceName] || '').trim() : '';
        if (!exec || !svcName) continue;
        const docKey = nameToKey(exec);
        if (!docKey) continue;
        const qty = cm.qty ? (parseNum(r[cm.qty]) || 1) : 1;
        if (!byDoctor[docKey]) byDoctor[docKey] = { executor: exec, services: {} };
        const svcKey = normServiceName(svcName);
        const prev   = byDoctor[docKey].services[svcKey];
        byDoctor[docKey].services[svcKey] = { name: svcName, qty: (prev?.qty || 0) + qty };
      }
    } catch (e) {
      console.error('[Consumables] source load error', src?.id, e);
    }
  }

  const result = [];
  for (const [docKey, d] of Object.entries(byDoctor)) {
    const consumableMap = {};
    const serviceDetails = [];
    let totalServices = 0;

    for (const [svcKey, svcData] of Object.entries(d.services)) {
      totalServices += svcData.qty;
      const matchedNorms = normByName[svcKey] || [];
      const svcConsumables = matchedNorms.map(n => ({
        consumableName: n.consumableName,
        unit:           n.unit,
        normQty:        n.normQty,
        unitCost:       n.unitCost || 0,
        expected:       svcData.qty * n.normQty,
        expectedCost:   svcData.qty * n.normQty * (n.unitCost || 0),
      }));
      for (const sc of svcConsumables) {
        if (!consumableMap[sc.consumableName]) consumableMap[sc.consumableName] = { expected: 0, expectedCost: 0, unit: sc.unit };
        consumableMap[sc.consumableName].expected     += sc.expected;
        consumableMap[sc.consumableName].expectedCost += sc.expectedCost;
      }
      if (matchedNorms.length > 0) {
        serviceDetails.push({ serviceName: svcData.name, qty: svcData.qty, consumables: svcConsumables });
      }
    }

    result.push({
      docKey, executor: d.executor, totalServices, consumables: consumableMap,
      services: serviceDetails.sort((a, b) => b.qty - a.qty),
    });
  }
  return result.sort((a, b) => b.totalServices - a.totalServices);
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const fieldInputStyle = {
  padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7,
  fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff',
  color: 'var(--rb-text)', width: '100%', boxSizing: 'border-box',
};
const inlineInputStyle = {
  width: '100%', padding: '4px 8px', fontSize: 12,
  border: '1px solid var(--rb-border-dark)', borderRadius: 6,
  fontFamily: 'inherit', outline: 'none', background: '#fafafa', boxSizing: 'border-box',
};
const timeInputStyle = {
  padding: '4px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6,
  fontSize: 12, fontFamily: 'inherit', outline: 'none', background: '#fff', width: 90,
};

// ── Micro-components ──────────────────────────────────────────────────────────
function Spinner({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: 'var(--rb-text-secondary)', gap: 10 }}>
      <span className="rb-spinner" style={{ width: 18, height: 18 }} />
      <span style={{ fontSize: 14 }}>{text}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </div>
  );
}

function InfoRow({ icon: Icon, text }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 13 }}>
      <Icon size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--rb-text-secondary)' }} />
      <span style={{ color: 'var(--rb-text-secondary)' }}>{text}</span>
    </div>
  );
}

function THCell({ children, right }) {
  return (
    <th style={{ background: '#f8fafc', padding: '10px 12px', textAlign: right ? 'right' : 'left', fontWeight: 600, fontSize: 12, border: '1px solid var(--rb-border)', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

function StatCell({ value, formatter }) {
  if (value == null) return <td style={{ textAlign: 'right', color: 'var(--rb-text-secondary)' }}>{DASH}</td>;
  return <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatter ? formatter(value) : value}</td>;
}

function declCab(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'кабинет';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'кабинета';
  return 'кабинетов';
}

// ══════════════════════════════════════════════════════════════════════════════
// WEEKLY SCHEDULE EDITOR
// ══════════════════════════════════════════════════════════════════════════════
function WeeklyScheduleEditor({ value, onChange }) {
  const sched = useMemo(() => ({ ...DEFAULT_SCHEDULE, ...value }), [value]);
  const update = (dayKey, field, val) => onChange({ ...sched, [dayKey]: { ...sched[dayKey], [field]: val } });
  const weeklyHours = scheduleWeeklyHours(sched);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>День</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Раб.</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Начало</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Конец</span>
        {WEEK_DAYS.map(d => {
          const s = sched[d.key] || { on: false, from: '', to: '' };
          return (
            <React.Fragment key={d.key}>
              <span style={{ fontSize: 13, fontWeight: s.on ? 600 : 400, color: s.on ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}>{d.label}</span>
              <input type="checkbox" checked={!!s.on} onChange={e => update(d.key, 'on', e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--rb-primary)' }} />
              <input type="time" value={s.from || ''} disabled={!s.on} onChange={e => update(d.key, 'from', e.target.value)}
                style={{ ...timeInputStyle, opacity: s.on ? 1 : 0.35 }} />
              <input type="time" value={s.to || ''} disabled={!s.on} onChange={e => update(d.key, 'to', e.target.value)}
                style={{ ...timeInputStyle, opacity: s.on ? 1 : 0.35 }} />
            </React.Fragment>
          );
        })}
      </div>
      {weeklyHours > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--rb-text-secondary)' }}>
          В неделю: <strong style={{ color: 'var(--rb-text)' }}>{weeklyHours.toFixed(1)} ч</strong>
          &nbsp;·&nbsp;в месяц: <strong style={{ color: 'var(--rb-text)' }}>{(weeklyHours * 4.33).toFixed(0)} ч</strong>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ФИЛИАЛЫ
// ══════════════════════════════════════════════════════════════════════════════
function TabClinics({ roomCountByClinic }) {
  const [clinics, setClinics] = useState([]);
  const [manualData, setManualData] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedSchedule, setExpandedSchedule] = useState({});
  const saveTimers = useRef({});

  useEffect(() => {
    Promise.all([
      mis.getClinicsFromMIS().catch(() => ({ data: { data: [] } })),
      directories.getAll('clinic').catch(() => ({ data: {} })),
    ]).then(([misRes, dirRes]) => {
      setClinics(Array.isArray(misRes.data?.data) ? misRes.data.data : []);
      setManualData(dirRes.data || {});
    }).finally(() => setLoading(false));
  }, []);

  const saveField = useCallback((clinicId, patch) => {
    const key = String(clinicId);
    clearTimeout(saveTimers.current[key]);
    setManualData(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
    saveTimers.current[key] = setTimeout(async () => {
      try { await directories.save('clinic', key, patch); toast.success('Сохранено', { duration: 1500 }); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  if (loading) return <Spinner text="Загрузка филиалов…" />;
  if (!clinics.length) return <div className="rb-placeholder"><div style={{ fontWeight: 600 }}>Нет данных о клиниках</div></div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
      {clinics.map(c => {
        const cid = String(c.id);
        const m = manualData[cid] || {};
        const schedule = (typeof m.schedule === 'object' && m.schedule !== null && !Array.isArray(m.schedule))
          ? m.schedule : DEFAULT_SCHEDULE;
        const isSchedOpen = !!expandedSchedule[cid];
        const roomCount = roomCountByClinic[cid];
        return (
          <div key={c.id} style={{ background: 'var(--rb-card-bg)', border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', overflow: 'hidden' }}>
            <div style={{ background: c.color || '#94a3b8', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              {c.images?.[0] && <img src={c.images[0]} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{c.title || c.name}</div>
                {c.city && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>{c.city}</div>}
              </div>
              {roomCount != null && (
                <div style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 8, padding: '4px 12px', textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{roomCount}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>кабинетов</div>
                </div>
              )}
            </div>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--rb-border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {c.address     && <InfoRow icon={MapPin}    text={c.address} />}
              {c.legal_address && c.legal_address !== c.address && <InfoRow icon={MapPin} text={`Юр.: ${c.legal_address}`} />}
              {c.real_address  && c.real_address !== c.address && c.real_address !== c.legal_address && <InfoRow icon={MapPin} text={`Факт.: ${c.real_address}`} />}
              {(c.phone || c.mobile) && <InfoRow icon={Phone} text={[c.phone && `Тел.: ${c.phone}`, c.mobile && `Моб.: ${c.mobile}`].filter(Boolean).join(' · ')} />}
              {c.site  && <InfoRow icon={Globe} text={c.site} />}
              {c.email && <InfoRow icon={Mail}  text={c.email} />}
              {c.license_number && (
                <InfoRow icon={FileText} text={`Лицензия № ${c.license_number}${c.license_date ? ` от ${formatApiDate(c.license_date)}` : ''}`} />
              )}
              {c.director_name && <InfoRow icon={UserRound} text={`Директор: ${c.director_name}`} />}
              {c.doctor_name   && <InfoRow icon={UserRound} text={c.doctor_name} />}
              {(c.inn || c.kpp || c.bin) && (
                <InfoRow icon={Building2} text={[c.inn && `ИНН: ${c.inn}`, c.kpp && `КПП: ${c.kpp}`, c.bin && `ОГРН: ${c.bin}`].filter(Boolean).join(' · ')} />
              )}
              {(c.bank || c.bic || c.account || c.cor_account) && (
                <InfoRow icon={Landmark} text={[c.bank, c.bic && `БИК: ${c.bic}`, c.account && `Р/с: ${c.account}`, c.cor_account && `К/с: ${c.cor_account}`].filter(Boolean).join(' · ')} />
              )}
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Площадь (м²)">
                  <input type="text" value={m.area || ''} onChange={e => saveField(c.id, { area: e.target.value })} style={fieldInputStyle} />
                </Field>
                <Field label="Аренда / содержание">
                  <input type="text" value={m.rent || ''} onChange={e => saveField(c.id, { rent: e.target.value })} style={fieldInputStyle} />
                </Field>
              </div>
              <Field label="График работы">
                <div style={{ border: '1px solid var(--rb-border-dark)', borderRadius: 7, overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedSchedule(p => ({ ...p, [cid]: !p[cid] }))}
                    style={{ width: '100%', padding: '7px 10px', background: isSchedOpen ? '#f0f7ff' : '#f8fafc', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontFamily: 'inherit' }}
                  >
                    <span style={{ color: 'var(--rb-text-secondary)', textAlign: 'left' }}>{scheduleToLabel(schedule)}</span>
                    <span style={{ fontSize: 11, color: isSchedOpen ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', marginLeft: 8, flexShrink: 0 }}>{isSchedOpen ? '▲' : '▼'}</span>
                  </button>
                  {isSchedOpen && (
                    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--rb-border)' }}>
                      <WeeklyScheduleEditor value={schedule} onChange={s => saveField(c.id, { schedule: s })} />
                    </div>
                  )}
                </div>
              </Field>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT CELL (used in Кабинеты table)
// ══════════════════════════════════════════════════════════════════════════════
function EquipmentCellEdit({ items, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const confirm = async () => {
    const name = newName.trim();
    if (!name) return;
    try { await onAdd(name); }
    catch { toast.error('Ошибка'); return; }
    setNewName('');
    setAdding(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        {items.map(item => (
          <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '2px 5px 2px 7px', borderRadius: 4, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
            {item.name}
            <button onClick={() => onRemove(item.id)} title="Удалить"
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '0 1px', fontSize: 14, lineHeight: 1, color: '#93c5fd', display: 'flex', alignItems: 'center' }}>×</button>
          </span>
        ))}
        {!adding && (
          <button onClick={() => setAdding(true)}
            style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, border: '1px dashed #94a3b8', background: 'none', cursor: 'pointer', color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>
            + Добавить
          </button>
        )}
      </div>
      {adding && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
            placeholder="Название аппарата…"
            style={{ ...inlineInputStyle, flex: 1 }} />
          <button onClick={confirm}
            style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✓</button>
          <button onClick={() => { setAdding(false); setNewName(''); }}
            style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--rb-border)', background: '#fff', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// КАБИНЕТЫ (from MIS appointments + doctor specialties)
// ══════════════════════════════════════════════════════════════════════════════
function TabCabinets({ appointments, loadingAppts, doctors }) {
  const [manualData, setManualData] = useState({});
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [allEquipment, setAllEquipment] = useState({});
  const [loadingEquip, setLoadingEquip] = useState(true);
  const [clinicFilter, setClinicFilter] = useState('');
  const saveTimers = useRef({});

  useEffect(() => {
    directories.getAll('cabinet')
      .then(res => setManualData(res.data || {}))
      .catch(() => {})
      .finally(() => setLoadingMeta(false));
  }, []);

  useEffect(() => {
    directories.getAll('equipment')
      .then(res => setAllEquipment(res.data || {}))
      .catch(() => {})
      .finally(() => setLoadingEquip(false));
  }, []);

  // Build a map: doctorId (string) → doctor professions
  const doctorSpecMap = useMemo(() => {
    const m = {};
    for (const d of doctors) m[String(d.id)] = d.professions || [];
    return m;
  }, [doctors]);

  const rooms = useMemo(() => {
    const map = {};
    for (const a of appointments) {
      if (a.status_id === 5 || a.status === 'refused') continue;
      const room = (a.room || '').trim();
      const cid  = String(a.clinic_id || '');
      if (!room || !cid) continue;
      const key = `${cid}|${room}`;
      const t0 = parseApptTime(a.time_start);
      const t1 = parseApptTime(a.time_end);
      if (!map[key]) map[key] = { key, room, clinicId: cid, ranges: [], apptCount: 0, doctorIds: new Set() };
      map[key].apptCount++;
      if (t0 && t1 && t1 > t0) map[key].ranges.push({ t0, t1 });
      if (a.doctor_id) map[key].doctorIds.add(String(a.doctor_id));
    }

    return Object.values(map).map(r => {
      // Collect unique specialties from doctors who worked in this room
      const specialties = new Set();
      for (const did of r.doctorIds) {
        for (const spec of (doctorSpecMap[did] || [])) {
          if (spec) specialties.add(spec);
        }
      }
      return { ...r, doctorIds: r.doctorIds, specialties: [...specialties] };
    }).sort((a, b) =>
      a.clinicId !== b.clinicId ? a.clinicId.localeCompare(b.clinicId) : a.room.localeCompare(b.room, 'ru')
    );
  }, [appointments, doctorSpecMap]);

  const clinicOptions = useMemo(() => {
    const ids = [...new Set(rooms.map(r => r.clinicId))];
    return ids.map(id => ({ id, name: getClinicName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [rooms]);

  const filtered = clinicFilter ? rooms.filter(r => r.clinicId === clinicFilter) : rooms;

  const equipmentByKey = useMemo(() => {
    const map = {};
    for (const [id, data] of Object.entries(allEquipment)) {
      const k = data.cabinetKey;
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push({ id, ...data });
    }
    return map;
  }, [allEquipment]);

  const saveField = useCallback((key, patch) => {
    clearTimeout(saveTimers.current[key]);
    setManualData(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
    saveTimers.current[key] = setTimeout(async () => {
      try { await directories.save('cabinet', encodeURIComponent(key), patch); toast.success('Сохранено', { duration: 1500 }); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  const addEquipment = useCallback(async (cabinetKey, clinicId, room, name) => {
    const id   = uuidv4();
    const data = { name, cabinetKey, clinicId, room };
    await directories.save('equipment', id, data);
    setAllEquipment(prev => ({ ...prev, [id]: data }));
  }, []);

  const removeEquipment = useCallback(async (id) => {
    await directories.remove('equipment', id);
    setAllEquipment(prev => { const next = { ...prev }; delete next[id]; return next; });
  }, []);

  if (loadingAppts || loadingMeta || loadingEquip) return <Spinner text="Загрузка кабинетов…" />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={clinicFilter} onChange={e => setClinicFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          <option value="">Все филиалы</option>
          {clinicOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
          {filtered.length} {declCab(filtered.length)} · данные за последние 90 дней
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="rb-table" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              <THCell>Кабинет</THCell>
              <THCell>Тип / Специальности</THCell>
              <THCell>Филиал</THCell>
              <THCell>Площадь (м²)</THCell>
              <THCell>Оборудование</THCell>
              <THCell right>Записей</THCell>
              <THCell right>Часов занято</THCell>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const meta = manualData[r.key] || {};
              const usedHours = (unionIntervalMinutes(r.ranges) / 60).toFixed(1);
              return (
                <tr key={r.key}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 4, height: 20, borderRadius: 2, background: getClinicColor(r.clinicId), flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontWeight: 500 }}>{r.room}</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: 220 }}>
                    {r.specialties.length > 0 ? (
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {r.specialties.slice(0, 3).map(s => (
                          <span key={s} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#f1f5f9', color: 'var(--rb-text)', whiteSpace: 'nowrap' }}>{s}</span>
                        ))}
                        {r.specialties.length > 3 && (
                          <span title={r.specialties.slice(3).join(', ')} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#e2e8f0', color: 'var(--rb-text-secondary)', cursor: 'help' }}>+{r.specialties.length - 3}</span>
                        )}
                      </div>
                    ) : <span style={{ color: 'var(--rb-text-secondary)', fontSize: 12 }}>{DASH}</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{getClinicName(r.clinicId)}</td>
                  <td><input type="text" value={meta.area || ''} onChange={e => saveField(r.key, { area: e.target.value })} style={{ ...inlineInputStyle, width: 80 }} /></td>
                  <td>
                    <EquipmentCellEdit
                      items={equipmentByKey[r.key] || []}
                      onAdd={(name) => addEquipment(r.key, r.clinicId, r.room, name)}
                      onRemove={removeEquipment}
                    />
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.apptCount.toLocaleString('ru-RU')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{usedHours}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                  {appointments.length === 0 ? 'Нет данных о визитах — выполните синхронизацию во вкладке Кабинеты (КПИ)' : 'Нет кабинетов'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ВРАЧИ (stats loaded independently from Excel sources)
// ══════════════════════════════════════════════════════════════════════════════
function TabDoctors({ doctors, excelSources }) {
  const [manualData, setManualData] = useState({});
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [doctorStats, setDoctorStats] = useState({});
  const [statsPeriodLabel, setStatsPeriodLabel] = useState('');
  const [search, setSearch] = useState('');
  const [clinicFilter, setClinicFilter] = useState('');
  const saveTimers = useRef({});

  // Load manual data (hour rates)
  useEffect(() => {
    directories.getAll('doctor')
      .then(res => setManualData(res.data || {}))
      .catch(() => {})
      .finally(() => setLoadingMeta(false));
  }, []);

  // Load doctor stats from the most recent available Excel period — no KPI tab needed
  useEffect(() => {
    if (!excelSources.length) { setStatsLoading(false); return; }
    const { matched, label } = findLatestPeriodSources(excelSources);
    if (!matched.length) { setStatsLoading(false); return; }
    setStatsLoading(true);
    setStatsPeriodLabel(label);
    loadDoctorStats(matched)
      .then(stats => setDoctorStats(stats))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [excelSources]);

  // Врач role but NOT КабинетыИРабота
  const docDoctors = useMemo(
    () => doctors.filter(d => {
      const roles = d.roles || [];
      return roles.some(r => r.toLowerCase().includes('врач')) && !roles.includes('КабинетыИРабота');
    }),
    [doctors]
  );

  const allClinics = useMemo(() => {
    const ids = [...new Set(docDoctors.flatMap(d => d.clinics || []).map(String))];
    return ids.map(id => ({ id, name: getClinicName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [docDoctors]);

  const filtered = docDoctors.filter(d => {
    if (search) {
      const q = search.toLowerCase();
      if (!d.name?.toLowerCase().includes(q) && !d.professions?.join(' ').toLowerCase().includes(q)) return false;
    }
    if (clinicFilter && !(d.clinics || []).map(String).includes(clinicFilter)) return false;
    return true;
  });

  const saveHourRate = useCallback((doctorId, value) => {
    clearTimeout(saveTimers.current[doctorId]);
    setManualData(prev => ({ ...prev, [doctorId]: { ...(prev[doctorId] || {}), hourRate: value } }));
    saveTimers.current[doctorId] = setTimeout(async () => {
      try { await directories.save('doctor', doctorId, { hourRate: value }); toast.success('Сохранено', { duration: 1500 }); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по ФИО или специальности…"
          style={{ flex: '1 1 200px', minWidth: 200, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        <select value={clinicFilter} onChange={e => setClinicFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          <option value="">Все филиалы</option>
          {allClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>{filtered.length} из {docDoctors.length}</span>
        {statsLoading && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--rb-text-secondary)' }}>
            <span className="rb-spinner" style={{ width: 12, height: 12 }} /> Загрузка статистики…
          </span>
        )}
        {!statsLoading && statsPeriodLabel && (
          <span style={{ fontSize: 12, color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px' }}>
            Статистика: {statsPeriodLabel}
          </span>
        )}
        {!statsLoading && !excelSources.length && (
          <span style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px' }}>
            Нет загруженных источников данных
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="rb-table" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              <THCell>ФИО врача</THCell>
              <THCell>Специальности</THCell>
              <THCell>Филиалы</THCell>
              <THCell>Стоимость часа (₽)</THCell>
              <THCell right>Приёмов</THCell>
              <THCell right>Выручка</THCell>
              <THCell right>Средний чек</THCell>
              <THCell right>Повторных пац.</THCell>
            </tr>
          </thead>
          <tbody>
            {filtered.map(doc => {
              const meta = manualData[doc.id] || {};
              const dk   = nameToKey(doc.name);
              const st   = doctorStats[dk];
              return (
                <tr key={doc.id}>
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{doc.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--rb-text-secondary)', maxWidth: 240 }}>
                    {doc.professions?.length ? doc.professions.join(', ') : DASH}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(doc.clinics || []).map(cid => (
                        <span key={cid} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 12, background: getClinicColor(cid) + '28', color: getClinicColor(cid), fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {getClinicName(cid)}
                        </span>
                      ))}
                      {!(doc.clinics || []).length && <span style={{ color: 'var(--rb-text-secondary)', fontSize: 12 }}>{DASH}</span>}
                    </div>
                  </td>
                  <td>
                    {loadingMeta ? <span style={{ color: 'var(--rb-text-secondary)', fontSize: 12 }}>…</span> : (
                      <input type="number" value={meta.hourRate || ''} onChange={e => saveHourRate(doc.id, e.target.value)}
                        placeholder="0" style={{ ...inlineInputStyle, width: 90, textAlign: 'right' }} />
                    )}
                  </td>
                  <StatCell value={st?.appts ?? null} formatter={v => v.toLocaleString('ru-RU')} />
                  <StatCell value={st?.revenue ?? null} formatter={fmtRub} />
                  <StatCell value={st?.avgCheck ?? null} formatter={fmtRub} />
                  <StatCell value={st?.repeatPatients ?? null} formatter={v => v.toLocaleString('ru-RU')} />
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                  {doctors.length === 0 ? 'Данные о врачах загружаются…' : 'Нет совпадений'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ОБОРУДОВАНИЕ
// ══════════════════════════════════════════════════════════════════════════════
function EquipServiceBindings({ equipItem, onClose }) {
  const [bindings, setBindings]       = useState({});
  const [loadingB, setLoadingB]       = useState(true);
  const [svcSearch, setSvcSearch]     = useState('');
  const [svcResults, setSvcResults]   = useState([]);
  const [svcLoading, setSvcLoading]   = useState(false);
  const [addingValues, setAddingValues] = useState({});
  const saveTimers = useRef({});

  useEffect(() => {
    setLoadingB(true);
    directories.getAll('equipment_service_binding')
      .then(res => {
        const all = res.data || {};
        const filtered = {};
        for (const [id, b] of Object.entries(all)) {
          if (b.equipmentId === equipItem.id) filtered[id] = b;
        }
        setBindings(filtered);
      })
      .catch(() => {})
      .finally(() => setLoadingB(false));
  }, [equipItem.id]);

  const myBindings = useMemo(() =>
    Object.entries(bindings).map(([id, b]) => ({ id, ...b }))
      .sort((a, b) => (a.serviceName || '').localeCompare(b.serviceName || '', 'ru')),
  [bindings]);

  const boundCodes = useMemo(() => new Set(myBindings.map(b => b.serviceCode)), [myBindings]);

  const searchSvcs = useCallback(async (term) => {
    if (!term.trim() || !equipItem.clinicId) return;
    setSvcLoading(true);
    try {
      const res = await mis.searchServices(term, equipItem.clinicId);
      const raw = res.data?.data || res.data || [];
      setSvcResults(Array.isArray(raw) ? raw.slice(0, 40) : []);
    } catch { setSvcResults([]); }
    finally { setSvcLoading(false); }
  }, [equipItem.clinicId]);

  const handleSearchKey = (e) => {
    if (e.key === 'Enter') searchSvcs(svcSearch);
  };

  const addBinding = async (svc) => {
    const code  = svc.code || String(svc.service_id || svc.id || '');
    const title = svc.title || svc.name || '';
    if (!code) return;
    const id   = uuidv4();
    const data = {
      equipmentId:       equipItem.id,
      clinicId:          equipItem.clinicId,
      room:              equipItem.room || '',
      serviceCode:       code,
      serviceName:       title,
      paybackPerService: 0,
    };
    try {
      await directories.save('equipment_service_binding', id, data);
      setBindings(prev => ({ ...prev, [id]: data }));
      toast.success('Услуга привязана', { duration: 1500 });
    } catch { toast.error('Ошибка сохранения'); }
  };

  const removeBinding = async (id) => {
    try {
      await directories.remove('equipment_service_binding', id);
      setBindings(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success('Удалено', { duration: 1500 });
    } catch { toast.error('Ошибка удаления'); }
  };

  const savePayback = useCallback((id, val) => {
    const num = parseNum(val);
    setBindings(prev => ({ ...prev, [id]: { ...prev[id], paybackPerService: num } }));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try { await directories.save('equipment_service_binding', id, { paybackPerService: num }); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--rb-border-dark)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f0f9ff', borderBottom: '1px solid var(--rb-border-dark)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--rb-text)' }}>Привязка услуг — {equipItem.name}</span>
          {equipItem.room && (
            <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginLeft: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: getClinicColor(equipItem.clinicId), display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
              {equipItem.room}
            </span>
          )}
        </div>
        <button onClick={onClose}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--rb-text-secondary)', padding: '0 4px', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 0 }}>
        {/* LEFT: search panel */}
        <div style={{ borderRight: '1px solid var(--rb-border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--rb-border)', background: '#fafafa', display: 'flex', gap: 6 }}>
            <input
              value={svcSearch}
              onChange={e => setSvcSearch(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Поиск услуги по названию…"
              style={{ ...inlineInputStyle, flex: 1 }}
            />
            <button onClick={() => searchSvcs(svcSearch)} disabled={svcLoading}
              style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: svcLoading ? 'default' : 'pointer', fontSize: 12, fontFamily: 'inherit', flexShrink: 0 }}>
              {svcLoading ? '…' : 'Найти'}
            </button>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 340 }}>
            {!equipItem.clinicId && (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>
                У оборудования не указан филиал
              </div>
            )}
            {equipItem.clinicId && svcResults.length === 0 && !svcLoading && (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>
                Введите название услуги<br />и нажмите «Найти»
              </div>
            )}
            {svcResults.map(svc => {
              const code  = svc.code || String(svc.service_id || svc.id || '');
              const title = svc.title || svc.name || '';
              const bound = boundCodes.has(code);
              return (
                <div key={code} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--rb-border)', background: bound ? '#f0fdf4' : '#fff' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--rb-text)', lineHeight: 1.4 }}>{title}</div>
                    {svc.code && <div style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 1 }}>{svc.code}</div>}
                  </div>
                  {bound ? (
                    <span style={{ fontSize: 10, color: '#16a34a', flexShrink: 0, fontWeight: 600, marginTop: 2 }}>✓ добавлено</span>
                  ) : (
                    <button onClick={() => addBinding(svc)}
                      style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 5, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
                      + Привязать
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: bound services */}
        <div style={{ padding: '12px 14px', overflowY: 'auto', maxHeight: 380 }}>
          {loadingB ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--rb-text-secondary)', fontSize: 13 }}>Загрузка…</div>
          ) : myBindings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 8 }}>
              Нет привязанных услуг — найдите и добавьте услуги слева
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                {myBindings.length} {myBindings.length === 1 ? 'услуга' : myBindings.length < 5 ? 'услуги' : 'услуг'} привязано
              </div>
              <table className="rb-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <THCell>Услуга</THCell>
                    <THCell>Код</THCell>
                    <THCell right>₽ / 1 услугу</THCell>
                    <THCell></THCell>
                  </tr>
                </thead>
                <tbody>
                  {myBindings.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontSize: 12 }}>{b.serviceName}</td>
                      <td style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{b.serviceCode || DASH}</td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <input
                            type="number" min="0" step="0.01"
                            value={addingValues[b.id] ?? (b.paybackPerService || '')}
                            onChange={e => {
                              setAddingValues(p => ({ ...p, [b.id]: e.target.value }));
                              savePayback(b.id, e.target.value);
                            }}
                            placeholder="0"
                            style={{ ...inlineInputStyle, width: 100, textAlign: 'right' }}
                          />
                        </div>
                      </td>
                      <td style={{ width: 36 }}>
                        <button onClick={() => removeBinding(b.id)} title="Удалить"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px', color: '#94a3b8', fontSize: 16, lineHeight: 1 }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabEquipment() {
  const [equipment, setEquipment] = useState({});
  const [loading, setLoading]     = useState(true);
  const [clinicFilter, setClinicFilter] = useState('');
  const [search, setSearch]       = useState('');
  const [bindingCounts, setBindingCounts] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const saveTimers = useRef({});

  useEffect(() => {
    directories.getAll('equipment')
      .then(res => setEquipment(res.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    directories.getAll('equipment_service_binding')
      .then(res => {
        const counts = {};
        for (const b of Object.values(res.data || {})) {
          if (b.equipmentId) counts[b.equipmentId] = (counts[b.equipmentId] || 0) + 1;
        }
        setBindingCounts(counts);
      })
      .catch(() => {});
  }, []);

  const items = useMemo(() =>
    Object.entries(equipment)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => (a.clinicId || '').localeCompare(b.clinicId || '') || (a.room || '').localeCompare(b.room || '', 'ru') || (a.name || '').localeCompare(b.name || '', 'ru')),
  [equipment]);

  const clinicOptions = useMemo(() => {
    const ids = [...new Set(items.map(i => i.clinicId).filter(Boolean))];
    return ids.map(id => ({ id, name: getClinicName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [items]);

  const filtered = items.filter(item => {
    if (clinicFilter && item.clinicId !== clinicFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.name?.toLowerCase().includes(q) && !item.room?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const saveField = useCallback((id, patch) => {
    clearTimeout(saveTimers.current[id]);
    setEquipment(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    saveTimers.current[id] = setTimeout(async () => {
      try { await directories.save('equipment', id, patch); toast.success('Сохранено', { duration: 1500 }); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  if (loading) return <Spinner text="Загрузка оборудования…" />;

  const expandedItem = expandedId ? items.find(i => i.id === expandedId) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию или кабинету…"
          style={{ flex: '1 1 200px', minWidth: 180, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        <select value={clinicFilter} onChange={e => setClinicFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          <option value="">Все филиалы</option>
          {clinicOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
          {filtered.length} из {items.length} ед. оборудования
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rb-placeholder">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Оборудование не добавлено</div>
          <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginTop: 6 }}>
            Перейдите во вкладку «Кабинеты» и нажмите «+ Добавить» в столбце «Оборудование»
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="rb-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <THCell>Название</THCell>
                <THCell>Кабинет</THCell>
                <THCell>Филиал</THCell>
                <THCell>Дата установки</THCell>
                <THCell right>Стоимость покупки (₽)</THCell>
                <THCell right>Срок исп. (мес)</THCell>
                <THCell right>Обслуж./мес (₽)</THCell>
                <THCell right>Ремонты (₽)</THCell>
                <THCell>Услуги</THCell>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const svcCount   = bindingCounts[item.id] || 0;
                const isExpanded = expandedId === item.id;
                return (
                  <tr key={item.id} style={isExpanded ? { background: '#f0f9ff' } : {}}>
                    <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{item.name}</td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 4, height: 16, borderRadius: 2, background: getClinicColor(item.clinicId), flexShrink: 0, display: 'inline-block' }} />
                        {item.room || DASH}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{item.clinicId ? getClinicName(item.clinicId) : DASH}</td>
                    <td>
                      <input type="date" value={item.installDate || ''} onChange={e => saveField(item.id, { installDate: e.target.value })}
                        style={{ ...inlineInputStyle, width: 130 }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.purchaseCost ?? ''} onChange={e => saveField(item.id, { purchaseCost: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 110, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.usefulLife ?? ''} onChange={e => saveField(item.id, { usefulLife: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 70, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.maintenance ?? ''} onChange={e => saveField(item.id, { maintenance: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 100, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.repairs ?? ''} onChange={e => saveField(item.id, { repairs: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 100, textAlign: 'right' }} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        title="Привязать услуги"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 10px', borderRadius: 6, border: '1px solid',
                          borderColor: isExpanded ? 'var(--rb-primary)' : (svcCount > 0 ? '#bfdbfe' : 'var(--rb-border-dark)'),
                          background: isExpanded ? '#eff6ff' : (svcCount > 0 ? '#dbeafe' : '#fff'),
                          color: isExpanded ? 'var(--rb-primary)' : (svcCount > 0 ? '#1e40af' : 'var(--rb-text-secondary)'),
                          cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: svcCount > 0 ? 700 : 400,
                        }}
                      >
                        {svcCount > 0 ? `${svcCount} усл.` : '+ Услуги'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {expandedItem && (
        <EquipServiceBindings
          key={expandedId}
          equipItem={expandedItem}
          onClose={() => setExpandedId(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// РАСХОДНИКИ (Directories tab)
// ══════════════════════════════════════════════════════════════════════════════
function flattenCats(cats, depth) {
  if (!depth) depth = 0;
  const result = [];
  for (const c of (cats || [])) {
    result.push({ id: c.id, title: ' '.repeat(depth * 3) + c.title, count: c.services_count });
    if (c.children?.length) result.push(...flattenCats(c.children, depth + 1));
  }
  return result;
}

function TabConsumables() {
  const [norms, setNorms]               = useState({});
  const [loading, setLoading]           = useState(true);
  const [services, setServices]         = useState([]);
  const [svcsLoading, setSvcsLoading]   = useState(false);
  const [categories, setCategories]     = useState([]);
  const [catsLoading, setCatsLoading]   = useState(false);
  const [clinicFilter, setClinicFilter] = useState('');
  const [categoryFilter, setCatFilter]  = useState('');
  const [search, setSearch]             = useState('');
  const [selectedSvc, setSelectedSvc]   = useState(null);
  const [showAdd, setShowAdd]           = useState(false);
  const [form, setForm]                 = useState({ consumableName: '', unit: 'шт', normQty: '', unitCost: '' });
  const [saving, setSaving]             = useState(false);
  const saveTimers = useRef({});

  useEffect(() => {
    directories.getAll('consumable_norm')
      .then(res => setNorms(res.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load categories when clinic selected
  useEffect(() => {
    if (!clinicFilter) { setCategories([]); setServices([]); setCatFilter(''); return; }
    setCatsLoading(true);
    mis.getServiceCategories()
      .then(res => {
        const raw = res.data?.data || res.data || [];
        setCategories(Array.isArray(raw) ? raw : []);
      })
      .catch(() => setCategories([]))
      .finally(() => setCatsLoading(false));
  }, [clinicFilter]);

  // Load services when clinic or category changes
  useEffect(() => {
    if (!clinicFilter) { setServices([]); return; }
    setSvcsLoading(true);
    const loader = categoryFilter
      ? mis.getServicesByCategory(categoryFilter)
      : mis.getAllServices(clinicFilter);
    loader
      .then(res => {
        const raw = res.data?.data || res.data || [];
        setServices(Array.isArray(raw) ? raw : []);
      })
      .catch(() => setServices([]))
      .finally(() => setSvcsLoading(false));
  }, [clinicFilter, categoryFilter]);

  const flatCats = useMemo(() => flattenCats(categories), [categories]);

  // Count norms per service for current clinic only
  const normCountByCode = useMemo(() => {
    const counts = {};
    for (const n of Object.values(norms)) {
      if (n.clinicId !== clinicFilter) continue;
      const k = n.serviceCode || normServiceName(n.serviceName || '');
      if (k) counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [norms, clinicFilter]);

  const filteredSvcs = useMemo(() => {
    if (!search) return services;
    const q = search.toLowerCase();
    return services.filter(s =>
      (s.title || s.name || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q)
    );
  }, [services, search]);

  // Norms for selected service in current clinic
  const selectedNorms = useMemo(() => {
    if (!selectedSvc || !clinicFilter) return [];
    return Object.entries(norms)
      .filter(([, n]) =>
        n.clinicId === clinicFilter &&
        (n.serviceCode === selectedSvc.code ||
          normServiceName(n.serviceName || '') === normServiceName(selectedSvc.title))
      )
      .map(([id, n]) => ({ id, ...n }))
      .sort((a, b) => (a.consumableName || '').localeCompare(b.consumableName || '', 'ru'));
  }, [norms, selectedSvc, clinicFilter]);

  const existingConsumables = useMemo(() =>
    [...new Set(Object.values(norms).map(n => n.consumableName).filter(Boolean))],
  [norms]);

  const addNorm = async () => {
    if (!selectedSvc || !clinicFilter) { toast.error('Выберите медцентр и услугу'); return; }
    if (!form.consumableName.trim()) { toast.error('Укажите название расходника'); return; }
    const qty = parseFloat(form.normQty);
    if (!qty || qty <= 0) { toast.error('Укажите норму > 0'); return; }
    setSaving(true);
    try {
      const id   = uuidv4();
      const data = {
        clinicId:       clinicFilter,
        serviceCode:    selectedSvc.code,
        serviceName:    selectedSvc.title,
        consumableName: form.consumableName.trim(),
        unit:           form.unit,
        normQty:        qty,
        unitCost:       parseFloat(form.unitCost) || 0,
      };
      await directories.save('consumable_norm', id, data);
      setNorms(prev => ({ ...prev, [id]: data }));
      setForm({ consumableName: '', unit: 'шт', normQty: '', unitCost: '' });
      setShowAdd(false);
      toast.success('Добавлено');
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSaving(false); }
  };

  const removeNorm = async (id) => {
    try {
      await directories.remove('consumable_norm', id);
      setNorms(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success('Удалено', { duration: 1500 });
    } catch { toast.error('Ошибка удаления'); }
  };

  const saveNormField = useCallback((id, patch) => {
    clearTimeout(saveTimers.current[id]);
    setNorms(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    saveTimers.current[id] = setTimeout(async () => {
      try { await directories.save('consumable_norm', id, patch); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  if (loading) return <Spinner text="Загрузка расходников…" />;

  const clinicName = DEFAULT_CLINICS.find(c => String(c.id) === clinicFilter)?.name;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>

      {/* LEFT: Filters + Services list */}
      <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select value={clinicFilter}
            onChange={e => { setClinicFilter(e.target.value); setSelectedSvc(null); setCatFilter(''); setSearch(''); }}
            style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">— Выберите медцентр —</option>
            {DEFAULT_CLINICS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {clinicFilter && (
            <select value={categoryFilter}
              onChange={e => { setCatFilter(e.target.value); setSelectedSvc(null); setSearch(''); }}
              style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }}
              disabled={catsLoading}>
              <option value="">Все категории{catsLoading ? ' (загрузка…)' : ''}</option>
              {flatCats.map(c => (
                <option key={c.id} value={c.id}>
                  {c.title}{c.count != null ? ` (${c.count})` : ''}
                </option>
              ))}
            </select>
          )}

          {clinicFilter && (
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по коду или названию…"
              style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }} />
          )}
          {!svcsLoading && clinicFilter && (
            <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{filteredSvcs.length} услуг</span>
          )}
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 560 }}>
          {svcsLoading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>
              <span className="rb-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 6 }} />
              Загрузка…
            </div>
          ) : !clinicFilter ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>
              Выберите медцентр<br />для загрузки услуг
            </div>
          ) : filteredSvcs.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>Нет услуг</div>
          ) : filteredSvcs.map(s => {
            const code  = s.code || String(s.service_id || s.id || '');
            const title = s.title || s.name || '';
            const count = normCountByCode[code] || normCountByCode[normServiceName(title)] || 0;
            const isSel = selectedSvc?.code === code;
            return (
              <button key={code}
                onClick={() => { setSelectedSvc({ code, title }); setShowAdd(false); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6,
                  width: '100%', padding: '7px 12px', border: 'none', borderBottom: '1px solid var(--rb-border)',
                  background: isSel ? '#eff6ff' : '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: isSel ? 'var(--rb-primary)' : 'var(--rb-text)', lineHeight: 1.4 }}>{title}</div>
                  {s.code && <div style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 1 }}>{s.code}</div>}
                </div>
                {count > 0 && (
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8, background: isSel ? '#bfdbfe' : '#dbeafe', color: '#1e40af', marginTop: 2 }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Consumables for selected service */}
      <div>
        {!clinicFilter ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
            Выберите медцентр и услугу слева
          </div>
        ) : !selectedSvc ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
            Выберите услугу из списка слева
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--rb-text)' }}>{selectedSvc.title}</div>
                <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2, display: 'flex', gap: 10 }}>
                  {selectedSvc.code && <span>код: {selectedSvc.code}</span>}
                  {clinicName && <span style={{ color: getClinicColor(clinicFilter), fontWeight: 600 }}>{clinicName}</span>}
                </div>
              </div>
              <button onClick={() => setShowAdd(v => !v)}
                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: showAdd ? '#64748b' : 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {showAdd ? '✕ Отмена' : '+ Расходник'}
              </button>
            </div>

            {showAdd && (
              <div style={{ background: '#f8fafc', border: '1px solid var(--rb-border-dark)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 90px 110px auto', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Расходник *</span>
                    <input list="cs-cons-list" value={form.consumableName}
                      onChange={e => setForm(p => ({ ...p, consumableName: e.target.value }))}
                      placeholder="Название…" style={inlineInputStyle} />
                    <datalist id="cs-cons-list">
                      {existingConsumables.map((s, i) => <option key={i} value={s} />)}
                    </datalist>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ед.</span>
                    <select value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} style={inlineInputStyle}>
                      {CONSUMABLE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Норма/1</span>
                    <input type="number" min="0.01" step="0.01" value={form.normQty}
                      onChange={e => setForm(p => ({ ...p, normQty: e.target.value }))}
                      placeholder="0" style={{ ...inlineInputStyle, textAlign: 'right' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>₽ за ед.</span>
                    <input type="number" min="0" step="0.01" value={form.unitCost}
                      onChange={e => setForm(p => ({ ...p, unitCost: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addNorm(); }}
                      placeholder="0" style={{ ...inlineInputStyle, textAlign: 'right' }} />
                  </div>
                  <button onClick={addNorm} disabled={saving}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: saving ? '#94a3b8' : '#10b981', color: '#fff', cursor: saving ? 'default' : 'pointer', fontSize: 13, fontFamily: 'inherit', height: 30, flexShrink: 0 }}>
                    {saving ? '…' : '✓'}
                  </button>
                </div>
              </div>
            )}

            {selectedNorms.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 8 }}>
                Нет расходников для этой услуги в данном медцентре — нажмите «+ Расходник»
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="rb-table" style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <THCell>Расходник</THCell>
                      <THCell>Ед.</THCell>
                      <THCell right>Норма на 1 услугу</THCell>
                      <THCell right>₽ за ед.</THCell>
                      <THCell right>Стоим./услугу</THCell>
                      <THCell></THCell>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNorms.map(item => {
                      const cost = parseNum(item.normQty) * parseNum(item.unitCost);
                      return (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 500 }}>{item.consumableName}</td>
                          <td style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{item.unit}</td>
                          <td>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <input type="number" min="0.01" step="0.01" value={item.normQty ?? ''}
                                onChange={e => saveNormField(item.id, { normQty: parseFloat(e.target.value) || 0 })}
                                style={{ ...inlineInputStyle, width: 70, textAlign: 'right' }} />
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <input type="number" min="0" step="0.01" value={item.unitCost ?? ''}
                                onChange={e => saveNormField(item.id, { unitCost: parseFloat(e.target.value) || 0 })}
                                style={{ ...inlineInputStyle, width: 80, textAlign: 'right' }} />
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: cost > 0 ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}>
                            {cost > 0 ? fmtRubP(cost) : DASH}
                          </td>
                          <td style={{ width: 36 }}>
                            <button onClick={() => removeNorm(item.id)} title="Удалить"
                              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px', color: '#94a3b8', fontSize: 16, lineHeight: 1 }}>\xd7</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// ══════════════════════════════════════════════════════════════════════════════
// РЕПУТАЦИЯ (aggregated from all review boards)
// ══════════════════════════════════════════════════════════════════════════════
function SummaryKpiCard({ icon: Icon, label, value, color }) {
  return (
    <div style={{ background: 'var(--rb-card-bg)', border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--rb-text)' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

function NegativeReviewRow({ r }) {
  const [open, setOpen] = useState(false);
  const text    = r.reviewText || '';
  const rating  = r.rating || 0;
  const doctorName = getReviewDoctorName(r);
  const date    = r.reviewDate
    ? new Date(r.reviewDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rb-border)' }}>

      {/* Header: имя | дата | оценка */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 8px', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--rb-text)' }}>
          {r.patientName || 'Аноним'}
        </span>
        {date && <>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{date}</span>
        </>}
        <span style={{ color: '#cbd5e1' }}>|</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>{rating}/5</span>
          <span style={{ display: 'flex', gap: 1 }}>
            {[1,2,3,4,5].map(n => (
              <Star key={n} size={12} fill={n <= rating ? '#ef4444' : 'none'} color={n <= rating ? '#ef4444' : '#d1d5db'} />
            ))}
          </span>
        </span>
      </div>

      {/* Текст отзыва */}
      {text && (
        <div
          onClick={() => text.length > 180 && setOpen(o => !o)}
          style={{ fontSize: 13, color: 'var(--rb-text)', lineHeight: 1.65, marginBottom: 8, cursor: text.length > 180 ? 'pointer' : 'default' }}
        >
          {open ? text : (text.length > 180 ? text.slice(0, 180) + '…' : text)}
          {!open && text.length > 180 && (
            <span style={{ marginLeft: 5, fontSize: 11, color: 'var(--rb-primary)' }}>развернуть</span>
          )}
        </div>
      )}

      {/* Footer: площадка | врач | клиника */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px' }}>
        {r.platformName && (
          <span style={{ fontSize: 11, color: '#64748b', padding: '1px 7px', borderRadius: 4, background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
            {r.platformName}
          </span>
        )}
        {doctorName && <>
          {r.platformName && <span style={{ fontSize: 11, color: '#cbd5e1' }}>|</span>}
          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>
            Лечащий врач: <span style={{ fontWeight: 600, color: 'var(--rb-text)' }}>{doctorName}</span>
          </span>
        </>}
        {(r.platformId || doctorName) && <span style={{ fontSize: 11, color: '#cbd5e1' }}>|</span>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.boardColor, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: r.boardColor }}>{r.boardName}</span>
        </span>
      </div>

    </div>
  );
}

export function TabReputation({ dateFrom: dateFromProp, dateTo: dateToProp }) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const dateFrom = dateFromProp || defaultFrom;
  const dateTo   = dateToProp   || defaultTo;

  const [boards, setBoards]           = useState([]);
  const [statsMap, setStatsMap]       = useState({});
  const [loading, setLoading]         = useState(true);
  const [hiddenLines, setHiddenLines] = useState(new Set());
  const [negReviews, setNegReviews]   = useState([]);
  const [loadingNeg, setLoadingNeg]   = useState(false);
  const [negExpanded, setNegExpanded] = useState(false);
  const [platformMap, setPlatformMap] = useState({});
  const [doctorBoardFilter, setDoctorBoardFilter] = useState('');
  const [doctorSort, setDoctorSort] = useState({ key: 'avgRating', dir: 'desc' });

  useEffect(() => {
    reviews.getPlatforms()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : [];
        const map = {};
        for (const p of list) map[p.id] = p.name || p.title || p.id;
        setPlatformMap(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    reviews.getBoards()
      .then(async res => {
        const list = Array.isArray(res.data) ? res.data : [];
        setBoards(list);
        const results = await Promise.all(
          list.map(b =>
            reviews.getStats({ boardId: b.id, from: dateFrom, to: dateTo })
              .then(r => [b.id, r.data])
              .catch(() => [b.id, null])
          )
        );
        setStatsMap(Object.fromEntries(results));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  // Auto-fetch neg reviews whenever boards or period changes
  useEffect(() => {
    if (!boards.length) return;
    setLoadingNeg(true);
    setNegReviews([]);
    setNegExpanded(false);
    const from = new Date(dateFrom);
    const to   = new Date(dateTo + 'T23:59:59');
    Promise.all(
      boards.map(b =>
        reviews.getReviews(b.id)
          .then(res => {
            const list = Array.isArray(res.data) ? res.data : [];
            return list
              .filter(r => r.rating && r.rating <= 3 && r.reviewDate && new Date(r.reviewDate) >= from && new Date(r.reviewDate) <= to)
              .map(r => ({
                ...r,
                doctorName: getReviewDoctorName(r),
                boardName: b.name,
                boardColor: getBoardColor(b.name),
                platformName: r.platform?.name || platformMap[r.platformId] || r.platformId || null,
              }));
          })
          .catch(() => [])
      )
    ).then(results => {
      setNegReviews(results.flat().sort((a, b) => new Date(b.reviewDate) - new Date(a.reviewDate)));
    }).catch(() => {}).finally(() => setLoadingNeg(false));
  }, [boards, dateFrom, dateTo, platformMap]);

  // Aggregate totals
  const totals = useMemo(() => {
    let total = 0, ratingSum = 0, ratingW = 0, finalized = 0, pending = 0;
    for (const s of Object.values(statsMap)) {
      if (!s) continue;
      total     += s.total     || 0;
      finalized += s.finalized || 0;
      pending   += s.pending   || 0;
      if (s.avgRating && s.total) { ratingSum += s.avgRating * s.total; ratingW += s.total; }
    }
    return { total, avgRating: ratingW > 0 ? ratingSum / ratingW : null, finalized, pending };
  }, [statsMap]);

  // Combined trend chart: complete date axis + zero-fill per board
  const { chartData, chartLines } = useMemo(() => {
    const lines = boards.map((b, i) => ({
      id: b.id, name: b.name, color: getBoardColor(b.name), dk: `b${i}`,
    }));

    // Build a lookup: { boardId → { dateKey → total } }
    const boardLookup = {};
    for (const ln of lines) {
      const pts = statsMap[ln.id]?.dailyStats?.data || [];
      boardLookup[ln.id] = {};
      for (const pt of pts) {
        const key = String(pt.date || '').split('T')[0];
        if (key) boardLookup[ln.id][key] = (pt.positive || 0) + (pt.negative || 0);
      }
    }

    // Determine granularity from first board that has data
    const anyPeriod = Object.values(statsMap).find(s => s?.dailyStats?.period)?.dailyStats?.period || 'day';

    // Generate complete date axis matching backend granularity
    const start = new Date(dateFrom);
    const end   = new Date(dateTo);
    const dateKeys = [];

    if (anyPeriod === 'day') {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
        dateKeys.push(d.toISOString().split('T')[0]);
    } else if (anyPeriod === 'week') {
      // Align to Monday of start week
      const cur = new Date(start);
      cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
      for (; cur <= end; cur.setDate(cur.getDate() + 7))
        dateKeys.push(cur.toISOString().split('T')[0]);
    } else {
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      const endM = new Date(end.getFullYear(), end.getMonth(), 1);
      for (; cur <= endM; cur.setMonth(cur.getMonth() + 1))
        dateKeys.push(cur.toISOString().split('T')[0]);
    }

    const fmt = anyPeriod === 'month'
      ? { month: 'short', year: 'numeric' }
      : anyPeriod === 'week'
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short' };

    const data = dateKeys.map(key => {
      const entry = { key, label: new Date(key + 'T12:00:00').toLocaleDateString('ru-RU', fmt) };
      for (const ln of lines) entry[ln.dk] = boardLookup[ln.id]?.[key] ?? 0;
      return entry;
    });

    return { chartData: data, chartLines: lines };
  }, [statsMap, boards, dateFrom, dateTo]);

  // Combined doctor table (union from all boards' topDoctors)
  const allDoctors = useMemo(() => {
    const byName = {};
    boards.forEach((b, i) => {
      const s = statsMap[b.id];
      if (!s?.topDoctors) return;
      for (const d of s.topDoctors) {
        if (!d.name) continue;
        if (!byName[d.name]) byName[d.name] = { name: d.name, count: 0, ratingSum: 0, positive: 0, negative: 0, boards: [], boardColors: [] };
        byName[d.name].count     += d.count    || 0;
        byName[d.name].ratingSum += (d.avgRating || 0) * (d.count || 0);
        byName[d.name].positive  += d.positive  || 0;
        byName[d.name].negative  += d.negative  || 0;
        byName[d.name].boards.push({ id: b.id, name: b.name, color: getBoardColor(b.name), count: d.count || 0 });
        byName[d.name].boardColors.push(getBoardColor(b.name));
      }
    });
    return Object.values(byName)
      .map(d => ({ ...d, avgRating: d.count > 0 ? d.ratingSum / d.count : 0 }));
  }, [statsMap, boards]);

  const filteredDoctors = useMemo(() => {
    const dir = doctorSort.dir === 'asc' ? 1 : -1;
    return allDoctors
      .filter(d => !doctorBoardFilter || d.boards.some(b => String(b.id) === String(doctorBoardFilter)))
      .sort((a, b) => {
        if (doctorSort.key === 'name') return a.name.localeCompare(b.name, 'ru') * dir;
        const av = a[doctorSort.key] ?? 0;
        const bv = b[doctorSort.key] ?? 0;
        return (av - bv) * dir;
      });
  }, [allDoctors, doctorBoardFilter, doctorSort]);

  const setDoctorSortKey = useCallback((key) => {
    setDoctorSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  const SortButton = ({ sortKey, children, right }) => {
    const active = doctorSort.key === sortKey;
    return (
      <button
        type="button"
        onClick={() => setDoctorSortKey(sortKey)}
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          font: 'inherit',
          fontWeight: 600,
          color: active ? 'var(--rb-primary)' : 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: right ? 'flex-end' : 'flex-start',
          gap: 4,
          width: '100%',
        }}
      >
        {children}
        <span style={{ fontSize: 10, color: active ? 'var(--rb-primary)' : '#94a3b8' }}>
          {active ? (doctorSort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    );
  };

  // Count negative reviews from stats byRating data
  const negCount = useMemo(() => {
    let n = 0;
    for (const s of Object.values(statsMap)) {
      if (!s?.byRating) continue;
      n += (s.byRating[1] || 0) + (s.byRating[2] || 0) + (s.byRating[3] || 0);
    }
    return n;
  }, [statsMap]);

  // Doctor → count from fetched neg reviews
  const negByDoctor = useMemo(() => {
    const map = {};
    for (const r of negReviews) {
      const doctorName = getReviewDoctorName(r);
      if (!doctorName) continue;
      map[doctorName] = (map[doctorName] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [negReviews]);


  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rb-text)' }}>{label}</div>
        {payload.map(e => (
          <div key={e.dataKey} style={{ color: e.stroke, display: 'flex', gap: 6 }}>
            <span>{e.name}:</span><strong>{e.value}</strong>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return <Spinner text="Загрузка репутации…" />;

  if (!boards.length) return (
    <div className="rb-placeholder">
      <div style={{ fontWeight: 600, fontSize: 15 }}>Нет досок отзывов</div>
      <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginTop: 4 }}>Создайте доски в модуле «Отзывы»</div>
    </div>
  );

  return (
    <div>
      {/* Summary KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <SummaryKpiCard icon={MessageSquare} label="Всего отзывов"  value={totals.total}                         color="#3b82f6" />
        <SummaryKpiCard icon={Star}          label="Ср. оценка"     value={totals.avgRating?.toFixed(1) || '—'}  color="#f59e0b" />
      </div>

      {/* Per-clinic cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginBottom: 20 }}>
        {boards.map((b, i) => {
          const s = statsMap[b.id];
          const color = getBoardColor(b.name);
          const pct = s?.total > 0 ? Math.round(((s.byRating?.[4] || 0) + (s.byRating?.[5] || 0)) / s.total * 100) : null;
          return (
            <div key={b.id} style={{ background: 'var(--rb-card-bg)', border: '1px solid var(--rb-border)', borderTop: `3px solid ${color}`, borderRadius: 'var(--rb-radius)', padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--rb-text)', marginBottom: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
              <div style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1 }}>{s?.avgRating != null ? s.avgRating.toFixed(1) : '—'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 3, marginBottom: 8 }}>
                {[1,2,3,4,5].map(n => (
                  <Star key={n} size={12}
                    fill={n <= Math.round(s?.avgRating || 0) ? '#f59e0b' : 'none'}
                    color={n <= Math.round(s?.avgRating || 0) ? '#f59e0b' : '#d1d5db'} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div><span style={{ fontWeight: 600, color: 'var(--rb-text)' }}>{s?.total || 0}</span> отзывов</div>
                {pct != null && <div style={{ color: pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>{pct}% позитивных</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Combined trend chart */}
      {chartData.length > 0 && (
        <div style={{ background: 'var(--rb-card-bg)', border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={16} style={{ color: 'var(--rb-text-secondary)' }} />
            Динамика отзывов по филиалам
          </div>

          {/* Line toggle buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {chartLines.map(ln => {
              const hidden = hiddenLines.has(ln.id);
              return (
                <button key={ln.id}
                  onClick={() => setHiddenLines(prev => {
                    const next = new Set(prev);
                    if (next.has(ln.id)) next.delete(ln.id); else next.add(ln.id);
                    return next;
                  })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                    fontFamily: 'inherit', transition: 'all 0.15s',
                    border: `2px solid ${ln.color}`,
                    background: hidden ? '#f8fafc' : ln.color + '18',
                    color: hidden ? 'var(--rb-text-secondary)' : 'var(--rb-text)',
                    opacity: hidden ? 0.5 : 1,
                  }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: hidden ? '#cbd5e1' : ln.color, flexShrink: 0 }} />
                  {ln.name}
                </button>
              );
            })}
            {hiddenLines.size > 0 && (
              <button onClick={() => setHiddenLines(new Set())}
                style={{ padding: '5px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', border: '1px dashed #94a3b8', background: 'none', color: 'var(--rb-text-secondary)' }}>
                Показать все
              </button>
            )}
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false}
                axisLine={{ stroke: 'rgba(148,163,184,0.3)' }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={26} />
              <Tooltip content={<CustomTooltip />} />
              {chartLines.filter(ln => !hiddenLines.has(ln.id)).map((ln, i) => (
                <Line key={ln.id} type="monotone" dataKey={ln.dk} name={ln.name}
                  stroke={ln.color} strokeWidth={2}
                  strokeDasharray={i % 2 === 1 ? '5 3' : undefined}
                  dot={{ r: 3, fill: ln.color, strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Combined doctor rating table */}
      {allDoctors.length > 0 && (
        <div style={{ background: 'var(--rb-card-bg)', border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 180 }}>
              <UserRound size={16} style={{ color: 'var(--rb-text-secondary)' }} />
              Рейтинг врачей
            </div>
            <select
              value={doctorBoardFilter}
              onChange={e => setDoctorBoardFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: '#fff', cursor: 'pointer', maxWidth: 260 }}
            >
              <option value="">Все медцентры</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
              {filteredDoctors.length} из {allDoctors.length}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rb-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <THCell>#</THCell>
                  <THCell><SortButton sortKey="name">Врач</SortButton></THCell>
                  <THCell>Медцентры</THCell>
                  <THCell right><SortButton sortKey="count" right>Отзывов</SortButton></THCell>
                  <THCell right><SortButton sortKey="negative" right>Негатив</SortButton></THCell>
                  <THCell right><SortButton sortKey="avgRating" right>Ср. оценка</SortButton></THCell>
                </tr>
              </thead>
              <tbody>
                {filteredDoctors.map((doc, i) => (
                  <tr key={doc.name}>
                    <td style={{ color: 'var(--rb-text-secondary)', fontSize: 12, width: 36 }}>{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {doc.boardColors.slice(0, 4).map((c, j) => (
                            <span key={j} style={{ width: 5, height: 14, borderRadius: 2, background: c, display: 'inline-block' }} />
                          ))}
                        </div>
                        {doc.name}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {doc.boards.map(b => (
                          <span key={b.id} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 12, background: b.color + '18', color: b.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {b.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{doc.count}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: doc.negative > 0 ? '#dc2626' : 'var(--rb-text-secondary)', fontWeight: doc.negative > 0 ? 600 : 400 }}>
                      {doc.negative}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                        <Star size={12} fill="#f59e0b" color="#f59e0b" />
                        {doc.avgRating.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredDoctors.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '28px 20px', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                      Нет врачей по выбранному медцентру
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Negative reviews section */}
      {(negCount > 0 || loadingNeg) && (
        <div style={{ background: 'var(--rb-card-bg)', border: '1px solid #fecaca', borderRadius: 'var(--rb-radius)', marginTop: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Star size={15} fill="#ef4444" color="#ef4444" />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--rb-text)', flex: 1 }}>Негативные отзывы</span>
            {loadingNeg
              ? <span className="rb-spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
              : <span style={{ background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: 12, borderRadius: 10, padding: '2px 9px', flexShrink: 0 }}>{negReviews.length}</span>
            }
          </div>

          {!loadingNeg && negByDoctor.length > 0 && (
            <div style={{ padding: '8px 20px 10px', borderBottom: '1px solid var(--rb-border)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginRight: 2 }}>По врачам:</span>
              {negByDoctor.slice(0, 8).map(([name, cnt]) => (
                <span key={name} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {name} ({cnt})
                </span>
              ))}
              {negByDoctor.length > 8 && (
                <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>+{negByDoctor.length - 8} ещё</span>
              )}
            </div>
          )}

          {!loadingNeg && (
            <>
              {negReviews.slice(0, negExpanded ? negReviews.length : 20).map((r, i) => (
                <NegativeReviewRow key={r.id ?? i} r={r} />
              ))}
              {negReviews.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Нет негативных отзывов за выбранный период</div>
              )}
              {!negExpanded && negReviews.length > 20 && (
                <button onClick={() => setNegExpanded(true)}
                  style={{ display: 'block', width: '100%', padding: '12px 20px', border: 'none', borderTop: '1px solid var(--rb-border)', background: '#fafafa', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--rb-primary)', fontWeight: 500 }}>
                  Показать ещё {negReviews.length - 20} отзывов
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helper: utility stats table cell ─────────────────────────────────────────
function UtilStatCell({ value, hint, noData }) {
  if (noData) return (
    <td style={{ textAlign: 'right', padding: '7px 12px', border: '1px solid var(--rb-border)', color: '#cbd5e1', fontSize: 12 }}>
      н/д
    </td>
  );
  if (value === null || value === undefined) return (
    <td style={{ textAlign: 'right', padding: '7px 12px', border: '1px solid var(--rb-border)', color: '#cbd5e1', fontSize: 12 }}>
      {DASH}
    </td>
  );
  return (
    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '7px 12px', border: '1px solid var(--rb-border)' }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtRubP(value)}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 1 }}>{hint}</div>}
    </td>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY CATEGORY EDITOR  (modal overlay — supports 2 and 3-level hierarchies)
// ══════════════════════════════════════════════════════════════════════════════
function UtilityCatEditor({ cats, onSave, onClose, embedded = false }) {
  const [draft, setDraft]   = useState(() => cats.map(c => ({
    ...c,
    types: (c.types || []).map(t => ({ ...t })),
    subcats: (c.subcats || []).map(sc => ({ ...sc, types: (sc.types || []).map(t => ({ ...t })) })),
  })));
  const [saving, setSaving] = useState(false);

  const moveCat  = (ci, dir) => setDraft(d => { const n=[...d]; const sw=ci+dir; if(sw<0||sw>=n.length)return d; [n[ci],n[sw]]=[n[sw],n[ci]]; return n; });
  const deleteCat = ci      => setDraft(d => d.filter((_,i)=>i!==ci));
  const updateCatLabel = (ci, v) => setDraft(d => d.map((c,i)=>i===ci?{...c,label:v}:c));

  const addCat = () => { const k=`cat_${Date.now()}`; setDraft(d=>[...d,{key:k,label:'Новая категория',types:[{key:`${k}_t0`,label:'Подтип 1'}],subcats:[]}]); };

  // Flat type ops (when category has no subcats)
  const updateTypeLabel = (ci,ti,v) => setDraft(d=>d.map((c,i)=>i===ci?{...c,types:c.types.map((t,j)=>j===ti?{...t,label:v}:t)}:c));
  const updateTypeUnit  = (ci,ti,v) => setDraft(d=>d.map((c,i)=>i===ci?{...c,types:c.types.map((t,j)=>j===ti?{...t,unit:v}:t)}:c));
  const deleteType      = (ci,ti)   => setDraft(d=>d.map((c,i)=>i===ci?{...c,types:c.types.filter((_,j)=>j!==ti)}:c));
  const moveType        = (ci,ti,dir)=>setDraft(d=>d.map((c,i)=>{if(i!==ci)return c;const n=[...c.types];const sw=ti+dir;if(sw<0||sw>=n.length)return c;[n[ti],n[sw]]=[n[sw],n[ti]];return{...c,types:n};}));
  const addType         = (ci)      => { const k=`type_${Date.now()}`; setDraft(d=>d.map((c,i)=>i===ci?{...c,types:[...c.types,{key:k,label:'Новый подтип'}]}:c)); };

  // Subcategory ops
  const addSubcat = (ci) => { const k=`sc_${Date.now()}`; setDraft(d=>d.map((c,i)=>i===ci?{...c,types:[],subcats:[...(c.subcats||[]),{key:k,label:'Новая подкатегория',types:[{key:`${k}_t0`,label:'Подтип 1'}]}]}:c)); };
  const deleteSubcat      = (ci,si)      => setDraft(d=>d.map((c,i)=>i===ci?{...c,subcats:(c.subcats||[]).filter((_,j)=>j!==si)}:c));
  const updateSubcatLabel = (ci,si,v)    => setDraft(d=>d.map((c,i)=>i===ci?{...c,subcats:(c.subcats||[]).map((sc,j)=>j===si?{...sc,label:v}:sc)}:c));
  const moveSubcat        = (ci,si,dir)  => setDraft(d=>d.map((c,i)=>{if(i!==ci)return c;const n=[...(c.subcats||[])];const sw=si+dir;if(sw<0||sw>=n.length)return c;[n[si],n[sw]]=[n[sw],n[si]];return{...c,subcats:n};}));
  // Subcat type ops
  const addSubcatType         = (ci,si)         => { const k=`type_${Date.now()}`; setDraft(d=>d.map((c,i)=>i===ci?{...c,subcats:(c.subcats||[]).map((sc,j)=>j===si?{...sc,types:[...sc.types,{key:k,label:'Новый подтип'}]}:sc)}:c)); };
  const deleteSubcatType      = (ci,si,ti)       => setDraft(d=>d.map((c,i)=>i===ci?{...c,subcats:(c.subcats||[]).map((sc,j)=>j===si?{...sc,types:sc.types.filter((_,k)=>k!==ti)}:sc)}:c));
  const updateSubcatTypeLabel = (ci,si,ti,v)     => setDraft(d=>d.map((c,i)=>i===ci?{...c,subcats:(c.subcats||[]).map((sc,j)=>j===si?{...sc,types:sc.types.map((t,k)=>k===ti?{...t,label:v}:t)}:sc)}:c));
  const updateSubcatTypeUnit  = (ci,si,ti,v)     => setDraft(d=>d.map((c,i)=>i===ci?{...c,subcats:(c.subcats||[]).map((sc,j)=>j===si?{...sc,types:sc.types.map((t,k)=>k===ti?{...t,unit:v}:t)}:sc)}:c));
  const moveSubcatType        = (ci,si,ti,dir)   => setDraft(d=>d.map((c,i)=>{if(i!==ci)return c;return{...c,subcats:(c.subcats||[]).map((sc,j)=>{if(j!==si)return sc;const n=[...sc.types];const sw=ti+dir;if(sw<0||sw>=n.length)return sc;[n[ti],n[sw]]=[n[sw],n[ti]];return{...sc,types:n};})}}));

  // Convert flat ↔ hierarchical
  const convertToHierarchical = (ci) => {
    const k = `sc_${Date.now()}`;
    setDraft(d => d.map((c,i) => i===ci ? {...c, subcats:[{key:k,label:'Группа 1',types:[...c.types]}], types:[]} : c));
  };
  const convertToFlat = (ci) => {
    setDraft(d => d.map((c,i) => {
      if(i!==ci)return c;
      const flat = (c.subcats||[]).flatMap(sc => sc.types||[]);
      return {...c, types:flat, subcats:[]};
    }));
  };

  const handleSave = async () => { setSaving(true); await onSave(draft); setSaving(false); onClose(); };

  const btnSt = (primary) => ({
    padding: '7px 18px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
    border: primary ? 'none' : '1px solid var(--rb-border-dark)',
    background: primary ? 'var(--rb-primary)' : '#fff',
    color: primary ? '#fff' : 'var(--rb-text)', fontWeight: primary ? 600 : 400,
    opacity: saving ? 0.7 : 1,
  });

  const mvBtn = (onClick, disabled, label) => (
    <button onClick={onClick} disabled={disabled}
      style={{ border:'none',background:'none',cursor:disabled?'default':'pointer',fontSize:9,lineHeight:1.2,padding:'1px 4px',color:disabled?'#cbd5e1':'var(--rb-text-secondary)' }}>
      {label}
    </button>
  );

  return (
    <>
      {!embedded && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} />}
      <div style={embedded
        ? {}
        : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 600, maxWidth: '97vw', maxHeight: '90vh', overflow: 'hidden', background: '#fff', borderRadius: 14,
            boxShadow: '0 24px 64px rgba(0,0,0,0.28)', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
        {!embedded && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Категории коммунальных услуг</span>
            <button onClick={onClose} style={{ border:'none',background:'none',cursor:'pointer',fontSize:22,color:'var(--rb-text-secondary)',lineHeight:1,padding:'0 4px' }}>×</button>
          </div>
        )}
        <div style={embedded
          ? { padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }
          : { flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {draft.map((cat, ci) => {
            const hasSubcats = (cat.subcats||[]).length > 0;
            return (
              <div key={cat.key} style={{ border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
                {/* Category header */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: '#f1f5f9' }}>
                  <div style={{ display:'flex',flexDirection:'column' }}>
                    {mvBtn(() => moveCat(ci,-1), ci===0, '▲')}
                    {mvBtn(() => moveCat(ci,1), ci===draft.length-1, '▼')}
                  </div>
                  <input value={cat.label} onChange={e => updateCatLabel(ci, e.target.value)}
                    style={{ ...inlineInputStyle, flex: 1, fontWeight: 600, fontSize: 13 }} />
                  <button onClick={() => hasSubcats ? convertToFlat(ci) : convertToHierarchical(ci)}
                    title={hasSubcats ? 'Сделать плоской (убрать подкатегории)' : 'Добавить уровень подкатегорий'}
                    style={{ border:'1px solid #bfdbfe',background:'#eff6ff',cursor:'pointer',borderRadius:6,padding:'3px 8px',fontSize:11,color:'#1e40af',fontFamily:'inherit',flexShrink:0,whiteSpace:'nowrap' }}>
                    {hasSubcats ? '⊟ Плоско' : '⊞ Уровни'}
                  </button>
                  <button onClick={() => deleteCat(ci)}
                    style={{ border:'1px solid #fecaca',background:'#fff',cursor:'pointer',borderRadius:6,padding:'3px 10px',fontSize:12,color:'#ef4444',fontFamily:'inherit',flexShrink:0 }}>
                    Удалить
                  </button>
                </div>

                {hasSubcats ? (
                  /* ── 3-level: subcategories ── */
                  <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(cat.subcats||[]).map((sc, si) => (
                      <div key={sc.key} style={{ border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden' }}>
                        <div style={{ display:'flex',gap:6,alignItems:'center',padding:'6px 10px',background:'#f8fafc' }}>
                          <div style={{ display:'flex',flexDirection:'column' }}>
                            {mvBtn(() => moveSubcat(ci,si,-1), si===0, '▲')}
                            {mvBtn(() => moveSubcat(ci,si,1), si===(cat.subcats||[]).length-1, '▼')}
                          </div>
                          <div style={{ width:3,alignSelf:'stretch',background:'#93c5fd',borderRadius:2,flexShrink:0 }} />
                          <input value={sc.label} onChange={e => updateSubcatLabel(ci,si,e.target.value)}
                            style={{ ...inlineInputStyle, flex:1, fontWeight:600, fontSize:12 }} />
                          <button onClick={() => deleteSubcat(ci,si)}
                            style={{ border:'none',background:'none',cursor:'pointer',fontSize:16,color:'#94a3b8',lineHeight:1,padding:'0 4px',flexShrink:0 }}>×</button>
                        </div>
                        <div style={{ padding:'6px 12px',display:'flex',flexDirection:'column',gap:4 }}>
                          {(sc.types||[]).map((type,ti) => (
                            <div key={type.key} style={{ display:'flex',gap:6,alignItems:'center' }}>
                              <div style={{ display:'flex',flexDirection:'column' }}>
                                {mvBtn(() => moveSubcatType(ci,si,ti,-1), ti===0, '▲')}
                                {mvBtn(() => moveSubcatType(ci,si,ti,1), ti===(sc.types||[]).length-1, '▼')}
                              </div>
                              <div style={{ width:3,alignSelf:'stretch',background:'#bfdbfe',borderRadius:2,flexShrink:0 }} />
                              <input value={type.label} onChange={e => updateSubcatTypeLabel(ci,si,ti,e.target.value)}
                                style={{ ...inlineInputStyle, flex:1, fontSize:12 }} />
                              <input value={type.unit||''} onChange={e => updateSubcatTypeUnit(ci,si,ti,e.target.value)}
                                placeholder="ед." title="Единица измерения" style={{ ...inlineInputStyle, width:55, fontSize:12 }} />
                              <button onClick={() => deleteSubcatType(ci,si,ti)}
                                style={{ border:'none',background:'none',cursor:'pointer',fontSize:16,color:'#94a3b8',lineHeight:1,padding:'0 4px',flexShrink:0 }}>×</button>
                            </div>
                          ))}
                          <button onClick={() => addSubcatType(ci,si)}
                            style={{ alignSelf:'flex-start',marginTop:2,padding:'2px 8px',borderRadius:5,border:'1px dashed #94a3b8',background:'none',cursor:'pointer',fontSize:11,color:'var(--rb-text-secondary)',fontFamily:'inherit' }}>
                            + подтип
                          </button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addSubcat(ci)}
                      style={{ alignSelf:'flex-start',padding:'3px 10px',borderRadius:5,border:'1px dashed #93c5fd',background:'#eff6ff',cursor:'pointer',fontSize:12,color:'#1e40af',fontFamily:'inherit' }}>
                      + подкатегорию
                    </button>
                  </div>
                ) : (
                  /* ── 2-level: flat types ── */
                  <div style={{ padding:'8px 14px',display:'flex',flexDirection:'column',gap:5 }}>
                    {(cat.types||[]).map((type,ti) => (
                      <div key={type.key} style={{ display:'flex',gap:6,alignItems:'center' }}>
                        <div style={{ display:'flex',flexDirection:'column' }}>
                          {mvBtn(() => moveType(ci,ti,-1), ti===0, '▲')}
                          {mvBtn(() => moveType(ci,ti,1), ti===(cat.types||[]).length-1, '▼')}
                        </div>
                        <div style={{ width:3,alignSelf:'stretch',background:'#bfdbfe',borderRadius:2,flexShrink:0 }} />
                        <input value={type.label} onChange={e => updateTypeLabel(ci,ti,e.target.value)}
                          style={{ ...inlineInputStyle, flex:1 }} />
                        <input value={type.unit||''} onChange={e => updateTypeUnit(ci,ti,e.target.value)}
                          placeholder="ед." title="Единица измерения" style={{ ...inlineInputStyle, width:55 }} />
                        <button onClick={() => deleteType(ci,ti)}
                          style={{ border:'none',background:'none',cursor:'pointer',fontSize:18,color:'#94a3b8',lineHeight:1,padding:'0 4px',flexShrink:0 }}>×</button>
                      </div>
                    ))}
                    <button onClick={() => addType(ci)}
                      style={{ alignSelf:'flex-start',marginTop:2,padding:'3px 10px',borderRadius:5,border:'1px dashed #94a3b8',background:'none',cursor:'pointer',fontSize:12,color:'var(--rb-text-secondary)',fontFamily:'inherit' }}>
                      + подтип
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={addCat}
            style={{ padding:'8px 14px',borderRadius:8,border:'1px dashed var(--rb-primary)',background:'none',cursor:'pointer',fontSize:13,color:'var(--rb-primary)',fontFamily:'inherit',fontWeight:500 }}>
            + Добавить категорию
          </button>
        </div>
        <div style={{ padding:'12px 20px',borderTop:'1px solid var(--rb-border)',display:'flex',gap:8,justifyContent:'flex-end',
          ...(embedded ? {} : { flexShrink: 0 }) }}>
          {!embedded && <button onClick={onClose} style={btnSt(false)}>Отмена</button>}
          <button onClick={handleSave} disabled={saving} style={btnSt(true)}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY COLUMN GROUP EDITOR  — unified ordered list (groups + solo clinics)
// ══════════════════════════════════════════════════════════════════════════════
function UtilityColEditor({ colGroups, clinics, onSave, onClose, embedded = false }) {
  const [saving, setSaving] = useState(false);

  // Unified list: items are either { kind:'group', key, label, color, items[] }
  //                               or { kind:'solo',  key, label, color, clinicId }
  const [unified, setUnified] = useState(() => {
    const groups = colGroups.map(g => ({ kind: 'group', ...g, items: g.items.map(i => ({ ...i })) }));
    const assignedIds = new Set(colGroups.flatMap(g => g.items.filter(i => i.kind === 'clinic').map(i => i.id)));
    const soloAll = clinics.filter(c => !assignedIds.has(String(c.id)));
    const savedOrder = colGroups.__standaloneOrder || [];
    const ordered = [
      ...savedOrder.map(id => soloAll.find(c => String(c.id) === id)).filter(Boolean),
      ...soloAll.filter(c => !savedOrder.includes(String(c.id))),
    ];
    const solos = ordered.map(c => ({ kind: 'solo', key: `s_${c.id}`, clinicId: String(c.id), label: c.title || c.name, color: c.color }));
    return [...groups, ...solos];
  });

  const assignedInGroups = useMemo(() =>
    new Set(unified.filter(u => u.kind === 'group').flatMap(g => g.items.filter(i => i.kind === 'clinic').map(i => i.id))),
  [unified]);

  // Clinics available to add to groups (those in solos or not yet in list)
  const availableForGroups = clinics.filter(c => !assignedInGroups.has(String(c.id)));

  const move = (ui, dir) => setUnified(prev => {
    const next = [...prev]; const sw = ui + dir;
    if (sw < 0 || sw >= next.length) return prev;
    [next[ui], next[sw]] = [next[sw], next[ui]]; return next;
  });

  const addGroup = () => setUnified(prev => [...prev, { kind: 'group', key: `grp_${Date.now()}`, label: 'Новая группа', items: [] }]);

  const deleteUnified = (ui) => setUnified(prev => {
    const item = prev[ui];
    if (item.kind === 'solo') return prev.filter((_, i) => i !== ui);
    // Group deleted: release its clinics back as solos at end
    const newSolos = item.items.filter(it => it.kind === 'clinic').map(it => {
      const c = clinics.find(cl => String(cl.id) === it.id);
      return c ? { kind: 'solo', key: `s_${c.id}`, clinicId: String(c.id), label: c.title || c.name, color: c.color } : null;
    }).filter(Boolean);
    return [...prev.filter((_, i) => i !== ui), ...newSolos];
  });

  const updateGroupLabel = (ui, label) => setUnified(prev => prev.map((item, i) => i === ui ? { ...item, label } : item));

  const addClinicToGroup = (ui, clinicId) => setUnified(prev => {
    // Remove solo entry if present, add clinic to group
    const soloIdx = prev.findIndex(it => it.kind === 'solo' && it.clinicId === clinicId);
    const next = prev.filter((_, i) => i !== soloIdx);
    const adjUi = soloIdx >= 0 && soloIdx < ui ? ui - 1 : ui;
    return next.map((item, i) => i === adjUi ? { ...item, items: [...item.items, { kind: 'clinic', id: clinicId }] } : item);
  });

  const addPremiseToGroup = (ui) => setUnified(prev => prev.map((item, i) =>
    i === ui ? { ...item, items: [...item.items, { kind: 'premise', id: `prem_${Date.now()}`, label: 'Новое помещение' }] } : item));

  const updateItemLabel = (ui, ii, label) => setUnified(prev => prev.map((item, i) =>
    i === ui ? { ...item, items: item.items.map((it, j) => j === ii ? { ...it, label } : it) } : item));

  const removeFromGroup = (ui, ii) => setUnified(prev => {
    const grp = prev[ui]; const removed = grp.items[ii];
    const newGrp = { ...grp, items: grp.items.filter((_, j) => j !== ii) };
    const next = prev.map((item, i) => i === ui ? newGrp : item);
    if (removed.kind === 'clinic') {
      const c = clinics.find(cl => String(cl.id) === removed.id);
      if (c) next.push({ kind: 'solo', key: `s_${c.id}`, clinicId: String(c.id), label: c.title || c.name, color: c.color });
    }
    return next;
  });

  const moveGroupItem = (ui, ii, dir) => setUnified(prev => prev.map((item, i) => {
    if (i !== ui) return item;
    const items = [...item.items]; const sw = ii + dir;
    if (sw < 0 || sw >= items.length) return item;
    [items[ii], items[sw]] = [items[sw], items[ii]]; return { ...item, items };
  }));

  const handleSave = async () => {
    setSaving(true);
    const groups = unified.filter(u => u.kind === 'group').map(({ kind, ...rest }) => rest);
    const soOrder = unified.filter(u => u.kind === 'solo').map(u => u.clinicId);
    await onSave(groups, soOrder);
    setSaving(false);
    onClose();
  };

  const btnSt = (primary) => ({
    padding: '7px 18px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
    border: primary ? 'none' : '1px solid var(--rb-border-dark)',
    background: primary ? 'var(--rb-primary)' : '#fff',
    color: primary ? '#fff' : 'var(--rb-text)', fontWeight: primary ? 600 : 400,
    opacity: saving ? 0.7 : 1,
  });
  const mvBtn = (onClick, disabled, label) => (
    <button onClick={onClick} disabled={disabled}
      style={{ border:'none',background:'none',cursor:disabled?'default':'pointer',fontSize:9,lineHeight:1.2,padding:'1px 4px',color:disabled?'#cbd5e1':'var(--rb-text-secondary)' }}>
      {label}
    </button>
  );

  return (
    <>
      {!embedded && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} />}
      <div style={embedded
        ? {}
        : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 600, maxWidth: '96vw', maxHeight: '88vh', overflow: 'hidden', background: '#fff', borderRadius: 14,
            boxShadow: '0 24px 64px rgba(0,0,0,0.28)', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
        {!embedded && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Порядок столбцов</span>
            <button onClick={onClose} style={{ border:'none',background:'none',cursor:'pointer',fontSize:22,color:'var(--rb-text-secondary)',lineHeight:1 }}>×</button>
          </div>
        )}
        <div style={embedded
          ? { padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 5 }
          : { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            Перетащите ▲▼ для изменения порядка. Отдельная клиника — одиночный столбец; группа — объединённый.
          </div>
          {unified.map((item, ui) => {
            const isFirst = ui === 0, isLast = ui === unified.length - 1;
            if (item.kind === 'solo') {
              const clinic = clinics.find(c => String(c.id) === item.clinicId);
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#fafcff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {mvBtn(() => move(ui, -1), isFirst, '▲')}
                    {mvBtn(() => move(ui, 1), isLast, '▼')}
                  </div>
                  <div style={{ width: 4, height: 18, borderRadius: 2, background: item.color || '#94a3b8', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, flex: 1 }}>🏥 {clinic?.title || clinic?.name || item.label}</span>
                  <button onClick={() => deleteUnified(ui)}
                    style={{ border:'none',background:'none',cursor:'pointer',fontSize:16,color:'#cbd5e1',padding:'0 2px',lineHeight:1 }}>×</button>
                </div>
              );
            }
            // Group item
            return (
              <div key={item.key} style={{ border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 10px', background: '#f1f5f9' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {mvBtn(() => move(ui, -1), isFirst, '▲')}
                    {mvBtn(() => move(ui, 1), isLast, '▼')}
                  </div>
                  <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>⊞</span>
                  <input value={item.label} onChange={e => updateGroupLabel(ui, e.target.value)}
                    style={{ ...inlineInputStyle, flex: 1, fontWeight: 600, fontSize: 13 }} />
                  <button onClick={() => deleteUnified(ui)}
                    style={{ border:'1px solid #fecaca',background:'#fff',cursor:'pointer',borderRadius:6,padding:'2px 8px',fontSize:12,color:'#ef4444',fontFamily:'inherit',flexShrink:0 }}>
                    Удалить
                  </button>
                </div>
                <div style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {item.items.map((it, ii) => (
                    <div key={it.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {mvBtn(() => moveGroupItem(ui, ii, -1), ii === 0, '▲')}
                        {mvBtn(() => moveGroupItem(ui, ii, 1), ii === item.items.length - 1, '▼')}
                      </div>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{it.kind === 'clinic' ? '🏥' : '🏢'}</span>
                      {it.kind === 'clinic'
                        ? <span style={{ flex: 1, fontSize: 12 }}>{clinics.find(c => String(c.id) === it.id)?.title || clinics.find(c => String(c.id) === it.id)?.name || it.id}</span>
                        : <input value={it.label || ''} onChange={e => updateItemLabel(ui, ii, e.target.value)} style={{ ...inlineInputStyle, flex: 1, fontSize: 12 }} />
                      }
                      <button onClick={() => removeFromGroup(ui, ii)}
                        style={{ border:'none',background:'none',cursor:'pointer',fontSize:16,color:'#94a3b8',lineHeight:1,padding:'0 2px',flexShrink:0 }}>×</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {availableForGroups.length > 0 && (
                      <select defaultValue="" onChange={e => { if (e.target.value) { addClinicToGroup(ui, e.target.value); e.target.value = ''; } }}
                        style={{ padding: '3px 7px', borderRadius: 5, border: '1px dashed #94a3b8', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--rb-text-secondary)', fontFamily: 'inherit' }}>
                        <option value="">+ клиника</option>
                        {availableForGroups.map(c => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
                      </select>
                    )}
                    <button onClick={() => addPremiseToGroup(ui)}
                      style={{ padding: '3px 8px', borderRadius: 5, border: '1px dashed #94a3b8', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--rb-text-secondary)', fontFamily: 'inherit' }}>
                      + помещение
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <button onClick={addGroup}
            style={{ marginTop: 4, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--rb-primary)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--rb-primary)', fontFamily: 'inherit', fontWeight: 500 }}>
            + Добавить группу
          </button>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--rb-border)', display: 'flex', gap: 8, justifyContent: 'flex-end',
          ...(embedded ? {} : { flexShrink: 0 }) }}>
          {!embedded && <button onClick={onClose} style={btnSt(false)}>Отмена</button>}
          <button onClick={handleSave} disabled={saving} style={btnSt(true)}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// UNIFIED SETTINGS MODAL  (categories + column groups in one tabbed dialog)
// ══════════════════════════════════════════════════════════════════════════════
function UtilitySettingsModal({ utilCats, colGroups, clinics, onSaveCats, onSaveCols, onClose }) {
  const [tab, setTab] = useState('cats');
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 660, maxWidth: '97vw', maxHeight: '90vh', overflow: 'hidden', background: '#fff', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,0,0,0.3)', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
        {/* Header with tabs */}
        <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--rb-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Настройки таблицы</span>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--rb-text-secondary)', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
            {[['cats', 'Категории услуг'], ['cols', 'Группы столбцов']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                style={{ padding: '7px 18px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                  border: 'none', borderBottom: tab === k ? '2px solid var(--rb-primary)' : '2px solid transparent',
                  background: 'none', color: tab === k ? 'var(--rb-primary)' : 'var(--rb-text-secondary)',
                  fontWeight: tab === k ? 600 : 400, transition: 'color 0.15s' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Tabbed content — simple scroll, no flex gymnastics */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {tab === 'cats' && (
            <UtilityCatEditor cats={utilCats} onSave={onSaveCats} onClose={() => {}} embedded />
          )}
          {tab === 'cols' && (
            <UtilityColEditor colGroups={colGroups} clinics={clinics} onSave={onSaveCols} onClose={() => {}} embedded />
          )}
        </div>
      </div>
    </>
  );
}

// ── Column visibility panel ────────────────────────────────────────────────
function ColumnFilterPanel({ groups, hiddenGroups, onChange, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 501, padding: 16, minWidth: 260, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Видимые столбцы</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--rb-text-secondary)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {groups.map(grp => {
            const hidden = hiddenGroups.has(grp.key);
            const visible = !hidden;
            return (
              <div key={grp.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '5px 0', userSelect: 'none' }}
                onClick={() => {
                  const next = new Set(hiddenGroups);
                  if (hidden) next.delete(grp.key); else next.add(grp.key);
                  onChange(next);
                }}>
                <div style={{ width: 16, height: 16, border: `2px solid ${visible ? 'var(--rb-primary)' : '#cbd5e1'}`,
                  borderRadius: 3, background: visible ? 'var(--rb-primary)' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {visible && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                </div>
                <div style={{ width: 4, height: 16, borderRadius: 2, background: grp.color || '#94a3b8', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: hidden ? '#94a3b8' : 'var(--rb-text)', textDecoration: hidden ? 'line-through' : 'none' }}>
                  {grp.label}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--rb-border)', paddingTop: 10 }}>
          <button onClick={() => onChange(new Set())}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--rb-border)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            Показать все
          </button>
          <button onClick={onClose}
            style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            Готово
          </button>
        </div>
      </div>
    </>
  );
}

// ── Month filter panel ─────────────────────────────────────────────────────
function MonthFilterPanel({ selectedPeriods, onChange, onClose }) {
  const yearRange = useMemo(() => Array.from({ length: 7 }, (_, i) => 2022 + i), []);
  const isYearFull    = y => MONTHS_RU.every(m => selectedPeriods.has(`${y}_${m.num}`));
  const isYearPartial = y => MONTHS_RU.some(m => selectedPeriods.has(`${y}_${m.num}`));

  const togglePeriod = (y, monthNum) => {
    const k = `${y}_${monthNum}`;
    const next = new Set(selectedPeriods);
    if (next.has(k)) next.delete(k); else next.add(k);
    if (next.size > 0) onChange(next);
  };

  const toggleYear = y => {
    const full = isYearFull(y);
    const next = new Set(selectedPeriods);
    MONTHS_RU.forEach(m => { const k = `${y}_${m.num}`; full ? next.delete(k) : next.add(k); });
    if (next.size > 0) onChange(next);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 501, padding: 16, minWidth: 340, maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Выбор периода</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--rb-text-secondary)', lineHeight: 1 }}>×</button>
        </div>
        {yearRange.map(y => {
          const full = isYearFull(y);
          const partial = !full && isYearPartial(y);
          return (
            <div key={y} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleYear(y)}>
                <div style={{ width: 16, height: 16, border: `2px solid ${full || partial ? 'var(--rb-primary)' : '#cbd5e1'}`,
                  borderRadius: 3, background: full ? 'var(--rb-primary)' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {full    && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                  {partial && <span style={{ color: 'var(--rb-primary)', fontSize: 12, lineHeight: 1 }}>—</span>}
                </div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{y}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, paddingLeft: 24 }}>
                {MONTHS_RU.map(m => {
                  const sel = selectedPeriods.has(`${y}_${m.num}`);
                  return (
                    <button key={m.num} onClick={() => togglePeriod(y, m.num)}
                      style={{ padding: '4px 4px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                        border: `1px solid ${sel ? 'var(--rb-primary)' : 'var(--rb-border)'}`,
                        background: sel ? 'var(--rb-primary)' : '#fff',
                        color: sel ? '#fff' : 'var(--rb-text)', fontWeight: sel ? 600 : 400 }}>
                      {m.label.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--rb-border)', paddingTop: 10 }}>
          <button onClick={() => {
            const cy = new Date().getFullYear();
            const next = new Set(); MONTHS_RU.forEach(m => next.add(`${cy}_${m.num}`)); onChange(next);
          }} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--rb-border)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            Текущий год
          </button>
          <button onClick={onClose}
            style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            Применить
          </button>
        </div>
      </div>
    </>
  );
}

// ── Type filter panel ──────────────────────────────────────────────────────
function TypeFilterPanel({ utilCats, selectedTypeKeys, onChange, onClose }) {
  const allTypeKeys = useMemo(() => utilCats.flatMap(c => getAllTypesFlat(c).map(t => t.key)), [utilCats]);
  const isAll     = selectedTypeKeys === null;
  const isTypeSel = k => isAll || selectedTypeKeys.has(k);
  const isCatFull = cat => getAllTypesFlat(cat).every(t => isTypeSel(t.key));
  const isCatPart = cat => !isCatFull(cat) && getAllTypesFlat(cat).some(t => isTypeSel(t.key));
  const isScFull  = sc => (sc.types || []).every(t => isTypeSel(t.key));
  const isScPart  = sc => !isScFull(sc) && (sc.types || []).some(t => isTypeSel(t.key));

  const applySet = next => {
    if (next.size === 0 || next.size === allTypeKeys.length) onChange(null);
    else onChange(next);
  };

  const toggleType = typeKey => {
    if (isAll) { applySet(new Set(allTypeKeys.filter(k => k !== typeKey))); return; }
    const next = new Set(selectedTypeKeys);
    if (next.has(typeKey)) next.delete(typeKey); else next.add(typeKey);
    applySet(next);
  };

  const toggleGroup = keys => {
    const allSel = keys.every(k => isTypeSel(k));
    let next;
    if (isAll) { next = allSel ? new Set(allTypeKeys.filter(k => !keys.includes(k))) : null; }
    else { next = new Set(selectedTypeKeys); if (allSel) keys.forEach(k => next.delete(k)); else keys.forEach(k => next.add(k)); }
    if (next !== null) applySet(next);
  };

  // Unified checkbox component — same bold style for all levels
  const Chk = ({ checked, partial, label, onClick, indent = 0 }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 0', paddingLeft: indent, userSelect: 'none' }}
      onClick={onClick}>
      <div style={{ width: 16, height: 16, border: `2px solid ${checked || partial ? 'var(--rb-primary)' : '#cbd5e1'}`,
        borderRadius: 3, background: checked ? 'var(--rb-primary)' : '#fff', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
        {partial && <span style={{ color: 'var(--rb-primary)', fontSize: 12, fontWeight: 700 }}>—</span>}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--rb-text)' }}>{label}</span>
    </div>
  );
  const TypeChk = ({ typeKey, label, indent }) => {
    const sel = isTypeSel(typeKey);
    return <Chk checked={sel} partial={false} label={label} indent={indent} onClick={() => toggleType(typeKey)} />;
  };
  const CatChk = ({ full, part, label, onClick }) => (
    <Chk checked={full} partial={part} label={label} indent={0} onClick={onClick} />
  );
  const SubcatChk = ({ full, part, label, onClick }) => (
    <Chk checked={full} partial={part} label={label} indent={0} onClick={onClick} />
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 501, padding: 16, minWidth: 300, maxHeight: '84vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Виды услуг</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--rb-text-secondary)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 0 8px', borderBottom: '1px solid var(--rb-border)', marginBottom: 8 }}
          onClick={() => onChange(null)}>
          <div style={{ width: 16, height: 16, border: `2px solid ${isAll ? 'var(--rb-primary)' : '#cbd5e1'}`,
            borderRadius: 3, background: isAll ? 'var(--rb-primary)' : '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isAll && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Все категории</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {utilCats.map(cat => {
            const flatTypes = getAllTypesFlat(cat);
            const catKeys   = flatTypes.map(t => t.key);
            const full = isCatFull(cat), part = isCatPart(cat);
            return (
              <div key={cat.key} style={{ paddingBottom: 4, borderBottom: '1px solid #f1f5f9', marginBottom: 2 }}>
                <CatChk full={full} part={part} label={cat.label} onClick={() => toggleGroup(catKeys)} />
                {cat.subcats?.length ? (
                  // 3-level: category → subcategory → types
                  <div style={{ paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    {cat.subcats.map(sc => {
                      const scKeys = (sc.types || []).map(t => t.key);
                      const scFull = isScFull(sc), scPart = isScPart(sc);
                      return (
                        <div key={sc.key}>
                          <SubcatChk full={scFull} part={scPart} label={sc.label} onClick={() => toggleGroup(scKeys)} />
                          <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 1, marginTop: 1 }}>
                            {(sc.types || []).map(type => (
                              <TypeChk key={type.key} typeKey={type.key} label={type.label} indent={0} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : flatTypes.length > 1 && (
                  // 2-level: category → types (flat)
                  <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }}>
                    {flatTypes.map(type => (
                      <TypeChk key={type.key} typeKey={type.key} label={type.label} indent={0} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, borderTop: '1px solid var(--rb-border)', paddingTop: 10 }}>
          <button onClick={onClose}
            style={{ fontSize: 12, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            Применить
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// КОММУНАЛЬНЫЕ РАСХОДЫ
// ══════════════════════════════════════════════════════════════════════════════
function TabUtilities() {
  const thisYear = new Date().getFullYear();

  // selectedPeriods: Set of "YYYY_M" strings (multi-year month selection)
  const [selectedPeriods, setSelectedPeriods] = useState(() => {
    const s = new Set(); MONTHS_RU.forEach(m => s.add(`${thisYear}_${m.num}`)); return s;
  });
  // null = all types selected; Set<string> = explicit set of type keys
  const [selectedTypeKeys, setSelectedTypeKeys] = useState(null);
  const [showMonthPanel,  setShowMonthPanel]  = useState(false);
  const [showTypePanel,   setShowTypePanel]   = useState(false);

  const [rawData, setRawData]               = useState({});
  const [loading, setLoading]               = useState(true);
  const [clinics, setClinics]               = useState([]);
  const [expandedCats,    setExpandedCats]    = useState(new Set());
  const [expandedSubcats, setExpandedSubcats] = useState(new Set());
  const [expandedGroups,  setExpandedGroups]  = useState(new Set());
  const [utilCats, setUtilCats]             = useState(UTILITY_CATEGORIES);
  const [colGroups, setColGroups]                 = useState([]);
  const [standaloneOrder, setStandaloneOrder]     = useState([]);
  const [showSettings, setShowSettings]           = useState(false);
  const [hiddenGroups, setHiddenGroups]           = useState(new Set());
  const [showColFilter, setShowColFilter]         = useState(false);
  const saveTimers = useRef({});

  useEffect(() => {
    Promise.all([
      mis.getClinicsFromMIS().catch(() => ({ data: { data: [] } })),
      directories.getAll('utility').catch(() => ({ data: {} })),
      directories.getAll('utility_cfg').catch(() => ({ data: {} })),
    ]).then(([misRes, dirRes, cfgRes]) => {
      setClinics(Array.isArray(misRes.data?.data) ? misRes.data.data : []);
      setRawData(dirRes.data || {});
      const savedCats = cfgRes.data?.categories?.cats;
      if (Array.isArray(savedCats) && savedCats.length > 0) setUtilCats(savedCats);
      const savedGrps = cfgRes.data?.col_groups?.groups;
      if (Array.isArray(savedGrps)) setColGroups(savedGrps);
      const savedSO = cfgRes.data?.col_groups?.standaloneOrder;
      if (Array.isArray(savedSO)) setStandaloneOrder(savedSO);
    }).finally(() => setLoading(false));
  }, []);

  const saveCell = useCallback((key, patch) => {
    clearTimeout(saveTimers.current[key]);
    setRawData(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
    saveTimers.current[key] = setTimeout(async () => {
      try {
        await directories.save('utility', encodeURIComponent(key), patch);
        toast.success('Сохранено', { duration: 1500 });
      } catch {
        toast.error('Ошибка сохранения');
      }
    }, 800);
  }, []);

  const saveUtilCats = useCallback(async (cats) => {
    setUtilCats(cats);
    try {
      await directories.save('utility_cfg', 'categories', { cats });
      toast.success('Настройки категорий сохранены', { duration: 1500 });
    } catch {
      toast.error('Ошибка сохранения');
    }
  }, []);

  const saveColGroups = useCallback(async (groups, soOrder) => {
    setColGroups(groups);
    if (soOrder !== undefined) setStandaloneOrder(soOrder);
    try {
      await directories.save('utility_cfg', 'col_groups', { groups, standaloneOrder: soOrder ?? standaloneOrder });
      toast.success('Настройки столбцов сохранены', { duration: 1500 });
    } catch {
      toast.error('Ошибка сохранения');
    }
  }, [standaloneOrder]);

  // Sorted array of { year, monthNum } from selectedPeriods
  const filteredPeriods = useMemo(() =>
    [...selectedPeriods]
      .map(p => { const i = p.indexOf('_'); return { year: +p.slice(0, i), monthNum: +p.slice(i + 1) }; })
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.monthNum - b.monthNum),
  [selectedPeriods]);

  const allUtilTypes = useMemo(
    () => utilCats.flatMap(c => getAllTypesFlat(c).map(t => ({ ...t, catKey: c.key, catLabel: c.label }))),
    [utilCats]
  );

  const filteredTypes = useMemo(
    () => selectedTypeKeys === null ? allUtilTypes : allUtilTypes.filter(t => selectedTypeKeys.has(t.key)),
    [selectedTypeKeys, allUtilTypes]
  );

  // Group filtered types by category, preserving utilCats order; includes subcats for 3-level
  const catGroups = useMemo(() => {
    const groups = [];
    for (const cat of utilCats) {
      const flatTypes = getAllTypesFlat(cat);
      const types = filteredTypes.filter(t => flatTypes.some(ft => ft.key === t.key));
      if (types.length === 0) continue;
      if (cat.subcats?.length) {
        const subcats = cat.subcats
          .map(sc => ({ ...sc, visTypes: (sc.types||[]).filter(t => filteredTypes.some(ft => ft.key === t.key)) }))
          .filter(sc => sc.visTypes.length > 0);
        groups.push({ cat, types, subcats });
      } else {
        groups.push({ cat, types, subcats: null });
      }
    }
    return groups;
  }, [filteredTypes, utilCats]);

  const toggleCat = useCallback((catKey) => {
    setExpandedCats(prev => { const next=new Set(prev); if(next.has(catKey))next.delete(catKey);else next.add(catKey); return next; });
  }, []);

  const toggleSubcat = useCallback((scKey) => {
    setExpandedSubcats(prev => { const next=new Set(prev); if(next.has(scKey))next.delete(scKey);else next.add(scKey); return next; });
  }, []);

  // Direct sum overrides auto-calculated qty×price
  const getSum = useCallback((key) => {
    const c = rawData[key];
    if (!c) return 0;
    if (c.sum !== undefined && c.sum !== '') return parseNum(c.sum);
    const qty   = parseNum(c.qty);
    const price = parseNum(c.price);
    return qty > 0 ? qty * price : price;
  }, [rawData]);

  // Build rendered column groups: configured groups first, then ungrouped clinics in user-defined order
  const renderedGroups = useMemo(() => {
    const assignedIds = new Set(colGroups.flatMap(g => g.items.filter(i => i.kind === 'clinic').map(i => i.id)));
    const ungroupedAll = clinics.filter(c => !assignedIds.has(String(c.id)));
    const ordered = [
      ...standaloneOrder.map(id => ungroupedAll.find(c => String(c.id) === id)).filter(Boolean),
      ...ungroupedAll.filter(c => !standaloneOrder.includes(String(c.id))),
    ];
    const ungrouped = ordered.map(c => ({ key: `auto_${c.id}`, label: c.title || c.name, color: c.color, items: [{ kind: 'clinic', id: String(c.id) }] }));
    return [...colGroups, ...ungrouped];
  }, [colGroups, clinics, standaloneOrder]);

  // Groups visible in the table (user can hide without deleting)
  const visibleGroups = useMemo(
    () => renderedGroups.filter(g => !hiddenGroups.has(g.key)),
    [renderedGroups, hiddenGroups]
  );

  const toggleGroup = useCallback((key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const getItemSum = useCallback((item, pYear, monthNum, typeKey) =>
    getSum(`${pYear}_${monthNum}_${typeKey}_${item.id}`),
  [getSum]);

  const getGrpSum = useCallback((grp, pYear, monthNum, typeKey) =>
    grp.items.reduce((s, item) => s + getItemSum(item, pYear, monthNum, typeKey), 0),
  [getItemSum]);

  const grpTotals = useMemo(() => {
    const t = {};
    for (const grp of renderedGroups) {
      t[grp.key] = filteredPeriods.reduce((ps, { year: pYear, monthNum }) =>
        ps + filteredTypes.reduce((ts, type) => ts + getGrpSum(grp, pYear, monthNum, type.key), 0), 0);
    }
    return t;
  }, [renderedGroups, filteredPeriods, filteredTypes, getGrpSum]);

  const grandTotal = useMemo(() => Object.values(grpTotals).reduce((a, b) => a + b, 0), [grpTotals]);

  // numCols: 2 (period+service) + per group cols + 1 (total)
  const numCols = useMemo(() => {
    let cols = 2;
    for (const grp of visibleGroups) {
      if (grp.items.length === 1) cols += 3;
      else if (expandedGroups.has(grp.key)) cols += 1 + grp.items.length * 3;
      else cols += 1;
    }
    return cols + 1;
  }, [visibleGroups, expandedGroups]);
  const cellInpSt = { ...inlineInputStyle, width: 80, textAlign: 'right', padding: '3px 6px' };

  // ── Export ───────────────────────────────────────────────────────────────
  // Leaf-column list (no headers — headers built per-exporter with merges/rowspan)
  const buildExportCols = useCallback(() => {
    const cols = [{ kind: 'service' }];
    for (const grp of visibleGroups) {
      const isExpanded = expandedGroups.has(grp.key);
      if (grp.items.length === 1) {
        cols.push({ kind: 'qty',      grpKey: grp.key, itemId: grp.items[0].id });
        cols.push({ kind: 'price',    grpKey: grp.key, itemId: grp.items[0].id });
        cols.push({ kind: 'item_sum', grpKey: grp.key, itemId: grp.items[0].id });
      } else if (!isExpanded) {
        cols.push({ kind: 'grp_sum', grpKey: grp.key });
      } else {
        grp.items.forEach(item => {
          cols.push({ kind: 'qty',      grpKey: grp.key, itemId: item.id });
          cols.push({ kind: 'price',    grpKey: grp.key, itemId: item.id });
          cols.push({ kind: 'item_sum', grpKey: grp.key, itemId: item.id });
        });
        cols.push({ kind: 'grp_sum', grpKey: grp.key }); // Итого — в конце группы
      }
    }
    cols.push({ kind: 'total' });
    return cols;
  }, [visibleGroups, expandedGroups]);

  const buildExportRows = useCallback((cols) => {
    const rows = [];
    const outlineLevels = [];

    const getCellVal = (col, pYear, monthNum, typeKey, isAggr, aggrTypes) => {
      const dKey = (id) => `${pYear}_${monthNum}_${typeKey}_${id}`;
      if (col.kind === 'total') {
        if (isAggr) return aggrTypes.reduce((s, t) =>
          s + visibleGroups.reduce((gs, g) => gs + g.items.reduce((is, it) => is + getSum(`${pYear}_${monthNum}_${t.key}_${it.id}`), 0), 0), 0) || '';
        return visibleGroups.reduce((gs, g) => gs + g.items.reduce((is, it) => is + getSum(dKey(it.id)), 0), 0) || '';
      }
      if (col.kind === 'grp_sum') {
        const grp = visibleGroups.find(g => g.key === col.grpKey);
        if (!grp) return '';
        if (isAggr) return aggrTypes.reduce((s, t) => s + grp.items.reduce((is, it) => is + getSum(`${pYear}_${monthNum}_${t.key}_${it.id}`), 0), 0) || '';
        return grp.items.reduce((s, it) => s + getSum(dKey(it.id)), 0) || '';
      }
      if (isAggr) return '';
      const grp = visibleGroups.find(g => g.key === col.grpKey);
      const item = grp?.items.find(it => it.id === col.itemId);
      if (!item) return '';
      const c = rawData[dKey(item.id)] || {};
      if (col.kind === 'qty')      return parseNum(c.qty)   || '';
      if (col.kind === 'price')    return parseNum(c.price) || '';
      if (col.kind === 'item_sum') return getSum(dKey(item.id)) || '';
      return '';
    };

    const makeRow = (label, typeKey, isAggr, aggrTypes, pYear, monthNum) =>
      [label, ...cols.slice(1).map(col => getCellVal(col, pYear, monthNum, typeKey, isAggr, aggrTypes))];

    for (const { year: pYear, monthNum } of filteredPeriods) {
      const m = MONTHS_RU.find(x => x.num === monthNum);
      const pLabel = `${m?.label ?? monthNum} ${pYear}`;
      if (filteredPeriods.length > 1) {
        rows.push([pLabel, ...new Array(cols.length - 1).fill('')]);
        outlineLevels.push(0);
      }
      for (const { cat, types, subcats } of catGroups) {
        const allTypes = subcats?.length ? subcats.flatMap(sc => sc.visTypes) : types;
        if (allTypes.length > 1) {
          rows.push(makeRow(cat.label, null, true, allTypes, pYear, monthNum));
          outlineLevels.push(1);
        }
        if (subcats?.length) {
          for (const subcat of subcats) {
            if (!subcat.visTypes.length) continue;
            if (subcat.visTypes.length > 1) {
              rows.push(makeRow(`  ${subcat.label}`, null, true, subcat.visTypes, pYear, monthNum));
              outlineLevels.push(2);
            }
            for (const type of subcat.visTypes) {
              const unit   = allUtilTypes.find(t => t.key === type.key)?.unit;
              const indent = subcat.visTypes.length > 1 ? '    ' : '  ';
              rows.push(makeRow(`${indent}${type.label}${unit ? ` (${unit})` : ''}`, type.key, false, null, pYear, monthNum));
              outlineLevels.push(3);
            }
          }
        } else {
          for (const type of types) {
            const unit   = allUtilTypes.find(t => t.key === type.key)?.unit;
            const indent = allTypes.length > 1 ? '  ' : '';
            rows.push(makeRow(`${indent}${type.label}${unit ? ` (${unit})` : ''}`, type.key, false, null, pYear, monthNum));
            outlineLevels.push(allTypes.length > 1 ? 2 : 1);
          }
        }
      }
    }
    rows.push(['Итого за период', ...cols.slice(1).map(col => {
      if (col.kind === 'total')   return grandTotal            || '';
      if (col.kind === 'grp_sum') return grpTotals[col.grpKey] || '';
      return '';
    })]);
    outlineLevels.push(0);
    return { rows, outlineLevels };
  }, [filteredPeriods, catGroups, visibleGroups, getSum, rawData, grpTotals, grandTotal, allUtilTypes]);

  const exportToXLSX = useCallback(() => {
    const cols = buildExportCols();
    const { rows, outlineLevels } = buildExportRows(cols);

    // 3-row header: row0=group names, row1=item names, row2=Кол-во/Цена/Сумма
    const h1 = new Array(cols.length).fill('');
    const h2 = new Array(cols.length).fill('');
    const h3 = new Array(cols.length).fill('');
    const merges = [];

    h1[0] = 'Вид услуги';
    merges.push({ s: { r: 0, c: 0 }, e: { r: 2, c: 0 } });

    let ci = 1;
    for (const grp of visibleGroups) {
      const isExpanded = expandedGroups.has(grp.key);
      if (grp.items.length === 1) {
        h1[ci] = grp.label;
        merges.push({ s: { r: 0, c: ci }, e: { r: 1, c: ci + 2 } }); // группа spans rows 0-1
        h3[ci] = 'Кол-во'; h3[ci + 1] = 'Цена'; h3[ci + 2] = 'Сумма';
        ci += 3;
      } else if (!isExpanded) {
        h1[ci] = grp.label;
        merges.push({ s: { r: 0, c: ci }, e: { r: 2, c: ci } }); // spans все 3 строки
        ci += 1;
      } else {
        const grpSpan = grp.items.length * 3 + 1;
        h1[ci] = grp.label;
        merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + grpSpan - 1 } }); // row0: имя группы
        let ic = ci;
        for (const item of grp.items) {
          const lbl = item.kind === 'clinic'
            ? (clinics.find(c => String(c.id) === item.id)?.title || item.id)
            : (item.label || item.id);
          h2[ic] = lbl;
          merges.push({ s: { r: 1, c: ic }, e: { r: 1, c: ic + 2 } }); // имя помещения spans 3 cols
          h3[ic] = 'Кол-во'; h3[ic + 1] = 'Цена'; h3[ic + 2] = 'Сумма';
          ic += 3;
        }
        h2[ic] = 'Итого';
        merges.push({ s: { r: 1, c: ic }, e: { r: 2, c: ic } }); // Итого spans rows 1-2
        ci += grpSpan;
      }
    }
    const lastC = cols.length - 1;
    h1[lastC] = 'Итого';
    merges.push({ s: { r: 0, c: lastC }, e: { r: 2, c: lastC } });

    const allRows = [h1, h2, h3, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(allRows);
    ws['!merges'] = merges;
    ws['!cols'] = cols.map((col, i) => ({
      wch: i === 0 ? 34 : col.kind === 'qty' || col.kind === 'price' ? 10 : col.kind === 'item_sum' ? 12 : 14,
    }));
    if (!ws['!views']) ws['!views'] = [];
    ws['!views'][0] = { state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', activeCell: 'A4', sqref: 'A4' };
    ws['!rows'] = [{ hpt: 22 }, { hpt: 18 }, { hpt: 15 }, ...outlineLevels.map(l => ({ level: l }))];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Коммунальные');
    XLSX.writeFile(wb, `коммунальные_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [buildExportCols, buildExportRows, visibleGroups, expandedGroups, clinics]);

  const exportToPDF = useCallback(() => {
    const cols = buildExportCols();
    const { rows, outlineLevels } = buildExportRows(cols);
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtN = v => typeof v === 'number' && v !== 0
      ? v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : (v || '');

    // Row 1: group names
    let hdr = '<tr><th rowspan="3" style="text-align:left;min-width:130px">Вид услуги</th>';
    for (const grp of visibleGroups) {
      const isExpanded = expandedGroups.has(grp.key);
      if (grp.items.length === 1)
        hdr += `<th colspan="3" rowspan="2">${esc(grp.label)}</th>`;
      else if (!isExpanded)
        hdr += `<th rowspan="3">${esc(grp.label)}</th>`;
      else
        hdr += `<th colspan="${grp.items.length * 3 + 1}">${esc(grp.label)}</th>`;
    }
    hdr += '<th rowspan="3">Итого</th></tr>';

    // Row 2: item names for expanded multi-item groups
    hdr += '<tr>';
    for (const grp of visibleGroups) {
      if (!expandedGroups.has(grp.key) || grp.items.length === 1) continue;
      for (const item of grp.items) {
        const lbl = item.kind === 'clinic'
          ? (clinics.find(c => String(c.id) === item.id)?.title || item.id)
          : (item.label || item.id);
        hdr += `<th colspan="3">${esc(lbl)}</th>`;
      }
      hdr += '<th rowspan="2">Итого</th>';
    }
    hdr += '</tr>';

    // Row 3: Кол-во / Цена / Сумма
    hdr += '<tr>';
    for (const grp of visibleGroups) {
      const isExpanded = expandedGroups.has(grp.key);
      if (grp.items.length > 1 && !isExpanded) continue; // collapsed: rowspan=3 already set
      const n = isExpanded ? grp.items.length : 1;
      for (let i = 0; i < n; i++) hdr += '<th>Кол-во</th><th>Цена</th><th>Сумма</th>';
      // Итого for expanded already has rowspan=2 from row 2 — skip
    }
    hdr += '</tr>';

    let body = '';
    rows.forEach((row, ri) => {
      const isTotal = ri === rows.length - 1;
      const lvl = outlineLevels[ri] ?? 1;
      const cls = isTotal ? 'tot' : lvl === 0 ? 'per' : lvl === 1 ? 'cat' : lvl === 2 ? 'sub' : 'typ';
      body += `<tr class="${cls}">`;
      row.forEach((cell, ci) => {
        const isNum = ci > 0 && cell !== '' && cell !== undefined && cell !== null;
        body += `<td${isNum && cell ? ' class="num"' : ''}>${isNum ? fmtN(cell) : esc(String(cell ?? ''))}</td>`;
      });
      body += '</tr>';
    });

    const css = 'body{font-family:Arial,sans-serif;font-size:9px;margin:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;white-space:nowrap}th{background:#d4e6f5;font-weight:700;text-align:center}tr.per td{background:#e6ecf5;font-weight:700;font-size:10px}tr.cat td{background:#edf2fb;font-weight:700}tr.sub td{background:#f4f8fd;font-weight:600}tr.typ td{background:#fff}tr.tot td{background:#ddf0e4;font-weight:700}td.num{text-align:right}@media print{@page{margin:6mm;size:landscape}}';
    const html = `<html><head><meta charset="utf-8"><title>Коммунальные</title><style>${css}</style></head><body><h3 style="margin:0 0 6px;font-size:12px">Коммунальные расходы</h3><table><thead>${hdr}</thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('', '_blank', 'width=1200,height=700');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }, [buildExportCols, buildExportRows, visibleGroups, expandedGroups, clinics]);

  if (loading) return <Spinner text="Загрузка коммунальных расходов…" />;

  if (!clinics.length) return (
    <div className="rb-placeholder">
      <div style={{ fontWeight: 600, fontSize: 15 }}>Нет данных о клиниках</div>
      <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginTop: 4 }}>Проверьте подключение к МИС</div>
    </div>
  );

  const thFilterSt = {
    background: '#f8fafc', padding: '7px 10px', textAlign: 'left', fontWeight: 600,
    fontSize: 12, border: '1px solid var(--rb-border)', whiteSpace: 'nowrap', verticalAlign: 'top',
  };

  const renderItemCells = (item, pYear, monthNum, typeKey) => {
    const dataKey  = `${pYear}_${monthNum}_${typeKey}_${item.id}`;
    const cell     = rawData[dataKey] || {};
    const autoSum  = (() => { const q = parseNum(cell.qty); const p = parseNum(cell.price); return q > 0 ? q * p : p; })();
    const typeUnit = allUtilTypes.find(t => t.key === typeKey)?.unit || '';
    return [
      <td key={`${dataKey}_q`} style={{ padding: '3px 6px' }}>
        <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
          <input type="number" min="0" step="any" value={cell.qty ?? ''} placeholder="0"
            onChange={e => saveCell(dataKey, { qty: e.target.value })}
            style={{ ...cellInpSt, paddingRight: typeUnit ? `${Math.max(typeUnit.length * 6 + 8, 28)}px` : cellInpSt.paddingRight }} />
          {typeUnit && (
            <span style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
              fontSize: 10, color: '#94a3b8', pointerEvents: 'none', userSelect: 'none', lineHeight: 1, whiteSpace: 'nowrap' }}>
              {typeUnit}
            </span>
          )}
        </div>
      </td>,
      <td key={`${dataKey}_p`} style={{ padding: '3px 6px' }}>
        <input type="number" min="0" step="any" value={cell.price ?? ''} placeholder="0"
          onChange={e => saveCell(dataKey, { price: e.target.value })} style={cellInpSt} />
      </td>,
      <td key={`${dataKey}_s`} style={{ padding: '3px 6px' }}>
        <input type="number" min="0" step="any" value={cell.sum ?? ''}
          placeholder={autoSum > 0 ? String(+autoSum.toFixed(2)) : '0'}
          onChange={e => saveCell(dataKey, { sum: e.target.value })}
          style={{ ...cellInpSt, background: cell.sum ? '#f0f9ff' : undefined }} />
      </td>,
    ];
  };

  const renderGroupCells = (pYear, monthNum, typeKey, isCatSummary, catTypes) => {
    return visibleGroups.flatMap(grp => {
      const isExpanded = expandedGroups.has(grp.key);
      const isSingle   = grp.items.length === 1;

      if (isSingle && !isCatSummary) {
        return renderItemCells(grp.items[0], pYear, monthNum, typeKey);
      }

      if (isSingle && isCatSummary) {
        const total = (catTypes || []).reduce((s, t) => s + getGrpSum(grp, pYear, monthNum, t.key), 0);
        return [
          <td key={`cgs_${grp.key}_q`} style={{ border: '1px solid var(--rb-border)' }} />,
          <td key={`cgs_${grp.key}_p`} style={{ border: '1px solid var(--rb-border)' }} />,
          <td key={`cgs_${grp.key}_s`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', border: '1px solid var(--rb-border)', background: total > 0 ? '#f0fdf4' : undefined }}>
            {total > 0 ? fmtRubP(total) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
          </td>,
        ];
      }

      // multi-item group
      const grpTotal = isCatSummary
        ? (catTypes || []).reduce((s, t) => s + getGrpSum(grp, pYear, monthNum, t.key), 0)
        : getGrpSum(grp, pYear, monthNum, typeKey);

      const totalCell = (
        <td key={`cgm_${grp.key}_tot`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', border: '1px solid var(--rb-border)', fontWeight: grpTotal > 0 ? 600 : 400, background: grpTotal > 0 ? '#f0fdf4' : undefined }}>
          {grpTotal > 0 ? fmtRubP(grpTotal) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
        </td>
      );

      if (!isExpanded || isCatSummary) return [totalCell];

      return [
        ...grp.items.flatMap(item => renderItemCells(item, pYear, monthNum, typeKey)),
        totalCell,
      ];
    });
  };

  const renderTypeRow = (type, pYear, monthNum, isSubRow) => {
    const rowTotal = visibleGroups.reduce((s, grp) => s + getGrpSum(grp, pYear, monthNum, type.key), 0);
    return (
      <tr key={`${pYear}_${monthNum}_${type.key}`} style={isSubRow ? { background: '#fafcff' } : undefined}>
        <td style={{ borderLeft: isSubRow ? '3px solid #bfdbfe' : undefined }} />
        <td style={{ fontSize: 12, paddingLeft: isSubRow ? 20 : 12, whiteSpace: 'nowrap', borderLeft: isSubRow ? '3px solid #bfdbfe' : undefined }}>
          {type.label}
        </td>
        {renderGroupCells(pYear, monthNum, type.key, false, null)}
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', fontWeight: rowTotal > 0 ? 600 : 400 }}>
          {rowTotal > 0 ? fmtRubP(rowTotal) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
        </td>
      </tr>
    );
  };

  return (
    <div>
      {/* Toolbar: export buttons + period total */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {grandTotal > 0 && (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--rb-primary)', fontVariantNumeric: 'tabular-nums', marginRight: 4 }}>
            За период: {fmtRubP(grandTotal)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginRight: 2, userSelect: 'none' }}>Экспорт</span>
          <button onClick={exportToXLSX}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7,
                     cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                     border: 'none', background: '#16a34a', color: '#fff',
                     boxShadow: '0 1px 3px rgba(22,163,74,0.4)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>
              <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
            </svg>
            XLSX
          </button>
          <button onClick={exportToPDF}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7,
                     cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                     border: 'none', background: '#dc2626', color: '#fff',
                     boxShadow: '0 1px 3px rgba(220,38,38,0.4)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>
              <line x1="9" y1="9" x2="15" y2="9"/>
            </svg>
            PDF
          </button>
        </div>
      </div>

      {showSettings && (
        <UtilitySettingsModal
          utilCats={utilCats} colGroups={colGroups} clinics={clinics}
          onSaveCats={saveUtilCats} onSaveCols={saveColGroups}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showMonthPanel && (
        <MonthFilterPanel selectedPeriods={selectedPeriods} onChange={setSelectedPeriods} onClose={() => setShowMonthPanel(false)} />
      )}
      {showTypePanel && (
        <TypeFilterPanel utilCats={utilCats} selectedTypeKeys={selectedTypeKeys} onChange={setSelectedTypeKeys} onClose={() => setShowTypePanel(false)} />
      )}
      {showColFilter && (
        <ColumnFilterPanel groups={renderedGroups} hiddenGroups={hiddenGroups} onChange={setHiddenGroups} onClose={() => setShowColFilter(false)} />
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="rb-table" style={{ minWidth: 300 + visibleGroups.reduce((s, g) => s + (g.items.length === 1 ? 260 : expandedGroups.has(g.key) ? 80 + g.items.length * 260 : 120), 0) }}>
          <thead>
            {/* Row 1: Период / Вид услуги (rowSpan=3) + group name headers + Итого (rowSpan=3) */}
            <tr>
              <th rowSpan={3} style={{ ...thFilterSt, verticalAlign: 'top', minWidth: 120 }}>
                <div>Период</div>
                <button onClick={() => setShowMonthPanel(true)}
                  style={{ marginTop: 4, padding: '3px 6px', border: '1px solid var(--rb-border)', borderRadius: 5,
                    fontSize: 11, fontFamily: 'inherit', background: '#fff', cursor: 'pointer', width: '100%',
                    textAlign: 'left', color: selectedPeriods.size > 0 ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', display: 'block' }}>
                  {selectedPeriods.size} мес. ▾
                </button>
              </th>
              <th rowSpan={3} style={{ ...thFilterSt, verticalAlign: 'top', minWidth: 140 }}>
                <div>Вид услуги</div>
                <button onClick={() => setShowTypePanel(true)}
                  style={{ marginTop: 4, padding: '3px 6px', border: '1px solid var(--rb-border)', borderRadius: 5,
                    fontSize: 11, fontFamily: 'inherit', background: '#fff', cursor: 'pointer', width: '100%',
                    textAlign: 'left', color: selectedTypeKeys !== null ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', display: 'block' }}>
                  {selectedTypeKeys === null ? 'Все' : `${selectedTypeKeys.size} выбрано`} ▾
                </button>
              </th>
              {visibleGroups.map(grp => {
                const isSingle   = grp.items.length === 1;
                const isExpanded = expandedGroups.has(grp.key);
                const colSpan    = isSingle ? 3 : isExpanded ? 1 + grp.items.length * 3 : 1;
                const canExpand  = !isSingle;
                return (
                  <th key={grp.key} colSpan={colSpan} rowSpan={isSingle ? 3 : 1}
                    onClick={canExpand ? () => toggleGroup(grp.key) : undefined}
                    style={{ background: '#f0f7ff', padding: '8px 12px', textAlign: 'center', fontWeight: 700,
                      fontSize: 12, border: '1px solid var(--rb-border)',
                      borderLeft: `3px solid ${grp.color || '#94a3b8'}`,
                      whiteSpace: 'nowrap', cursor: canExpand ? 'pointer' : 'default',
                      userSelect: 'none', verticalAlign: 'middle' }}>
                    {canExpand && <span style={{ marginRight: 4, fontSize: 10, color: 'var(--rb-primary)' }}>{isExpanded ? '▼' : '▶'}</span>}
                    {grp.label}
                  </th>
                );
              })}
              <th rowSpan={3} style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                  <span>Итого</span>
                  {/* Column visibility toggle */}
                  <button onClick={() => setShowColFilter(true)}
                    title={hiddenGroups.size > 0 ? `Скрыто ${hiddenGroups.size} стол.` : 'Видимость столбцов'}
                    style={{ width: 22, height: 22, border: `1px solid ${hiddenGroups.size > 0 ? 'var(--rb-primary)' : 'var(--rb-border)'}`, borderRadius: 5,
                      background: hiddenGroups.size > 0 ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 11, lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: hiddenGroups.size > 0 ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', padding: 0, flexShrink: 0 }}>
                    ⊞
                  </button>
                  {/* Settings gear */}
                  <button onClick={() => setShowSettings(true)} title="Настройки таблицы"
                    style={{ width: 22, height: 22, border: '1px solid var(--rb-border)', borderRadius: 5,
                      background: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--rb-text-secondary)', padding: 0, flexShrink: 0 }}>
                    ⚙
                  </button>
                </div>
              </th>
            </tr>
            {/* Row 2: item labels for expanded multi-item groups */}
            <tr>
              {visibleGroups.flatMap(grp => {
                if (grp.items.length === 1) return [];
                const isExpanded = expandedGroups.has(grp.key);
                if (!isExpanded) return [<th key={`r2_${grp.key}_tot`} style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '4px 8px', fontSize: 11, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Итого ₽</th>];
                return [
                  ...grp.items.map(item => (
                    <th key={`r2_${grp.key}_${item.id}`} colSpan={3}
                      style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '4px 8px', fontSize: 11, textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {item.kind === 'clinic'
                        ? (clinics.find(c => String(c.id) === item.id)?.title || clinics.find(c => String(c.id) === item.id)?.name || item.id)
                        : (item.label || item.id)}
                    </th>
                  )),
                  <th key={`r2_${grp.key}_tot`} style={{ background: '#f0f7ff', border: '1px solid var(--rb-border)', padding: '4px 8px', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>Итого ₽</th>,
                ];
              })}
            </tr>
            {/* Row 3: Кол-во / Цена / Сумма per leaf column for expanded multi-item groups */}
            <tr>
              {visibleGroups.flatMap(grp => {
                if (grp.items.length === 1) return [];
                const isExpanded = expandedGroups.has(grp.key);
                if (!isExpanded) return [];
                return [
                  ...grp.items.flatMap(item => [
                    <th key={`r3_${grp.key}_${item.id}_q`} style={{ background: '#f8fafc', padding: '5px 8px', fontSize: 11, border: '1px solid var(--rb-border)', textAlign: 'right', fontWeight: 600, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Кол-во</th>,
                    <th key={`r3_${grp.key}_${item.id}_p`} style={{ background: '#f8fafc', padding: '5px 8px', fontSize: 11, border: '1px solid var(--rb-border)', textAlign: 'right', fontWeight: 600, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Цена ₽</th>,
                    <th key={`r3_${grp.key}_${item.id}_s`} style={{ background: '#f8fafc', padding: '5px 8px', fontSize: 11, border: '1px solid var(--rb-border)', textAlign: 'right', fontWeight: 600, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Сумма ₽</th>,
                  ]),
                  <th key={`r3_${grp.key}_tot`} style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '4px 8px' }} />,
                ];
              })}
            </tr>
          </thead>
          <tbody>
            {filteredPeriods.length === 0 ? (
              <tr>
                <td colSpan={numCols} style={{ textAlign: 'center', padding: '30px', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                  Выберите хотя бы один период
                </td>
              </tr>
            ) : filteredPeriods.map(({ year: pYear, monthNum }) => {
              const month = MONTHS_RU.find(m => m.num === monthNum);
              const periodLabel = `${month.label} ${pYear}`;
              const monthTotal = filteredTypes.reduce((s, type) =>
                s + visibleGroups.reduce((gs, grp) => gs + getGrpSum(grp, pYear, monthNum, type.key), 0), 0);
              return (
                <React.Fragment key={`${pYear}_${monthNum}`}>
                  <tr>
                    <td colSpan={numCols} style={{ background: '#f1f5f9', fontWeight: 700, fontSize: 12, padding: '7px 14px', border: '1px solid var(--rb-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{periodLabel}</span>
                        {monthTotal > 0 && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rb-primary)' }}>{fmtRub(monthTotal)}</span>}
                      </div>
                    </td>
                  </tr>
                  {catGroups.map(({ cat, types, subcats }) => {
                    const isMulti    = types.length > 1;
                    const isExpanded = expandedCats.has(cat.key);
                    const catTotal   = visibleGroups.reduce((gs, grp) =>
                      gs + types.reduce((ts, type) => ts + getGrpSum(grp, pYear, monthNum, type.key), 0), 0);

                    if (!isMulti && !subcats?.length) return renderTypeRow(types[0], pYear, monthNum, false);

                    return (
                      <React.Fragment key={`${pYear}_${monthNum}_${cat.key}`}>
                        <tr onClick={() => toggleCat(cat.key)}
                          style={{ cursor: 'pointer', background: isExpanded ? '#f0f7ff' : undefined }}>
                          <td />
                          <td style={{ fontSize: 12, fontWeight: 600, paddingLeft: 10, whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 10, color: 'var(--rb-primary)', marginRight: 5, userSelect: 'none' }}>
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            {cat.label}
                          </td>
                          {renderGroupCells(pYear, monthNum, null, true, types)}
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', fontWeight: catTotal > 0 ? 700 : 400, border: '1px solid var(--rb-border)' }}>
                            {catTotal > 0 ? fmtRub(catTotal) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
                          </td>
                        </tr>
                        {isExpanded && (subcats?.length ? (
                          subcats.map(sc => {
                            const scKey = `${cat.key}_${sc.key}`;
                            const isScExp = expandedSubcats.has(scKey);
                            const scTotal = visibleGroups.reduce((gs,grp) =>
                              gs + sc.visTypes.reduce((ts,t)=>ts+getGrpSum(grp,pYear,monthNum,t.key),0), 0);
                            return (
                              <React.Fragment key={`${pYear}_${monthNum}_${scKey}`}>
                                <tr onClick={() => toggleSubcat(scKey)} style={{ cursor:'pointer', background: isScExp ? '#f5f9ff' : '#fafcff' }}>
                                  <td />
                                  <td style={{ fontSize:12,fontWeight:600,paddingLeft:24,whiteSpace:'nowrap',borderLeft:'3px solid #93c5fd' }}>
                                    <span style={{ fontSize:10,color:'#3b82f6',marginRight:4,userSelect:'none' }}>{isScExp?'▼':'▶'}</span>
                                    {sc.label}
                                  </td>
                                  {renderGroupCells(pYear,monthNum,null,true,sc.visTypes)}
                                  <td style={{ textAlign:'right',fontVariantNumeric:'tabular-nums',fontSize:12,padding:'4px 10px',fontWeight:scTotal>0?600:400,border:'1px solid var(--rb-border)' }}>
                                    {scTotal > 0 ? fmtRubP(scTotal) : <span style={{ color:'#cbd5e1' }}>{DASH}</span>}
                                  </td>
                                </tr>
                                {isScExp && sc.visTypes.map(type => renderTypeRow(type, pYear, monthNum, true))}
                              </React.Fragment>
                            );
                          })
                        ) : (
                          types.map(type => renderTypeRow(type, pYear, monthNum, true))
                        ))}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
            {/* Totals row */}
            <tr style={{ background: '#f8fafc' }}>
              <td colSpan={2} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, border: '1px solid var(--rb-border)' }}>
                Итого за период
              </td>
              {visibleGroups.flatMap(grp => {
                const isSingle   = grp.items.length === 1;
                const isExpanded = expandedGroups.has(grp.key);
                const tot = grpTotals[grp.key] || 0;
                const totCell = (
                  <td key={`tot_${grp.key}_s`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13, padding: '10px', border: '1px solid var(--rb-border)' }}>
                    {tot > 0 ? fmtRub(tot) : DASH}
                  </td>
                );
                if (isSingle) return [
                  <td key={`tot_${grp.key}_q`} style={{ border: '1px solid var(--rb-border)' }} />,
                  <td key={`tot_${grp.key}_p`} style={{ border: '1px solid var(--rb-border)' }} />,
                  totCell,
                ];
                if (!isExpanded) return [totCell];
                return [
                  ...grp.items.flatMap(item => {
                    const itemTot = filteredPeriods.reduce((ps, { year: pYear, monthNum }) =>
                      ps + filteredTypes.reduce((ts, type) => ts + getItemSum(item, pYear, monthNum, type.key), 0), 0);
                    return [
                      <td key={`tot_${grp.key}_${item.id}_q`} style={{ border: '1px solid var(--rb-border)' }} />,
                      <td key={`tot_${grp.key}_${item.id}_p`} style={{ border: '1px solid var(--rb-border)' }} />,
                      <td key={`tot_${grp.key}_${item.id}_s`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13, padding: '10px', border: '1px solid var(--rb-border)' }}>
                        {itemTot > 0 ? fmtRubP(itemTot) : DASH}
                      </td>,
                    ];
                  }),
                  totCell,
                ];
              })}
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14, padding: '10px', border: '1px solid var(--rb-border)', color: 'var(--rb-primary)' }}>
                {grandTotal > 0 ? fmtRubP(grandTotal) : DASH}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT ANALYTICS (shown in Аналитика/Кабинеты, read-only)
// ══════════════════════════════════════════════════════════════════════════════
export function TabEquipmentAnalytics({ periodStart, periodEnd }) {
  const [equipment,      setEquipment]      = useState({});
  const [bindings,       setBindings]       = useState({});
  const [clinicMeta,     setClinicMeta]     = useState({});
  const [consumableNorms,setConsumableNorms]= useState({});
  const [loading,        setLoading]        = useState(true);
  const [clinicFilter,   setClinicFilter]   = useState('');

  useEffect(() => {
    Promise.all([
      directories.getAll('equipment').catch(() => ({ data: {} })),
      directories.getAll('equipment_service_binding').catch(() => ({ data: {} })),
      directories.getAll('clinic').catch(() => ({ data: {} })),
      directories.getAll('consumable_norm').catch(() => ({ data: {} })),
    ]).then(([eqRes, bRes, clRes, cnRes]) => {
      setEquipment(eqRes.data || {});
      setBindings(bRes.data || {});
      setClinicMeta(clRes.data || {});
      setConsumableNorms(cnRes.data || {});
    }).finally(() => setLoading(false));
  }, []);

  const items = useMemo(() =>
    Object.entries(equipment)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) =>
        (a.clinicId || '').localeCompare(b.clinicId || '') ||
        (a.room || '').localeCompare(b.room || '', 'ru') ||
        (a.name || '').localeCompare(b.name || '', 'ru')
      ),
  [equipment]);

  // Bindings grouped by equipmentId
  const bindingsByEquip = useMemo(() => {
    const m = {};
    for (const b of Object.values(bindings)) {
      if (!b.equipmentId) continue;
      if (!m[b.equipmentId]) m[b.equipmentId] = [];
      m[b.equipmentId].push(b);
    }
    return m;
  }, [bindings]);

  // Consumable norms indexed by "clinicId|serviceCode" for fast lookup
  const normsByClinicService = useMemo(() => {
    const m = {};
    for (const n of Object.values(consumableNorms)) {
      const key = `${n.clinicId}|${n.serviceCode || normServiceName(n.serviceName || '')}`;
      if (!m[key]) m[key] = [];
      m[key].push(n);
    }
    return m;
  }, [consumableNorms]);

  const clinicOptions = useMemo(() => {
    const ids = [...new Set(items.map(i => i.clinicId).filter(Boolean))];
    return ids.map(id => ({ id, name: getClinicName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [items]);

  const filtered = clinicFilter ? items.filter(i => i.clinicId === clinicFilter) : items;

  if (loading) return <Spinner text="Загрузка оборудования…" />;
  if (items.length === 0) return null;

  const now = new Date();

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--rb-text)' }}>Оборудование</div>
        <select value={clinicFilter} onChange={e => setClinicFilter(e.target.value)}
          style={{ padding: '5px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          <option value="">Все филиалы</option>
          {clinicOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{filtered.length} ед.</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="rb-table" style={{ minWidth: 1050 }}>
          <thead>
            <tr>
              <THCell>Название</THCell>
              <THCell>Кабинет</THCell>
              <THCell>Филиал</THCell>
              <THCell>Дата установки</THCell>
              <THCell right>Стоимость покупки</THCell>
              <THCell right title="Отработано / Срок службы (мес)">Срок (мес)</THCell>
              <THCell right>Аморт./мес</THCell>
              <THCell right>Аморт./1 услугу</THCell>
              <THCell right>Часы/мес</THCell>
              <THCell right>Обслуж./мес</THCell>
              <THCell right>Ремонты (∑)</THCell>
              <THCell right>Расходы/мес</THCell>
              <THCell right>Расходники</THCell>
              <THCell right>Окупаемость</THCell>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const purchaseCost = parseNum(item.purchaseCost);
              const usefulLife   = parseNum(item.usefulLife);
              const maintenance  = parseNum(item.maintenance);
              const repairs      = parseNum(item.repairs);

              // Амортизация = покупка / срок
              const amortPerMonth = purchaseCost > 0 && usefulLife > 0
                ? purchaseCost / usefulLife : 0;

              // Месяцев в эксплуатации от даты установки
              let monthsElapsed = null;
              if (item.installDate) {
                const inst = new Date(item.installDate);
                if (!isNaN(inst)) {
                  monthsElapsed = (now.getFullYear() - inst.getFullYear()) * 12
                    + (now.getMonth() - inst.getMonth());
                  if (monthsElapsed < 0) monthsElapsed = 0;
                }
              }

              // Часы в месяц из графика филиала, fallback — DEFAULT_SCHEDULE
              const clinicScheduleData = clinicMeta[String(item.clinicId)] || {};
              const clinicSchedule = (
                typeof clinicScheduleData.schedule === 'object' &&
                clinicScheduleData.schedule !== null &&
                !Array.isArray(clinicScheduleData.schedule)
              ) ? clinicScheduleData.schedule : DEFAULT_SCHEDULE;
              const weeklyHrs  = scheduleWeeklyHours(clinicSchedule);
              const monthlyHrs = +(weeklyHrs * (52 / 12)).toFixed(1);

              // Расходы/мес = амортизация + обслуживание
              const totalPerMonth = amortPerMonth + maintenance;

              // Расходники через цепочку: оборудование → услуги (bindings) → расходники (norms)
              const myBindings = bindingsByEquip[item.id] || [];
              const consumableSet = new Set();
              for (const b of myBindings) {
                const key = `${item.clinicId}|${b.serviceCode || normServiceName(b.serviceName || '')}`;
                const norms = normsByClinicService[key] || [];
                for (const n of norms) {
                  if (n.consumableName) consumableSet.add(n.consumableName);
                }
              }
              const consumableCount = consumableSet.size;

              // Окупаемость: покупка / (расходы/мес)
              const paybackMonths = totalPerMonth > 0 && purchaseCost > 0
                ? Math.ceil(purchaseCost / totalPerMonth) : null;

              return (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{item.name}</td>
                  <td style={{ fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 4, height: 16, borderRadius: 2, background: getClinicColor(item.clinicId), flexShrink: 0, display: 'inline-block' }} />
                      {item.room || DASH}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
                    {item.clinicId ? getClinicName(item.clinicId) : DASH}
                  </td>
                  <td style={{ fontSize: 12 }}>{item.installDate ? formatApiDate(item.installDate) : DASH}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {purchaseCost > 0 ? fmtRub(purchaseCost) : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                    title={monthsElapsed !== null && usefulLife > 0
                      ? `Отработано ${monthsElapsed} мес. из ${usefulLife}`
                      : undefined}>
                    {usefulLife > 0 ? (
                      <span>
                        {monthsElapsed !== null
                          ? <span style={{ color: monthsElapsed >= usefulLife ? '#ef4444' : 'var(--rb-text)' }}>{monthsElapsed}</span>
                          : <span style={{ color: 'var(--rb-text-secondary)' }}>{DASH}</span>
                        }
                        <span style={{ color: 'var(--rb-text-secondary)' }}>/{usefulLife}</span>
                      </span>
                    ) : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {amortPerMonth > 0 ? fmtRub(amortPerMonth) : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {amortPerMonth > 0 && myBindings.length > 0
                      ? fmtRubP(amortPerMonth / myBindings.length)
                      : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {monthlyHrs > 0 ? monthlyHrs + ' ч' : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {maintenance > 0 ? fmtRub(maintenance) : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {repairs > 0 ? fmtRub(repairs) : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: totalPerMonth > 0 ? '#ef4444' : 'var(--rb-text-secondary)' }}>
                    {totalPerMonth > 0 ? fmtRub(totalPerMonth) : DASH}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {consumableCount > 0 ? (
                      <span title={[...consumableSet].join(', ')} style={{ cursor: 'default' }}>
                        {consumableCount} вид{consumableCount === 1 ? '' : consumableCount < 5 ? 'а' : 'ов'}
                      </span>
                    ) : (myBindings.length > 0 ? (
                      <span style={{ color: 'var(--rb-text-secondary)', fontSize: 11 }}>нет норм</span>
                    ) : DASH)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {paybackMonths != null ? (
                      <span title="Стоимость покупки / (Аморт.+Обслуж.) в мес.">
                        {paybackMonths} мес.
                      </span>
                    ) : DASH}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY ANALYTICS (shown in Аналитика tab of Statistics page)
// ══════════════════════════════════════════════════════════════════════════════
export function TabUtilitiesAnalytics({ appointments = [], periodStart, periodEnd }) {
  const [rawData, setRawData]     = useState({});
  const [loading, setLoading]     = useState(true);
  const [clinics, setClinics]     = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [utilCats, setUtilCats]   = useState(UTILITY_CATEGORIES);
  const [colGroups, setColGroups] = useState([]);
  const [clinicMeta, setClinicMeta]   = useState({});
  const [cabinetMeta, setCabinetMeta] = useState({});
  const [refreshKey, setRefreshKey]   = useState(0);

  const year = useMemo(() => (periodStart || new Date()).getFullYear(), [periodStart]);
  const filteredMonths = useMemo(() => {
    if (!periodStart || !periodEnd) return MONTHS_RU;
    const startM = periodStart.getFullYear() === year ? periodStart.getMonth() + 1 : 1;
    const endM   = periodEnd.getFullYear()   === year ? periodEnd.getMonth()   + 1 : 12;
    return MONTHS_RU.filter(m => m.num >= startM && m.num <= endM);
  }, [periodStart, periodEnd, year]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      mis.getClinicsFromMIS().catch(() => ({ data: { data: [] } })),
      directories.getAll('utility').catch(() => ({ data: {} })),
      directories.getAll('utility_cfg').catch(() => ({ data: {} })),
      directories.getAll('clinic').catch(() => ({ data: {} })),
      directories.getAll('cabinet').catch(() => ({ data: {} })),
    ]).then(([misRes, dirRes, cfgRes, clinicRes, cabinetRes]) => {
      setClinics(Array.isArray(misRes.data?.data) ? misRes.data.data : []);
      setRawData(dirRes.data || {});
      const savedCats = cfgRes.data?.categories?.cats;
      if (Array.isArray(savedCats) && savedCats.length > 0) setUtilCats(savedCats);
      const savedGrps = cfgRes.data?.col_groups?.groups;
      if (Array.isArray(savedGrps)) setColGroups(savedGrps);
      setClinicMeta(clinicRes.data || {});
      setCabinetMeta(cabinetRes.data || {});
    }).finally(() => setLoading(false));
  }, [refreshKey]); // refreshKey forces re-fetch on demand

  const allUtilTypes = useMemo(
    () => utilCats.flatMap(c => getAllTypesFlat(c).map(t => ({ ...t, catKey: c.key }))),
    [utilCats]
  );

  const filteredTypes = useMemo(
    () => catFilter ? allUtilTypes.filter(t => t.catKey === catFilter) : allUtilTypes,
    [catFilter, allUtilTypes]
  );

  const renderedGroups = useMemo(() => {
    const assignedIds = new Set(colGroups.flatMap(g => g.items.filter(i => i.kind === 'clinic').map(i => i.id)));
    const ungrouped = clinics
      .filter(c => !assignedIds.has(String(c.id)))
      .map(c => ({ key: `auto_${c.id}`, label: c.title || c.name, color: c.color, items: [{ kind: 'clinic', id: String(c.id) }] }));
    return [...colGroups, ...ungrouped];
  }, [colGroups, clinics]);

  const getSum = useCallback((key) => {
    const c = rawData[key];
    if (!c) return 0;
    if (c.sum !== undefined && c.sum !== '') return parseNum(c.sum);
    const qty = parseNum(c.qty), price = parseNum(c.price);
    return qty > 0 ? qty * price : price;
  }, [rawData]);

  const grpTotals = useMemo(() => {
    const t = {};
    for (const grp of renderedGroups) {
      t[grp.key] = filteredMonths.reduce((ms, m) =>
        ms + filteredTypes.reduce((ts, type) => ts + grp.items.reduce((s, item) =>
          s + getSum(`${year}_${m.num}_${type.key}_${item.id}`), 0), 0), 0);
    }
    return t;
  }, [renderedGroups, filteredMonths, filteredTypes, year, getSum]);

  const WEEKS_PER_MONTH = 365 / 12 / 7;

  const utilStats = useMemo(() => {
    const periodWeeks = filteredMonths.length * WEEKS_PER_MONTH;
    return renderedGroups.map(grp => {
      const total = grpTotals[grp.key] || 0;
      let totalArea = 0, totalHours = 0, totalVisits = 0, hasClinicData = false;
      for (const item of grp.items) {
        if (item.kind !== 'clinic') continue;
        hasClinicData = true;
        const cid = item.id;
        const meta = clinicMeta[cid] || {};
        totalArea += parseNum(meta.area);
        totalHours += scheduleWeeklyHours(meta.schedule || DEFAULT_SCHEDULE) * periodWeeks;
        for (const a of appointments) {
          if (a.status_id === 5 || a.status === 'refused') continue;
          if (String(a.clinic_id) !== String(cid)) continue;
          const t = parseApptTime(a.time_start);
          if (!t || t.getFullYear() !== year) continue;
          const m = t.getMonth() + 1;
          if (filteredMonths.some(fm => fm.num === m)) totalVisits++;
        }
      }
      return {
        key: grp.key, label: grp.label, color: grp.color, total,
        perSqm:   totalArea  > 0 ? total / totalArea  : null,
        perHour:  totalHours > 0 ? total / totalHours : null,
        perVisit: totalVisits > 0 ? total / totalVisits : null,
        hasClinicData, totalArea,
        totalHours: Math.round(totalHours), totalVisits,
      };
    });
  }, [renderedGroups, grpTotals, filteredMonths, clinicMeta, appointments, year]);

  const cabChartData = useMemo(() => {
    const items = [];
    for (const grp of renderedGroups) {
      for (const item of grp.items) {
        if (item.kind !== 'clinic') continue;
        const cid = item.id;
        const clinicTotal = filteredMonths.reduce((ms, m) =>
          ms + filteredTypes.reduce((ts, t) => ts + getSum(`${year}_${m.num}_${t.key}_${cid}`), 0), 0);
        const cabs = Object.entries(cabinetMeta)
          .filter(([k]) => k.startsWith(`${cid}|`))
          .map(([k, v]) => ({ area: parseNum(v.area), name: v.name || v.label || k.split('|')[1] || k }));
        const totalArea = cabs.reduce((s, c) => s + c.area, 0);
        for (const cab of cabs) {
          const allocated = totalArea > 0 && clinicTotal > 0 ? clinicTotal * (cab.area / totalArea) : 0;
          items.push({ name: cab.name, value: allocated, area: cab.area, grpLabel: grp.label, color: grp.color || '#94a3b8' });
        }
      }
    }
    return items.sort((a, b) => b.value - a.value);
  }, [renderedGroups, filteredMonths, filteredTypes, cabinetMeta, year, getSum]);

  if (loading) return <Spinner text="Загрузка…" />;

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Category filter + refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>Категория:</span>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ padding: '3px 8px', border: '1px solid var(--rb-border)', borderRadius: 5,
                   fontSize: 12, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          <option value="">Все категории</option>
          {utilCats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button onClick={() => setRefreshKey(k => k + 1)}
          title="Обновить данные"
          style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--rb-border)', background: '#fff',
                   cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: 'var(--rb-text-secondary)' }}>
          ↻ Обновить
        </button>
      </div>

      {utilStats.some(s => s.total > 0) ? (
        <>
          {/* Stats table */}
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--rb-text)' }}>
            Статистика коммунальных расходов
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--rb-text-secondary)', marginLeft: 8 }}>
              {filteredMonths.length === 12 ? `${year} год` : filteredMonths.map(m => m.label).join(', ')}
            </span>
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 32 }}>
            <table className="rb-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '7px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Подразделение</th>
                  <th style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '7px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Итого ₽</th>
                  <th style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '7px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>На м² ₽</th>
                  <th style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '7px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>В час ₽</th>
                  <th style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '7px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>На визит ₽</th>
                </tr>
              </thead>
              <tbody>
                {utilStats.filter(s => s.total > 0).map(s => (
                  <tr key={s.key}>
                    <td style={{ padding: '7px 12px', fontWeight: 600, fontSize: 13, border: '1px solid var(--rb-border)', borderLeft: `3px solid ${s.color || '#94a3b8'}`, whiteSpace: 'nowrap' }}>
                      {s.label}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 700, padding: '7px 12px', border: '1px solid var(--rb-border)', color: 'var(--rb-primary)' }}>
                      {fmtRubP(s.total)}
                    </td>
                    <UtilStatCell value={s.perSqm} hint={s.totalArea > 0 ? `${s.totalArea} м²` : null} noData={!s.hasClinicData || s.totalArea === 0} />
                    <UtilStatCell value={s.perHour} hint={s.totalHours > 0 ? `${s.totalHours} ч` : null} noData={!s.hasClinicData || s.totalHours === 0} />
                    <UtilStatCell value={s.perVisit} hint={s.totalVisits > 0 ? `${s.totalVisits} визитов` : null} noData={!s.hasClinicData || s.totalVisits === 0} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-cabinet bar chart */}
          {cabChartData.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--rb-text)' }}>
                Распределение расходов по кабинетам
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--rb-text-secondary)', marginLeft: 8 }}>
                  пропорционально площади
                </span>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(200, cabChartData.length * 32)}>
                <BarChart data={cabChartData} layout="vertical" margin={{ top: 4, right: 80, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={v => [fmtRubP(v), 'Расходы']}
                    labelFormatter={(label, payload) => {
                      const d = payload?.[0]?.payload;
                      return `${label}${d?.area ? ` · ${d.area} м²` : ''}${d?.grpLabel ? ` · ${d.grpLabel}` : ''}`;
                    }}
                  />
                  <Bar dataKey="value" name="Расходы ₽" radius={[0, 4, 4, 0]}>
                    {cabChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
          Нет данных за выбранный период. Введите показания в разделе Справочники → Коммунальные.
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSUMABLES ANALYTICS (shown in Аналитика tab of Statistics page)
// ══════════════════════════════════════════════════════════════════════════════
export function TabConsumablesAnalytics({ excelSources = [], periodStart, periodEnd }) {
  const [norms, setNorms]                 = useState({});
  const [actuals, setActuals]             = useState({});
  const [doctorActuals, setDoctorActuals] = useState({});
  const [loading, setLoading]             = useState(true);
  const [statsLoading, setStatsLoading]   = useState(false);
  const [doctorStats, setDoctorStats]     = useState([]);
  const [expanded, setExpanded]           = useState(new Set());
  const saveTimers = useRef({});

  const periodKey = useMemo(() =>
    periodStart
      ? `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`
      : '',
  [periodStart]);

  useEffect(() => {
    Promise.all([
      directories.getAll('consumable_norm').catch(() => ({ data: {} })),
      directories.getAll('consumable_actual').catch(() => ({ data: {} })),
      directories.getAll('consumable_actual_doctor').catch(() => ({ data: {} })),
    ]).then(([normRes, actRes, docActRes]) => {
      setNorms(normRes.data || {});
      setActuals(actRes.data || {});
      setDoctorActuals(docActRes.data || {});
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const normArr = Object.values(norms).filter(n => n.consumableName && n.serviceName);
    if (!normArr.length || !excelSources.length || !periodStart || !periodEnd) {
      setDoctorStats([]); return;
    }
    const matched = excelSources.filter(s => {
      const from = s.dateFrom ? new Date(s.dateFrom) : null;
      const to   = s.dateTo   ? new Date(s.dateTo)   : null;
      return from && to && from <= periodEnd && to >= periodStart;
    });
    if (!matched.length) { setDoctorStats([]); return; }
    setStatsLoading(true);
    loadConsumableStats(matched, normArr)
      .then(setDoctorStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [excelSources, periodStart, periodEnd, norms]);

  const uniqueConsumables = useMemo(() => {
    const map = {};
    for (const n of Object.values(norms)) {
      if (!n.consumableName) continue;
      if (!map[n.consumableName]) map[n.consumableName] = { name: n.consumableName, unit: n.unit || 'шт' };
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [norms]);

  const expectedTotals = useMemo(() => {
    const totals = {};
    for (const doc of doctorStats) {
      for (const [name, data] of Object.entries(doc.consumables)) {
        if (!totals[name]) totals[name] = { expected: 0, expectedCost: 0 };
        totals[name].expected     += data.expected;
        totals[name].expectedCost += data.expectedCost || 0;
      }
    }
    return totals;
  }, [doctorStats]);

  const saveActual = useCallback((consumableName, value) => {
    if (!periodKey) return;
    const rawKey = `${periodKey}__${consumableName}`;
    const qty    = parseFloat(value) || 0;
    clearTimeout(saveTimers.current[rawKey]);
    setActuals(prev => ({ ...prev, [rawKey]: { qty, consumableName, period: periodKey } }));
    saveTimers.current[rawKey] = setTimeout(async () => {
      try {
        await directories.save('consumable_actual', encodeURIComponent(rawKey), { qty, consumableName, period: periodKey });
      } catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, [periodKey]);

  const saveActualDoctor = useCallback((docKey, doctorName, consumableName, value) => {
    if (!periodKey) return;
    const rawKey = `${periodKey}__${docKey}__${consumableName}`;
    const qty    = value === '' ? null : (parseFloat(value) || 0);
    clearTimeout(saveTimers.current[rawKey]);
    setDoctorActuals(prev => {
      const next = { ...prev };
      if (qty === null) { delete next[rawKey]; } else { next[rawKey] = { qty, docKey, doctorName, consumableName, period: periodKey }; }
      return next;
    });
    saveTimers.current[rawKey] = setTimeout(async () => {
      try {
        if (qty === null) {
          await directories.remove('consumable_actual_doctor', encodeURIComponent(rawKey)).catch(() => {});
        } else {
          await directories.save('consumable_actual_doctor', encodeURIComponent(rawKey),
            { qty, docKey, doctorName, consumableName, period: periodKey });
        }
      } catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, [periodKey]);

  const toggleExpand = useCallback((key) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }, []);

  if (loading) return <Spinner text="Загрузка расходников…" />;

  if (!Object.keys(norms).length) {
    return (
      <div className="rb-placeholder">
        <div style={{ fontWeight: 600, fontSize: 15 }}>Нормы расходников не заданы</div>
        <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginTop: 6 }}>
          Добавьте нормы в разделе <strong>Справочники → Расходники</strong>
        </div>
      </div>
    );
  }

  const activeCols = uniqueConsumables.filter(c => (expectedTotals[c.name]?.expected || 0) > 0);
  const hasExpected = activeCols.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Section 1: Summary per consumable ── */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--rb-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          Потребление расходников
          {statsLoading && <span className="rb-spinner" style={{ width: 13, height: 13 }} />}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="rb-table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <THCell>Расходник</THCell>
                <THCell>Ед.</THCell>
                <THCell right>По норме</THCell>
                <THCell right>Стоим. по норме</THCell>
                <THCell right>Фактически</THCell>
                <THCell right>Отклонение</THCell>
              </tr>
            </thead>
            <tbody>
              {uniqueConsumables.map(c => {
                const rawKey       = `${periodKey}__${c.name}`;
                const actualQty    = actuals[rawKey]?.qty ?? '';
                const totals       = expectedTotals[c.name] || { expected: 0, expectedCost: 0 };
                const expected     = totals.expected;
                const expectedCost = totals.expectedCost;
                const actual       = parseFloat(String(actualQty)) || 0;
                const diff         = actual > 0 && expected > 0 ? actual - expected : null;
                const diffPct      = diff !== null && expected > 0 ? (diff / expected * 100) : null;
                return (
                  <tr key={c.name}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{c.unit}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {statsLoading ? <span style={{ color: 'var(--rb-text-secondary)', fontSize: 12 }}>…</span>
                        : expected > 0 ? expected.toFixed(1) : DASH}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--rb-text-secondary)' }}>
                      {expectedCost > 0 ? fmtRubP(expectedCost) : DASH}
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <input type="number" min="0" step="0.1"
                          value={actualQty}
                          onChange={e => saveActual(c.name, e.target.value)}
                          placeholder="—"
                          style={{ ...inlineInputStyle, width: 90, textAlign: 'right' }} />
                      </div>
                    </td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: diff === null ? 'var(--rb-text-secondary)' : diff > 0 ? '#ef4444' : '#10b981',
                    }}>
                      {diff !== null && diffPct !== null
                        ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)} (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(0)}%)`
                        : DASH}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!periodKey && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--rb-text-secondary)' }}>
            Выберите период выше для ввода фактических значений
          </div>
        )}
      </div>

      {/* ── Section 2: Отклонения по врачам ── */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--rb-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          Отклонения по врачам
          {statsLoading && <span className="rb-spinner" style={{ width: 13, height: 13 }} />}
        </div>

        {!statsLoading && !hasExpected ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
            {!excelSources.length ? 'Нет загруженных источников данных'
              : !periodStart ? 'Выберите период'
              : 'Нет совпадений — убедитесь, что названия услуг в нормах совпадают с Excel'}
          </div>
        ) : hasExpected && (
          <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)', fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <span>Врач</span>
              <span style={{ textAlign: 'right' }}>Норма → Факт → Откл.</span>
            </div>

            {doctorStats.filter(d => Object.keys(d.consumables).length > 0).map(doc => {
              const isOpen       = expanded.has(doc.docKey);
              const docActiveCons = activeCols.filter(c => (doc.consumables[c.name]?.expected || 0) > 0);

              return (
                <React.Fragment key={doc.docKey}>
                  {/* Doctor collapsed row */}
                  <div
                    onClick={() => toggleExpand(doc.docKey)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--rb-border)', background: isOpen ? '#f0f7ff' : '#fff', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 3, flexShrink: 0, width: 10 }}>
                      {isOpen ? '▼' : '▶'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{doc.executor}</span>
                        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>{doc.totalServices} услуг</span>
                      </div>
                      {/* Per-consumable badges */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {docActiveCons.map(c => {
                          const expected = doc.consumables[c.name]?.expected || 0;
                          const rawKey   = `${periodKey}__${doc.docKey}__${c.name}`;
                          const rec      = doctorActuals[rawKey];
                          const actual   = rec?.qty ?? null;
                          const diff     = actual !== null ? actual - expected : null;
                          return (
                            <span key={c.name} style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap',
                              background: diff === null ? '#f1f5f9' : diff > 0 ? '#fee2e2' : diff < 0 ? '#dcfce7' : '#f1f5f9',
                              color: diff === null ? 'var(--rb-text-secondary)' : diff > 0 ? '#dc2626' : '#15803d',
                              border: `1px solid ${diff === null ? '#e2e8f0' : diff > 0 ? '#fecaca' : '#bbf7d0'}`,
                            }}>
                              {c.name}: {expected.toFixed(1)}
                              {actual !== null && ` → ${actual.toFixed(1)} (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Expanded: per-consumable actual inputs + service detail */}
                  {isOpen && (
                    <div style={{ background: '#f8fafc', borderBottom: '1px solid var(--rb-border)', padding: '12px 14px 10px 34px' }}>
                      {/* Actual input cards */}
                      <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        Фактический расход за период
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                        {docActiveCons.map(c => {
                          const expected = doc.consumables[c.name]?.expected || 0;
                          const rawKey   = `${periodKey}__${doc.docKey}__${c.name}`;
                          const rec      = doctorActuals[rawKey];
                          const inputVal = rec?.qty ?? '';
                          const diff     = inputVal !== '' ? parseFloat(inputVal) - expected : null;
                          return (
                            <div key={c.name} style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '8px 12px', minWidth: 160 }}>
                              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{c.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>
                                Норма: {expected.toFixed(1)} {c.unit}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Факт:</span>
                                <input type="number" min="0" step="0.1"
                                  value={inputVal}
                                  onChange={e => saveActualDoctor(doc.docKey, doc.executor, c.name, e.target.value)}
                                  placeholder={expected.toFixed(1)}
                                  style={{ ...inlineInputStyle, width: 70, textAlign: 'right' }} />
                                <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{c.unit}</span>
                              </div>
                              {diff !== null && (
                                <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: diff > 0 ? '#ef4444' : '#10b981' }}>
                                  {diff > 0 ? '+' : ''}{diff.toFixed(1)} {c.unit}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Services breakdown */}
                      {doc.services.length > 0 && (
                        <details>
                          <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--rb-text-secondary)', userSelect: 'none', marginBottom: 6 }}>
                            Детализация по услугам ({doc.services.length})
                          </summary>
                          <div style={{ overflowX: 'auto' }}>
                            <table className="rb-table" style={{ fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <THCell>Услуга</THCell>
                                  <THCell right>Кол-во</THCell>
                                  {docActiveCons.map(c => <THCell key={c.name} right>{c.name}</THCell>)}
                                </tr>
                              </thead>
                              <tbody>
                                {doc.services.map(svc => (
                                  <tr key={svc.serviceName}>
                                    <td style={{ color: 'var(--rb-text-secondary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.serviceName}</td>
                                    <td style={{ textAlign: 'right' }}>{svc.qty}</td>
                                    {docActiveCons.map(c => {
                                      const sc = svc.consumables.find(x => x.consumableName === c.name);
                                      return <td key={c.name} style={{ textAlign: 'right', color: 'var(--rb-text-secondary)' }}>{sc ? sc.expected.toFixed(1) : DASH}</td>;
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* ИТОГО row */}
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderTop: '2px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>ИТОГО</span>
              {activeCols.map(c => {
                const expected = expectedTotals[c.name]?.expected || 0;
                let totalActual = 0;
                let hasAny = false;
                for (const d of doctorStats) {
                  const rawKey = `${periodKey}__${d.docKey}__${c.name}`;
                  const rec = doctorActuals[rawKey];
                  if (rec?.qty != null) { totalActual += rec.qty; hasAny = true; }
                }
                const diff = hasAny ? totalActual - expected : null;
                return (
                  <span key={c.name} style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap',
                    background: diff === null ? '#f1f5f9' : diff > 0 ? '#fee2e2' : diff < 0 ? '#dcfce7' : '#f1f5f9',
                    color: diff === null ? 'var(--rb-text-secondary)' : diff > 0 ? '#dc2626' : '#15803d',
                    border: `1px solid ${diff === null ? '#e2e8f0' : diff > 0 ? '#fecaca' : '#bbf7d0'}`,
                  }}>
                    {c.name}: {expected.toFixed(1)}
                    {hasAny && ` → ${totalActual.toFixed(1)} (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE COST ANALYTICS (shown in Аналитика tab of Statistics page)
// ══════════════════════════════════════════════════════════════════════════════
export function TabServiceCostAnalytics({ periodStart, periodEnd }) {
  const [norms, setNorms]             = useState({});
  const [bindings, setBindings]       = useState({});
  const [marketing, setMarketing]     = useState({});
  const [utilityRaw, setUtilityRaw]   = useState({});
  const [utilityCfg, setUtilityCfg]   = useState({});
  const [clinicMeta, setClinicMeta]   = useState({});
  const [salaryRows, setSalaryRows]   = useState([]);
  const [periodAppointments, setPeriodAppointments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [clinicFilter, setClinicFilter] = useState('');
  const [categories, setCategories]   = useState([]);
  const [categoryFilter, setCatFilter]= useState('');
  const [services, setServices]       = useState([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [svcsLoading, setSvcsLoading] = useState(false);
  const [search, setSearch]           = useState('');
  const [selectedSvc, setSelectedSvc] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      directories.getAll('consumable_norm').catch(() => ({ data: {} })),
      directories.getAll('equipment_service_binding').catch(() => ({ data: {} })),
      directories.getAll('marketing_service').catch(() => ({ data: {} })),
      directories.getAll('utility').catch(() => ({ data: {} })),
      directories.getAll('utility_cfg').catch(() => ({ data: {} })),
      directories.getAll('clinic').catch(() => ({ data: {} })),
      salaryRecords.getAll().catch(() => ({ data: [] })),
      periodStart && periodEnd
        ? fetchAppointmentsFromDB(periodStart, periodEnd).catch(() => [])
        : Promise.resolve([]),
    ]).then(([normRes, bindRes, marketingRes, utilRes, utilCfgRes, clinicRes, salaryRes, apptsRes]) => {
      setNorms(normRes.data || {});
      setBindings(bindRes.data || {});
      setMarketing(marketingRes.data || {});
      setUtilityRaw(utilRes.data || {});
      setUtilityCfg(utilCfgRes.data || {});
      setClinicMeta(clinicRes.data || {});
      setSalaryRows(Array.isArray(salaryRes.data) ? salaryRes.data : []);
      setPeriodAppointments(Array.isArray(apptsRes) ? apptsRes : []);
    }).finally(() => setLoading(false));
  }, [periodStart, periodEnd]);

  useEffect(() => {
    if (!clinicFilter) { setCategories([]); setServices([]); setCatFilter(''); return; }
    setCatsLoading(true);
    mis.getServiceCategories()
      .then(res => { const raw = res.data?.data || res.data || []; setCategories(Array.isArray(raw) ? raw : []); })
      .catch(() => setCategories([]))
      .finally(() => setCatsLoading(false));
  }, [clinicFilter]);

  useEffect(() => {
    if (!clinicFilter) { setServices([]); return; }
    setSvcsLoading(true);
    const loader = categoryFilter ? mis.getServicesByCategory(categoryFilter) : mis.getAllServices(clinicFilter);
    loader
      .then(res => { const raw = res.data?.data || res.data || []; setServices(Array.isArray(raw) ? raw : []); })
      .catch(() => setServices([]))
      .finally(() => setSvcsLoading(false));
  }, [clinicFilter, categoryFilter]);

  const flatCats = useMemo(() => flattenCats(categories), [categories]);

  const filteredSvcs = useMemo(() => {
    if (!search) return services;
    const q = search.toLowerCase();
    return services.filter(s =>
      (s.title || s.name || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q)
    );
  }, [services, search]);

  const getServiceDurationMinutes = useCallback((svc) => {
    const raw = svc.duration ?? svc.duration_minutes ?? svc.durationMinutes ?? svc.service_duration ??
      svc.serviceDuration ?? svc.time ?? svc.minutes ?? svc.duration_min ?? svc.durationMin;
    if (raw == null || raw === '') return 0;
    if (typeof raw === 'number') return raw;
    const str = String(raw).trim();
    const timeMatch = str.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) return parseNum(timeMatch[1]) * 60 + parseNum(timeMatch[2]);
    return parseNum(str);
  }, []);

  const utilityPerVisit = useMemo(() => {
    if (!clinicFilter || !periodStart || !periodEnd) return { value: 0, visits: 0, source: '' };

    const utilCats = Array.isArray(utilityCfg?.categories?.cats) && utilityCfg.categories.cats.length
      ? utilityCfg.categories.cats
      : UTILITY_CATEGORIES;
    const colGroups = Array.isArray(utilityCfg?.col_groups?.groups) ? utilityCfg.col_groups.groups : [];
    const allTypes = utilCats.flatMap(c => getAllTypesFlat(c).map(t => ({ ...t, catKey: c.key })));
    const months = [];
    const cur = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    const end = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    while (cur <= end) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }

    const groupsWithClinic = colGroups.filter(g =>
      (g.items || []).some(i => i.kind === 'clinic' && String(i.id) === String(clinicFilter))
    );
    const targetGroups = groupsWithClinic.length
      ? groupsWithClinic
      : [{ key: `clinic_${clinicFilter}`, label: getClinicName(clinicFilter), items: [{ kind: 'clinic', id: String(clinicFilter) }] }];

    const getSum = (key) => {
      const c = utilityRaw[key];
      if (!c) return 0;
      if (c.sum !== undefined && c.sum !== '') return parseNum(c.sum);
      const qty = parseNum(c.qty), price = parseNum(c.price);
      return qty > 0 ? qty * price : price;
    };

    let total = 0;
    const clinicIds = new Set();
    for (const grp of targetGroups) {
      for (const item of (grp.items || [])) {
        if (item.kind !== 'clinic') continue;
        clinicIds.add(String(item.id));
        for (const m of months) {
          for (const type of allTypes) {
            total += getSum(`${m.year}_${m.month}_${type.key}_${item.id}`);
          }
        }
      }
    }

    let visits = 0;
    for (const a of periodAppointments) {
      if (a.status_id === 5 || a.status === 'refused') continue;
      if (clinicIds.has(String(a.clinic_id || ''))) visits++;
    }

    return {
      value: total > 0 && visits > 0 ? total / visits : 0,
      visits,
      source: groupsWithClinic.length ? targetGroups.map(g => g.label).join(', ') : getClinicName(clinicFilter),
    };
  }, [clinicFilter, periodStart, periodEnd, utilityCfg, utilityRaw, periodAppointments]);

  const doctorPayStats = useMemo(() => {
    if (!clinicFilter || !selectedSvc || !periodStart || !periodEnd) return { value: 0, doctors: [] };
    const serviceCode = selectedSvc.code || '';
    const serviceNameKey = normServiceName(selectedSvc.title);

    const serviceMatches = (s) =>
      (serviceCode && s.code && normServiceName(s.code) === normServiceName(serviceCode)) ||
      normServiceName(s.name || s.serviceName || '') === serviceNameKey;

    const overlapsPeriod = (record) => {
      if (!record.dateFrom && !record.dateTo) return true;
      const from = record.dateFrom ? new Date(record.dateFrom) : null;
      const to = record.dateTo ? new Date(record.dateTo) : from;
      if (from && from > periodEnd) return false;
      if (to && to < periodStart) return false;
      return true;
    };

    const byDoctor = {};
    for (const rec of salaryRows.filter(overlapsPeriod)) {
      const clinicReports = rec.reportData?.clinicReports || [];
      for (const cr of clinicReports) {
        if (String(cr.clinicId || '') !== String(clinicFilter)) continue;
        const sal = cr.salary || {};
        const sections = [
          ...(sal.performedSections || []),
          ...(sal.basePerformedSections || []),
          ...(cr.performedSections || []),
        ].filter(serviceMatches);
        if (!sections.length) continue;

        const bonusTotal = sections.reduce((sum, s) => sum + parseNum(s.bonusAmount), 0);
        const serviceCount = sections.reduce((sum, s) => sum + (parseNum(s.count) || 1), 0);
        if (bonusTotal <= 0 || serviceCount <= 0) continue;

        const key = rec.misUserId || rec.doctorName;
        if (!byDoctor[key]) byDoctor[key] = { name: rec.doctorName || key, bonus: 0, services: 0 };
        byDoctor[key].bonus += bonusTotal;
        byDoctor[key].services += serviceCount;
      }
    }

    const doctors = Object.values(byDoctor)
      .map(d => ({ ...d, avg: d.services > 0 ? d.bonus / d.services : 0 }))
      .filter(d => d.avg > 0)
      .sort((a, b) => b.avg - a.avg);
    const value = doctors.length ? doctors.reduce((sum, d) => sum + d.avg, 0) / doctors.length : 0;
    return { value, doctors };
  }, [clinicFilter, selectedSvc, periodStart, periodEnd, salaryRows]);

  const adminExpenses = useMemo(() => {
    if (!clinicFilter || !selectedSvc) return 0;
    const meta = clinicMeta[String(clinicFilter)] || {};
    const rent = parseNum(meta.rent);
    const schedule = (
      typeof meta.schedule === 'object' &&
      meta.schedule !== null &&
      !Array.isArray(meta.schedule)
    ) ? meta.schedule : DEFAULT_SCHEDULE;
    const monthlyHours = scheduleWeeklyHours(schedule) * (52 / 12);
    const durationMinutes = parseNum(selectedSvc.durationMinutes);
    if (rent <= 0 || monthlyHours <= 0 || durationMinutes <= 0) return 0;
    return rent / monthlyHours * (durationMinutes / 60);
  }, [clinicFilter, selectedSvc, clinicMeta]);

  const autoParts = useMemo(() => {
    if (!clinicFilter || !selectedSvc) return { consumables: 0, equipment: 0, marketing: 0 };
    const serviceCode = selectedSvc.code || '';
    const serviceNameKey = normServiceName(selectedSvc.title);
    const price = parseNum(selectedSvc.price);

    const consumables = Object.values(norms)
      .filter(n =>
        n.clinicId === clinicFilter &&
        ((serviceCode && n.serviceCode === serviceCode) ||
          normServiceName(n.serviceName || '') === serviceNameKey)
      )
      .reduce((sum, n) => sum + parseNum(n.normQty) * parseNum(n.unitCost), 0);

    const equipment = Object.values(bindings)
      .filter(b =>
        b.clinicId === clinicFilter &&
        ((serviceCode && b.serviceCode === serviceCode) ||
          normServiceName(b.serviceName || '') === serviceNameKey)
      )
      .reduce((sum, b) => sum + parseNum(b.paybackPerService), 0);

    const marketingSetting = Object.values(marketing).find(m =>
      m.clinicId === clinicFilter &&
      ((serviceCode && m.serviceCode === serviceCode) ||
        normServiceName(m.serviceName || '') === serviceNameKey)
    );
    const marketingValue = marketingSetting
      ? (marketingSetting.valueType === 'rub'
          ? parseNum(marketingSetting.value)
          : price * parseNum(marketingSetting.value) / 100)
      : 0;

    return { consumables, equipment, marketing: marketingValue };
  }, [clinicFilter, selectedSvc, norms, bindings, marketing]);

  const costParts = useMemo(() => ({
    consumables: autoParts.consumables,
    doctorPay:   doctorPayStats.value,
    equipment:   autoParts.equipment,
    utilities:   utilityPerVisit.value,
    marketing:   autoParts.marketing,
    adminExpenses,
  }), [autoParts, doctorPayStats.value, utilityPerVisit.value, adminExpenses]);

  const totals = useMemo(() => {
    const price = parseNum(selectedSvc?.price);
    const fullCost = costParts.consumables + costParts.doctorPay + costParts.equipment + costParts.utilities + costParts.marketing + costParts.adminExpenses;
    const profit = price - fullCost;
    const margin = price > 0 ? profit / price * 100 : null;
    return { price, fullCost, profit, margin };
  }, [selectedSvc, costParts]);

  if (loading) return <Spinner text="Загрузка себестоимости…" />;

  const clinicName = clinicFilter ? getClinicName(clinicFilter) : '';
  const partRows = [
    { key: 'consumables', label: 'Расходники', color: '#3b82f6' },
    { key: 'doctorPay',   label: 'Оплата врача', color: '#10b981' },
    { key: 'equipment',   label: 'Оборудование', color: '#f59e0b' },
    { key: 'utilities',   label: 'Коммунальные', color: '#06b6d4' },
    { key: 'marketing',   label: 'Маркетинг', color: '#ec4899' },
    { key: 'adminExpenses', label: 'Админ. расходы', color: '#8b5cf6' },
  ];
  const pieRows = [
    ...partRows.map(part => ({
      name: part.label,
      value: costParts[part.key] || 0,
      color: part.color,
      pct: totals.price > 0 ? (costParts[part.key] || 0) / totals.price * 100 : 0,
    })),
    ...(totals.profit > 0 ? [{
      name: 'Прибыль',
      value: totals.profit,
      color: '#84cc16',
      pct: totals.price > 0 ? totals.profit / totals.price * 100 : 0,
    }] : []),
  ].filter(item => item.value > 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
      <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select value={clinicFilter}
            onChange={e => { setClinicFilter(e.target.value); setSelectedSvc(null); setCatFilter(''); setSearch(''); }}
            style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">— Выберите медцентр —</option>
            {DEFAULT_CLINICS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {clinicFilter && (
            <select value={categoryFilter}
              onChange={e => { setCatFilter(e.target.value); setSelectedSvc(null); setSearch(''); }}
              style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }}
              disabled={catsLoading}>
              <option value="">Все категории{catsLoading ? ' (загрузка…)' : ''}</option>
              {flatCats.map(c => <option key={c.id} value={c.id}>{c.title}{c.count != null ? ` (${c.count})` : ''}</option>)}
            </select>
          )}
          {clinicFilter && (
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по коду или названию…"
              style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }} />
          )}
          {!svcsLoading && clinicFilter && (
            <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{filteredSvcs.length} услуг</span>
          )}
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 620 }}>
          {svcsLoading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>
              <span className="rb-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 6 }} />
              Загрузка…
            </div>
          ) : !clinicFilter ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>
              Выберите медцентр<br />для загрузки услуг
            </div>
          ) : filteredSvcs.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>Нет услуг</div>
          ) : filteredSvcs.map(s => {
            const code  = s.code || String(s.service_id || s.id || '');
            const title = s.title || s.name || '';
            const isSel = selectedSvc?.code === code;
            return (
              <button key={code || title}
                onClick={() => setSelectedSvc({ code, title, price: s.price, durationMinutes: getServiceDurationMinutes(s) })}
                style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                  width: '100%', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--rb-border)',
                  background: isSel ? '#eff6ff' : '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: isSel ? 'var(--rb-primary)' : 'var(--rb-text)', lineHeight: 1.4 }}>{title}</div>
                  {code && <div style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 1 }}>{code}</div>}
                </div>
                {s.price != null && (
                  <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--rb-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmtRubP(parseNum(s.price))}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!clinicFilter || !selectedSvc ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
          {clinicFilter ? 'Выберите услугу слева' : 'Выберите медцентр и услугу слева'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--rb-text)' }}>{selectedSvc.title}</div>
              <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {selectedSvc.code && <span>код: {selectedSvc.code}</span>}
                <span style={{ color: getClinicColor(clinicFilter), fontWeight: 600 }}>{clinicName}</span>
                <span>стоимость: <strong style={{ color: 'var(--rb-text)' }}>{fmtRubP(totals.price)}</strong></span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 430px) 1fr', gap: 14, alignItems: 'stretch' }}>
            <div style={{ border: '1px solid var(--rb-border)', borderRadius: 8, background: '#fff', padding: '12px 14px' }}>
              <div style={{ height: 260 }}>
                {totals.price > 0 && pieRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieRows}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={96}
                        paddingAngle={1}
                        labelLine={false}
                        label={({ payload }) => payload?.pct >= 2 ? `${payload.pct.toFixed(1)}%` : ''}
                      >
                        {pieRows.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v, name, item) => [`${fmtRubP(v)} · ${item.payload.pct.toFixed(1)}%`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                    Нет данных для диаграммы
                  </div>
                )}
              </div>
            </div>

            <div style={{ border: '1px solid var(--rb-border)', borderRadius: 8, background: '#fff', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(150px, 1fr))', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Полная себестоимость</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--rb-text)', fontVariantNumeric: 'tabular-nums' }}>{fmtRubP(totals.fullCost)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Прибыль</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: totals.profit >= 0 ? '#16a34a' : '#dc2626', fontVariantNumeric: 'tabular-nums' }}>{fmtRubP(totals.profit)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Маржинальность</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: totals.profit >= 0 ? '#16a34a' : '#dc2626', fontVariantNumeric: 'tabular-nums' }}>{totals.margin == null ? DASH : `${totals.margin.toFixed(1)}%`}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Цена услуги</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--rb-text)', fontVariantNumeric: 'tabular-nums' }}>{fmtRubP(totals.price)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
                {pieRows.map(item => (
                  <div key={item.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmtRubP(item.value)}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rb-text-secondary)', minWidth: 50, textAlign: 'right' }}>{item.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="rb-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <THCell>Компонент</THCell>
                  <THCell right>Значение</THCell>
                  <THCell right>Доля в цене</THCell>
                </tr>
              </thead>
              <tbody>
                {partRows.map(part => {
                  const value = costParts[part.key] || 0;
                  return (
                    <tr key={part.key}>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: part.color, flexShrink: 0 }} />
                          {part.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {value > 0 ? fmtRubP(value) : DASH}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: totals.price > 0 ? 'var(--rb-text-secondary)' : '#94a3b8' }}>
                        {totals.price > 0 ? `${(value / totals.price * 100).toFixed(1)}%` : DASH}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: '#f8fafc' }}>
                  <td style={{ fontWeight: 700 }}>Полная себестоимость</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRubP(totals.fullCost)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totals.price > 0 ? `${(totals.fullCost / totals.price * 100).toFixed(1)}%` : DASH}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>Прибыль</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: totals.profit >= 0 ? '#16a34a' : '#dc2626' }}>{fmtRubP(totals.profit)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: totals.profit >= 0 ? '#16a34a' : '#dc2626' }}>{totals.margin == null ? DASH : `${totals.margin.toFixed(1)}%`}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
// ══════════════════════════════════════════════════════════════════════════════
// МАРКЕТИНГ — вспомогательный CategoryDropdown
// ══════════════════════════════════════════════════════════════════════════════
function MarketingCategoryDropdown({ onSelect }) {
  const [open, setOpen]               = useState(false);
  const [categories, setCategories]   = useState(null);
  const [loading, setLoading]         = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [query, setQuery]             = useState('');
  const [dropPos, setDropPos]         = useState({ top: 0, left: 0, width: 0 });
  const btnRef  = useRef();
  const dropRef = useRef();
  const inputRef = useRef();

  useEffect(() => {
    const handleClick = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target) &&
          dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadCats = useCallback(async () => {
    if (categories !== null) return;
    setLoading(true);
    try {
      const res  = await mis.getServiceCategories();
      const data = res.data?.data || res.data || [];
      setCategories(Array.isArray(data) ? data : []);
    } catch {
      setCategories([]);
      toast.error('Ошибка загрузки категорий');
    } finally { setLoading(false); }
  }, [categories]);

  const handleToggle = () => {
    const next = !open;
    if (next && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(next);
    if (next) { setQuery(''); loadCats(); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  const handleSelect = (cat) => { setSelectedLabel(cat.title); setOpen(false); setQuery(''); onSelect(cat); };

  function renderCats(cats, level = 0) {
    return cats.map(cat => (
      <React.Fragment key={cat.id}>
        <div className="rb-cat-dropdown-item" data-level={level}
          style={{ paddingLeft: 12 + level * 12, padding: '7px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--rb-border)' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
          onMouseLeave={e => e.currentTarget.style.background = ''}
          onClick={() => handleSelect(cat)}>
          {cat.title} {cat.services_count != null ? `(${cat.services_count})` : ''}
        </div>
        {cat.children?.length > 0 && renderCats(cat.children, level + 1)}
      </React.Fragment>
    ));
  }

  const q = query.trim().toLowerCase();
  const flatMatches = q && categories
    ? (function flatAll(cats) { const r = []; for (const c of cats) { r.push(c); if (c.children?.length) r.push(...flatAll(c.children)); } return r; })(categories).filter(c => c.title.toLowerCase().includes(q))
    : null;

  return (
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <button ref={btnRef} type="button" onClick={handleToggle}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left', color: selectedLabel ? 'var(--rb-text)' : 'var(--rb-text-secondary)', fontFamily: 'inherit' }}>
        <span>{selectedLabel || 'Выберите категорию…'}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div ref={dropRef} style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: Math.max(dropPos.width, 320), border: '1px solid var(--rb-border-dark)', borderRadius: 8, background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.14)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--rb-border)' }}>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Поиск категории…"
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {loading && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Загрузка…</div>}
            {!loading && categories?.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Нет категорий</div>}
            {!loading && flatMatches?.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>}
            {!loading && flatMatches && flatMatches.map(cat => (
              <div key={cat.id} style={{ paddingLeft: 12, padding: '7px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--rb-border)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
                onClick={() => handleSelect(cat)}>
                {cat.title} {cat.services_count != null ? `(${cat.services_count})` : ''}
              </div>
            ))}
            {!loading && !flatMatches && categories?.length > 0 && renderCats(categories)}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// МАРКЕТИНГ
// ══════════════════════════════════════════════════════════════════════════════
function TabMarketing() {
  const [settings, setSettings]         = useState({});
  const [loading, setLoading]           = useState(true);
  const [mode, setMode]                 = useState('services'); // 'services' | 'category'
  const [clinicFilter, setClinicFilter] = useState('');

  // ── «По услугам» mode state ──
  const [categoryFilter, setCatFilter]  = useState('');
  const [categories, setCategories]     = useState([]);
  const [catsLoading, setCatsLoading]   = useState(false);
  const [services, setServices]         = useState([]);
  const [svcsLoading, setSvcsLoading]   = useState(false);
  const [search, setSearch]             = useState('');
  const [selectedSvc, setSelectedSvc]   = useState(null);
  const [valueType, setValueType]       = useState('percent');
  const [value, setValue]               = useState('');
  const [saving, setSaving]             = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  // ── «По категории» mode state ──
  const [catSvcs, setCatSvcs]           = useState([]);
  const [catSvcsLoading, setCatSvcsLoading] = useState(false);
  const [catBulkType, setCatBulkType]   = useState('percent');
  const [catBulkValue, setCatBulkValue] = useState('');
  const [catExcluded, setCatExcluded]   = useState(new Set());
  const [catFilter, setCatFilter2]      = useState('');
  const [catSaving, setCatSaving]       = useState(false);

  const saveTimers = useRef({});

  useEffect(() => {
    directories.getAll('marketing_service')
      .then(res => setSettings(res.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── «По услугам»: load categories when clinic changes ──
  useEffect(() => {
    if (!clinicFilter) { setCategories([]); setServices([]); setCatFilter(''); return; }
    setCatsLoading(true);
    mis.getServiceCategories()
      .then(res => { const raw = res.data?.data || res.data || []; setCategories(Array.isArray(raw) ? raw : []); })
      .catch(() => setCategories([]))
      .finally(() => setCatsLoading(false));
  }, [clinicFilter]);

  // ── «По услугам»: load services ──
  useEffect(() => {
    if (!clinicFilter || mode !== 'services') { setServices([]); return; }
    setSvcsLoading(true);
    const loader = categoryFilter ? mis.getServicesByCategory(categoryFilter) : mis.getAllServices(clinicFilter);
    loader
      .then(res => { const raw = res.data?.data || res.data || []; setServices(Array.isArray(raw) ? raw : []); })
      .catch(() => setServices([]))
      .finally(() => setSvcsLoading(false));
  }, [clinicFilter, categoryFilter, mode]);

  useEffect(() => { setSelectedSvc(null); setShowEditForm(false); setCatSvcs([]); setCatBulkValue(''); setCatExcluded(new Set()); setCatFilter2(''); }, [clinicFilter]);

  const flatCats  = useMemo(() => flattenCats(categories), [categories]);

  const settingByCode = useMemo(() => {
    const map = {};
    for (const [id, s] of Object.entries(settings)) {
      if (s.clinicId !== clinicFilter) continue;
      if (s.serviceCode) map[s.serviceCode] = { id, ...s };
    }
    return map;
  }, [settings, clinicFilter]);

  const filteredSvcs = useMemo(() => {
    if (!search) return services;
    const q = search.toLowerCase();
    return services.filter(s => (s.title || s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q));
  }, [services, search]);

  // ── Handlers: «По услугам» ──
  const handleSelect = (svc) => {
    const code = svc.code || String(svc.service_id || svc.id || '');
    setSelectedSvc({ code, title: svc.title || svc.name || '', price: svc.price });
    setShowEditForm(false);
    const existing = settingByCode[code];
    if (existing) { setValue(String(existing.value)); setValueType(existing.valueType === 'rub' ? 'rub' : 'percent'); }
    else { setValue(''); setValueType('percent'); }
  };

  const handleSave = async () => {
    if (!selectedSvc || !clinicFilter) return;
    const val = parseFloat(value);
    if (isNaN(val) || val < 0) { toast.error('Введите корректное значение'); return; }
    setSaving(true);
    try {
      const existing = settingByCode[selectedSvc.code];
      const id   = existing?.id || uuidv4();
      const data = { clinicId: clinicFilter, serviceCode: selectedSvc.code, serviceName: selectedSvc.title, value: val, valueType };
      await directories.save('marketing_service', id, data);
      setSettings(prev => ({ ...prev, [id]: data }));
      setShowEditForm(false);
      toast.success('Сохранено', { duration: 1500 });
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSaving(false); }
  };

  const handleRemove = async (id) => {
    try {
      await directories.remove('marketing_service', id);
      setSettings(prev => { const n = { ...prev }; delete n[id]; return n; });
      if (selectedSvc && settingByCode[selectedSvc.code]?.id === id) { setValue(''); setShowEditForm(false); }
      toast.success('Удалено', { duration: 1500 });
    } catch { toast.error('Ошибка удаления'); }
  };

  const saveInline = useCallback((id, patch) => {
    clearTimeout(saveTimers.current[id]);
    setSettings(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    saveTimers.current[id] = setTimeout(async () => {
      try { await directories.save('marketing_service', id, patch); }
      catch { toast.error('Ошибка сохранения'); }
    }, 800);
  }, []);

  // ── Handlers: «По категории» ──
  const handleCatSelect = useCallback(async (cat) => {
    setCatSvcs([]); setCatBulkValue(''); setCatExcluded(new Set()); setCatFilter2('');
    setCatSvcsLoading(true);
    try {
      const res  = await mis.getServicesByCategory(cat.id);
      const data = res.data?.data || res.data || [];
      setCatSvcs(Array.isArray(data) ? data : []);
    } catch { setCatSvcs([]); toast.error('Ошибка загрузки услуг категории'); }
    finally { setCatSvcsLoading(false); }
  }, []);

  const toggleCatExclude = (code) => {
    setCatExcluded(prev => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
  };

  const handleApplyCategory = async () => {
    if (!clinicFilter) { toast.error('Выберите медцентр'); return; }
    const val = parseFloat(catBulkValue);
    if (isNaN(val) || val < 0) { toast.error('Укажите ставку'); return; }
    const active = catSvcs.filter(s => !catExcluded.has(s.code || String(s.service_id || '')));
    if (!active.length) { toast.error('Нет выбранных услуг'); return; }
    setCatSaving(true);
    try {
      const updates = {};
      for (const svc of active) {
        const code = svc.code || String(svc.service_id || '');
        const id   = settingByCode[code]?.id || uuidv4();
        const data = { clinicId: clinicFilter, serviceCode: code, serviceName: svc.title || '', value: val, valueType: catBulkType };
        await directories.save('marketing_service', id, data);
        updates[id] = data;
      }
      setSettings(prev => ({ ...prev, ...updates }));
      toast.success(`Применено к ${active.length} услуг${active.length === 1 ? 'е' : active.length < 5 ? 'ам' : 'ам'}`);
      setCatBulkValue('');
    } catch { toast.error('Ошибка сохранения'); }
    finally { setCatSaving(false); }
  };

  const fmtVal    = (s) => s.valueType === 'rub' ? `${s.value} ₽` : `${s.value}%`;
  const clinicName = DEFAULT_CLINICS.find(c => String(c.id) === clinicFilter)?.name;

  // ── Category mode: filtered visible list — must be before any early return ──
  const catFilteredSvcs = useMemo(() => {
    if (!catFilter) return catSvcs;
    const q = catFilter.toLowerCase();
    return catSvcs.filter(s => (s.title || '').toLowerCase().includes(q) || (s.code || String(s.service_id || '')).toLowerCase().includes(q));
  }, [catSvcs, catFilter]);

  if (loading) return <Spinner text="Загрузка маркетинга…" />;

  const currentSetting = selectedSvc ? settingByCode[selectedSvc.code] : null;

  return (
    <div>
      {/* ── Режим-переключатель ── */}
      <div className="rb-tabs" style={{ marginBottom: 16 }}>
        <button className={`rb-tab-btn${mode === 'services' ? ' active' : ''}`}
          onClick={() => { setMode('services'); setSelectedSvc(null); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          По услугам
        </button>
        <button className={`rb-tab-btn${mode === 'category' ? ' active' : ''}`}
          onClick={() => { setMode('category'); setSelectedSvc(null); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          По категории
        </button>
      </div>

      {/* ── Выбор медцентра (общий для обоих режимов) ── */}
      <div style={{ marginBottom: 14 }}>
        <select value={clinicFilter}
          onChange={e => { setClinicFilter(e.target.value); setSelectedSvc(null); setCatFilter(''); setSearch(''); }}
          style={{ padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer', minWidth: 220 }}>
          <option value="">— Выберите медцентр —</option>
          {DEFAULT_CLINICS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {clinicFilter && (
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--rb-text-secondary)' }}>
            {Object.values(settings).filter(s => s.clinicId === clinicFilter).length} ставок назначено
          </span>
        )}
      </div>

      {/* ══════════════════════════════════════════════
          РЕЖИМ: По услугам
      ══════════════════════════════════════════════ */}
      {mode === 'services' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>

          {/* LEFT: категория + поиск + список услуг */}
          <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clinicFilter && (
                <select value={categoryFilter}
                  onChange={e => { setCatFilter(e.target.value); setSelectedSvc(null); setSearch(''); }}
                  style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }} disabled={catsLoading}>
                  <option value="">Все категории{catsLoading ? ' (загрузка…)' : ''}</option>
                  {flatCats.map(c => <option key={c.id} value={c.id}>{c.title}{c.count != null ? ` (${c.count})` : ''}</option>)}
                </select>
              )}
              {clinicFilter && (
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск по коду или названию…"
                  style={{ ...inlineInputStyle, width: '100%', boxSizing: 'border-box' }} />
              )}
              {!svcsLoading && clinicFilter && (
                <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{filteredSvcs.length} услуг</span>
              )}
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 560 }}>
              {svcsLoading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>
                  <span className="rb-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 6 }} />Загрузка…
                </div>
              ) : !clinicFilter ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>
                  Выберите медцентр<br />для загрузки услуг
                </div>
              ) : filteredSvcs.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 12 }}>Нет услуг</div>
              ) : filteredSvcs.map(s => {
                const code  = s.code || String(s.service_id || s.id || '');
                const title = s.title || s.name || '';
                const hasSetting = !!settingByCode[code];
                const isSel = selectedSvc?.code === code;
                return (
                  <button key={code} onClick={() => handleSelect(s)}
                    style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, width: '100%', padding: '7px 12px', border: 'none', borderBottom: '1px solid var(--rb-border)', background: isSel ? '#eff6ff' : '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: isSel ? 'var(--rb-primary)' : 'var(--rb-text)', lineHeight: 1.4 }}>{title}</div>
                      {s.code && <div style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 1 }}>{s.code}</div>}
                    </div>
                    {hasSetting && (
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8, background: isSel ? '#bfdbfe' : '#dbeafe', color: '#1e40af', marginTop: 2 }}>
                        {fmtVal(settingByCode[code])}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT: деталь выбранной услуги */}
          <div>
            {!clinicFilter ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
                Выберите медцентр и услугу слева
              </div>
            ) : !selectedSvc ? (
              /* Сводная таблица */
              Object.values(settings).filter(s => s.clinicId === clinicFilter).length > 0 ? (
                <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)', fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>
                    Назначенные ставки — {clinicName}
                  </div>
                  <table className="rb-table" style={{ minWidth: 400 }}>
                    <thead><tr><THCell>Услуга</THCell><THCell>Код</THCell><THCell right>Ставка</THCell><THCell right>Тип</THCell><THCell></THCell></tr></thead>
                    <tbody>
                      {Object.entries(settings)
                        .filter(([, s]) => s.clinicId === clinicFilter)
                        .sort(([, a], [, b]) => (a.serviceName || '').localeCompare(b.serviceName || '', 'ru'))
                        .map(([id, s]) => (
                          <tr key={id}>
                            <td style={{ fontSize: 12 }}>{s.serviceName || s.serviceCode}</td>
                            <td style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{s.serviceCode}</td>
                            <td><div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <input type="number" min="0" step="0.01" value={s.value ?? ''} onChange={e => saveInline(id, { value: parseFloat(e.target.value) || 0 })} style={{ ...inlineInputStyle, width: 80, textAlign: 'right' }} />
                            </div></td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', border: '1px solid var(--rb-border-dark)', borderRadius: 6, overflow: 'hidden' }}>
                                <button onClick={() => saveInline(id, { valueType: 'percent' })} style={{ padding: '3px 8px', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: s.valueType !== 'rub' ? 'var(--rb-primary)' : '#fff', color: s.valueType !== 'rub' ? '#fff' : 'var(--rb-text-secondary)' }}>%</button>
                                <button onClick={() => saveInline(id, { valueType: 'rub' })} style={{ padding: '3px 8px', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: s.valueType === 'rub' ? 'var(--rb-primary)' : '#fff', color: s.valueType === 'rub' ? '#fff' : 'var(--rb-text-secondary)' }}>₽</button>
                              </div>
                            </td>
                            <td style={{ width: 36 }}>
                              <button onClick={() => handleRemove(id)} title="Удалить" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px', color: '#94a3b8', fontSize: 16, lineHeight: 1 }}>×</button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
                  Выберите услугу слева, чтобы назначить маркетинговую ставку
                </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--rb-text)' }}>{selectedSvc.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2, display: 'flex', gap: 10 }}>
                      {selectedSvc.code && <span>код: {selectedSvc.code}</span>}
                      {selectedSvc.price != null && <span>цена: {parseFloat(selectedSvc.price).toLocaleString('ru-RU')} ₽</span>}
                      {clinicName && <span style={{ color: getClinicColor(clinicFilter), fontWeight: 600 }}>{clinicName}</span>}
                    </div>
                  </div>
                  {!showEditForm && (
                    <button onClick={() => setShowEditForm(true)}
                      style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {currentSetting ? '✎ Изменить' : '+ Назначить'}
                    </button>
                  )}
                </div>

                {showEditForm && (
                  <div style={{ background: '#f8fafc', border: '1px solid var(--rb-border-dark)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Маркетинговая ставка</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'inline-flex', border: '1px solid var(--rb-border-dark)', borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
                        <button onClick={() => setValueType('percent')} style={{ padding: '7px 14px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: valueType === 'percent' ? 'var(--rb-primary)' : '#fff', color: valueType === 'percent' ? '#fff' : 'var(--rb-text-secondary)' }}>%</button>
                        <button onClick={() => setValueType('rub')} style={{ padding: '7px 14px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: valueType === 'rub' ? 'var(--rb-primary)' : '#fff', color: valueType === 'rub' ? '#fff' : 'var(--rb-text-secondary)' }}>₽</button>
                      </div>
                      <input type="number" min="0" step="any" value={value} onChange={e => setValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowEditForm(false); }}
                        placeholder={valueType === 'percent' ? 'Например: 10' : 'Например: 500'}
                        style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
                      <button onClick={handleSave} disabled={saving}
                        style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: saving ? '#94a3b8' : '#10b981', color: '#fff', cursor: saving ? 'default' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500, flexShrink: 0 }}>
                        {saving ? '…' : 'Сохранить'}
                      </button>
                      <button onClick={() => setShowEditForm(false)}
                        style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--rb-border)', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: 'var(--rb-text-secondary)', flexShrink: 0 }}>
                        Отмена
                      </button>
                    </div>
                    {valueType === 'percent' && selectedSvc.price != null && value && !isNaN(parseFloat(value)) && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--rb-text-secondary)' }}>
                        С каждой услуги уйдёт на маркетинг: <strong style={{ color: 'var(--rb-text)' }}>
                          {(parseFloat(selectedSvc.price) * parseFloat(value) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                {currentSetting ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 2 }}>Текущая ставка</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--rb-text)' }}>{fmtVal(currentSetting)}</div>
                      {currentSetting.valueType !== 'rub' && selectedSvc.price != null && (
                        <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 2 }}>
                          ≈ {(parseFloat(selectedSvc.price) * currentSetting.value / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽ с услуги
                        </div>
                      )}
                    </div>
                    <button onClick={() => handleRemove(currentSetting.id)} title="Удалить"
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                ) : !showEditForm && (
                  <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 8 }}>
                    Ставка не назначена — нажмите «+ Назначить»
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          РЕЖИМ: По категории (массовое назначение)
      ══════════════════════════════════════════════ */}
      {mode === 'category' && (
        <div>
          {!clinicFilter ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
              Выберите медцентр выше
            </div>
          ) : (
            <div>
              <MarketingCategoryDropdown onSelect={handleCatSelect} />

              {catSvcsLoading && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                  <span className="rb-spinner" style={{ width: 14, height: 14, display: 'inline-block', marginRight: 8 }} />Загрузка услуг…
                </div>
              )}

              {!catSvcsLoading && catSvcs.length > 0 && (() => {
                const allCodes      = catSvcs.map(s => s.code || String(s.service_id || ''));
                const selectedCount = catSvcs.length - catExcluded.size;
                return (
                  <>
                    {/* Форма массового назначения */}
                    <div style={{ background: '#f8fafc', border: '1px solid var(--rb-border-dark)', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                        Маркетинговая ставка для выбранных услуг
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'inline-flex', border: '1px solid var(--rb-border-dark)', borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
                          <button onClick={() => { setCatBulkType('percent'); setCatBulkValue(''); }}
                            style={{ padding: '7px 14px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: catBulkType === 'percent' ? 'var(--rb-primary)' : '#fff', color: catBulkType === 'percent' ? '#fff' : 'var(--rb-text-secondary)' }}>%</button>
                          <button onClick={() => { setCatBulkType('rub'); setCatBulkValue(''); }}
                            style={{ padding: '7px 14px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: catBulkType === 'rub' ? 'var(--rb-primary)' : '#fff', color: catBulkType === 'rub' ? '#fff' : 'var(--rb-text-secondary)' }}>₽</button>
                        </div>
                        <input type="number" min="0" step="any" value={catBulkValue} onChange={e => setCatBulkValue(e.target.value)}
                          placeholder={catBulkType === 'percent' ? 'Например: 10' : 'Например: 500'}
                          style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
                        <button onClick={handleApplyCategory} disabled={catSaving}
                          style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: catSaving ? '#94a3b8' : '#10b981', color: '#fff', cursor: catSaving ? 'default' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {catSaving ? <><span className="rb-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 6 }} />Сохранение…</> : `Применить к ${selectedCount}`}
                        </button>
                      </div>
                    </div>

                    {/* Список услуг с тоглами */}
                    <div style={{ border: '1px solid var(--rb-border)', borderRadius: 8 }}>
                      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', borderRadius: '8px 8px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input value={catFilter} onChange={e => setCatFilter2(e.target.value)}
                          placeholder="Найти услугу в категории…"
                          style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>
                            Выбрано: <b>{selectedCount}</b> из {catSvcs.length}
                            {catFilter && ` (показано ${catFilteredSvcs.length})`}
                          </span>
                          <button type="button"
                            onClick={() => catExcluded.size === catSvcs.length ? setCatExcluded(new Set()) : setCatExcluded(new Set(allCodes))}
                            style={{ fontSize: 11, color: 'var(--rb-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            {catExcluded.size === catSvcs.length ? 'Выбрать все' : 'Снять все'}
                          </button>
                        </div>
                      </div>
                      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                        {catFilteredSvcs.length === 0 && (
                          <div style={{ padding: '12px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>
                        )}
                        {catFilteredSvcs.map((svc, i) => {
                          const code     = svc.code || String(svc.service_id || '');
                          const excluded = catExcluded.has(code);
                          const existing = settingByCode[code];
                          return (
                            <div key={code || i}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--rb-border)', cursor: 'pointer', opacity: excluded ? 0.5 : 1 }}
                              onClick={() => toggleCatExclude(code)}>
                              {/* Toggle */}
                              <div style={{ width: 32, height: 18, borderRadius: 9, background: excluded ? '#cbd5e1' : 'var(--rb-primary)', position: 'relative', transition: 'background 0.18s', flexShrink: 0 }}>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: excluded ? 2 : 16, transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.18)' }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{code}</span>
                                <span style={{ fontSize: 12, color: 'var(--rb-text)' }}>{svc.title}</span>
                              </div>
                              {existing && !excluded && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8, background: '#dbeafe', color: '#1e40af', flexShrink: 0 }}>
                                  {fmtVal(existing)}
                                </span>
                              )}
                              {svc.price != null && (
                                <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{parseFloat(svc.price).toLocaleString('ru-RU')} ₽</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}

              {!catSvcsLoading && catSvcs.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13, border: '1px dashed var(--rb-border)', borderRadius: 'var(--rb-radius)' }}>
                  Выберите категорию выше для загрузки услуг
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function Directories({ doctors = [], excelSources = [] }) {
  const [activeTab, setActiveTab] = useState('clinics');
  const { wrapRef, sliderEl } = useTabSlider(activeTab);

  const [appointments, setAppointments] = useState([]);
  const [loadingAppts, setLoadingAppts] = useState(true);

  useEffect(() => {
    const end   = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
    fetchAppointmentsFromDB(start, end)
      .then(data => setAppointments(data))
      .catch(() => {})
      .finally(() => setLoadingAppts(false));
  }, []);

  const roomCountByClinic = useMemo(() => {
    const counts = {};
    for (const a of appointments) {
      const room = (a.room || '').trim();
      const cid  = String(a.clinic_id || '');
      if (!room || !cid) continue;
      if (!counts[cid]) counts[cid] = new Set();
      counts[cid].add(room);
    }
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.size]));
  }, [appointments]);

  return (
    <div style={{ padding: '16px 20px', height: '100%', overflowY: 'auto' }}>
      <div className="rb-clinic-tab-wrap" ref={wrapRef} style={{ marginBottom: 20 }}>
        {sliderEl}
        {DIR_TABS.map(t => (
          <button key={t.key} className={`rb-clinic-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'clinics'     && <TabClinics roomCountByClinic={roomCountByClinic} />}
      {activeTab === 'cabinets'    && <TabCabinets appointments={appointments} loadingAppts={loadingAppts} doctors={doctors} />}
      {activeTab === 'doctors'     && <TabDoctors doctors={doctors} excelSources={excelSources} />}
      {activeTab === 'equipment'   && <TabEquipment />}
      {activeTab === 'utilities'   && <TabUtilities />}
      {activeTab === 'consumables' && <TabConsumables />}
      {activeTab === 'marketing'   && <TabMarketing />}
    </div>
  );
}
