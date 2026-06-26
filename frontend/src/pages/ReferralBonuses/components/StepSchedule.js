import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { doctorSchedules as schedulesApi, rbScheduleDicts as dictsApi, roleNorms as roleNormsApi, hourNorms as hourNormsApi, categoryNorms as categoryNormsApi, rbHolidays as holidaysApi, executorSettings as execSettingsApi } from '../../../services/api';
import { useTabSlider } from '../utils/useTabSlider';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { STATUS_CODES } from './TabelTable';
import DivisionAccessPanel from './DivisionAccessPanel';

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const MONTH_NAMES_GEN = [
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря',
];
const DAY_NAMES   = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const WDAY_LABELS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const PATTERN_LABELS = {
  daily:     'Ежедневно',
  workdays:  'Будние',
  two_two:   '2/2',
  weekdays:  'По дням',
  even_odd:  'Чётные / нечётные',
  custom:    'Произвольно',
};

function pad2(n) { return String(n).padStart(2, '0'); }
function formatDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(dateStr, n) { const d = parseDate(dateStr); d.setDate(d.getDate() + n); return formatDate(d); }
function cellDate(cell) { return formatDate(new Date(cell.year, cell.month - 1, cell.day)); }
function displayDate(cell) { return `${cell.day} ${MONTH_NAMES_GEN[cell.month - 1]} ${cell.year}`; }
function fmtDateShort(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${MONTH_NAMES_GEN[parseInt(m) - 1]}`;
}

// Half-period freeze: a date is locked for non-admin edits once its half-month
// has passed the cutoff — 1st half closes on the 18th of its own month, 2nd half
// on the 3rd of the next month. Mirrors TabelTable's lock logic. `today` must be
// normalised to midnight. Frozen dates always form a contiguous prefix in time.
function isDateFrozen(d, today) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const halfSize = Math.floor(new Date(y, m, 0).getDate() / 2);
  if (day <= halfSize) return today >= new Date(y, m - 1, 18);
  return today >= new Date(y, m, 3);
}

function toMins(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}
function timesOverlap(from1, to1, from2, to2) {
  let s1 = toMins(from1), e1 = toMins(to1);
  let s2 = toMins(from2), e2 = toMins(to2);
  if (e1 <= s1) e1 += 1440;
  if (e2 <= s2) e2 += 1440;
  return s1 < e2 && s2 < e1;
}
function findTimeConflicts(form, entries, editId) {
  const conflicts = [];
  const end = parseDate(form.dateTo);
  const cur = parseDate(form.dateFrom);
  let dayCount = 0;
  while (cur <= end && dayCount < 366 && conflicts.length < 5) {
    const year = cur.getFullYear(), month = cur.getMonth() + 1, day = cur.getDate();
    const dateStr = formatDate(cur);
    dayCount++;
    if (isDayScheduled(form, year, month, day)) {
      for (const entry of entries) {
        if (entry.id === editId) continue;
        if (String(entry.clinicId) !== String(form.clinicId)) continue;
        if (!isDayScheduled(entry, year, month, day)) continue;
        if (!timesOverlap(form.timeFrom, form.timeTo, entry.timeFrom, entry.timeTo)) continue;
        let rec = conflicts.find(c => c.entry.id === entry.id);
        if (!rec) { rec = { entry, dates: [] }; conflicts.push(rec); }
        if (rec.dates.length < 3) rec.dates.push(dateStr);
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return conflicts;
}

function getContrastColor(hex) {
  const h = (hex || '#94a3b8').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return (r * 0.299 + g * 0.587 + b * 0.114) > 140 ? 'rgba(0,0,0,0.7)' : '#fff';
}

function abbreviateName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  const [last, ...rest] = parts;
  return last + ' ' + rest.map(p => p[0] ? p[0].toUpperCase() + '.' : '').join(' ');
}

function patternSummary(pattern) {
  switch (pattern.type) {
    case 'daily':    return 'Ежедневно';
    case 'workdays': return 'Будние';
    case 'two_two':  return '2/2';
    case 'weekdays': return pattern.weekdays?.length ? pattern.weekdays.map(i => WDAY_LABELS[i]).join(', ') : 'По дням';
    case 'even_odd': return pattern.evenOdd === 'even' ? 'Чётные дни' : 'Нечётные дни';
    case 'custom':   return `${pattern.workDays || 1} раб. / ${pattern.restDays || 1} вых.`;
    default:         return '';
  }
}

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0).getDate();
  let startDow   = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const prevDate  = new Date(year, month - 2, 1);
  const prevYear  = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;
  const prevLast  = new Date(year, month - 1, 0).getDate();
  const nextDate  = new Date(year, month, 1);
  const nextYear  = nextDate.getFullYear();
  const nextMonth = nextDate.getMonth() + 1;

  const cells = [];
  for (let i = startDow - 1; i >= 0; i--)
    cells.push({ day: prevLast - i, month: prevMonth, year: prevYear, isCurrentMonth: false });
  for (let d = 1; d <= lastDay; d++)
    cells.push({ day: d, month, year, isCurrentMonth: true });
  const tail = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let d = 1; d <= tail; d++)
    cells.push({ day: d, month: nextMonth, year: nextYear, isCurrentMonth: false });

  const grid = [];
  for (let i = 0; i < cells.length; i += 7) grid.push(cells.slice(i, i + 7));
  return grid;
}

function isDayScheduled(entry, year, month, day) {
  const d    = new Date(year, month - 1, day);
  const from = parseDate(entry.dateFrom);
  const to   = parseDate(entry.dateTo);
  if (d < from || d > to) return false;
  const { pattern } = entry;
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // 0=Mon … 6=Sun

  // Weekday filter: applies to all patterns except 'weekdays' (which already IS the day filter)
  if (pattern.type !== 'weekdays') {
    const allowed = pattern.allowedWeekdays;
    if (allowed && allowed.length > 0 && allowed.length < 7) {
      if (!allowed.includes(dow)) return false;
    }
  }

  switch (pattern.type) {
    case 'daily':    return true;
    case 'workdays': return dow <= 4; // Mon–Fri
    case 'two_two': {
      const anchor = pattern.phaseAnchor ? parseDate(pattern.phaseAnchor) : from;
      const diff = Math.round((d - anchor) / 86400000);
      return diff % 4 < 2;
    }
    case 'weekdays': return (pattern.weekdays || []).includes(dow);
    case 'even_odd': return pattern.evenOdd === 'even' ? d.getDate() % 2 === 0 : d.getDate() % 2 === 1;
    case 'custom': {
      const anchor = pattern.phaseAnchor ? parseDate(pattern.phaseAnchor) : from;
      const diff  = Math.round((d - anchor) / 86400000);
      const cycle = (pattern.workDays || 1) + (pattern.restDays || 1);
      return diff % cycle < (pattern.workDays || 1);
    }
    default: return false;
  }
}

function makeBlankForm(cell, doctorClinics) {
  return {
    clinicId:   doctorClinics[0] ? String(doctorClinics[0].id) : '',
    dateFrom:   formatDate(new Date(cell.year, cell.month - 1, cell.day)),
    dateTo:     formatDate(new Date(cell.year, cell.month, 0)),
    pattern:    { type: 'daily', weekdays: [], allowedWeekdays: [], evenOdd: 'even', workDays: 5, restDays: 2 },
    timeFrom:   '09:00',
    timeTo:     '18:00',
    categoryId: null,
    cabinetId:  null,
    roleTitle:  null,
    cancelCode: null,
  };
}

function entryToForm(entry) {
  return {
    clinicId:   entry.clinicId,
    dateFrom:   entry.dateFrom,
    dateTo:     entry.dateTo,
    pattern:    { ...entry.pattern, weekdays: [...(entry.pattern.weekdays || [])], allowedWeekdays: [...(entry.pattern.allowedWeekdays || [])] },
    timeFrom:   entry.timeFrom,
    timeTo:     entry.timeTo,
    categoryId: entry.categoryId || null,
    cabinetId:  entry.cabinetId  || null,
    roleTitle:  entry.roleTitle  || null,
  };
}

// ── Calendar date-range picker (adapted from StepReport) ─────────────────────
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS_RU   = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function CalendarPopover({ dateFrom, dateTo, focusField, onSelect }) {
  const initDate = (focusField === 'to' && dateTo ? dateTo : dateFrom) || '';
  const initD = initDate ? new Date(initDate + 'T00:00:00') : new Date();
  const [viewYear,  setViewYear]  = useState(initD.getFullYear());
  const [viewMonth, setViewMonth] = useState(initD.getMonth());
  const [hover,     setHover]     = useState(null);

  const fmt = (y, m, d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const today       = fmt(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay();
  const firstDay    = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
  const cells       = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const prevM = () => viewMonth === 0 ? (setViewMonth(11), setViewYear(y => y-1)) : setViewMonth(m => m-1);
  const nextM = () => viewMonth === 11 ? (setViewMonth(0),  setViewYear(y => y+1)) : setViewMonth(m => m+1);

  const previewEnd   = focusField === 'to'   ? (hover || dateTo)   : dateTo;
  const previewStart = focusField === 'from' ? (hover || dateFrom) : dateFrom;
  const isStart   = ds => ds === (focusField === 'from' ? previewStart : dateFrom);
  const isEnd     = ds => ds === previewEnd && previewEnd !== previewStart;
  const isInRange = ds => {
    if (!previewStart || !previewEnd) return false;
    const [f, t] = previewStart <= previewEnd ? [previewStart, previewEnd] : [previewEnd, previewStart];
    return ds > f && ds < t;
  };

  return (
    <div style={{ position: 'fixed', zIndex: 9999, background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.14)', padding: '12px 10px', width: 252, top: 'var(--cal-top)', left: 'var(--cal-left)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={prevM} style={{ background: 'var(--rb-primary)', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 5, fontSize: 16, color: '#fff', lineHeight: 1 }}>‹</button>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{MONTHS_RU[viewMonth]} {viewYear}</span>
        <button onClick={nextM} style={{ background: 'var(--rb-primary)', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 5, fontSize: 16, color: '#fff', lineHeight: 1 }}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 4 }}>
        {DAYS_RU.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--rb-text-secondary)', padding: '2px 0' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = fmt(viewYear, viewMonth, day);
          const start = isStart(ds), end = isEnd(ds), inRange = isInRange(ds), isToday = ds === today;
          return (
            <button key={i} onClick={() => onSelect(ds)} onMouseEnter={() => setHover(ds)} onMouseLeave={() => setHover(null)} style={{
              padding: '5px 0', border: 'none', cursor: 'pointer', fontSize: 12,
              borderRadius: (start || end) ? 6 : inRange ? 0 : 6,
              background: (start || end) ? 'var(--rb-primary)' : inRange ? '#dbeafe' : 'transparent',
              color: (start || end) ? 'white' : isToday ? 'var(--rb-primary)' : 'var(--rb-text)',
              fontWeight: isToday ? 700 : 400,
              outline: isToday && !start && !end ? '1.5px solid var(--rb-primary)' : 'none',
              outlineOffset: -2,
            }}>{day}</button>
          );
        })}
      </div>
    </div>
  );
}

const fmtDisplay  = str => { if (!str) return ''; const [y,m,d] = str.split('-'); return `${d}.${m}.${y}`; };
const parseManual = str => {
  if (!str || str.length !== 10) return null;
  const mo = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!mo) return null;
  const iso = `${mo[3]}-${mo[2]}-${mo[1]}`;
  return isNaN(new Date(iso + 'T00:00:00').getTime()) ? null : iso;
};

function DateFieldCal({ value, onChange, onAutoAdvance, isOpen, onToggleCalendar, inputRef, anchorRef }) {
  const [raw, setRaw] = useState(fmtDisplay(value));
  useEffect(() => { setRaw(fmtDisplay(value)); }, [value]);

  const handleChange = e => {
    const v = e.target.value; setRaw(v);
    if (v === '') { onChange(''); return; }
    const iso = parseManual(v);
    if (iso) { onChange(iso); onAutoAdvance?.(); }
  };
  const handleBlur = () => {
    const iso = parseManual(raw);
    if (iso) { onChange(iso); setRaw(fmtDisplay(iso)); }
    else if (raw && raw !== fmtDisplay(value)) setRaw(fmtDisplay(value));
  };

  return (
    <div ref={anchorRef} style={{ display: 'flex', alignItems: 'center', border: isOpen ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border)', borderRadius: 7, background: isOpen ? '#f0f7ff' : 'var(--rb-bg)', height: 32, overflow: 'hidden', boxShadow: isOpen ? '0 0 0 3px rgba(0,122,255,.12)' : 'none', transition: 'all .15s' }}>
      <input ref={inputRef} type="text" value={raw} onChange={handleChange} onBlur={handleBlur}
        placeholder="дд.мм.гггг" maxLength={10}
        style={{ width: 88, padding: '0 8px', border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--rb-text)', height: '100%' }} />
      <button type="button" onClick={onToggleCalendar}
        style={{ padding: '0 7px', height: '100%', border: 'none', borderLeft: '1px solid var(--rb-border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', color: isOpen ? 'var(--rb-primary)' : 'var(--rb-text-secondary)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>
    </div>
  );
}

function DateRangePicker({ dateFrom, setDateFrom, dateTo, setDateTo }) {
  const [open, setOpen]     = useState(null);
  const [calPos, setCalPos] = useState({ top: 0, left: 0 });
  const toRef = useRef(null), wrapRef = useRef(null), fromAnchor = useRef(null), toAnchor = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openCalendar = field => {
    const anchor = field === 'from' ? fromAnchor.current : toAnchor.current;
    if (anchor) { const r = anchor.getBoundingClientRect(); setCalPos({ top: r.bottom + 4, left: r.left }); }
    setOpen(o => o === field ? null : field);
  };
  const handleSelect = ds => {
    if (open === 'from') {
      setDateFrom(ds);
      if (dateTo && ds > dateTo) setDateTo('');
      const anchor = toAnchor.current;
      if (anchor) { const r = anchor.getBoundingClientRect(); setCalPos({ top: r.bottom + 4, left: r.left }); }
      setOpen('to');
      setTimeout(() => toRef.current?.focus(), 0);
    } else {
      if (dateFrom && ds < dateFrom) { setDateTo(dateFrom); setDateFrom(ds); } else setDateTo(ds);
      setOpen(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <DateFieldCal anchorRef={fromAnchor} value={dateFrom}
        onChange={v => { setDateFrom(v); if (v && dateTo && v > dateTo) setDateTo(''); }}
        onAutoAdvance={() => { openCalendar('to'); setTimeout(() => toRef.current?.focus(), 0); }}
        isOpen={open === 'from'} onToggleCalendar={() => openCalendar('from')} />
      {open === 'from' && <div style={{ '--cal-top': calPos.top + 'px', '--cal-left': calPos.left + 'px' }}><CalendarPopover dateFrom={dateFrom} dateTo={dateTo} focusField="from" onSelect={handleSelect} /></div>}
      <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>—</span>
      <DateFieldCal anchorRef={toAnchor} inputRef={toRef} value={dateTo} onChange={setDateTo}
        isOpen={open === 'to'} onToggleCalendar={() => openCalendar('to')} />
      {open === 'to' && <div style={{ '--cal-top': calPos.top + 'px', '--cal-left': calPos.left + 'px' }}><CalendarPopover dateFrom={dateFrom} dateTo={dateTo} focusField="to" onSelect={handleSelect} /></div>}
    </div>
  );
}

// ── Clock time picker ─────────────────────────────────────────────────────────
const CLK_CX = 100, CLK_CY = 100, CLK_R_OUT = 80, CLK_R_IN = 52, CLK_R_MIN = 80;
const OUTER_H  = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const INNER_H  = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_V = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function clkXY(index, r) {
  const a = (index / 12) * 2 * Math.PI - Math.PI / 2;
  return { x: CLK_CX + r * Math.cos(a), y: CLK_CY + r * Math.sin(a) };
}

const ClockPicker = React.forwardRef(function ClockPicker({ value, onChange, onComplete }, ref) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('hour');
  const [pos,  setPos]  = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const wrapRef   = useRef(null);

  const hour   = parseInt(value?.split(':')[0] ?? '9')  || 0;
  const minute = parseInt(value?.split(':')[1] ?? '0')  || 0;

  useEffect(() => {
    if (!open) return;
    const close = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openClock = () => {
    if (anchorRef.current) { const r = anchorRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 4, left: r.left }); }
    setMode('hour');
    setOpen(true);
  };

  // Expose open() so parent can trigger it programmatically
  useImperativeHandle(ref, () => ({ open: openClock }));

  const pickHour   = h => { onChange(`${pad2(h)}:${pad2(minute)}`); setMode('minute'); };
  const pickMinute = m => {
    onChange(`${pad2(hour)}:${pad2(m)}`);
    setOpen(false);
    onComplete?.();
  };

  // Hand end position
  let hx, hy;
  if (mode === 'hour') {
    const oi = OUTER_H.indexOf(hour), ii = INNER_H.indexOf(hour);
    if (oi >= 0) { const p = clkXY(oi, CLK_R_OUT); hx = p.x; hy = p.y; }
    else if (ii >= 0) { const p = clkXY(ii, CLK_R_IN); hx = p.x; hy = p.y; }
  } else {
    const mi = MINUTE_V.indexOf(minute);
    if (mi >= 0) { const p = clkXY(mi, CLK_R_MIN); hx = p.x; hy = p.y; }
    else { const a = (minute / 60) * 2 * Math.PI - Math.PI / 2; hx = CLK_CX + CLK_R_MIN * Math.cos(a); hy = CLK_CY + CLK_R_MIN * Math.sin(a); }
  }

  return (
    <div ref={wrapRef} style={{ display: 'inline-block', position: 'relative' }}>
      <button ref={anchorRef} type="button" onClick={openClock} style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px',
        borderRadius: 7, border: open ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border)',
        background: open ? '#f0f7ff' : 'var(--rb-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--rb-text)',
        boxShadow: open ? '0 0 0 3px rgba(0,122,255,.12)' : 'none', transition: 'all .15s', minWidth: 82,
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ color: open ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        {value || '—'}
      </button>

      {open && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.15)', padding: '14px 14px 12px', userSelect: 'none' }}>
          {/* HH:MM display */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, marginBottom: 12 }}>
            {[['hour', hour], ['minute', minute]].map(([m, val], i) => (
              <React.Fragment key={m}>
                {i === 1 && <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--rb-text-secondary)', lineHeight: 1 }}>:</span>}
                <span onClick={() => setMode(m)} style={{
                  fontSize: 30, fontWeight: 700, lineHeight: 1, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', transition: 'all .15s',
                  background: mode === m ? 'var(--rb-primary)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--rb-text)',
                }}>{pad2(val)}</span>
              </React.Fragment>
            ))}
          </div>

          {/* Clock SVG */}
          <svg width="200" height="200" style={{ display: 'block' }}>
            <circle cx={CLK_CX} cy={CLK_CY} r={94} fill="#f1f5f9" />
            <circle cx={CLK_CX} cy={CLK_CY} r={4}  fill="var(--rb-primary)" />
            {hx !== undefined && (
              <>
                <line x1={CLK_CX} y1={CLK_CY} x2={hx} y2={hy} stroke="var(--rb-primary)" strokeWidth={2} strokeLinecap="round" />
                <circle cx={hx} cy={hy} r={17} fill="var(--rb-primary)" fillOpacity={0.15} />
              </>
            )}
            {mode === 'hour' ? (
              <>
                {OUTER_H.map((h, i) => {
                  const { x, y } = clkXY(i, CLK_R_OUT);
                  const sel = h === hour;
                  return (
                    <g key={h} onClick={() => pickHour(h)} style={{ cursor: 'pointer' }}>
                      <circle cx={x} cy={y} r={17} fill={sel ? 'var(--rb-primary)' : 'transparent'} />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="12" fill={sel ? '#fff' : 'var(--rb-text)'} fontWeight={sel ? '700' : '400'}>{pad2(h)}</text>
                    </g>
                  );
                })}
                {INNER_H.map((h, i) => {
                  const { x, y } = clkXY(i, CLK_R_IN);
                  const sel = h === hour;
                  return (
                    <g key={`i${h}`} onClick={() => pickHour(h)} style={{ cursor: 'pointer' }}>
                      <circle cx={x} cy={y} r={13} fill={sel ? 'var(--rb-primary)' : 'transparent'} />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="11" fill={sel ? '#fff' : 'var(--rb-text-secondary)'} fontWeight={sel ? '700' : '400'}>{h}</text>
                    </g>
                  );
                })}
              </>
            ) : (
              MINUTE_V.map((m, i) => {
                const { x, y } = clkXY(i, CLK_R_MIN);
                const sel = m === minute;
                return (
                  <g key={m} onClick={() => pickMinute(m)} style={{ cursor: 'pointer' }}>
                    <circle cx={x} cy={y} r={17} fill={sel ? 'var(--rb-primary)' : 'transparent'} />
                    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="12" fill={sel ? '#fff' : 'var(--rb-text)'} fontWeight={sel ? '700' : '400'}>{pad2(m)}</text>
                  </g>
                );
              })
            )}
          </svg>

          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 4 }}>
            {mode === 'hour' ? 'Выберите час' : 'Выберите минуты'}
          </div>
        </div>
      )}
    </div>
  );
});

// ── Shared search box rendered at top of any popover dropdown ─────────────────
function DropdownSearch({ value, onChange, inputRef }) {
  return (
    <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--rb-text-secondary)" strokeWidth="2" width="13" height="13" style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Поиск..."
        onMouseDown={e => e.stopPropagation()}
        style={{
          flex: 1, border: 'none', outline: 'none', fontSize: 13,
          background: 'transparent', color: 'var(--rb-text)', fontFamily: 'inherit',
        }}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'var(--rb-text-secondary)', fontSize: 15 }}>×</button>
      )}
    </div>
  );
}

// ── Clinic select dropdown ────────────────────────────────────────────────────
function ClinicSelect({ value, onChange, clinics, getClinicColor, getClinicName }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  const handleOpen = useCallback(() => {
    updatePos();
    setOpen(v => !v);
    setSearch('');
  }, [updatePos]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = e => {
      if (
        btnRef.current && btnRef.current.contains(e.target)
      ) return;
      if (
        wrapRef.current && wrapRef.current.contains(e.target)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', () => setOpen(false), true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', () => setOpen(false), true);
    };
  }, [open]);

  const selected = clinics.find(c => String(c.id) === value);
  const color    = selected ? getClinicColor(String(selected.id)) : '#94a3b8';

  const filtered = search
    ? clinics.filter(c => getClinicName(String(c.id)).toLowerCase().includes(search.toLowerCase()))
    : clinics;

  const dropdown = open && ReactDOM.createPortal(
    <div ref={wrapRef} style={{
      position: 'fixed', top: dropPos.top, left: dropPos.left, width: Math.max(dropPos.width, 200),
      zIndex: 9999, background: '#fff', border: '1px solid var(--rb-border)',
      borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,.12)', fontFamily: 'Inter, sans-serif',
      maxHeight: 280, display: 'flex', flexDirection: 'column',
    }}>
      <DropdownSearch value={search} onChange={setSearch} inputRef={searchRef} />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0
          ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>
          : filtered.map(c => {
              const cid = String(c.id), col = getClinicColor(cid), sel = cid === value;
              return (
                <button key={cid} type="button" onClick={() => { onChange(cid); setOpen(false); }} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
                  border: 'none', background: sel ? '#EFF6FF' : 'transparent', cursor: 'pointer',
                  fontSize: 13, color: 'var(--rb-text)', textAlign: 'left', fontFamily: 'inherit',
                }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: col, flexShrink: 0, boxShadow: `0 0 0 2px ${col}44` }} />
                  <span style={{ flex: 1 }}>{getClinicName(cid)}</span>
                  {sel && <svg viewBox="0 0 24 24" fill="none" stroke="var(--rb-primary)" strokeWidth="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              );
            })
        }
      </div>
    </div>,
    document.body
  );

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} type="button" onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px 0 12px',
        borderRadius: 8, border: open ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border)',
        background: open ? '#f0f7ff' : 'var(--rb-bg)', cursor: 'pointer', fontSize: 13,
        color: selected ? 'var(--rb-text)' : 'var(--rb-text-secondary)', minWidth: 200,
        boxShadow: open ? '0 0 0 3px rgba(0,122,255,.12)' : 'none', transition: 'all .15s', fontFamily: 'inherit',
      }}>
        {selected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />}
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? getClinicName(String(selected.id)) : 'Выберите медцентр'}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0, color: 'var(--rb-text-secondary)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// Generic popover select reused for category, cabinet, role, profession
function PopoverSelect({ value, onChange, items, placeholder, renderDot, renderLabel, searchable = true }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const maxH = 280;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openAbove = spaceBelow < maxH && spaceAbove > spaceBelow;
    setDropPos({
      top: openAbove ? undefined : r.bottom + 4,
      bottom: openAbove ? window.innerHeight - r.top + 4 : undefined,
      left: r.left,
      width: r.width,
      maxH: openAbove ? Math.min(spaceAbove, maxH) : Math.min(spaceBelow, maxH),
    });
  }, []);

  const handleOpen = useCallback(() => { updatePos(); setOpen(v => !v); setSearch(''); }, [updatePos]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = e => {
      if (btnRef.current?.contains(e.target) || wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = e => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const selected = items.find(it => it.id === value);

  const filtered = search
    ? items.filter(it => renderLabel(it).toLowerCase().includes(search.toLowerCase()))
    : items;

  const dropdown = open && ReactDOM.createPortal(
    <div ref={wrapRef} style={{
      position: 'fixed', top: dropPos.top, bottom: dropPos.bottom, left: dropPos.left,
      width: Math.max(dropPos.width, 180),
      maxHeight: dropPos.maxH || 280,
      zIndex: 9999, background: '#fff', border: '1px solid var(--rb-border)',
      borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,.12)', fontFamily: 'Inter, sans-serif',
      display: 'flex', flexDirection: 'column',
    }}>
      {searchable && <DropdownSearch value={search} onChange={setSearch} inputRef={searchRef} />}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* clear option */}
        {!search && (
          <button type="button" onClick={() => { onChange(null); setOpen(false); }} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
            border: 'none', background: !value ? '#EFF6FF' : 'transparent', cursor: 'pointer',
            fontSize: 13, color: 'var(--rb-text-secondary)', textAlign: 'left', fontFamily: 'inherit',
          }}>
            {placeholder}
          </button>
        )}
        {filtered.length === 0
          ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>
          : filtered.map(it => {
              const sel = it.id === value;
              return (
                <button key={it.id} type="button" onClick={() => { onChange(it.id); setOpen(false); }} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
                  border: 'none', background: sel ? '#EFF6FF' : 'transparent', cursor: 'pointer',
                  fontSize: 13, color: 'var(--rb-text)', textAlign: 'left', fontFamily: 'inherit',
                }}>
                  {renderDot && renderDot(it)}
                  <span style={{ flex: 1 }}>{renderLabel(it)}</span>
                  {sel && <svg viewBox="0 0 24 24" fill="none" stroke="var(--rb-primary)" strokeWidth="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              );
            })
        }
      </div>
    </div>,
    document.body
  );

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button ref={btnRef} type="button" onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px 0 12px',
        borderRadius: 8, border: open ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border)',
        background: open ? '#f0f7ff' : 'var(--rb-bg)', cursor: 'pointer', fontSize: 13,
        color: selected ? 'var(--rb-text)' : 'var(--rb-text-secondary)', width: '100%',
        boxShadow: open ? '0 0 0 3px rgba(0,122,255,.12)' : 'none', transition: 'all .15s', fontFamily: 'inherit',
      }}>
        {selected && renderDot && renderDot(selected)}
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? renderLabel(selected) : placeholder}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0, color: 'var(--rb-text-secondary)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const inputStyle = {
  padding: '6px 10px', border: '1px solid var(--rb-border)', borderRadius: 8,
  fontSize: 13, background: 'var(--rb-bg)', color: 'var(--rb-text)', outline: 'none',
};
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--rb-text-secondary)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4,
};
const sectionStyle = { padding: '14px 16px', borderBottom: '1px solid var(--rb-border)' };

// Unified button styles for day modal
const BTN_W = 140;
const btnBlue = {
  width: BTN_W, fontSize: 12, padding: '6px 0', cursor: 'pointer',
  background: 'var(--rb-primary)', color: '#fff',
  border: '1px solid var(--rb-primary)', borderRadius: 8, fontWeight: 500,
};
const btnRed = {
  width: BTN_W, fontSize: 12, padding: '6px 0', cursor: 'pointer',
  background: '#dc2626', color: '#fff',
  border: '1px solid #dc2626', borderRadius: 8, fontWeight: 500,
};
const btnGhost = {
  width: BTN_W, fontSize: 12, padding: '6px 0', cursor: 'pointer',
  background: 'var(--rb-bg)', color: 'var(--rb-text)',
  border: '1px solid var(--rb-border)', borderRadius: 8, fontWeight: 500,
};

// ═════════════════════════════════════════════════════════════════════════════
export default function StepSchedule({ selectedDoctorId, doctors, clinics, getClinicColor, getClinicName, readOnly = false, managingDivision, onDivisionRenamed, scheduleCategories = [], allRoles = [], allProfessions = [] }) {
  const { isAdmin } = useAuth();
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quickNav,          setQuickNav]          = useState(false);
  const [quickNavStep,      setQuickNavStep]      = useState('year'); // 'year' | 'month'
  const [quickNavYear,      setQuickNavYear]      = useState(now.getFullYear());
  const [quickNavYearStart, setQuickNavYearStart] = useState(Math.floor(now.getFullYear() / 10) * 10);
  const quickNavRef = useRef(null);

  // entries for currently selected doctor (loaded from API)
  const [entries,     setEntries]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);

  // dictionaries (categories + cabinets)
  const [categories,  setCategories]  = useState([]);
  const [cabinets,    setCabinets]    = useState([]);

  // norms for current month (roles + professions + categories)
  const [roleNorms,     setRoleNorms]     = useState([]);
  const [hourNorms,     setHourNorms]     = useState([]);
  const [categoryNorms, setCategoryNorms] = useState([]); // [{ categoryId, normHours }]

  // modal: null | { type: 'day', cell } | { type: 'form', cell, editId: null|string }
  const [modal,       setModal]       = useState(null);
  const [form,        setForm]        = useState(null);
  const [confirmDel,     setConfirmDel]     = useState(null); // entryId to confirm deletion
  const [cancelModal,    setCancelModal]    = useState(null); // { entryId, cell } — reason picker
  const [conflictConfirm, setConflictConfirm] = useState(null); // [{ entry, dates }] — time overlap warning
  const skipConflictCheck = useRef(false);

  // MIS auto-import block flag
  const [disableMisAutoImport, setDisableMisAutoImport] = useState(false);
  const [savingAutoImportFlag, setSavingAutoImportFlag] = useState(false);
  const execSettingsRef = useRef({});

  // MIS import
  const [catMapModal,        setCatMapModal]        = useState(false);
  const [catMapData,         setCatMapData]         = useState([]);
  const [catMapLoading,      setCatMapLoading]      = useState(false);
  const [cancelImportModal,  setCancelImportModal]  = useState(false);
  const [cancelling,         setCancelling]         = useState(false);
  const [importModal,        setImportModal]        = useState(false);
  const [importing,          setImporting]          = useState(false);

  // Tab slider for pattern selector inside the form modal
  const { wrapRef: patternWrapRef, sliderEl: patternSliderEl } = useTabSlider(form?.pattern?.type ?? 'daily');

  // Ref to the second ClockPicker so the first can auto-open it on complete
  const timeToClockRef = useRef(null);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId) || null;
  const doctorRoles = React.useMemo(() => {
    if (!selectedDoctor) return [];
    return [...new Set((selectedDoctor.roles || []).filter(Boolean))];
  }, [selectedDoctor]);

  const doctorProfessions = React.useMemo(() => {
    if (!selectedDoctor) return [];
    return [...new Set(
      (selectedDoctor.professions || [])
        .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
        .filter(Boolean)
    )];
  }, [selectedDoctor]);
  const doctorClinics  = selectedDoctor
    ? clinics.filter(c => (selectedDoctor.clinics || []).includes(String(c.id)))
    : [];

  const [holidayDates, setHolidayDates] = useState(new Set());

  // Half-period locks — mirrors TabelTable logic.
  // Computed per-cell using cell's own year/month so neighbor-month cells
  // (e.g. Apr 27-30 visible while viewing May) are evaluated correctly.
  const lockToday = new Date(); lockToday.setHours(0, 0, 0, 0);
  const isCellFrozen = (cell) =>
    isDateFrozen(new Date(cell.year, cell.month - 1, cell.day), lockToday);
  // isCellLocked — actual edit restriction (non-admins only)
  const isCellLocked = (cell) => !isAdmin && isCellFrozen(cell);

  // ── Load dictionaries once ───────────────────────────────────────────────
  useEffect(() => {
    dictsApi.listCategories().then(r => setCategories(r.data)).catch(() => {});
    dictsApi.listCabinets().then(r => setCabinets(r.data)).catch(() => {});
    holidaysApi.list().then(r => setHolidayDates(new Set((r.data || []).map(h => h.date)))).catch(() => {});
  }, []);

  // ── Load role + profession + category norms when month/year changes ──────
  useEffect(() => {
    Promise.all([
      roleNormsApi.get(year, month).catch(() => ({ data: [] })),
      hourNormsApi.get(year, month).catch(() => ({ data: [] })),
      categoryNormsApi.get(year, month).catch(() => ({ data: [] })),
    ]).then(([roleRes, hourRes, catRes]) => {
      setRoleNorms(roleRes.data || []);
      setHourNorms(hourRes.data || []);
      setCategoryNorms(catRes.data || []);
    });
  }, [year, month]);

  // ── Load entries when selected doctor changes ─────────────────────────────
  const loadedForRef = useRef(null);
  useEffect(() => {
    if (!selectedDoctor) {
      setEntries([]);
      setDisableMisAutoImport(false);
      execSettingsRef.current = {};
      loadedForRef.current = null;
      return;
    }
    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    if (loadedForRef.current === misUserId) return;
    loadedForRef.current = misUserId;

    setLoading(true);
    Promise.all([
      schedulesApi.list(misUserId),
      execSettingsApi.get(misUserId).catch(() => ({ data: {} })),
    ])
      .then(([schedRes, settingsRes]) => {
        setEntries(schedRes.data.map(r => mapSchedRow(r, selectedDoctor.id)));
        const s = settingsRes.data || {};
        execSettingsRef.current = s;
        const isDoctor = (selectedDoctor.roles || []).includes('Врач');
        setDisableMisAutoImport('disableMisAutoImport' in s ? !!s.disableMisAutoImport : !isDoctor);
      })
      .catch(err => console.error('Load schedules error:', err))
      .finally(() => setLoading(false));
  }, [selectedDoctor]);

  // Map a raw schedule row from the API into a local entry
  function mapSchedRow(r, doctorId) {
    return {
      id:         r.id,
      doctorId,
      misUserId:  r.misUserId,
      clinicId:   r.clinicId,
      dateFrom:   r.dateFrom,
      dateTo:     r.dateTo,
      pattern:    r.pattern,
      timeFrom:   r.timeFrom,
      timeTo:     r.timeTo,
      exceptions: r.exceptions || [],
      categoryId: r.categoryId || null,
      cabinetId:  r.cabinetId  || null,
      roleTitle:  r.roleTitle  || null,
      source:     r.source || 'manual',
    };
  }

  // Re-fetch entries for the selected doctor (after a MIS import)
  const reloadEntries = useCallback(async () => {
    if (!selectedDoctor) return;
    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    const res = await schedulesApi.list(misUserId);
    setEntries(res.data.map(r => mapSchedRow(r, selectedDoctor.id)));
  }, [selectedDoctor]);

  // Entries for a specific cell
  const getCellEntries = useCallback((cell) => {
    if (!selectedDoctor) return [];
    return entries
      .filter(e => isDayScheduled(e, cell.year, cell.month, cell.day))
      .sort((a, b) => a.timeFrom.localeCompare(b.timeFrom));
  }, [entries, selectedDoctor]);

  // Exceptions can be string (legacy) or { date, code } object
  const getExceptionEntry = (entry, cell) => {
    const dateStr = cellDate(cell);
    return (entry.exceptions || []).find(ex =>
      typeof ex === 'string' ? ex === dateStr : ex.date === dateStr
    );
  };
  const isExcepted = (entry, cell) => !!getExceptionEntry(entry, cell);
  const getExceptionCode = (entry, cell) => {
    const ex = getExceptionEntry(entry, cell);
    if (!ex) return null;
    return typeof ex === 'object' ? ex.code : 'ОТ';
  };

  const hasMisEntries = entries.some(e => e.source === 'mis_import');

  const handleCancelMisImport = useCallback(async () => {
    if (!selectedDoctor) return;
    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    setCancelling(true);
    try {
      await schedulesApi.cancelMisImport(misUserId);
      setCancelImportModal(false);
      // Remove mis_import entries from local state
      setEntries(prev => prev.filter(e => e.source !== 'mis_import'));
    } catch (err) {
      console.error('Cancel MIS import error:', err);
    } finally {
      setCancelling(false);
    }
  }, [selectedDoctor]);

  const handleImportFromMis = useCallback(async () => {
    if (!selectedDoctor) return;
    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    const monthStr  = `${year}-${String(month).padStart(2, '0')}`;
    setImporting(true);
    try {
      await schedulesApi.importFromMis(misUserId, monthStr);
      await reloadEntries();
      setImportModal(false);
    } catch (err) {
      console.error('Import from MIS error:', err);
    } finally {
      setImporting(false);
    }
  }, [selectedDoctor, year, month, reloadEntries]);

  const handleToggleDisableAutoImport = useCallback(async () => {
    if (!selectedDoctor) return;
    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    const newVal = !disableMisAutoImport;
    const newSettings = { ...execSettingsRef.current, disableMisAutoImport: newVal };
    setSavingAutoImportFlag(true);
    try {
      await execSettingsApi.save({ misUserId, doctorName: selectedDoctor.name, settings: newSettings });
      execSettingsRef.current = newSettings;
      setDisableMisAutoImport(newVal);
    } catch (err) {
      console.error('Save disableMisAutoImport error:', err);
    } finally {
      setSavingAutoImportFlag(false);
    }
  }, [selectedDoctor, disableMisAutoImport]);

  const handleCatMapUpdate = useCallback(async (misCategoryId, rbCategoryId) => {
    try {
      await schedulesApi.updateMisCategoryMap(misCategoryId, rbCategoryId || null);
      setCatMapData(prev => prev.map(r =>
        r.misCategoryId === misCategoryId ? { ...r, rbCategoryId: rbCategoryId || null } : r
      ));
    } catch (err) {
      console.error('Category map update error:', err);
    }
  }, []);

  useEffect(() => {
    if (!catMapModal) return;
    setCatMapLoading(true);
    schedulesApi.getMisCategoryMap()
      .then(res => setCatMapData(res.data))
      .catch(err => console.error('Load category map error:', err))
      .finally(() => setCatMapLoading(false));
  }, [catMapModal]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const closeModal = () => { setModal(null); setForm(null); setConfirmDel(null); setConflictConfirm(null); skipConflictCheck.current = false; };

  const handleDayClick = (cell) => {
    if (!selectedDoctor) return;
    const cellEntries = getCellEntries(cell);
    const locked = isCellLocked(cell);
    if (cellEntries.length > 0 || locked) {
      setModal({ type: 'day', cell });
    } else {
      setForm(makeBlankForm(cell, doctorClinics));
      setModal({ type: 'form', cell, editId: null });
    }
    setConfirmDel(null);
  };

  const openNewForm = (cell) => {
    setForm(makeBlankForm(cell, doctorClinics));
    setModal({ type: 'form', cell, editId: null });
    setConfirmDel(null);
  };

  const openEditForm = (entry, cell) => {
    const f = entryToForm(entry);
    if (cell) {
      f.dateFrom = cellDate(cell);
      f.dateTo   = cellDate(cell);
    }
    setForm(f);
    setModal(prev => ({ ...prev, type: 'form', editId: entry.id }));
    setConfirmDel(null);
  };

  const handleSaveDayOnly = async (misUserId) => {
    const targetDate = cellDate(modal.cell);
    const origEntry  = entries.find(e => e.id === modal.editId);
    if (!origEntry) return;

    const filterEx = (exceptions, pred) =>
      (exceptions || []).filter(ex => pred(typeof ex === 'string' ? ex : ex.date));

    const mkEntry = e => ({
      id: e.id, doctorId: selectedDoctor.id, misUserId: e.misUserId,
      clinicId: e.clinicId, dateFrom: e.dateFrom, dateTo: e.dateTo,
      pattern: e.pattern, timeFrom: e.timeFrom, timeTo: e.timeTo,
      exceptions: e.exceptions || [],
      categoryId: e.categoryId || null,
      cabinetId:  e.cabinetId  || null,
      roleTitle:  e.roleTitle  || null,
    });

    const newDayPayload = {
      misUserId,
      clinicId:   form.clinicId,
      dateFrom:   targetDate,
      dateTo:     targetDate,
      pattern:    { type: 'daily', weekdays: [], evenOdd: 'even', workDays: 1, restDays: 1 },
      timeFrom:   form.timeFrom,
      timeTo:     form.timeTo,
      exceptions: [],
      categoryId: form.categoryId || null,
      cabinetId:  form.cabinetId  || null,
      roleTitle:  form.roleTitle  || null,
    };

    if (origEntry.dateFrom === targetDate && origEntry.dateTo === targetDate) {
      // Single-day entry — just update in place
      const res = await schedulesApi.update(modal.editId, {
        clinicId: form.clinicId, dateFrom: targetDate, dateTo: targetDate,
        pattern: form.pattern, timeFrom: form.timeFrom, timeTo: form.timeTo,
        categoryId: form.categoryId || null,
        cabinetId:  form.cabinetId  || null,
        roleTitle:  form.roleTitle  || null,
      });
      setEntries(prev => prev.map(e => e.id === modal.editId ? { ...e, ...mkEntry(res.data) } : e));
      return;
    }

    const beforeEx = filterEx(origEntry.exceptions, d => d < targetDate);
    const afterEx  = filterEx(origEntry.exceptions, d => d > targetDate);

    if (origEntry.dateFrom === targetDate) {
      // Target is first day — shrink original forward
      const updPattern = ['two_two', 'custom'].includes(origEntry.pattern.type)
        ? { ...origEntry.pattern, phaseAnchor: origEntry.pattern.phaseAnchor || origEntry.dateFrom }
        : origEntry.pattern;
      await schedulesApi.update(modal.editId, {
        clinicId: origEntry.clinicId, dateFrom: addDays(targetDate, 1), dateTo: origEntry.dateTo,
        pattern: updPattern, timeFrom: origEntry.timeFrom, timeTo: origEntry.timeTo, exceptions: afterEx,
        categoryId: origEntry.categoryId || null,
        cabinetId:  origEntry.cabinetId  || null,
        roleTitle:  origEntry.roleTitle   || null,
      });
      const res = await schedulesApi.create(newDayPayload);
      setEntries(prev => [
        ...prev.map(e => e.id === modal.editId ? { ...e, dateFrom: addDays(targetDate, 1), pattern: updPattern, exceptions: afterEx } : e),
        mkEntry(res.data),
      ]);
    } else if (origEntry.dateTo === targetDate) {
      // Target is last day — shrink original backward
      await schedulesApi.update(modal.editId, {
        clinicId: origEntry.clinicId, dateFrom: origEntry.dateFrom, dateTo: addDays(targetDate, -1),
        pattern: origEntry.pattern, timeFrom: origEntry.timeFrom, timeTo: origEntry.timeTo, exceptions: beforeEx,
        categoryId: origEntry.categoryId || null,
        cabinetId:  origEntry.cabinetId  || null,
        roleTitle:  origEntry.roleTitle   || null,
      });
      const res = await schedulesApi.create(newDayPayload);
      setEntries(prev => [
        ...prev.map(e => e.id === modal.editId ? { ...e, dateTo: addDays(targetDate, -1), exceptions: beforeEx } : e),
        mkEntry(res.data),
      ]);
    } else {
      // Target is in the middle — shrink original, create day entry, create "after" entry
      await schedulesApi.update(modal.editId, {
        clinicId: origEntry.clinicId, dateFrom: origEntry.dateFrom, dateTo: addDays(targetDate, -1),
        pattern: origEntry.pattern, timeFrom: origEntry.timeFrom, timeTo: origEntry.timeTo, exceptions: beforeEx,
        categoryId: origEntry.categoryId || null,
        cabinetId:  origEntry.cabinetId  || null,
        roleTitle:  origEntry.roleTitle   || null,
      });
      const splitPattern = ['two_two', 'custom'].includes(origEntry.pattern.type)
        ? { ...origEntry.pattern, phaseAnchor: origEntry.pattern.phaseAnchor || origEntry.dateFrom }
        : origEntry.pattern;
      const [dayRes, afterRes] = await Promise.all([
        schedulesApi.create(newDayPayload),
        schedulesApi.create({
          misUserId,
          clinicId:   origEntry.clinicId,
          dateFrom:   addDays(targetDate, 1),
          dateTo:     origEntry.dateTo,
          pattern:    splitPattern,
          timeFrom:   origEntry.timeFrom,
          timeTo:     origEntry.timeTo,
          exceptions: afterEx,
          categoryId: origEntry.categoryId || null,
          cabinetId:  origEntry.cabinetId  || null,
          roleTitle:  origEntry.roleTitle   || null,
        }),
      ]);
      setEntries(prev => [
        ...prev.map(e => e.id === modal.editId ? { ...e, dateTo: addDays(targetDate, -1), exceptions: beforeEx } : e),
        mkEntry(dayRes.data),
        mkEntry(afterRes.data),
      ]);
    }
  };

  const handleSave = async () => {
    if (!selectedDoctor || !form) return;
    if (!form.clinicId || !form.dateFrom || !form.dateTo) return;
    if (form.pattern.type === 'weekdays' && !form.pattern.weekdays?.length) return;

    // ── Half-period lock guard (non-admins, range create) ──
    // A new schedule must not be written into a frozen half. Clamp dateFrom
    // forward to the first open date and notify; reject outright if the whole
    // range is frozen. Frozen dates form a contiguous prefix, so once dateFrom
    // is open the entire remaining range is open too.
    let saveForm = form;
    if (!isAdmin && !modal.editId) {
      const end = parseDate(form.dateTo);
      const cur = parseDate(form.dateFrom);
      let firstOpen = null;
      while (cur <= end) {
        if (!isDateFrozen(cur, lockToday)) { firstOpen = formatDate(cur); break; }
        cur.setDate(cur.getDate() + 1);
      }
      if (!firstOpen) {
        toast.error('Этот период закрыт для редактирования');
        return;
      }
      if (firstOpen !== form.dateFrom) {
        // Preserve cycle phase for anchored patterns when the start shifts.
        const patched = ['two_two', 'custom'].includes(form.pattern.type) && !form.pattern.phaseAnchor
          ? { ...form.pattern, phaseAnchor: form.dateFrom }
          : form.pattern;
        saveForm = { ...form, dateFrom: firstOpen, pattern: patched };
        if (!skipConflictCheck.current) {
          toast(`Заблокированные даты пропущены — расписание применено с ${fmtDateShort(firstOpen)}`, { icon: '🔒', duration: 5000 });
        }
      }
    }

    if (!skipConflictCheck.current && !(modal.editId && modal.cell)) {
      const conflicts = findTimeConflicts(saveForm, entries, modal.editId);
      if (conflicts.length > 0) { setConflictConfirm(conflicts); return; }
    }
    skipConflictCheck.current = false;

    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    setSaving(true);
    try {
      if (modal.editId && modal.cell) {
        await handleSaveDayOnly(misUserId);
      } else if (modal.editId) {
        const res = await schedulesApi.update(modal.editId, {
          clinicId:   form.clinicId,
          dateFrom:   form.dateFrom,
          dateTo:     form.dateTo,
          pattern:    form.pattern,
          timeFrom:   form.timeFrom,
          timeTo:     form.timeTo,
          categoryId: form.categoryId || null,
          cabinetId:  form.cabinetId  || null,
          roleTitle:  form.roleTitle  || null,
        });
        const updated = res.data;
        setEntries(prev => prev.map(e => e.id === modal.editId
          ? { ...e, clinicId: updated.clinicId, dateFrom: updated.dateFrom, dateTo: updated.dateTo, pattern: updated.pattern, timeFrom: updated.timeFrom, timeTo: updated.timeTo, categoryId: form.categoryId, cabinetId: form.cabinetId, roleTitle: form.roleTitle || null }
          : e
        ));
      } else {
        const initExceptions = (() => {
          if (!saveForm.cancelCode) return [];
          const exs = [];
          const end = parseDate(saveForm.dateTo);
          const cur = parseDate(saveForm.dateFrom);
          while (cur <= end) {
            if (isDayScheduled(saveForm, cur.getFullYear(), cur.getMonth() + 1, cur.getDate())) {
              exs.push({ date: formatDate(cur), code: saveForm.cancelCode });
            }
            cur.setDate(cur.getDate() + 1);
          }
          return exs;
        })();
        const res = await schedulesApi.create({
          misUserId,
          clinicId:   saveForm.clinicId,
          dateFrom:   saveForm.dateFrom,
          dateTo:     saveForm.dateTo,
          pattern:    saveForm.pattern,
          timeFrom:   saveForm.timeFrom,
          timeTo:     saveForm.timeTo,
          exceptions: initExceptions,
          categoryId: saveForm.categoryId || null,
          cabinetId:  saveForm.cabinetId  || null,
          roleTitle:  saveForm.roleTitle  || null,
        });
        const created = res.data;
        setEntries(prev => [...prev, {
          id:         created.id,
          doctorId:   selectedDoctor.id,
          misUserId:  created.misUserId,
          clinicId:   created.clinicId,
          dateFrom:   created.dateFrom,
          dateTo:     created.dateTo,
          pattern:    created.pattern,
          timeFrom:   created.timeFrom,
          timeTo:     created.timeTo,
          exceptions: created.exceptions || [],
          categoryId: created.categoryId || null,
          cabinetId:  created.cabinetId  || null,
          roleTitle:  created.roleTitle  || null,
        }]);
      }
      closeModal();
    } catch (err) {
      console.error('Save schedule error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDayOnly = async (entryId, cell) => {
    const targetDate = cellDate(cell);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    if (entry.dateFrom === targetDate && entry.dateTo === targetDate) {
      await handleDeleteEntry(entryId);
      return;
    }

    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    const filterEx = (exceptions, pred) =>
      (exceptions || []).filter(ex => pred(typeof ex === 'string' ? ex : ex.date));
    const mkEntry = e => ({
      id: e.id, doctorId: selectedDoctor.id, misUserId: e.misUserId,
      clinicId: e.clinicId, dateFrom: e.dateFrom, dateTo: e.dateTo,
      pattern: e.pattern, timeFrom: e.timeFrom, timeTo: e.timeTo,
      exceptions: e.exceptions || [],
      categoryId: e.categoryId || null,
      cabinetId:  e.cabinetId  || null,
      roleTitle:  e.roleTitle  || null,
    });
    const beforeEx = filterEx(entry.exceptions, d => d < targetDate);
    const afterEx  = filterEx(entry.exceptions, d => d > targetDate);

    try {
      if (entry.dateFrom === targetDate) {
        const updPattern = ['two_two', 'custom'].includes(entry.pattern.type)
          ? { ...entry.pattern, phaseAnchor: entry.pattern.phaseAnchor || entry.dateFrom }
          : entry.pattern;
        await schedulesApi.update(entryId, {
          clinicId: entry.clinicId, dateFrom: addDays(targetDate, 1), dateTo: entry.dateTo,
          pattern: updPattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: afterEx,
          categoryId: entry.categoryId || null,
          cabinetId:  entry.cabinetId  || null,
          roleTitle:  entry.roleTitle   || null,
        });
        setEntries(prev => prev.map(e => e.id === entryId ? { ...e, dateFrom: addDays(targetDate, 1), pattern: updPattern, exceptions: afterEx } : e));
      } else if (entry.dateTo === targetDate) {
        await schedulesApi.update(entryId, {
          clinicId: entry.clinicId, dateFrom: entry.dateFrom, dateTo: addDays(targetDate, -1),
          pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: beforeEx,
          categoryId: entry.categoryId || null,
          cabinetId:  entry.cabinetId  || null,
          roleTitle:  entry.roleTitle   || null,
        });
        setEntries(prev => prev.map(e => e.id === entryId ? { ...e, dateTo: addDays(targetDate, -1), exceptions: beforeEx } : e));
      } else {
        await schedulesApi.update(entryId, {
          clinicId: entry.clinicId, dateFrom: entry.dateFrom, dateTo: addDays(targetDate, -1),
          pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: beforeEx,
          categoryId: entry.categoryId || null,
          cabinetId:  entry.cabinetId  || null,
          roleTitle:  entry.roleTitle   || null,
        });
        const splitPattern = ['two_two', 'custom'].includes(entry.pattern.type)
          ? { ...entry.pattern, phaseAnchor: entry.pattern.phaseAnchor || entry.dateFrom }
          : entry.pattern;
        const res = await schedulesApi.create({
          misUserId, clinicId: entry.clinicId,
          dateFrom: addDays(targetDate, 1), dateTo: entry.dateTo,
          pattern: splitPattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo,
          exceptions: afterEx,
          categoryId: entry.categoryId || null,
          cabinetId:  entry.cabinetId  || null,
          roleTitle:  entry.roleTitle   || null,
        });
        setEntries(prev => [
          ...prev.map(e => e.id === entryId ? { ...e, dateTo: addDays(targetDate, -1), exceptions: beforeEx } : e),
          mkEntry(res.data),
        ]);
      }
      setConfirmDel(null);
      setModal(prev => prev ? { ...prev, type: 'day' } : null);
    } catch (err) {
      console.error('Delete day error:', err);
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!selectedDoctor) return;

    // ── Half-period lock guard (non-admins) ──
    // Deleting the whole chain must not wipe frozen days. If the entry reaches
    // into a frozen half, shrink it to keep the frozen prefix and drop only the
    // open tail; reject outright if the entire chain is frozen.
    const entry = entries.find(e => e.id === entryId);
    if (entry && !isAdmin) {
      const end = parseDate(entry.dateTo);
      const cur = parseDate(entry.dateFrom);
      let firstOpen = null;
      while (cur <= end) {
        if (!isDateFrozen(cur, lockToday)) { firstOpen = formatDate(cur); break; }
        cur.setDate(cur.getDate() + 1);
      }
      if (!firstOpen) {
        toast.error('Это расписание в закрытом периоде — удаление недоступно');
        return;
      }
      if (firstOpen !== entry.dateFrom) {
        const newDateTo = addDays(firstOpen, -1);
        const keepEx = (entry.exceptions || []).filter(ex => (typeof ex === 'string' ? ex : ex.date) <= newDateTo);
        try {
          await schedulesApi.update(entryId, {
            clinicId: entry.clinicId, dateFrom: entry.dateFrom, dateTo: newDateTo,
            pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: keepEx,
            categoryId: entry.categoryId || null,
            cabinetId:  entry.cabinetId  || null,
            roleTitle:  entry.roleTitle   || null,
          });
          setEntries(prev => prev.map(e => e.id === entryId ? { ...e, dateTo: newDateTo, exceptions: keepEx } : e));
          setConfirmDel(null);
          setModal(prev => prev ? { ...prev, type: 'day' } : null);
          setForm(null);
          toast('Заблокированные дни сохранены — удалена только открытая часть', { icon: '🔒', duration: 5000 });
        } catch (err) {
          console.error('Delete schedule (clamped) error:', err);
        }
        return;
      }
    }

    try {
      await schedulesApi.delete(entryId);
      const remaining = entries.filter(e => e.id !== entryId);
      setEntries(remaining);
      setConfirmDel(null);
      if (modal?.cell && !remaining.some(e => isDayScheduled(e, modal.cell.year, modal.cell.month, modal.cell.day))) {
        closeModal();
      } else {
        setModal(prev => prev ? { ...prev, type: 'day' } : null);
        setForm(null);
      }
    } catch (err) {
      console.error('Delete schedule error:', err);
    }
  };

  const handleToggleException = (entryId, cell) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    if (isExcepted(entry, cell)) {
      handleRestoreException(entryId, cell);
    } else {
      setCancelModal({ entryId, cell });
    }
  };

  const handleRestoreException = async (entryId, cell) => {
    const dateStr = cellDate(cell);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newExceptions = (entry.exceptions || []).filter(ex =>
      typeof ex === 'string' ? ex !== dateStr : ex.date !== dateStr
    );
    try {
      await schedulesApi.update(entryId, { exceptions: newExceptions });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, exceptions: newExceptions } : e));
    } catch (err) {
      console.error('Restore exception error:', err);
    }
  };

  const handleConfirmCancel = async (code) => {
    if (!cancelModal) return;
    const { entryId, cell } = cancelModal;
    const dateStr = cellDate(cell);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newException = { date: dateStr, code };
    const newExceptions = [...(entry.exceptions || []), newException];
    try {
      await schedulesApi.update(entryId, { exceptions: newExceptions });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, exceptions: newExceptions } : e));
    } catch (err) {
      console.error('Cancel exception error:', err);
    }
    setCancelModal(null);
  };

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const openQuickNav = () => {
    setQuickNavStep('year');
    setQuickNavYearStart(Math.floor(year / 10) * 10);
    setQuickNav(true);
  };
  const pickYear  = (y) => { setQuickNavYear(y); setQuickNavStep('month'); };
  const pickMonth = (m) => { setYear(quickNavYear); setMonth(m); setQuickNav(false); };

  useEffect(() => {
    if (!quickNav) return;
    const handler = (e) => {
      if (quickNavRef.current && !quickNavRef.current.contains(e.target)) setQuickNav(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [quickNav]);

  const updateForm = (key, val) => {
    if (key === 'clinicId') setForm(f => ({ ...f, clinicId: val, cabinetId: null }));
    else setForm(f => ({ ...f, [key]: val }));
  };
  const updatePat  = (key, val) => setForm(f => ({ ...f, pattern: { ...f.pattern, [key]: val } }));
  const toggleWday = (i) => {
    const arr = form.pattern.weekdays || [];
    updatePat('weekdays', arr.includes(i) ? arr.filter(d => d !== i) : [...arr, i].sort());
  };
  const toggleAllowedWday = (i) => {
    const current = form.pattern.allowedWeekdays || [];
    const effective = current.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : current;
    const next = effective.includes(i) ? effective.filter(d => d !== i) : [...effective, i].sort();
    updatePat('allowedWeekdays', next.length === 7 ? [] : next);
  };

  const canSave = form && form.clinicId && form.dateFrom && form.dateTo &&
    !(form.pattern.type === 'weekdays' && !form.pattern.weekdays?.length);

  const grid  = getMonthGrid(year, month);
  const today = new Date();
  const isToday = (cell) =>
    today.getFullYear() === cell.year && today.getMonth() + 1 === cell.month && today.getDate() === cell.day;

  const clinicColor = (cId) => getClinicColor ? getClinicColor(cId) : '#94a3b8';
  const clinicName  = (cId) => getClinicName  ? getClinicName(cId)  : cId;

  // ── Month statistics ────────────────────────────────────────────────────────
  const monthStats = useMemo(() => {
    if (!selectedDoctor) return null;
    const currentCells = getMonthGrid(year, month).flat().filter(c => c.isCurrentMonth);
    const workedDaysSet = new Set();
    let workedMinutes = 0;
    let weekendCount  = 0;
    const absenceDates       = {}; // code -> Set<dateStr> — counts unique days per code
    const byRoleMinutes      = {}; // roleTitle -> minutes
    const byCategoryMinutes  = {}; // categoryId -> minutes (entries with categoryId, no roleTitle)

    for (const cell of currentCells) {
      const dateStr     = cellDate(cell);
      const cellEntries = entries.filter(e => isDayScheduled(e, cell.year, cell.month, cell.day));

      if (cellEntries.length === 0) {
        weekendCount++;
        continue;
      }

      let dayHasWork = false;
      for (const e of cellEntries) {
        const ex = (e.exceptions || []).find(ex2 =>
          typeof ex2 === 'string' ? ex2 === dateStr : ex2.date === dateStr
        );
        if (!ex) {
          dayHasWork = true;
          const [fh, fm] = e.timeFrom.split(':').map(Number);
          const [th, tm] = e.timeTo.split(':').map(Number);
          let mins = (th * 60 + tm) - (fh * 60 + fm);
          if (mins <= 0) mins += 24 * 60; // overnight shift (e.g. 21:00–06:00)
          if (mins > 0) {
            workedMinutes += mins;
            if (e.roleTitle) {
              byRoleMinutes[e.roleTitle] = (byRoleMinutes[e.roleTitle] || 0) + mins;
            } else if (e.categoryId) {
              byCategoryMinutes[e.categoryId] = (byCategoryMinutes[e.categoryId] || 0) + mins;
            } else {
              byRoleMinutes[''] = (byRoleMinutes[''] || 0) + mins;
            }
          }
        } else {
          const code = (typeof ex === 'object' ? ex.code : null) || 'ОТ';
          if (code === 'В') weekendCount++;
          else {
            if (!absenceDates[code]) absenceDates[code] = new Set();
            absenceDates[code].add(dateStr);
          }
        }
      }
      if (dayHasWork) workedDaysSet.add(dateStr);
    }

    const otherAbsences = Object.fromEntries(
      Object.entries(absenceDates).map(([code, dates]) => [code, dates.size])
    );
    const totalOther = Object.values(otherAbsences).reduce((a, b) => a + b, 0);

    // Classify entries: roles vs professions using the doctor's own lists
    const drRolesSet = new Set((selectedDoctor.roles || []).filter(Boolean));
    const drProfsSet = new Set(
      (selectedDoctor.professions || [])
        .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
        .filter(Boolean)
    );

    const byRoles = Object.entries(byRoleMinutes)
      .filter(([r]) => r && drRolesSet.has(r))
      .map(([role, mins]) => ({ role, hours: mins / 60 }))
      .sort((a, b) => b.hours - a.hours);

    const byProfessions = Object.entries(byRoleMinutes)
      .filter(([r]) => r && drProfsSet.has(r) && !drRolesSet.has(r))
      .map(([role, mins]) => ({ role, hours: mins / 60 }))
      .sort((a, b) => b.hours - a.hours);

    const byCategories = Object.entries(byCategoryMinutes)
      .map(([categoryId, mins]) => ({ categoryId, hours: mins / 60 }))
      .sort((a, b) => b.hours - a.hours);

    // Untagged: no role, no profession, no category
    const untaggedMins = Object.entries(byRoleMinutes)
      .filter(([r]) => !r || (!drRolesSet.has(r) && !drProfsSet.has(r)))
      .reduce((s, [, m]) => s + m, 0);
    const untaggedHours = untaggedMins / 60;

    return {
      workedDays:   workedDaysSet.size,
      workedHours:  Math.floor(workedMinutes / 60),
      workedMins:   workedMinutes % 60,
      weekendCount,
      otherAbsences,
      totalOther,
      vacationDays: otherAbsences['ОТ'] || 0,
      byRoles,
      byProfessions,
      byCategories,
      untaggedHours,
    };
  }, [year, month, entries, selectedDoctor]);

  if (!selectedDoctor) {
    if (managingDivision) {
      return <DivisionAccessPanel
        divisionId={managingDivision.id}
        divisionName={managingDivision.name}
        divisionDoctorIds={managingDivision.doctorIds || []}
        divisionRates={managingDivision.rates || []}
        onRenamed={onDivisionRenamed}
        doctors={doctors}
        getClinicName={getClinicName}
        scheduleCategories={scheduleCategories}
        allRoles={allRoles}
        allProfessions={allProfessions}
      />;
    }
    return <div className="rb-placeholder"><p>Выберите сотрудника из списка слева</p></div>;
  }

  // Current day entries for day-modal
  const modalCellEntries  = modal?.cell ? getCellEntries(modal.cell) : [];
  const modalCellLocked   = modal?.cell ? isCellLocked(modal.cell) : false;

  return (
    <div className="rb-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* ── Header ── */}
      <div className="rb-panel-header" style={{ position: 'relative' }}>
        <button onClick={prevMonth} style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 7, width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>‹</button>
        <span
          onClick={openQuickNav}
          style={{ fontWeight: 700, fontSize: 15, flex: 1, textAlign: 'center', cursor: 'pointer', userSelect: 'none', padding: '4px 8px', borderRadius: 6, transition: 'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,122,255,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title="Быстрый переход к месяцу"
        >
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button onClick={nextMonth} style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 7, width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>›</button>

        {selectedDoctor && (
          <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setImportModal(true)}
              title={`Импортировать расписание из МИС за ${MONTH_NAMES[month - 1]} ${year}`}
              style={{ background: 'transparent', border: '1px solid var(--rb-border)', borderRadius: 7, height: 32, padding: '0 8px', cursor: 'pointer', fontSize: 12, color: 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center', transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--rb-primary)'; e.currentTarget.style.color = 'var(--rb-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rb-border)'; e.currentTarget.style.color = 'var(--rb-text-secondary)'; }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            {hasMisEntries && (
              <button
                onClick={() => setCancelImportModal(true)}
                title="Удалить все записи, импортированные из МИС"
                style={{ background: 'transparent', border: '1px solid var(--rb-border)', borderRadius: 7, height: 32, padding: '0 8px', cursor: 'pointer', fontSize: 12, color: 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.color = '#dc2626'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rb-border)'; e.currentTarget.style.color = 'var(--rb-text-secondary)'; }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            )}
            {/* Тумблер авто-импорта из МИС — только для администратора */}
            {!readOnly && (
            <label
              title={!disableMisAutoImport ? 'Автоимпорт расписания из МИС включён' : 'Автоимпорт расписания из МИС отключён'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--rb-text-secondary)', cursor: savingAutoImportFlag ? 'wait' : 'pointer', userSelect: 'none', opacity: savingAutoImportFlag ? 0.6 : 1 }}
            >
              <span
                onClick={savingAutoImportFlag ? undefined : handleToggleDisableAutoImport}
                style={{
                  position: 'relative', display: 'inline-block', width: 34, height: 18, flexShrink: 0,
                  borderRadius: 9, cursor: savingAutoImportFlag ? 'wait' : 'pointer',
                  background: !disableMisAutoImport ? 'var(--rb-primary)' : '#d1d5db',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: !disableMisAutoImport ? 18 : 2,
                  width: 14, height: 14, borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
                }} />
              </span>
              <span style={{ fontSize: 11 }}>Импорт</span>
            </label>
            )}
          </div>
        )}

        {/* ── Quick Nav Popup ── */}
        {quickNav && (
          <div ref={quickNavRef} style={{
            position: 'absolute', top: '110%', left: '50%', transform: 'translateX(-50%)',
            background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 200, padding: '14px 16px', minWidth: 232,
          }}>
            {quickNavStep === 'year' ? (
              <>
                {/* Year range header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <button onClick={() => setQuickNavYearStart(s => s - 10)}
                    style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 14, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                  <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                    {quickNavYearStart} – {quickNavYearStart + 9}
                  </span>
                  <button onClick={() => setQuickNavYearStart(s => s + 10)}
                    style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 14, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                </div>
                {/* Year grid 4×3 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
                  {Array.from({ length: 10 }, (_, i) => quickNavYearStart + i).map(y => {
                    const isActive = y === year;
                    return (
                      <button key={y} onClick={() => pickYear(y)}
                        style={{ padding: '6px 2px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 700 : 400, background: isActive ? 'var(--rb-primary)' : 'transparent', color: isActive ? '#fff' : 'var(--rb-text)', transition: 'background 0.12s' }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(0,122,255,0.1)'; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      >{y}</button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                {/* Month step header with back + selected year */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <button onClick={() => setQuickNavStep('year')}
                    style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 14, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{quickNavYear}</span>
                  <div style={{ width: 26 }} />
                </div>
                {/* Month grid 4×3 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                  {MONTH_NAMES.map((name, i) => {
                    const isActive = quickNavYear === year && (i + 1) === month;
                    return (
                      <button key={i} onClick={() => pickMonth(i + 1)}
                        style={{ padding: '6px 2px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 700 : 400, background: isActive ? 'var(--rb-primary)' : 'transparent', color: isActive ? '#fff' : 'var(--rb-text)', transition: 'background 0.12s' }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(0,122,255,0.1)'; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      >{name.slice(0, 3)}</button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Calendar ── */}
      <div style={{ overflowX: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>Загрузка...</div>
        ) : (
          <table className="rb-schedule-calendar">
            <thead>
              <tr>
                {DAY_NAMES.map((d, i) => (
                  <th key={d} className={i >= 5 ? 'rb-schedule-th rb-schedule-weekend' : 'rb-schedule-th'}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, wi) => (
                <tr key={wi}>
                  {row.map((cell, di) => {
                    const cellEntries = getCellEntries(cell);
                    const tod = isToday(cell);
                    const isHoliday = cell.isCurrentMonth && holidayDates.has(cellDate(cell));
                    const isLocked  = isCellFrozen(cell);
                    return (
                      <td
                        key={di}
                        className={[
                          'rb-schedule-cell rb-schedule-cell-active',
                          di >= 5    ? 'rb-schedule-cell-weekend' : '',
                          tod        ? 'rb-schedule-cell-today'   : '',
                          isHoliday  ? 'rb-schedule-cell-holiday' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ position: 'relative', ...(isLocked ? { background: 'rgba(148,163,184,0.13)' } : {}) }}
                        onClick={() => handleDayClick(cell)}
                      >
                        <span
                          className={tod ? 'rb-schedule-day-num rb-schedule-today-num' : 'rb-schedule-day-num'}
                          style={!cell.isCurrentMonth ? { color: '#b0bec5' } : isHoliday ? { color: '#dc2626' } : undefined}
                        >
                          {cell.day}
                        </span>
                        {isLocked && (
                          <span title="Период закрыт для редактирования" style={{
                            position: 'absolute', bottom: 3, right: 3,
                            color: '#94a3b8', lineHeight: 1, pointerEvents: 'none',
                          }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                              <rect x="3" y="11" width="18" height="11" rx="2"/>
                              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                          </span>
                        )}
                        <div className="rb-schedule-entries">
                          {cellEntries.map(e => {
                            const cancelled = isExcepted(e, cell);
                            const entryCode = cancelled ? (getExceptionCode(e, cell) || 'ОТ') : isHoliday ? 'РВ' : 'Я';
                            const cat = e.categoryId ? categories.find(c => c.id === e.categoryId) : null;
                            const cab = e.cabinetId  ? cabinets.find(c => c.id === e.cabinetId)   : null;
                            return (
                              <div key={e.id} style={{ position: 'relative' }}>
                                <div
                                  className="rb-schedule-entry"
                                  style={{
                                    background: clinicColor(e.clinicId) + '22',
                                    borderLeft: `3px solid ${clinicColor(e.clinicId)}`,
                                    opacity: cancelled ? 0.4 : 1,
                                  }}
                                  title={cancelled ? `Отменён · ${entryCode}` : `${e.timeFrom}–${e.timeTo} · ${cab ? cab.name : clinicName(e.clinicId)}${cat ? ' · ' + cat.name : ''}${e.roleTitle ? ' · ' + e.roleTitle : ''}${e.source === 'mis_import' ? ' · МИС' : ''}`}
                                >
                                  {(() => {
                                    const bg = cat ? cat.color : clinicColor(e.clinicId);
                                    return (
                                      <span style={{
                                        position: 'absolute', top: 5, right: 2,
                                        width: 11, height: 11, borderRadius: '50%',
                                        background: bg, flexShrink: 0,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: entryCode.length === 1 ? 7.5 : 5.5,
                                        fontWeight: 800, lineHeight: 1, letterSpacing: -0.3,
                                        color: getContrastColor(bg),
                                      }}>{entryCode}</span>
                                    );
                                  })()}
                                  {e.source === 'mis_import' && (
                                    <span style={{
                                      position: 'absolute', top: 5, right: 15,
                                      width: 11, height: 11, borderRadius: '50%',
                                      background: '#8FC742', flexShrink: 0,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 7.5, fontWeight: 800, lineHeight: 1, color: '#fff',
                                    }}>R</span>
                                  )}
                                  <span className="rb-schedule-entry-time">{e.timeFrom} – {e.timeTo}</span>
                                  <span className="rb-schedule-entry-name">{abbreviateName(selectedDoctor.name)}</span>
                                  <span className="rb-schedule-entry-clinic">{cab ? cab.name : clinicName(e.clinicId)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Month statistics ── */}
      {monthStats && (monthStats.workedDays > 0 || monthStats.weekendCount > 0 || monthStats.totalOther > 0) && (
        <>
          <div className="rb-schedule-stats">
            <div className="rb-schedule-stat">
              <span className="rb-schedule-stat-value">{monthStats.workedDays}</span>
              <span className="rb-schedule-stat-label">раб. дней</span>
            </div>
            <div className="rb-schedule-stat-sep" />
            <div className="rb-schedule-stat">
              <span className="rb-schedule-stat-value">
                {(monthStats.workedHours + monthStats.workedMins / 60).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </span>
              <span className="rb-schedule-stat-label">часов</span>
            </div>
            <div className="rb-schedule-stat-sep" />
            <div className="rb-schedule-stat">
              <span className="rb-schedule-stat-value rb-schedule-stat-neutral">{monthStats.weekendCount}</span>
              <span className="rb-schedule-stat-label">выходных</span>
            </div>
            <div className="rb-schedule-stat-sep" />
            <div className="rb-schedule-stat">
              <span className="rb-schedule-stat-value rb-schedule-stat-absence">{monthStats.totalOther}</span>
              <span className="rb-schedule-stat-label">неявок</span>
            </div>
            <div className="rb-schedule-stat-sep" />
            <div className="rb-schedule-stat">
              <span className="rb-schedule-stat-value" style={{ color: '#dc2626' }}>{monthStats.vacationDays}</span>
              <span className="rb-schedule-stat-label">отпускных</span>
            </div>
          </div>

          {(monthStats.byRoles.length > 0 || monthStats.byProfessions.length > 0 || monthStats.byCategories.length > 0 || monthStats.untaggedHours > 0) && (() => {
            // ── Build segments ──────────────────────────────────────────────
            const PALETTE = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6'];
            let pi = 0;

            const segments = [
              ...monthStats.byRoles.map(({ role, hours }) => {
                const n = roleNorms.find(r => r.roleTitle === role);
                const normH = n?.normHours != null ? parseFloat(n.normHours) : null;
                return { label: role, hours, normH, color: PALETTE[pi++ % PALETTE.length], tag: 'Роль' };
              }),
              ...monthStats.byProfessions.map(({ role, hours }) => {
                const n = hourNorms.find(r => r.professionTitle === role);
                const normH = n?.normHours != null ? parseFloat(n.normHours) : null;
                return { label: role, hours, normH, color: PALETTE[pi++ % PALETTE.length], tag: 'Специальность' };
              }),
              ...monthStats.byCategories.map(({ categoryId, hours }) => {
                const cat = categories.find(c => c.id === categoryId);
                const cn = categoryNorms.find(r => r.categoryId === categoryId);
                const normH = cn?.normHours != null ? parseFloat(cn.normHours) : null;
                const color = cat?.color || PALETTE[pi++ % PALETTE.length];
                return { label: cat?.name || 'Категория', hours, normH, color, tag: 'Категория' };
              }),
              ...(monthStats.untaggedHours > 0 ? [{ label: 'Без указания', hours: monthStats.untaggedHours, normH: null, color: '#cbd5e1', tag: null }] : []),
            ];

            const totalH = segments.reduce((s, sg) => s + sg.hours, 0);
            if (totalH === 0) return null;

            // ── SVG donut ───────────────────────────────────────────────────
            const SZ = 150, cx = SZ / 2, cy = SZ / 2, R = 66, ri = 38;
            const GAP_DEG = segments.length > 1 ? 2 : 0;
            const toRad = deg => (deg - 90) * Math.PI / 180;
            const pt = (r, deg) => [cx + r * Math.cos(toRad(deg)), cy + r * Math.sin(toRad(deg))];
            const f = n => n.toFixed(3);

            const arcPath = (startDeg, endDeg) => {
              const span = endDeg - startDeg;
              if (span >= 359.9) {
                // full circle: two 180° arcs
                const [x1, y1] = pt(R, startDeg), [x2, y2] = pt(R, startDeg + 180);
                const [x3, y3] = pt(ri, startDeg + 180), [x4, y4] = pt(ri, startDeg);
                return `M${f(x1)},${f(y1)} A${R},${R},0,0,1,${f(x2)},${f(y2)} A${R},${R},0,0,1,${f(x1)},${f(y1)} L${f(x4)},${f(y4)} A${ri},${ri},0,0,0,${f(x3)},${f(y3)} A${ri},${ri},0,0,0,${f(x4)},${f(y4)} Z`;
              }
              const lg = span > 180 ? 1 : 0;
              const [ax, ay] = pt(R, startDeg), [bx, by] = pt(R, endDeg);
              const [cx2, cy2] = pt(ri, endDeg), [dx, dy] = pt(ri, startDeg);
              return `M${f(ax)},${f(ay)} A${R},${R},0,${lg},1,${f(bx)},${f(by)} L${f(cx2)},${f(cy2)} A${ri},${ri},0,${lg},0,${f(dx)},${f(dy)} Z`;
            };

            const rmid = (ri + R) / 2; // radius for label placement
            let cur = 0;
            const arcs = segments.map(sg => {
              const deg = (sg.hours / totalH) * 360;
              const s = cur + GAP_DEG / 2;
              const e = cur + deg - GAP_DEG / 2;
              const mid = cur + deg / 2;
              cur += deg;
              const [lx, ly] = pt(rmid, mid);
              const pct = Math.round((sg.hours / totalH) * 100);
              return { ...sg, path: arcPath(s, e), lx, ly, pct, deg };
            });

            const tw = Math.floor(totalH);
            const tm = Math.round((totalH - tw) * 60);

            const SEG = 100 / 3;
            const legendRow = (arc, i) => {
              const wh = Math.floor(arc.hours), mn = Math.round((arc.hours - wh) * 60);
              const nh = arc.normH;
              const pctBase  = nh ? Math.min(arc.hours / nh, 1) * SEG : null;
              const pctBonus = nh ? Math.min(Math.max(arc.hours - nh, 0) / nh, 1) * SEG : null;
              const pctExtra = nh ? Math.min(Math.max(arc.hours - nh * 2, 0) / nh, 1) * SEG : null;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: arc.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={arc.label}>
                      {arc.label}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {wh}{mn > 0 ? `:${pad2(mn)}` : ''} ч{nh != null ? ` при норме ${nh} ч` : ''}
                    </span>
                  </div>
                  {nh != null && (
                    <div className="rb-schedule-role-bar-track rb-schedule-role-bar-split" style={{ marginLeft: 14 }}>
                      <div className="rb-schedule-role-bar-fill" style={{ left: '0%',               width: `${pctBase.toFixed(1)}%`,  background: '#22c55e' }} />
                      <div className="rb-schedule-role-bar-fill" style={{ left: `${SEG.toFixed(1)}%`,     width: `${pctBonus.toFixed(1)}%`, background: '#f59e0b' }} />
                      <div className="rb-schedule-role-bar-fill" style={{ left: `${(SEG*2).toFixed(1)}%`, width: `${pctExtra.toFixed(1)}%`, background: '#ef4444' }} />
                    </div>
                  )}
                </div>
              );
            };

            const sectionLabel = text => (
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--rb-text-secondary)', marginBottom: 1 }}>{text}</div>
            );

            const rolesArcs       = arcs.filter(a => a.tag === 'Роль');
            const profsArcs       = arcs.filter(a => a.tag === 'Специальность');
            const catsArcs        = arcs.filter(a => a.tag === 'Категория');
            const untaggedArcs    = arcs.filter(a => a.tag === null);
            const multiSection    = [rolesArcs, profsArcs, catsArcs].filter(g => g.length > 0).length > 1;

            return (
              <div className="rb-schedule-role-stats">

                {/* ── Left: donut ── */}
                <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`} style={{ display: 'block' }}>
                  {arcs.map((arc, i) => <path key={i} d={arc.path} fill={arc.color} />)}
                  {arcs.map((arc, i) => arc.deg >= 25 && (
                    <text key={`l${i}`} x={f(arc.lx)} y={f(arc.ly)} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: 9, fontWeight: 700, fill: '#fff', pointerEvents: 'none' }}>
                      {arc.pct}%
                    </text>
                  ))}
                  <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 14, fontWeight: 700, fill: 'var(--rb-text, #1e293b)' }}>
                    {tw}{tm > 0 ? `:${pad2(tm)}` : ''}
                  </text>
                  <text x={cx} y={cy + 9} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--rb-text-secondary, #64748b)' }}>часов</text>
                </svg>

                {/* ── Right: legend ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>

                  {rolesArcs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {multiSection && sectionLabel('Роли')}
                      {rolesArcs.map(legendRow)}
                    </div>
                  )}

                  {profsArcs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: rolesArcs.length > 0 ? 4 : 0 }}>
                      {multiSection && sectionLabel('Специальности')}
                      {profsArcs.map(legendRow)}
                    </div>
                  )}

                  {catsArcs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: (rolesArcs.length > 0 || profsArcs.length > 0) ? 4 : 0 }}>
                      {multiSection && sectionLabel('Категории')}
                      {catsArcs.map(legendRow)}
                    </div>
                  )}

                  {untaggedArcs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                      {sectionLabel('Прочее')}
                      {untaggedArcs.map(legendRow)}
                    </div>
                  )}


                </div>

              </div>
            );
          })()}
        </>
      )}

      {/* ══════════════ MODAL: day overview ══════════════ */}
      {modal?.type === 'day' && (
        <div className="rb-modal-overlay" onClick={closeModal}>
          <div className="rb-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                {displayDate(modal.cell)}
              </h3>
              <button className="rb-modal-close" onClick={closeModal}>×</button>
            </div>

            <div className="rb-modal-body" style={{ padding: 0 }}>
              {modalCellEntries.map(e => {
                const cancelled = isExcepted(e, modal.cell);
                const col = clinicColor(e.clinicId);
                const isConfirming = confirmDel === e.id;
                const cat = e.categoryId ? categories.find(c => c.id === e.categoryId) : null;
                const cab = e.cabinetId  ? cabinets.find(c => c.id === e.cabinetId)   : null;
                return (
                  <div key={e.id} style={{
                    ...sectionStyle,
                    background: cancelled ? col + '1a' : col + '33',
                    borderLeft: `4px solid ${col}`,
                  }}>
                    {/* Entry info + actions */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ opacity: cancelled ? 0.6 : 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--rb-text)', marginBottom: 2 }}>
                            {e.timeFrom} – {e.timeTo}
                          </div>
                          {selectedDoctor && (
                            <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
                              {abbreviateName(selectedDoctor.name)}
                            </div>
                          )}
                          <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
                            {cab ? cab.name : clinicName(e.clinicId)}
                          </div>
                          {cat && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 2 }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                              {cat.name}
                            </div>
                          )}
                          {e.roleTitle && (
                            <div style={{ fontSize: 12, color: 'var(--rb-primary)', marginTop: 2, fontWeight: 500 }}>
                              {e.roleTitle}
                            </div>
                          )}
                        </div>
                        {cancelled && (() => {
                          const code = getExceptionCode(e, modal.cell) || 'ОТ';
                          const fullLabel = STATUS_CODES.find(s => s.code === code)?.label || code;
                          const reasonOnly = fullLabel.includes('—') ? fullLabel.split('—').slice(1).join('—').trim() : fullLabel;
                          return (
                            <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4, fontWeight: 600 }}>
                              Причина отмены: {reasonOnly}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Actions */}
                      {!readOnly && !modalCellLocked && (!isConfirming ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                        <button style={{ ...btnBlue, width: BTN_W }} onClick={() => handleToggleException(e.id, modal.cell)}>
                          {cancelled ? 'Восстановить' : 'Отменить'}
                        </button>
                        <button style={{ ...btnBlue, width: BTN_W }} onClick={() => openEditForm(e, modal.cell)}>
                          Редактировать
                        </button>
                        <button style={{ ...btnRed, width: BTN_W }} onClick={() => setConfirmDel(e.id)}>
                          Удалить
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#fff7f7', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 12px' }}>
                        <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Что удалить?</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="rb-btn"
                            style={{ fontSize: 12, padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none' }}
                            onClick={() => handleDeleteDayOnly(e.id, modal.cell)}
                          >
                            Только этот день
                          </button>
                          {e.dateFrom !== e.dateTo && (
                            <button
                              className="rb-btn"
                              style={{ fontSize: 12, padding: '4px 12px', background: '#7f1d1d', color: '#fff', border: 'none' }}
                              onClick={() => handleDeleteEntry(e.id)}
                            >
                              Всё расписание
                            </button>
                          )}
                          <button
                            className="rb-btn rb-btn-secondary"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => setConfirmDel(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  </div>
                );
              })}
            </div>

            {modalCellLocked && (
              <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b', borderTop: '1px solid var(--rb-border)', background: 'rgba(148,163,184,0.08)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Период закрыт для редактирования
              </div>
            )}
            {!readOnly && !modalCellLocked && (
            <div className="rb-modal-footer">
              <button style={{ ...btnBlue, width: BTN_W }} onClick={() => openNewForm(modal.cell)}>
                Создать
              </button>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ MODAL: create / edit form ══════════════ */}
      {modal?.type === 'form' && form && (
        <div className="rb-modal-overlay" onClick={closeModal}>
          <div className="rb-modal" style={{ maxWidth: 780 }} onClick={e => e.stopPropagation()}>

            <div className="rb-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                {modal.editId ? 'Редактировать расписание' : 'Новое расписание'}
              </h3>
              <button className="rb-modal-close" onClick={closeModal}>×</button>
            </div>

            <div className="rb-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* ── Row 1: Медцентр · Период · Рабочее время ── */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>

                {/* 1. Медцентр */}
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <label style={labelStyle}>Медцентр</label>
                  <ClinicSelect
                    value={form.clinicId}
                    onChange={v => updateForm('clinicId', v)}
                    clinics={doctorClinics}
                    getClinicColor={clinicColor}
                    getClinicName={clinicName}
                  />
                </div>

                {/* 2. Период */}
                <div style={{ flex: '0 0 auto' }}>
                  <label style={labelStyle}>Период</label>
                  {modal.editId && modal.cell ? (
                    <div style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 12px', background: '#f8fafc', border: '1px solid var(--rb-border)', borderRadius: 8, fontSize: 13, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmtDisplay(form.dateFrom)}
                    </div>
                  ) : (
                    <DateRangePicker
                      dateFrom={form.dateFrom}
                      setDateFrom={v => updateForm('dateFrom', v)}
                      dateTo={form.dateTo}
                      setDateTo={v => updateForm('dateTo', v)}
                    />
                  )}
                </div>

                {/* 4. Рабочее время */}
                <div style={{ flex: '0 0 auto' }}>
                  <label style={labelStyle}>Рабочее время</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <ClockPicker
                      value={form.timeFrom}
                      onChange={v => updateForm('timeFrom', v)}
                      onComplete={() => timeToClockRef.current?.open()}
                    />
                    <span style={{ color: 'var(--rb-text-secondary)', fontSize: 13 }}>—</span>
                    <ClockPicker
                      ref={timeToClockRef}
                      value={form.timeTo}
                      onChange={v => updateForm('timeTo', v)}
                    />
                  </div>
                </div>

              </div>

              {/* ── Row 2: Категория · Кабинет ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Категория расписания</label>
                  <PopoverSelect
                    value={form.categoryId}
                    onChange={v => updateForm('categoryId', v)}
                    items={categories}
                    placeholder="Без категории"
                    renderDot={it => <span style={{ width: 10, height: 10, borderRadius: '50%', background: it.color, flexShrink: 0 }} />}
                    renderLabel={it => it.name}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Кабинет</label>
                  <PopoverSelect
                    value={form.cabinetId}
                    onChange={v => updateForm('cabinetId', v)}
                    items={cabinets.filter(c => c.clinicId === form.clinicId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))}
                    placeholder="Не указан"
                    renderDot={null}
                    renderLabel={it => it.name}
                  />
                </div>
              </div>

              {/* ── Row 2b: Роль + Специальность ── */}
              {(doctorRoles.length > 0 || doctorProfessions.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {doctorRoles.length > 0 && (
                    <div>
                      <label style={labelStyle}>Роль</label>
                      <PopoverSelect
                        value={doctorRoles.includes(form.roleTitle) ? form.roleTitle : null}
                        onChange={v => updateForm('roleTitle', v)}
                        items={doctorRoles.map(r => ({ id: r, name: r }))}
                        placeholder="—"
                        renderDot={null}
                        renderLabel={it => it.name}
                      />
                    </div>
                  )}
                  {doctorProfessions.length > 0 && (
                    <div>
                      <label style={labelStyle}>Специальность</label>
                      <PopoverSelect
                        value={doctorProfessions.includes(form.roleTitle) ? form.roleTitle : null}
                        onChange={v => updateForm('roleTitle', v)}
                        items={doctorProfessions.map(p => ({ id: p, name: p }))}
                        placeholder="—"
                        renderDot={null}
                        renderLabel={it => it.name}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ── Row 3: Отмена расписания ── */}
              {!modal.editId && (
                <div>
                  <label style={labelStyle}>Отмена расписания</label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div
                      onClick={() => updateForm('cancelCode', form.cancelCode !== null ? null : 'ОТ')}
                      style={{
                        width: 40, height: 22, borderRadius: 11, cursor: 'pointer', flexShrink: 0,
                        background: form.cancelCode !== null ? 'var(--rb-primary)' : '#cbd5e1',
                        position: 'relative', transition: 'background 0.18s',
                      }}
                    >
                      <div style={{
                        position: 'absolute', top: 3,
                        left: form.cancelCode !== null ? 21 : 3,
                        width: 16, height: 16, borderRadius: '50%', background: 'white',
                        transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      }} />
                    </div>
                    {form.cancelCode !== null && (
                      <div style={{ flex: 1 }}>
                        <PopoverSelect
                          value={form.cancelCode}
                          onChange={v => updateForm('cancelCode', v || 'ОТ')}
                          items={STATUS_CODES.filter(s => s.code && s.code !== 'В' && s.code !== 'Я').map(s => ({ id: s.code, name: s.label.includes(' — ') ? s.label.split(' — ').slice(1).join(' — ') : s.label }))}
                          placeholder="Выберите код"
                          renderDot={null}
                          renderLabel={it => it.name}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Row 4: Шаблон расписания (скрыт при редактировании конкретного дня) ── */}
              {!(modal.editId && modal.cell) && (
              <div>
                <label style={labelStyle}>Шаблон расписания</label>

                {/* Tab switcher */}
                <div className="rb-clinic-tab-wrap" ref={patternWrapRef} style={{ marginBottom: 0 }}>
                  {patternSliderEl}
                  {['daily', 'workdays', 'two_two', 'weekdays', 'even_odd', 'custom'].map(type => (
                    <button
                      key={type}
                      type="button"
                      className={`rb-clinic-tab${form.pattern.type === type ? ' active' : ''}`}
                      onClick={() => updatePat('type', type)}
                    >
                      {PATTERN_LABELS[type]}
                    </button>
                  ))}
                </div>

                {/* Sub-options panel — only for types with settings */}
                {(form.pattern.type === 'weekdays' || form.pattern.type === 'even_odd' || form.pattern.type === 'custom') && (
                  <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', padding: '12px 14px', background: 'var(--rb-bg)', marginTop: 8 }}>

                    {form.pattern.type === 'weekdays' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {WDAY_LABELS.map((lbl, i) => {
                          const checked = (form.pattern.weekdays || []).includes(i);
                          return (
                            <button key={i} type="button" onClick={() => toggleWday(i)} style={{
                              width: 40, height: 36, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              border: checked ? '2px solid var(--rb-primary)' : '1px solid var(--rb-border)',
                              background: checked ? 'var(--rb-primary)' : (i >= 5 ? '#fef2f2' : 'white'),
                              color: checked ? 'white' : (i >= 5 ? '#dc2626' : 'var(--rb-text)'),
                            }}>{lbl}</button>
                          );
                        })}
                      </div>
                    )}

                    {form.pattern.type === 'even_odd' && (
                      <div style={{ display: 'flex', gap: 12 }}>
                        {[['even','Чётные дни'],['odd','Нечётные дни']].map(([val, lbl]) => (
                          <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, userSelect: 'none' }}>
                            <input type="radio" checked={form.pattern.evenOdd === val} onChange={() => updatePat('evenOdd', val)} style={{ accentColor: 'var(--rb-primary)', width: 15, height: 15 }} />
                            {lbl}
                          </label>
                        ))}
                      </div>
                    )}

                    {form.pattern.type === 'custom' && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="number" min="1" max="365" value={form.pattern.workDays}
                          onChange={e => updatePat('workDays', Math.max(1, parseInt(e.target.value) || 1))}
                          style={{ ...inputStyle, width: 64, textAlign: 'center' }} />
                        <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>рабочих дней, потом</span>
                        <input type="number" min="1" max="365" value={form.pattern.restDays}
                          onChange={e => updatePat('restDays', Math.max(1, parseInt(e.target.value) || 1))}
                          style={{ ...inputStyle, width: 64, textAlign: 'center' }} />
                        <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>выходных</span>
                      </div>
                    )}

                  </div>
                )}

                {/* Weekday filter — applies to all patterns except 'weekdays' (which already IS the day selector) */}
                {form.pattern.type !== 'weekdays' && (
                  <div style={{ border: '1px solid var(--rb-border)', borderRadius: 'var(--rb-radius)', padding: '12px 14px', background: 'var(--rb-bg)', marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {WDAY_LABELS.map((lbl, i) => {
                        const allowed = form.pattern.allowedWeekdays || [];
                        const checked = allowed.length === 0 || allowed.includes(i);
                        return (
                          <button key={i} type="button" onClick={() => toggleAllowedWday(i)} style={{
                            width: 40, height: 36, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: checked ? '2px solid var(--rb-primary)' : '1px solid var(--rb-border)',
                            background: checked ? 'var(--rb-primary)' : (i >= 5 ? '#fef2f2' : 'white'),
                            color: checked ? 'white' : (i >= 5 ? '#dc2626' : 'var(--rb-text)'),
                          }}>{lbl}</button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              )}

            </div>

            <div className="rb-modal-footer">
              {modal.editId && (
                <button
                  style={{ ...btnRed, marginRight: 'auto' }}
                  onClick={() => { setConfirmDel(modal.editId); setModal(prev => ({ ...prev, type: 'day' })); setForm(null); }}
                >
                  Удалить
                </button>
              )}
              <button
                style={{ ...btnBlue, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
                onClick={handleSave}
                disabled={!canSave || saving}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════ MODAL: cancel reason picker ══════════════ */}
      {cancelModal && (
        <div className="rb-modal-overlay" onClick={() => setCancelModal(null)}>
          <div className="rb-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Причина отмены</h3>
              <button className="rb-modal-close" onClick={() => setCancelModal(null)}>×</button>
            </div>
            <div className="rb-modal-body" style={{ padding: '8px 16px 16px' }}>
              <p style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginBottom: 12 }}>
                Укажите код, который будет зафиксирован в табеле вместо рабочего дня:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
                {STATUS_CODES.filter(s => s.code && s.code !== 'В' && s.code !== 'Я').map(s => (
                  <button
                    key={s.code}
                    onClick={() => handleConfirmCancel(s.code)}
                    style={{
                      textAlign: 'left', padding: '7px 12px', border: '1px solid var(--rb-border)',
                      borderRadius: 7, background: 'var(--rb-bg)', cursor: 'pointer',
                      fontSize: 13, color: 'var(--rb-text)', fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--rb-hover)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--rb-bg)'; }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ MODAL: time conflict warning ══════════════ */}
      {conflictConfirm && (
        <div className="rb-modal-overlay" onClick={() => setConflictConfirm(null)}>
          <div className="rb-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Конфликт расписания</h3>
              <button className="rb-modal-close" onClick={() => setConflictConfirm(null)}>×</button>
            </div>
            <div className="rb-modal-body" style={{ padding: '8px 16px 16px' }}>
              <p style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginBottom: 12 }}>
                Новое расписание пересекается по времени с существующими записями:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {conflictConfirm.map(({ entry, dates }) => (
                  <div key={entry.id} style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: clinicColor(entry.clinicId) + '18',
                    borderLeft: `3px solid ${clinicColor(entry.clinicId)}`,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--rb-text)' }}>
                      {entry.timeFrom} – {entry.timeTo} · {clinicName(entry.clinicId)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 3 }}>
                      {dates.map(fmtDateShort).join(', ')}{dates.length >= 3 ? ' и др.' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rb-modal-footer">
              <button
                style={{ ...btnGhost }}
                onClick={() => setConflictConfirm(null)}
              >
                Отмена
              </button>
              <button
                style={{ ...btnBlue }}
                onClick={() => { setConflictConfirm(null); skipConflictCheck.current = true; handleSave(); }}
              >
                Сохранить всё равно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel MIS Import Modal ── */}
      {cancelImportModal && (
        <div className="rb-modal-overlay" onClick={() => { if (!cancelling) setCancelImportModal(false); }}>
          <div className="rb-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Удалить импорт МИС</h3>
              <button className="rb-modal-close" onClick={() => { if (!cancelling) setCancelImportModal(false); }}>×</button>
            </div>
            <div style={{ padding: '16px' }}>
              <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
                Будут удалены <strong style={{ color: 'var(--rb-text)' }}>все записи, импортированные из МИС</strong> для сотрудника <strong style={{ color: 'var(--rb-text)' }}>{selectedDoctor?.name}</strong>.
                {' '}Вручную созданные записи не изменятся.
              </div>
            </div>
            <div className="rb-modal-footer">
              <button style={{ ...btnGhost }} onClick={() => setCancelImportModal(false)} disabled={cancelling}>Отмена</button>
              <button style={{ ...btnRed, opacity: cancelling ? 0.6 : 1, minWidth: 120 }} onClick={handleCancelMisImport} disabled={cancelling}>
                {cancelling ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importModal && (
        <div className="rb-modal-overlay" onClick={() => { if (!importing) setImportModal(false); }}>
          <div className="rb-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Импорт из МИС</h3>
              <button className="rb-modal-close" onClick={() => { if (!importing) setImportModal(false); }}>×</button>
            </div>
            <div style={{ padding: '16px' }}>
              <div style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>
                Будет загружено расписание из МИС за <strong style={{ color: 'var(--rb-text)' }}>{MONTH_NAMES[month - 1]} {year}</strong> для сотрудника <strong style={{ color: 'var(--rb-text)' }}>{selectedDoctor?.name}</strong>.
                {' '}Ранее импортированные записи за этот месяц заменятся актуальными, вручную созданные не изменятся.
              </div>
            </div>
            <div className="rb-modal-footer">
              <button style={{ ...btnGhost }} onClick={() => setImportModal(false)} disabled={importing}>Отмена</button>
              <button style={{ ...btnBlue, opacity: importing ? 0.6 : 1, minWidth: 120 }} onClick={handleImportFromMis} disabled={importing}>
                {importing ? 'Импорт...' : 'Импортировать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MIS Category Map Modal ── */}
      {catMapModal && (
        <div className="rb-modal-overlay" onClick={() => setCatMapModal(false)}>
          <div className="rb-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Категории МИС</h3>
              <button className="rb-modal-close" onClick={() => setCatMapModal(false)}>×</button>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <p style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 14 }}>
                Сопоставьте ID категорий из МИС с категориями расписания в этой системе. После настройки следующий импорт автоматически подставит категории.
              </p>
              {catMapLoading ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--rb-text-secondary)', fontSize: 13 }}>Загрузка...</div>
              ) : catMapData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--rb-text-secondary)', fontSize: 13 }}>
                  Нет данных. Сначала выполните импорт — категории появятся здесь.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--rb-text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--rb-border)', width: 90 }}>ID МИС</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--rb-text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--rb-border)' }}>Категория в системе</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catMapData.map(row => (
                      <tr key={row.misCategoryId}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--rb-border)', color: 'var(--rb-text)', fontFamily: 'monospace', fontSize: 13 }}>{row.misCategoryId}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--rb-border)' }}>
                          <select
                            value={row.rbCategoryId || ''}
                            onChange={e => handleCatMapUpdate(row.misCategoryId, e.target.value || null)}
                            style={{ ...inputStyle, width: '100%', fontSize: 13 }}
                          >
                            <option value="">— не выбрано —</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rb-modal-footer">
              <button style={{ ...btnGhost }} onClick={() => setCatMapModal(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

