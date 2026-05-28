import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { mis, directories, reviews } from '../../../services/api';
import { useTabSlider } from '../../ReferralBonuses/utils/useTabSlider';
import { fetchAppointmentsFromDB } from '../../ReferralBonuses/utils/appointmentsApi';
import { fetchSourceFile } from '../../ReferralBonuses/utils/excelSources';
import { parseExcelFile, rbMapNewColumns } from '../../ReferralBonuses/utils/excelUtils';
import { rbParseFullName, rbParseAbbrevName } from '../../ReferralBonuses/utils/nameMatching';
import { DEFAULT_CLINICS } from '../../ReferralBonuses/utils/clinicUtils';
import { MapPin, Phone, UserRound, Star, MessageSquare, CheckCircle, Clock, TrendingUp, Globe, Mail, FileText, Calendar, Building2, Landmark } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';

// ── Constants ─────────────────────────────────────────────────────────────────
const DIR_TABS = [
  { key: 'clinics',   label: 'Филиалы' },
  { key: 'cabinets',  label: 'Кабинеты' },
  { key: 'doctors',   label: 'Врачи' },
  { key: 'equipment', label: 'Оборудование' },
  { key: 'utilities', label: 'Коммунальные' },
];

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
  { key: 'water',       label: 'Водоснабжение',       types: [
    { key: 'water_old_water', label: 'Старый корпус — вода' },
    { key: 'water_old_neg',   label: 'Старый корпус — негат. воздействие' },
    { key: 'water_new_water', label: 'Новый корпус — вода' },
    { key: 'water_new_neg',   label: 'Новый корпус — негат. воздействие' },
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

const ALL_UTILITY_TYPES = UTILITY_CATEGORIES.flatMap(c =>
  c.types.map(t => ({ ...t, catKey: c.key, catLabel: c.label }))
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
        const revenue = parseNum(cm.totalCost ? r[cm.totalCost] : (cm.servicePrice ? r[cm.servicePrice] : 0));
        const patient = (cm.patientCard ? String(r[cm.patientCard] || '').trim() : '')
                     || (cm.patientName ? String(r[cm.patientName] || '').trim() : '');
        if (!byKey[key]) byKey[key] = { executor: exec, appts: 0, revenue: 0, patients: {} };
        byKey[key].appts++;
        byKey[key].revenue += revenue;
        if (patient) byKey[key].patients[patient] = (byKey[key].patients[patient] || 0) + 1;
      }
    } catch (e) {
      console.error('[Directories] source load error', src?.id, e);
    }
  }
  const result = {};
  for (const [key, d] of Object.entries(byKey)) {
    result[key] = {
      appts:          d.appts,
      revenue:        d.revenue,
      avgCheck:       d.appts > 0 ? d.revenue / d.appts : 0,
      repeatPatients: Object.values(d.patients).filter(v => v > 1).length,
    };
  }
  return result;
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
function TabEquipment() {
  const [equipment, setEquipment] = useState({});
  const [loading, setLoading]     = useState(true);
  const [clinicFilter, setClinicFilter] = useState('');
  const [search, setSearch]       = useState('');
  const saveTimers = useRef({});

  useEffect(() => {
    directories.getAll('equipment')
      .then(res => setEquipment(res.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
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
          <table className="rb-table" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <THCell>Название</THCell>
                <THCell>Кабинет</THCell>
                <THCell>Филиал</THCell>
                <THCell>Дата установки</THCell>
                <THCell right>Стоимость покупки (₽)</THCell>
                <THCell right>Срок исп. (мес)</THCell>
                <THCell right>Аморт./мес (₽)</THCell>
                <THCell right>Обслуж./мес (₽)</THCell>
                <THCell right>Ремонты (₽)</THCell>
                <THCell right>Часы работы</THCell>
                <THCell right>Простой (ч)</THCell>
                <THCell>Окупаемость</THCell>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const purchaseCost  = parseNum(item.purchaseCost);
                const usefulLife    = parseNum(item.usefulLife);
                const autoDeprec    = purchaseCost > 0 && usefulLife > 0 ? Math.round(purchaseCost / usefulLife) : null;
                return (
                  <tr key={item.id}>
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
                      <input type="number" min="0" value={item.monthlyDeprec ?? ''}
                        onChange={e => saveField(item.id, { monthlyDeprec: e.target.value })}
                        placeholder={autoDeprec != null ? autoDeprec.toLocaleString('ru-RU') : '0'}
                        title={autoDeprec != null ? `Авто: ${autoDeprec.toLocaleString('ru-RU')} ₽ (покупка / срок)` : ''}
                        style={{ ...inlineInputStyle, width: 110, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.maintenance ?? ''} onChange={e => saveField(item.id, { maintenance: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 100, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.repairs ?? ''} onChange={e => saveField(item.id, { repairs: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 100, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.workingHours ?? ''} onChange={e => saveField(item.id, { workingHours: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 80, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="number" min="0" value={item.downtime ?? ''} onChange={e => saveField(item.id, { downtime: e.target.value })}
                        placeholder="0" style={{ ...inlineInputStyle, width: 80, textAlign: 'right' }} />
                    </td>
                    <td>
                      <input type="text" value={item.payback || ''} onChange={e => saveField(item.id, { payback: e.target.value })}
                        placeholder={DASH} style={{ ...inlineInputStyle, width: 120 }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
        {r.doctorName && <>
          {r.platformName && <span style={{ fontSize: 11, color: '#cbd5e1' }}>|</span>}
          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{r.doctorName}</span>
        </>}
        {(r.platformId || r.doctorName) && <span style={{ fontSize: 11, color: '#cbd5e1' }}>|</span>}
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
              .map(r => ({ ...r, boardName: b.name, boardColor: getBoardColor(b.name), platformName: platformMap[r.platformId] || r.platformId || null }));
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
        if (!byName[d.name]) byName[d.name] = { name: d.name, count: 0, ratingSum: 0, positive: 0, negative: 0, boardColors: [] };
        byName[d.name].count     += d.count    || 0;
        byName[d.name].ratingSum += (d.avgRating || 0) * (d.count || 0);
        byName[d.name].positive  += d.positive  || 0;
        byName[d.name].negative  += d.negative  || 0;
        byName[d.name].boardColors.push(getBoardColor(b.name));
      }
    });
    return Object.values(byName)
      .map(d => ({ ...d, avgRating: d.count > 0 ? d.ratingSum / d.count : 0 }))
      .sort((a, b) => b.avgRating - a.avgRating);
  }, [statsMap, boards]);

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
      if (!r.doctorName) continue;
      map[r.doctorName] = (map[r.doctorName] || 0) + 1;
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
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserRound size={16} style={{ color: 'var(--rb-text-secondary)' }} />
            Рейтинг врачей
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rb-table" style={{ minWidth: 400 }}>
              <thead>
                <tr>
                  <THCell>#</THCell>
                  <THCell>Врач</THCell>
                  <THCell right>Отзывов</THCell>
                  <THCell right>Ср. оценка</THCell>
                </tr>
              </thead>
              <tbody>
                {allDoctors.map((doc, i) => (
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
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{doc.count}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                        <Star size={12} fill="#f59e0b" color="#f59e0b" />
                        {doc.avgRating.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
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
// UTILITY CATEGORY EDITOR  (modal overlay)
// ══════════════════════════════════════════════════════════════════════════════
function UtilityCatEditor({ cats, onSave, onClose }) {
  const [draft, setDraft]   = useState(() => cats.map(c => ({ ...c, types: c.types.map(t => ({ ...t })) })));
  const [saving, setSaving] = useState(false);

  const updateCatLabel  = (ci, label) => setDraft(d => d.map((c, i) => i === ci ? { ...c, label } : c));
  const deleteCat       = (ci)        => setDraft(d => d.filter((_, i) => i !== ci));
  const updateTypeLabel = (ci, ti, label) => setDraft(d => d.map((c, i) => i === ci
    ? { ...c, types: c.types.map((t, j) => j === ti ? { ...t, label } : t) } : c));
  const deleteType = (ci, ti) => setDraft(d => d.map((c, i) => i === ci
    ? { ...c, types: c.types.filter((_, j) => j !== ti) } : c));

  const moveCat = (ci, dir) => setDraft(d => {
    const next = [...d]; const swap = ci + dir;
    if (swap < 0 || swap >= next.length) return d;
    [next[ci], next[swap]] = [next[swap], next[ci]];
    return next;
  });

  const addType = (ci) => {
    const key = `type_${Date.now()}`;
    setDraft(d => d.map((c, i) => i === ci ? { ...c, types: [...c.types, { key, label: 'Новый подтип' }] } : c));
  };

  const addCat = () => {
    const key = `cat_${Date.now()}`;
    setDraft(d => [...d, { key, label: 'Новая категория', types: [{ key: `${key}_t0`, label: 'Подтип 1' }] }]);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(draft);
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

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 560, maxWidth: '96vw', maxHeight: '88vh', background: '#fff', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,0,0,0.28)', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Категории коммунальных услуг</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--rb-text-secondary)', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        {/* scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {draft.map((cat, ci) => (
            <div key={cat.key} style={{ border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: '#f1f5f9' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button onClick={() => moveCat(ci, -1)} disabled={ci === 0}
                    style={{ border: 'none', background: 'none', cursor: ci === 0 ? 'default' : 'pointer', fontSize: 9, lineHeight: 1.2, padding: '1px 5px', color: ci === 0 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>▲</button>
                  <button onClick={() => moveCat(ci, 1)} disabled={ci === draft.length - 1}
                    style={{ border: 'none', background: 'none', cursor: ci === draft.length - 1 ? 'default' : 'pointer', fontSize: 9, lineHeight: 1.2, padding: '1px 5px', color: ci === draft.length - 1 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>▼</button>
                </div>
                <input value={cat.label} onChange={e => updateCatLabel(ci, e.target.value)}
                  style={{ ...inlineInputStyle, flex: 1, fontWeight: 600, fontSize: 13 }} />
                <button onClick={() => deleteCat(ci)}
                  style={{ border: '1px solid #fecaca', background: '#fff', cursor: 'pointer', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#ef4444', fontFamily: 'inherit', flexShrink: 0 }}>
                  Удалить
                </button>
              </div>
              <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {cat.types.map((type, ti) => (
                  <div key={type.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: 3, alignSelf: 'stretch', background: '#bfdbfe', borderRadius: 2, flexShrink: 0 }} />
                    <input value={type.label} onChange={e => updateTypeLabel(ci, ti, e.target.value)}
                      style={{ ...inlineInputStyle, flex: 1 }} />
                    <button onClick={() => deleteType(ci, ti)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <button onClick={() => addType(ci)}
                  style={{ alignSelf: 'flex-start', marginTop: 2, padding: '3px 10px', borderRadius: 5, border: '1px dashed #94a3b8', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--rb-text-secondary)', fontFamily: 'inherit' }}>
                  + подтип
                </button>
              </div>
            </div>
          ))}
          <button onClick={addCat}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px dashed var(--rb-primary)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--rb-primary)', fontFamily: 'inherit', fontWeight: 500 }}>
            + Добавить категорию
          </button>
        </div>
        {/* footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--rb-border)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={btnSt(false)}>Отмена</button>
          <button onClick={handleSave} disabled={saving} style={btnSt(true)}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY COLUMN GROUP EDITOR  (modal overlay)
// ══════════════════════════════════════════════════════════════════════════════
function UtilityColEditor({ colGroups, clinics, onSave, onClose }) {
  const [draft, setDraft] = useState(() => colGroups.map(g => ({ ...g, items: g.items.map(i => ({ ...i })) })));
  const [saving, setSaving] = useState(false);

  const assignedIds = useMemo(() => new Set(draft.flatMap(g => g.items.filter(i => i.kind === 'clinic').map(i => i.id))), [draft]);
  const unassigned  = clinics.filter(c => !assignedIds.has(String(c.id)));

  const addGroup = () => {
    const key = `grp_${Date.now()}`;
    setDraft(d => [...d, { key, label: 'Новая группа', items: [] }]);
  };
  const updateGrpLabel = (gi, label) => setDraft(d => d.map((g, i) => i === gi ? { ...g, label } : g));
  const deleteGroup    = (gi)        => setDraft(d => d.filter((_, i) => i !== gi));
  const moveGroup      = (gi, dir)   => setDraft(d => {
    const next = [...d]; const sw = gi + dir;
    if (sw < 0 || sw >= next.length) return d;
    [next[gi], next[sw]] = [next[sw], next[gi]]; return next;
  });

  const addClinic  = (gi, clinicId) => setDraft(d => d.map((g, i) => i === gi
    ? { ...g, items: [...g.items, { kind: 'clinic', id: String(clinicId) }] } : g));
  const addPremise = (gi) => setDraft(d => d.map((g, i) => i === gi
    ? { ...g, items: [...g.items, { kind: 'premise', id: `prem_${Date.now()}`, label: 'Новое помещение' }] } : g));
  const updateItemLabel = (gi, ii, label) => setDraft(d => d.map((g, i) => i === gi
    ? { ...g, items: g.items.map((it, j) => j === ii ? { ...it, label } : it) } : g));
  const removeItem = (gi, ii) => setDraft(d => d.map((g, i) => i === gi
    ? { ...g, items: g.items.filter((_, j) => j !== ii) } : g));

  const handleSave = async () => {
    setSaving(true);
    await onSave(draft);
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

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 600, maxWidth: '96vw', maxHeight: '88vh', background: '#fff', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,0,0,0.28)', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Группы столбцов (клиники и помещения)</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--rb-text-secondary)', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        {unassigned.length > 0 && (
          <div style={{ padding: '8px 20px', background: '#fefce8', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e', flexShrink: 0 }}>
            Не в группах: {unassigned.map(c => c.title || c.name).join(', ')} — будут показаны отдельно
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {draft.map((grp, gi) => (
            <div key={grp.key} style={{ border: '1px solid var(--rb-border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: '#f1f5f9' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button onClick={() => moveGroup(gi, -1)} disabled={gi === 0}
                    style={{ border: 'none', background: 'none', cursor: gi === 0 ? 'default' : 'pointer', fontSize: 9, lineHeight: 1.2, padding: '1px 5px', color: gi === 0 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>▲</button>
                  <button onClick={() => moveGroup(gi, 1)} disabled={gi === draft.length - 1}
                    style={{ border: 'none', background: 'none', cursor: gi === draft.length - 1 ? 'default' : 'pointer', fontSize: 9, lineHeight: 1.2, padding: '1px 5px', color: gi === draft.length - 1 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>▼</button>
                </div>
                <input value={grp.label} onChange={e => updateGrpLabel(gi, e.target.value)}
                  style={{ ...inlineInputStyle, flex: 1, fontWeight: 600, fontSize: 13 }} />
                <button onClick={() => deleteGroup(gi)}
                  style={{ border: '1px solid #fecaca', background: '#fff', cursor: 'pointer', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#ef4444', fontFamily: 'inherit', flexShrink: 0 }}>
                  Удалить
                </button>
              </div>
              <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {grp.items.map((item, ii) => (
                  <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{item.kind === 'clinic' ? '🏥' : '🏢'}</span>
                    {item.kind === 'clinic'
                      ? <span style={{ flex: 1, fontSize: 13 }}>{clinics.find(c => String(c.id) === item.id)?.title || clinics.find(c => String(c.id) === item.id)?.name || item.id}</span>
                      : <input value={item.label || ''} onChange={e => updateItemLabel(gi, ii, e.target.value)}
                          style={{ ...inlineInputStyle, flex: 1 }} />
                    }
                    <button onClick={() => removeItem(gi, ii)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  {unassigned.length > 0 && (
                    <select defaultValue="" onChange={e => { if (e.target.value) { addClinic(gi, e.target.value); e.target.value = ''; } }}
                      style={{ padding: '4px 8px', borderRadius: 6, border: '1px dashed #94a3b8', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--rb-text-secondary)', fontFamily: 'inherit' }}>
                      <option value="">+ клиника</option>
                      {unassigned.map(c => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
                    </select>
                  )}
                  <button onClick={() => addPremise(gi)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px dashed #94a3b8', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--rb-text-secondary)', fontFamily: 'inherit' }}>
                    + помещение
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button onClick={addGroup}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px dashed var(--rb-primary)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--rb-primary)', fontFamily: 'inherit', fontWeight: 500 }}>
            + Добавить группу
          </button>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--rb-border)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={btnSt(false)}>Отмена</button>
          <button onClick={handleSave} disabled={saving} style={btnSt(true)}>
            {saving ? 'Сохранение…' : 'Сохранить'}
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
  const [year, setYear]                   = useState(thisYear);
  const [rawData, setRawData]             = useState({});
  const [loading, setLoading]             = useState(true);
  const [clinics, setClinics]             = useState([]);
  const [monthFilter, setMonthFilter]     = useState('');
  const [catFilter,   setCatFilter]       = useState('');
  const [expandedCats, setExpandedCats]   = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [utilCats, setUtilCats]           = useState(UTILITY_CATEGORIES);
  const [colGroups, setColGroups]         = useState([]);
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [showColEditor, setShowColEditor] = useState(false);
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

  const saveColGroups = useCallback(async (groups) => {
    setColGroups(groups);
    try {
      await directories.save('utility_cfg', 'col_groups', { groups });
      toast.success('Настройки столбцов сохранены', { duration: 1500 });
    } catch {
      toast.error('Ошибка сохранения');
    }
  }, []);

  const filteredMonths = useMemo(
    () => monthFilter ? MONTHS_RU.filter(m => m.num === +monthFilter) : MONTHS_RU,
    [monthFilter]
  );

  const allUtilTypes = useMemo(
    () => utilCats.flatMap(c => c.types.map(t => ({ ...t, catKey: c.key, catLabel: c.label }))),
    [utilCats]
  );

  const filteredTypes = useMemo(
    () => catFilter ? allUtilTypes.filter(t => t.catKey === catFilter) : allUtilTypes,
    [catFilter, allUtilTypes]
  );

  // Group filtered types by category, preserving utilCats order
  const catGroups = useMemo(() => {
    const groups = [];
    for (const cat of utilCats) {
      const types = filteredTypes.filter(t => t.catKey === cat.key);
      if (types.length > 0) groups.push({ cat, types });
    }
    return groups;
  }, [filteredTypes, utilCats]);

  const toggleCat = useCallback((catKey) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey); else next.add(catKey);
      return next;
    });
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

  // Build rendered column groups: configured groups first, then ungrouped clinics as solo groups
  const renderedGroups = useMemo(() => {
    const assignedIds = new Set(colGroups.flatMap(g => g.items.filter(i => i.kind === 'clinic').map(i => i.id)));
    const ungrouped = clinics
      .filter(c => !assignedIds.has(String(c.id)))
      .map(c => ({ key: `auto_${c.id}`, label: c.title || c.name, color: c.color, items: [{ kind: 'clinic', id: String(c.id) }] }));
    return [...colGroups, ...ungrouped];
  }, [colGroups, clinics]);

  const toggleGroup = useCallback((key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Get sum for a cell — supports both clinic ids and premise ids
  const getItemSum = useCallback((item, monthNum, typeKey) => {
    if (item.kind === 'clinic') return getSum(`${year}_${monthNum}_${typeKey}_${item.id}`);
    return getSum(`${year}_${monthNum}_${typeKey}_${item.id}`);
  }, [getSum, year]);

  const getGrpSum = useCallback((grp, monthNum, typeKey) =>
    grp.items.reduce((s, item) => s + getItemSum(item, monthNum, typeKey), 0),
  [getItemSum]);

  const grpTotals = useMemo(() => {
    const t = {};
    for (const grp of renderedGroups) {
      t[grp.key] = filteredMonths.reduce((ms, m) =>
        ms + filteredTypes.reduce((ts, type) => ts + getGrpSum(grp, m.num, type.key), 0), 0);
    }
    return t;
  }, [renderedGroups, filteredMonths, filteredTypes, getGrpSum]);

  const grandTotal = useMemo(() => Object.values(grpTotals).reduce((a, b) => a + b, 0), [grpTotals]);

  const yearRange = useMemo(() => Array.from({ length: 7 }, (_, i) => 2022 + i), []);

  // numCols: 2 (month+service) + per group cols + 1 (total)
  const numCols = useMemo(() => {
    let cols = 2;
    for (const grp of renderedGroups) {
      if (grp.items.length === 1) cols += 3;
      else if (expandedGroups.has(grp.key)) cols += 1 + grp.items.length * 3;
      else cols += 1;
    }
    return cols + 1;
  }, [renderedGroups, expandedGroups]);
  const cellInpSt = { ...inlineInputStyle, width: 80, textAlign: 'right', padding: '3px 6px' };

  if (loading) return <Spinner text="Загрузка коммунальных расходов…" />;

  if (!clinics.length) return (
    <div className="rb-placeholder">
      <div style={{ fontWeight: 600, fontSize: 15 }}>Нет данных о клиниках</div>
      <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginTop: 4 }}>Проверьте подключение к МИС</div>
    </div>
  );

  const miniSelectSt = {
    marginTop: 4, padding: '3px 6px', border: '1px solid var(--rb-border)', borderRadius: 5,
    fontSize: 11, fontFamily: 'inherit', background: '#fff', cursor: 'pointer', width: '100%', display: 'block',
  };
  const thFilterSt = {
    background: '#f8fafc', padding: '7px 10px', textAlign: 'left', fontWeight: 600,
    fontSize: 12, border: '1px solid var(--rb-border)', whiteSpace: 'nowrap', verticalAlign: 'top',
  };

  // Render qty/price/sum inputs for one item (clinic or premise)
  const renderItemCells = (item, monthNum, typeKey) => {
    const dataKey = `${year}_${monthNum}_${typeKey}_${item.id}`;
    const cell    = rawData[dataKey] || {};
    const autoSum = (() => { const q = parseNum(cell.qty); const p = parseNum(cell.price); return q > 0 ? q * p : p; })();
    return [
      <td key={`${dataKey}_q`} style={{ padding: '3px 6px' }}>
        <input type="number" min="0" step="any" value={cell.qty ?? ''} placeholder="0"
          onChange={e => saveCell(dataKey, { qty: e.target.value })} style={cellInpSt} />
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

  // Render all group cells for a data row
  // isCatSummary=true → show aggregate totals only (no editable inputs)
  const renderGroupCells = (monthNum, typeKey, isCatSummary, catTypes) => {
    return renderedGroups.flatMap(grp => {
      const isExpanded = expandedGroups.has(grp.key);
      const isSingle   = grp.items.length === 1;

      if (isSingle && !isCatSummary) {
        return renderItemCells(grp.items[0], monthNum, typeKey);
      }

      if (isSingle && isCatSummary) {
        const total = (catTypes || []).reduce((s, t) => s + getGrpSum(grp, monthNum, t.key), 0);
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
        ? (catTypes || []).reduce((s, t) => s + getGrpSum(grp, monthNum, t.key), 0)
        : getGrpSum(grp, monthNum, typeKey);

      const totalCell = (
        <td key={`cgm_${grp.key}_tot`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', border: '1px solid var(--rb-border)', fontWeight: grpTotal > 0 ? 600 : 400, background: grpTotal > 0 ? '#f0fdf4' : undefined }}>
          {grpTotal > 0 ? fmtRubP(grpTotal) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
        </td>
      );

      if (!isExpanded || isCatSummary) return [totalCell];

      return [
        totalCell,
        ...grp.items.flatMap(item => renderItemCells(item, monthNum, typeKey)),
      ];
    });
  };

  // Render an editable type detail row
  const renderTypeRow = (type, month, isSubRow) => {
    const rowTotal = renderedGroups.reduce((s, grp) => s + getGrpSum(grp, month.num, type.key), 0);
    return (
      <tr key={`${month.num}_${type.key}`} style={isSubRow ? { background: '#fafcff' } : undefined}>
        <td style={{ borderLeft: isSubRow ? '3px solid #bfdbfe' : undefined }} />
        <td style={{ fontSize: 12, paddingLeft: isSubRow ? 20 : 12, whiteSpace: 'nowrap', borderLeft: isSubRow ? '3px solid #bfdbfe' : undefined }}>
          {type.label}
        </td>
        {renderGroupCells(month.num, type.key, false, null)}
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', fontWeight: rowTotal > 0 ? 600 : 400 }}>
          {rowTotal > 0 ? fmtRubP(rowTotal) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
        </td>
      </tr>
    );
  };

  return (
    <div>
      {/* Year tabs + settings buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginRight: 2 }}>Год:</span>
        {yearRange.map(y => (
          <button key={y} onClick={() => setYear(y)}
            style={{ padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                     border: `1px solid ${y === year ? 'var(--rb-primary)' : 'var(--rb-border-dark)'}`,
                     background: y === year ? 'var(--rb-primary)' : '#fff',
                     color: y === year ? '#fff' : 'var(--rb-text)', fontWeight: y === year ? 600 : 400 }}>
            {y}
          </button>
        ))}
        <button onClick={() => setShowCatEditor(true)}
          style={{ marginLeft: 6, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                   border: '1px solid var(--rb-border-dark)', background: '#fff', color: 'var(--rb-text-secondary)' }}>
          ⚙ Категории
        </button>
        <button onClick={() => setShowColEditor(true)}
          style={{ padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                   border: '1px solid var(--rb-border-dark)', background: '#fff', color: 'var(--rb-text-secondary)' }}>
          ⚙ Столбцы
        </button>
        {grandTotal > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--rb-primary)', fontVariantNumeric: 'tabular-nums' }}>
            За период: {fmtRubP(grandTotal)}
          </span>
        )}
      </div>

      {showCatEditor && (
        <UtilityCatEditor
          cats={utilCats}
          onSave={saveUtilCats}
          onClose={() => setShowCatEditor(false)}
        />
      )}
      {showColEditor && (
        <UtilityColEditor
          colGroups={colGroups}
          clinics={clinics}
          onSave={saveColGroups}
          onClose={() => setShowColEditor(false)}
        />
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="rb-table" style={{ minWidth: 300 + renderedGroups.reduce((s, g) => s + (g.items.length === 1 ? 260 : expandedGroups.has(g.key) ? 80 + g.items.length * 260 : 120), 0) }}>
          <thead>
            {/* Row 1: Месяц / Вид услуги (rowSpan=3) + group name headers + Итого (rowSpan=3) */}
            <tr>
              <th rowSpan={3} style={{ ...thFilterSt, verticalAlign: 'top' }}>
                <div>Месяц</div>
                <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={miniSelectSt}>
                  <option value="">Все месяцы</option>
                  {MONTHS_RU.map(m => <option key={m.num} value={m.num}>{m.label}</option>)}
                </select>
              </th>
              <th rowSpan={3} style={{ ...thFilterSt, verticalAlign: 'top' }}>
                <div>Вид услуги</div>
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={miniSelectSt}>
                  <option value="">Все категории</option>
                  {utilCats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </th>
              {renderedGroups.map(grp => {
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
              <th rowSpan={3} style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>Итого</th>
            </tr>
            {/* Row 2: item labels for expanded multi-item groups */}
            <tr>
              {renderedGroups.flatMap(grp => {
                if (grp.items.length === 1) return [];
                const isExpanded = expandedGroups.has(grp.key);
                if (!isExpanded) return [<th key={`r2_${grp.key}_tot`} style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '4px 8px', fontSize: 11, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Итого ₽</th>];
                return [
                  <th key={`r2_${grp.key}_tot`} style={{ background: '#f0f7ff', border: '1px solid var(--rb-border)', padding: '4px 8px', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>Итого ₽</th>,
                  ...grp.items.map(item => (
                    <th key={`r2_${grp.key}_${item.id}`} colSpan={3}
                      style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '4px 8px', fontSize: 11, textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {item.kind === 'clinic'
                        ? (clinics.find(c => String(c.id) === item.id)?.title || clinics.find(c => String(c.id) === item.id)?.name || item.id)
                        : (item.label || item.id)}
                    </th>
                  )),
                ];
              })}
            </tr>
            {/* Row 3: Кол-во / Цена / Сумма per leaf column for expanded multi-item groups */}
            <tr>
              {renderedGroups.flatMap(grp => {
                if (grp.items.length === 1) return [];
                const isExpanded = expandedGroups.has(grp.key);
                if (!isExpanded) return [];
                return [
                  <th key={`r3_${grp.key}_tot`} style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', padding: '4px 8px' }} />,
                  ...grp.items.flatMap(item => [
                    <th key={`r3_${grp.key}_${item.id}_q`} style={{ background: '#f8fafc', padding: '5px 8px', fontSize: 11, border: '1px solid var(--rb-border)', textAlign: 'right', fontWeight: 600, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Кол-во</th>,
                    <th key={`r3_${grp.key}_${item.id}_p`} style={{ background: '#f8fafc', padding: '5px 8px', fontSize: 11, border: '1px solid var(--rb-border)', textAlign: 'right', fontWeight: 600, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Цена ₽</th>,
                    <th key={`r3_${grp.key}_${item.id}_s`} style={{ background: '#f8fafc', padding: '5px 8px', fontSize: 11, border: '1px solid var(--rb-border)', textAlign: 'right', fontWeight: 600, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>Сумма ₽</th>,
                  ]),
                ];
              })}
            </tr>
          </thead>
          <tbody>
            {filteredMonths.map(month => {
              const monthTotal = filteredTypes.reduce((s, type) =>
                s + renderedGroups.reduce((gs, grp) => gs + getGrpSum(grp, month.num, type.key), 0), 0);
              return (
                <React.Fragment key={month.num}>
                  <tr>
                    <td colSpan={numCols} style={{ background: '#f1f5f9', fontWeight: 700, fontSize: 12, padding: '7px 14px', border: '1px solid var(--rb-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{month.label}</span>
                        {monthTotal > 0 && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--rb-primary)' }}>{fmtRub(monthTotal)}</span>}
                      </div>
                    </td>
                  </tr>
                  {catGroups.map(({ cat, types }) => {
                    const isMulti    = types.length > 1;
                    const isExpanded = expandedCats.has(cat.key);
                    const catTotal   = renderedGroups.reduce((gs, grp) =>
                      gs + types.reduce((ts, type) => ts + getGrpSum(grp, month.num, type.key), 0), 0);

                    if (!isMulti) {
                      return renderTypeRow(types[0], month, false);
                    }

                    return (
                      <React.Fragment key={`${month.num}_${cat.key}`}>
                        <tr onClick={() => toggleCat(cat.key)}
                          style={{ cursor: 'pointer', background: isExpanded ? '#f0f7ff' : undefined }}>
                          <td />
                          <td style={{ fontSize: 12, fontWeight: 600, paddingLeft: 10, whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 10, color: 'var(--rb-primary)', marginRight: 5, userSelect: 'none' }}>
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            {cat.label}
                          </td>
                          {renderGroupCells(month.num, null, true, types)}
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, padding: '4px 10px', fontWeight: catTotal > 0 ? 700 : 400, border: '1px solid var(--rb-border)' }}>
                            {catTotal > 0 ? fmtRub(catTotal) : <span style={{ color: '#cbd5e1' }}>{DASH}</span>}
                          </td>
                        </tr>
                        {isExpanded && types.map(type => renderTypeRow(type, month, true))}
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
              {renderedGroups.flatMap(grp => {
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
                  totCell,
                  ...grp.items.flatMap(item => {
                    const itemTot = filteredMonths.reduce((ms, m) =>
                      ms + filteredTypes.reduce((ts, type) => ts + getItemSum(item, m.num, type.key), 0), 0);
                    return [
                      <td key={`tot_${grp.key}_${item.id}_q`} style={{ border: '1px solid var(--rb-border)' }} />,
                      <td key={`tot_${grp.key}_${item.id}_p`} style={{ border: '1px solid var(--rb-border)' }} />,
                      <td key={`tot_${grp.key}_${item.id}_s`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13, padding: '10px', border: '1px solid var(--rb-border)' }}>
                        {itemTot > 0 ? fmtRubP(itemTot) : DASH}
                      </td>,
                    ];
                  }),
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

  // Derive year and filtered months from the shared period selector
  const year = useMemo(
    () => (periodStart || new Date()).getFullYear(),
    [periodStart]
  );
  const filteredMonths = useMemo(() => {
    if (!periodStart || !periodEnd) return MONTHS_RU;
    const startM = periodStart.getFullYear() === year ? periodStart.getMonth() + 1 : 1;
    const endM   = periodEnd.getFullYear()   === year ? periodEnd.getMonth()   + 1 : 12;
    return MONTHS_RU.filter(m => m.num >= startM && m.num <= endM);
  }, [periodStart, periodEnd, year]);

  useEffect(() => {
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
  }, []);

  const allUtilTypes = useMemo(
    () => utilCats.flatMap(c => c.types.map(t => ({ ...t, catKey: c.key }))),
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
    return items;
  }, [renderedGroups, filteredMonths, filteredTypes, cabinetMeta, year, getSum]);

  if (loading) return <Spinner text="Загрузка…" />;

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Category filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>Категория:</span>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ padding: '3px 8px', border: '1px solid var(--rb-border)', borderRadius: 5,
                   fontSize: 12, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          <option value="">Все категории</option>
          {utilCats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
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

      {activeTab === 'clinics'   && <TabClinics roomCountByClinic={roomCountByClinic} />}
      {activeTab === 'cabinets'  && <TabCabinets appointments={appointments} loadingAppts={loadingAppts} doctors={doctors} />}
      {activeTab === 'doctors'   && <TabDoctors doctors={doctors} excelSources={excelSources} />}
      {activeTab === 'equipment' && <TabEquipment />}
      {activeTab === 'utilities' && <TabUtilities />}
    </div>
  );
}
