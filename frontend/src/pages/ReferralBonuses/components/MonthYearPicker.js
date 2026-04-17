import React, { useState, useEffect, useRef } from 'react';

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

export default function MonthYearPicker({ year, month, onChange, disabled }) {
  const [open,      setOpen]      = useState(false);
  const [step,      setStep]      = useState('year');
  const [navYear,   setNavYear]   = useState(year);
  const [yearStart, setYearStart] = useState(Math.floor(year / 10) * 10);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const openPicker = () => {
    setStep('year');
    setNavYear(year);
    setYearStart(Math.floor(year / 10) * 10);
    setOpen(true);
  };

  const pickYear  = (y) => { setNavYear(y); setStep('month'); };
  const pickMonth = (m) => { onChange(navYear, m); setOpen(false); };

  const btnBase = {
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        style={{
          ...btnBase, height: 34, padding: '0 12px', gap: 6,
          border: '1px solid var(--rb-border-dark)',
          background: '#fff', color: 'var(--rb-text)',
          minWidth: 160,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{MONTH_NAMES[month - 1]} {year}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 300,
          background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14)', padding: '14px 16px', minWidth: 232,
        }}>
          {step === 'year' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <button onClick={() => setYearStart(s => s - 10)}
                  style={{ ...btnBase, background: 'var(--rb-primary)', width: 26, height: 26, fontSize: 14, color: '#fff' }}>‹</button>
                <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                  {yearStart} – {yearStart + 9}
                </span>
                <button onClick={() => setYearStart(s => s + 10)}
                  style={{ ...btnBase, background: 'var(--rb-primary)', width: 26, height: 26, fontSize: 14, color: '#fff' }}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
                {Array.from({ length: 10 }, (_, i) => yearStart + i).map(y => {
                  const isActive = y === year;
                  return (
                    <button key={y} onClick={() => pickYear(y)}
                      style={{ ...btnBase, padding: '6px 2px', borderRadius: 7, fontWeight: isActive ? 700 : 400, background: isActive ? 'var(--rb-primary)' : 'transparent', color: isActive ? '#fff' : 'var(--rb-text)' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(0,122,255,0.1)'; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >{y}</button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <button onClick={() => setStep('year')}
                  style={{ ...btnBase, background: 'var(--rb-primary)', width: 26, height: 26, fontSize: 14, color: '#fff' }}>‹</button>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{navYear}</span>
                <div style={{ width: 26 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {MONTH_NAMES.map((name, i) => {
                  const isActive = navYear === year && (i + 1) === month;
                  return (
                    <button key={i} onClick={() => pickMonth(i + 1)}
                      style={{ ...btnBase, padding: '6px 4px', borderRadius: 7, fontSize: 12, fontWeight: isActive ? 700 : 400, background: isActive ? 'var(--rb-primary)' : 'transparent', color: isActive ? '#fff' : 'var(--rb-text)' }}
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
  );
}
