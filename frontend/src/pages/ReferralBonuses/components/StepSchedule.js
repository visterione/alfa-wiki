import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { doctorSchedules as schedulesApi, rbScheduleDicts as dictsApi } from '../../../services/api';
import { useTabSlider } from '../utils/useTabSlider';
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
  switch (pattern.type) {
    case 'daily':    return true;
    case 'workdays': return dow <= 4; // Mon–Fri
    case 'two_two': {
      const diff = Math.round((d - from) / 86400000);
      return diff % 4 < 2;
    }
    case 'weekdays': return (pattern.weekdays || []).includes(dow);
    case 'even_odd': return pattern.evenOdd === 'even' ? d.getDate() % 2 === 0 : d.getDate() % 2 === 1;
    case 'custom': {
      const diff  = Math.round((d - from) / 86400000);
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
    pattern:    { type: 'daily', weekdays: [], evenOdd: 'even', workDays: 5, restDays: 2 },
    timeFrom:   '09:00',
    timeTo:     '18:00',
    categoryId: null,
    cabinetId:  null,
  };
}

function entryToForm(entry) {
  return {
    clinicId:   entry.clinicId,
    dateFrom:   entry.dateFrom,
    dateTo:     entry.dateTo,
    pattern:    { ...entry.pattern, weekdays: [...(entry.pattern.weekdays || [])] },
    timeFrom:   entry.timeFrom,
    timeTo:     entry.timeTo,
    categoryId: entry.categoryId || null,
    cabinetId:  entry.cabinetId  || null,
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

// ── Clinic select dropdown ────────────────────────────────────────────────────
function ClinicSelect({ value, onChange, clinics, getClinicColor, getClinicName }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const wrapRef = useRef(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  const handleOpen = useCallback(() => {
    updatePos();
    setOpen(v => !v);
  }, [updatePos]);

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

  const dropdown = open && ReactDOM.createPortal(
    <div ref={wrapRef} style={{
      position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width,
      zIndex: 9999, background: '#fff', border: '1px solid var(--rb-border)',
      borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,.12)', fontFamily: 'Inter, sans-serif',
    }}>
      {clinics.length === 0
        ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Нет медцентров</div>
        : clinics.map(c => {
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

// Generic popover select reused for category and cabinet
function PopoverSelect({ value, onChange, items, placeholder, renderDot, renderLabel }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const wrapRef = useRef(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const maxH = 240;
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

  const handleOpen = useCallback(() => { updatePos(); setOpen(v => !v); }, [updatePos]);

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

  const dropdown = open && ReactDOM.createPortal(
    <div ref={wrapRef} style={{
      position: 'fixed', top: dropPos.top, bottom: dropPos.bottom, left: dropPos.left,
      width: Math.max(dropPos.width, 180),
      maxHeight: dropPos.maxH || 240, overflowY: 'auto',
      zIndex: 9999, background: '#fff', border: '1px solid var(--rb-border)',
      borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,.12)', fontFamily: 'Inter, sans-serif',
    }}>
      {/* clear option */}
      <button type="button" onClick={() => { onChange(null); setOpen(false); }} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
        border: 'none', background: !value ? '#EFF6FF' : 'transparent', cursor: 'pointer',
        fontSize: 13, color: 'var(--rb-text-secondary)', textAlign: 'left', fontFamily: 'inherit',
      }}>
        {placeholder}
      </button>
      {items.map(it => {
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
      })}
    </div>,
    document.body
  );

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} type="button" onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px 0 12px',
        borderRadius: 8, border: open ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border)',
        background: open ? '#f0f7ff' : 'var(--rb-bg)', cursor: 'pointer', fontSize: 13,
        color: selected ? 'var(--rb-text)' : 'var(--rb-text-secondary)', minWidth: 180,
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

// ═════════════════════════════════════════════════════════════════════════════
export default function StepSchedule({ selectedDoctorId, doctors, clinics, getClinicColor, getClinicName, managingDivision, onDivisionRenamed }) {
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

  // modal: null | { type: 'day', cell } | { type: 'form', cell, editId: null|string }
  const [modal,       setModal]       = useState(null);
  const [form,        setForm]        = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null); // entryId to confirm deletion
  const [cancelModal, setCancelModal] = useState(null); // { entryId, cell } — reason picker

  // Tab slider for pattern selector inside the form modal
  const { wrapRef: patternWrapRef, sliderEl: patternSliderEl } = useTabSlider(form?.pattern?.type ?? 'daily');

  // Ref to the second ClockPicker so the first can auto-open it on complete
  const timeToClockRef = useRef(null);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId) || null;
  const doctorClinics  = selectedDoctor
    ? clinics.filter(c => (selectedDoctor.clinics || []).includes(String(c.id)))
    : [];

  // ── Load dictionaries once ───────────────────────────────────────────────
  useEffect(() => {
    dictsApi.listCategories().then(r => setCategories(r.data)).catch(() => {});
    dictsApi.listCabinets().then(r => setCabinets(r.data)).catch(() => {});
  }, []);

  // ── Load entries when selected doctor changes ─────────────────────────────
  const loadedForRef = useRef(null);
  useEffect(() => {
    if (!selectedDoctor) {
      setEntries([]);
      loadedForRef.current = null;
      return;
    }
    const misUserId = selectedDoctor.misUserId || selectedDoctor.id;
    if (loadedForRef.current === misUserId) return;
    loadedForRef.current = misUserId;

    setLoading(true);
    schedulesApi.list(misUserId)
      .then(res => {
        setEntries(res.data.map(r => ({
          id:         r.id,
          doctorId:   selectedDoctor.id,
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
        })));
      })
      .catch(err => console.error('Load schedules error:', err))
      .finally(() => setLoading(false));
  }, [selectedDoctor]);

  // Entries for a specific cell
  const getCellEntries = useCallback((cell) => {
    if (!selectedDoctor) return [];
    return entries.filter(e => isDayScheduled(e, cell.year, cell.month, cell.day));
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

  // ── Handlers ──────────────────────────────────────────────────────────────
  const closeModal = () => { setModal(null); setForm(null); setConfirmDel(null); };

  const handleDayClick = (cell) => {
    if (!selectedDoctor) return;
    const cellEntries = getCellEntries(cell);
    if (cellEntries.length > 0) {
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
    };

    if (origEntry.dateFrom === targetDate && origEntry.dateTo === targetDate) {
      // Single-day entry — just update in place
      const res = await schedulesApi.update(modal.editId, {
        clinicId: form.clinicId, dateFrom: targetDate, dateTo: targetDate,
        pattern: form.pattern, timeFrom: form.timeFrom, timeTo: form.timeTo,
      });
      setEntries(prev => prev.map(e => e.id === modal.editId ? { ...e, ...mkEntry(res.data) } : e));
      return;
    }

    const beforeEx = filterEx(origEntry.exceptions, d => d < targetDate);
    const afterEx  = filterEx(origEntry.exceptions, d => d > targetDate);

    if (origEntry.dateFrom === targetDate) {
      // Target is first day — shrink original forward
      await schedulesApi.update(modal.editId, {
        clinicId: origEntry.clinicId, dateFrom: addDays(targetDate, 1), dateTo: origEntry.dateTo,
        pattern: origEntry.pattern, timeFrom: origEntry.timeFrom, timeTo: origEntry.timeTo, exceptions: afterEx,
      });
      const res = await schedulesApi.create(newDayPayload);
      setEntries(prev => [
        ...prev.map(e => e.id === modal.editId ? { ...e, dateFrom: addDays(targetDate, 1), exceptions: afterEx } : e),
        mkEntry(res.data),
      ]);
    } else if (origEntry.dateTo === targetDate) {
      // Target is last day — shrink original backward
      await schedulesApi.update(modal.editId, {
        clinicId: origEntry.clinicId, dateFrom: origEntry.dateFrom, dateTo: addDays(targetDate, -1),
        pattern: origEntry.pattern, timeFrom: origEntry.timeFrom, timeTo: origEntry.timeTo, exceptions: beforeEx,
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
      });
      const [dayRes, afterRes] = await Promise.all([
        schedulesApi.create(newDayPayload),
        schedulesApi.create({
          misUserId,
          clinicId:   origEntry.clinicId,
          dateFrom:   addDays(targetDate, 1),
          dateTo:     origEntry.dateTo,
          pattern:    origEntry.pattern,
          timeFrom:   origEntry.timeFrom,
          timeTo:     origEntry.timeTo,
          exceptions: afterEx,
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
        });
        const updated = res.data;
        setEntries(prev => prev.map(e => e.id === modal.editId
          ? { ...e, clinicId: updated.clinicId, dateFrom: updated.dateFrom, dateTo: updated.dateTo, pattern: updated.pattern, timeFrom: updated.timeFrom, timeTo: updated.timeTo, categoryId: updated.categoryId || null, cabinetId: updated.cabinetId || null }
          : e
        ));
      } else {
        const res = await schedulesApi.create({
          misUserId,
          clinicId:   form.clinicId,
          dateFrom:   form.dateFrom,
          dateTo:     form.dateTo,
          pattern:    form.pattern,
          timeFrom:   form.timeFrom,
          timeTo:     form.timeTo,
          exceptions: [],
          categoryId: form.categoryId || null,
          cabinetId:  form.cabinetId  || null,
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
    });
    const beforeEx = filterEx(entry.exceptions, d => d < targetDate);
    const afterEx  = filterEx(entry.exceptions, d => d > targetDate);

    try {
      if (entry.dateFrom === targetDate) {
        await schedulesApi.update(entryId, {
          clinicId: entry.clinicId, dateFrom: addDays(targetDate, 1), dateTo: entry.dateTo,
          pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: afterEx,
        });
        setEntries(prev => prev.map(e => e.id === entryId ? { ...e, dateFrom: addDays(targetDate, 1), exceptions: afterEx } : e));
      } else if (entry.dateTo === targetDate) {
        await schedulesApi.update(entryId, {
          clinicId: entry.clinicId, dateFrom: entry.dateFrom, dateTo: addDays(targetDate, -1),
          pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: beforeEx,
        });
        setEntries(prev => prev.map(e => e.id === entryId ? { ...e, dateTo: addDays(targetDate, -1), exceptions: beforeEx } : e));
      } else {
        await schedulesApi.update(entryId, {
          clinicId: entry.clinicId, dateFrom: entry.dateFrom, dateTo: addDays(targetDate, -1),
          pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo, exceptions: beforeEx,
        });
        const res = await schedulesApi.create({
          misUserId, clinicId: entry.clinicId,
          dateFrom: addDays(targetDate, 1), dateTo: entry.dateTo,
          pattern: entry.pattern, timeFrom: entry.timeFrom, timeTo: entry.timeTo,
          exceptions: afterEx,
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
    const otherAbsences = {}; // code -> count

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
          const mins = (th * 60 + tm) - (fh * 60 + fm);
          if (mins > 0) workedMinutes += mins;
        } else {
          const code = (typeof ex === 'object' ? ex.code : null) || 'ОТ';
          if (code === 'В') weekendCount++;
          else otherAbsences[code] = (otherAbsences[code] || 0) + 1;
        }
      }
      if (dayHasWork) workedDaysSet.add(dateStr);
    }

    const totalOther = Object.values(otherAbsences).reduce((a, b) => a + b, 0);
    return {
      workedDays:  workedDaysSet.size,
      workedHours: Math.floor(workedMinutes / 60),
      workedMins:  workedMinutes % 60,
      weekendCount,
      otherAbsences,
      totalOther,
    };
  }, [year, month, entries, selectedDoctor]);

  if (!selectedDoctor) {
    if (managingDivision) {
      return <DivisionAccessPanel divisionId={managingDivision.id} divisionName={managingDivision.name} onRenamed={onDivisionRenamed} />;
    }
    return <div className="rb-placeholder"><p>Выберите сотрудника из списка слева</p></div>;
  }

  // Current day entries for day-modal
  const modalCellEntries = modal?.cell ? getCellEntries(modal.cell) : [];

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
                    return (
                      <td
                        key={di}
                        className={[
                          'rb-schedule-cell rb-schedule-cell-active',
                          di >= 5    ? 'rb-schedule-cell-weekend' : '',
                          tod        ? 'rb-schedule-cell-today'   : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => handleDayClick(cell)}
                      >
                        <span
                          className={tod ? 'rb-schedule-day-num rb-schedule-today-num' : 'rb-schedule-day-num'}
                          style={!cell.isCurrentMonth ? { color: '#b0bec5' } : undefined}
                        >
                          {cell.day}
                        </span>
                        <div className="rb-schedule-entries">
                          {cellEntries.map(e => {
                            const cancelled = isExcepted(e, cell);
                            const entryCode = cancelled ? (getExceptionCode(e, cell) || 'ОТ') : 'Я';
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
                                  title={cancelled ? `Отменён · ${entryCode}` : `${e.timeFrom}–${e.timeTo} · ${cab ? cab.name : clinicName(e.clinicId)}${cat ? ' · ' + cat.name : ''}`}
                                >
                                  {cat && (
                                    <span style={{
                                      position: 'absolute', top: 3, right: 3,
                                      width: 8, height: 8, borderRadius: '50%',
                                      background: cat.color, flexShrink: 0,
                                    }} />
                                  )}
                                  <span className="rb-schedule-entry-time">{e.timeFrom} – {e.timeTo}</span>
                                  <span className="rb-schedule-entry-name">{abbreviateName(selectedDoctor.name)}</span>
                                  <span className="rb-schedule-entry-clinic">{cab ? cab.name : clinicName(e.clinicId)}</span>
                                </div>
                                <span className={cancelled ? 'rb-schedule-entry-cancel-code' : 'rb-schedule-entry-work-code'}>
                                  {entryCode}
                                </span>
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
        <div className="rb-schedule-stats">
          <div className="rb-schedule-stat">
            <span className="rb-schedule-stat-value">{monthStats.workedDays}</span>
            <span className="rb-schedule-stat-label">раб. дней</span>
          </div>
          <div className="rb-schedule-stat-sep" />
          <div className="rb-schedule-stat">
            <span className="rb-schedule-stat-value">
              {monthStats.workedHours}
              {monthStats.workedMins > 0 && (
                <span style={{ fontSize: '0.78em', fontWeight: 500 }}>:{pad2(monthStats.workedMins)}</span>
              )}
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
        </div>
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
                      {!isConfirming ? (
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
                    )}
                  </div>
                  </div>
                );
              })}
            </div>

            <div className="rb-modal-footer">
              <button style={{ ...btnBlue, width: BTN_W }} onClick={() => openNewForm(modal.cell)}>
                Создать
              </button>
            </div>
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
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
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
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <label style={labelStyle}>Кабинет</label>
                  <PopoverSelect
                    value={form.cabinetId}
                    onChange={v => updateForm('cabinetId', v)}
                    items={cabinets.filter(c => c.clinicId === form.clinicId)}
                    placeholder="Не указан"
                    renderDot={null}
                    renderLabel={it => it.name}
                  />
                </div>
              </div>

              {/* ── Row 3: Шаблон расписания (скрыт при редактировании конкретного дня) ── */}
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

    </div>
  );
}

