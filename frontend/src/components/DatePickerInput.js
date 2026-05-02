import React, { useState, useEffect, useRef } from 'react';

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

export default function DatePickerInput({ value, onChange, placeholder = 'Выберите дату' }) {
  const parsed = value ? new Date(value + 'T00:00:00') : null;
  const today = new Date();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('days');
  const [navYear, setNavYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [navMonth, setNavMonth] = useState(parsed ? parsed.getMonth() + 1 : today.getMonth() + 1);
  const [yearStart, setYearStart] = useState(Math.floor((parsed?.getFullYear() ?? today.getFullYear()) / 10) * 10);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const openPicker = () => {
    const y = parsed?.getFullYear() ?? today.getFullYear();
    const m = parsed ? parsed.getMonth() + 1 : today.getMonth() + 1;
    setNavYear(y);
    setNavMonth(m);
    setYearStart(Math.floor(y / 10) * 10);
    setStep('days');
    setOpen(true);
  };

  const selectDay = (day) => {
    const mm = String(navMonth).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${navYear}-${mm}-${dd}`);
    setOpen(false);
  };

  const prevMonth = () => {
    if (navMonth === 1) { setNavMonth(12); setNavYear(y => y - 1); }
    else setNavMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (navMonth === 12) { setNavMonth(1); setNavYear(y => y + 1); }
    else setNavMonth(m => m + 1);
  };

  const daysInMonth = new Date(navYear, navMonth, 0).getDate();
  const firstDayRaw = new Date(navYear, navMonth - 1, 1).getDay();
  const firstDay = firstDayRaw === 0 ? 7 : firstDayRaw; // Mon=1 … Sun=7
  const totalCells = Math.ceil((firstDay - 1 + daysInMonth) / 7) * 7;

  const activeDay = parsed &&
    parsed.getFullYear() === navYear &&
    parsed.getMonth() + 1 === navMonth
    ? parsed.getDate() : null;

  const isToday = (day) =>
    day === today.getDate() &&
    navMonth === today.getMonth() + 1 &&
    navYear === today.getFullYear();

  const formatDisplay = () => {
    if (!parsed) return '';
    return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()}`;
  };

  const btn = {
    border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit', background: 'transparent',
  };

  const navBtn = {
    ...btn,
    width: 26, height: 26, fontSize: 16, fontWeight: 700,
    background: 'var(--primary, #2563eb)', color: '#fff', borderRadius: 7,
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={openPicker}
        style={{
          ...btn,
          width: '100%', height: 40, padding: '0 12px', gap: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
          borderRadius: 'var(--radius-md)',
          justifyContent: 'flex-start', fontSize: 14,
        }}
      >
        <CalendarIcon />
        {formatDisplay() || placeholder}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          padding: '14px 16px', minWidth: 252,
        }}>
          {step === 'years' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <button onClick={() => setYearStart(s => s - 10)} style={navBtn}>‹</button>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {yearStart} – {yearStart + 9}
                </span>
                <button onClick={() => setYearStart(s => s + 10)} style={navBtn}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
                {Array.from({ length: 10 }, (_, i) => yearStart + i).map(y => {
                  const active = y === navYear;
                  return (
                    <button key={y}
                      onClick={() => { setNavYear(y); setStep('months'); }}
                      style={{ ...btn, padding: '6px 2px', borderRadius: 7, fontWeight: active ? 700 : 400, background: active ? 'var(--primary, #2563eb)' : 'transparent', color: active ? '#fff' : 'var(--text-primary)' }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >{y}</button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'months' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <button onClick={() => setStep('years')} style={navBtn}>‹</button>
                <button onClick={() => setStep('years')}
                  style={{ ...btn, fontWeight: 700, fontSize: 15, padding: '0 8px', height: 28, color: 'var(--text-primary)' }}>
                  {navYear}
                </button>
                <div style={{ width: 26 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {MONTH_NAMES.map((name, i) => {
                  const active = navYear === parsed?.getFullYear() && i + 1 === (parsed?.getMonth() + 1);
                  return (
                    <button key={i}
                      onClick={() => { setNavMonth(i + 1); setStep('days'); }}
                      style={{ ...btn, padding: '6px 4px', borderRadius: 7, fontSize: 12, fontWeight: active ? 700 : 400, background: active ? 'var(--primary, #2563eb)' : 'transparent', color: active ? '#fff' : 'var(--text-primary)' }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >{name.slice(0, 3)}</button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'days' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <button onClick={prevMonth} style={navBtn}>‹</button>
                <button onClick={() => setStep('months')}
                  style={{ ...btn, fontWeight: 600, fontSize: 14, padding: '0 8px', height: 28, color: 'var(--text-primary)' }}>
                  {MONTH_NAMES[navMonth - 1]} {navYear}
                </button>
                <button onClick={nextMonth} style={navBtn}>›</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
                {DAY_NAMES.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, padding: '2px 0' }}>
                    {d}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {Array.from({ length: totalCells }, (_, i) => {
                  const day = i - (firstDay - 2);
                  const valid = day >= 1 && day <= daysInMonth;
                  const active = valid && day === activeDay;
                  const tod = valid && isToday(day);
                  return (
                    <button key={i}
                      disabled={!valid}
                      onClick={() => valid && selectDay(day)}
                      style={{
                        ...btn,
                        height: 30, fontSize: 13,
                        borderRadius: 7,
                        background: active ? 'var(--primary, #2563eb)' : 'transparent',
                        color: active ? '#fff' : tod ? 'var(--primary, #2563eb)' : valid ? 'var(--text-primary)' : 'transparent',
                        fontWeight: active || tod ? 700 : 400,
                        cursor: valid ? 'pointer' : 'default',
                        outline: tod && !active ? '1.5px solid var(--primary, #2563eb)' : 'none',
                        outlineOffset: '-1.5px',
                      }}
                      onMouseEnter={e => { if (valid && !active) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {valid ? day : ''}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
