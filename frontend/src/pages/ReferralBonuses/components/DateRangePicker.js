import React, { useState, useEffect, useRef } from 'react';

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS_RU   = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function CalendarPopover({ dateFrom, dateTo, focusField, onSelect }) {
  const initDate = (focusField === 'to' && dateTo ? dateTo : dateFrom) || '';
  const initD = initDate ? new Date(initDate + 'T00:00:00') : new Date();
  const [viewYear,  setViewYear]  = useState(initD.getFullYear());
  const [viewMonth, setViewMonth] = useState(initD.getMonth());
  const [hover,     setHover]     = useState(null);

  const fmt = (y, m, d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const today = fmt(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay();
  const firstDay    = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
  const cells       = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const prevMonth = () => viewMonth === 0 ? (setViewMonth(11), setViewYear(y => y-1)) : setViewMonth(m => m-1);
  const nextMonth = () => viewMonth === 11 ? (setViewMonth(0),  setViewYear(y => y+1)) : setViewMonth(m => m+1);

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
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 5, fontSize: 16, color: 'var(--rb-text-secondary)', lineHeight: 1 }}>‹</button>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{MONTHS_RU[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 5, fontSize: 16, color: 'var(--rb-text-secondary)', lineHeight: 1 }}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 4 }}>
        {DAYS_RU.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--rb-text-secondary)', padding: '2px 0' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds      = fmt(viewYear, viewMonth, day);
          const start   = isStart(ds);
          const end     = isEnd(ds);
          const inRange = isInRange(ds);
          const isToday = ds === today;
          return (
            <button
              key={i}
              onClick={() => onSelect(ds)}
              onMouseEnter={() => setHover(ds)}
              onMouseLeave={() => setHover(null)}
              style={{
                padding: '5px 0', border: 'none', cursor: 'pointer', fontSize: 12,
                borderRadius: (start || end) ? 6 : inRange ? 0 : 6,
                background: (start || end) ? 'var(--rb-primary)' : inRange ? '#dbeafe' : 'transparent',
                color: (start || end) ? 'white' : isToday ? 'var(--rb-primary)' : 'var(--rb-text)',
                fontWeight: isToday ? 700 : 400,
                outline: isToday && !start && !end ? '1.5px solid var(--rb-primary)' : 'none',
                outlineOffset: -2,
              }}
            >{day}</button>
          );
        })}
      </div>
    </div>
  );
}

export const fmtDisplay = str => { if (!str) return ''; const [y,m,d] = str.split('-'); return `${d}.${m}.${y}`; };
export const parseManual = str => {
  if (!str || str.length !== 10) return null;
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isNaN(new Date(iso + 'T00:00:00').getTime()) ? null : iso;
};

function DateField({ value, onChange, onAutoAdvance, isOpen, onToggleCalendar, inputRef, anchorRef }) {
  const [raw, setRaw] = useState(fmtDisplay(value));

  useEffect(() => { setRaw(fmtDisplay(value)); }, [value]);

  const handleChange = e => {
    const v = e.target.value;
    setRaw(v);
    if (v === '') { onChange(''); return; }
    const iso = parseManual(v);
    if (iso) { onChange(iso); onAutoAdvance?.(); }
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter') { const iso = parseManual(raw); if (iso) { onChange(iso); onAutoAdvance?.(); } }
  };

  const handleBlur = () => {
    const iso = parseManual(raw);
    if (iso) { onChange(iso); setRaw(fmtDisplay(iso)); }
    else if (raw && raw !== fmtDisplay(value)) setRaw(fmtDisplay(value));
  };

  return (
    <div ref={anchorRef} style={{ display: 'flex', alignItems: 'center', border: isOpen ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border-dark)', borderRadius: 7, background: isOpen ? '#f0f7ff' : '#fff', height: 32, overflow: 'hidden', boxShadow: isOpen ? '0 0 0 3px rgba(0,122,255,.12)' : 'none', transition: 'box-shadow .15s, border-color .15s' }}>
      <input
        ref={inputRef}
        type="text"
        value={raw}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="дд.мм.гггг"
        maxLength={10}
        style={{ width: 86, padding: '0 8px', border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--rb-text)', height: '100%' }}
      />
      <button
        type="button"
        onClick={onToggleCalendar}
        style={{ padding: '0 7px', height: '100%', border: 'none', borderLeft: '1px solid var(--rb-border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', color: isOpen ? 'var(--rb-primary)' : 'var(--rb-text-secondary)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>
    </div>
  );
}

export default function DateRangePicker({ dateFrom, setDateFrom, dateTo, setDateTo }) {
  const [open, setOpen]     = useState(null);
  const [calPos, setCalPos] = useState({ top: 0, left: 0 });
  const toRef      = useRef(null);
  const wrapRef    = useRef(null);
  const fromAnchor = useRef(null);
  const toAnchor   = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openCalendar = (field) => {
    const anchor = field === 'from' ? fromAnchor.current : toAnchor.current;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      setCalPos({ top: r.bottom + 4, left: r.left });
    }
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
      if (dateFrom && ds < dateFrom) { setDateTo(dateFrom); setDateFrom(ds); }
      else setDateTo(ds);
      setOpen(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>с <span style={{ color: '#ef4444' }}>*</span></span>
      <DateField
        anchorRef={fromAnchor}
        value={dateFrom}
        onChange={v => { setDateFrom(v); if (v && dateTo && v > dateTo) setDateTo(''); }}
        onAutoAdvance={() => { openCalendar('to'); setTimeout(() => toRef.current?.focus(), 0); }}
        isOpen={open === 'from'}
        onToggleCalendar={() => openCalendar('from')}
      />
      {open === 'from' && (
        <div style={{ '--cal-top': calPos.top + 'px', '--cal-left': calPos.left + 'px' }}>
          <CalendarPopover dateFrom={dateFrom} dateTo={dateTo} focusField="from" onSelect={handleSelect} />
        </div>
      )}
      <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>по <span style={{ color: '#ef4444' }}>*</span></span>
      <DateField
        anchorRef={toAnchor}
        inputRef={toRef}
        value={dateTo}
        onChange={setDateTo}
        isOpen={open === 'to'}
        onToggleCalendar={() => openCalendar('to')}
      />
      {open === 'to' && (
        <div style={{ '--cal-top': calPos.top + 'px', '--cal-left': calPos.left + 'px' }}>
          <CalendarPopover dateFrom={dateFrom} dateTo={dateTo} focusField="to" onSelect={handleSelect} />
        </div>
      )}
    </div>
  );
}
