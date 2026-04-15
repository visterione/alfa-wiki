import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const ORGS = [
  'ООО "Альфа Престиж"',
  'ООО "Альфа Проф"',
  'ООО "ЛАБ ГРУПП"',
];
const STATUS_CODES = [
  { code: '',  label: '— (не задано)' },
  { code: 'Я', label: 'Я — Явился' },
  { code: 'В', label: 'В — Выходной' },
  { code: 'Б', label: 'Б — Больничный' },
  { code: 'О', label: 'О — Отпуск' },
  { code: 'К', label: 'К — Командировка' },
];
const WORKING_CODES = new Set(['Я', 'К']);

function pad2(n) { return String(n).padStart(2, '0'); }

// ── Employee multi-select dropdown ────────────────────────────────────────────
function EmpSelect({ doctors, selectedIds, onChange }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef             = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const filtered = useMemo(
    () => doctors.filter(d => d.name.toLowerCase().includes(search.toLowerCase())),
    [doctors, search]
  );

  const toggle = id => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };

  const label = selectedIds.size === 0
    ? 'Выберите сотрудников'
    : selectedIds.size === doctors.length ? 'Все сотрудники' : `Выбрано: ${selectedIds.size}`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 34,
        padding: '0 10px 0 12px', borderRadius: 8, border: '1px solid var(--rb-border)',
        background: 'var(--rb-bg)', cursor: 'pointer', fontSize: 13,
        color: selectedIds.size === 0 ? 'var(--rb-text-secondary)' : 'var(--rb-text)',
        minWidth: 200, whiteSpace: 'nowrap',
      }}>
        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.13)', minWidth: 260, maxWidth: 340,
          marginTop: 4, overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--rb-border)' }}>
            <input autoFocus type="text" placeholder="Поиск..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '5px 10px',
                border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 13,
                outline: 'none', background: 'var(--rb-bg)', color: 'var(--rb-text)',
              }} />
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--rb-border)' }}>
            {[['Все', () => onChange(new Set(doctors.map(d => d.id)))],
              ['Сбросить', () => onChange(new Set())]].map(([lbl, fn]) => (
              <button key={lbl} type="button" onClick={fn} style={{
                fontSize: 11, padding: '2px 8px', border: '1px solid var(--rb-border)',
                borderRadius: 5, background: 'none', cursor: 'pointer', color: 'var(--rb-text-secondary)',
              }}>{lbl}</button>
            ))}
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Не найдено</div>
              : filtered.map(d => (
                <label key={d.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 14px', cursor: 'pointer', fontSize: 13,
                  background: selectedIds.has(d.id) ? '#EFF6FF' : 'transparent',
                }}>
                  <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggle(d.id)}
                    style={{ accentColor: 'var(--rb-primary)', width: 14, height: 14, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                </label>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── Signature / underline field ───────────────────────────────────────────────
function UnderlineField({ label, value, minWidth = 140 }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth }}>
      <div style={{
        borderBottom: '1px solid #000', width: '100%',
        minHeight: 22, paddingBottom: 2, textAlign: 'center',
        fontSize: 13, fontFamily: 'Times New Roman, serif',
      }}>
        {value}
      </div>
      <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#555', marginTop: 2 }}>
        ({label})
      </span>
    </div>
  );
}

function SigLine({ role, name }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 24, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontFamily: 'Times New Roman, serif', whiteSpace: 'nowrap' }}>{role}</span>
      <UnderlineField label="должность" minWidth={130} />
      <UnderlineField label="подпись" minWidth={90} />
      <UnderlineField label="расшифровка подписи" value={name} minWidth={150} />
    </div>
  );
}

// ── Attendance table ──────────────────────────────────────────────────────────
// Structure: 16 shared day-columns.
// Column i (0-14) → top header = day i+1, bottom header = day i+16
// Column 15       → top header = "Х",     bottom header = last day of month (if > 30)
function TabelTable({ selectedDoctors, year, month, readOnly }) {
  const lastDay = new Date(year, month, 0).getDate();

  // Top half days: 1-15 for columns 0-14; column 15 is the "Х" separator
  const firstHalf = Array.from({ length: 15 }, (_, i) => i + 1); // [1..15]

  // Bottom half days: 16..lastDay mapped to columns 0-15
  // column i → day 16+i; null if month is too short
  const secondHalf = Array.from({ length: 16 }, (_, i) => {
    const d = 16 + i;
    return d <= lastDay ? d : null;
  });

  const [entries, setEntries] = useState({});
  const [picker,  setPicker]  = useState(null); // { docId, day, top, left }

  const getEntry = useCallback(
    (docId, day) => entries[docId]?.[day] || { code: '', hours: '' },
    [entries]
  );

  const setCode = (docId, day, code) =>
    setEntries(prev => ({
      ...prev,
      [docId]: { ...prev[docId], [day]: { ...(prev[docId]?.[day] || {}), code } },
    }));

  const setHours = (docId, day, val) =>
    setEntries(prev => ({
      ...prev,
      [docId]: { ...prev[docId], [day]: { ...(prev[docId]?.[day] || {}), hours: val } },
    }));

  const calcTotals = useCallback((docId) => {
    const allFirstHalf  = firstHalf; // days 1-15
    const allSecondHalf = secondHalf.filter(Boolean); // days 16-lastDay

    const daysI   = allFirstHalf.filter(d => WORKING_CODES.has(getEntry(docId, d).code)).length;
    const hoursI  = allFirstHalf.reduce((s, d) => s + (parseFloat(getEntry(docId, d).hours) || 0), 0);
    const daysII  = allSecondHalf.filter(d => WORKING_CODES.has(getEntry(docId, d).code)).length;
    const hoursII = allSecondHalf.reduce((s, d) => s + (parseFloat(getEntry(docId, d).hours) || 0), 0);

    return {
      daysI, hoursI, daysII, hoursII,
      totalDays: daysI + daysII,
      totalHours: hoursI + hoursII,
    };
  }, [getEntry, firstHalf, secondHalf]);

  const openPicker = (docId, day, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPicker({ docId, day, top: rect.bottom + 3, left: rect.left });
  };

  useEffect(() => {
    if (!picker) return;
    const close = e => { if (!e.target.closest('.tabel-picker')) setPicker(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [picker]);

  return (
    <div style={{ overflowX: 'auto', position: 'relative', borderRight: '1px solid #000' }}>

      {picker && (
        <div className="tabel-picker" style={{ top: picker.top, left: picker.left }}>
          {STATUS_CODES.map(s => (
            <button key={s.code || '__empty__'} className="tabel-picker-item"
              onClick={() => { setCode(picker.docId, picker.day, s.code); setPicker(null); }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <table className="tabel-table">
        <thead>
          {/* ── Row 1: group headers ── */}
          <tr>
            <th className="tt-th" rowSpan={3} style={{ width: 24 }}>№</th>
            <th className="tt-th" rowSpan={3} style={{ minWidth: 200 }}>
              Фамилия, инициалы, должность (специальность, профессия)
            </th>
            <th className="tt-th tt-th-rot" rowSpan={3}>
              <div className="tt-th-rot-inner">Табельный номер</div>
            </th>
            {/* 16 shared day-columns */}
            <th className="tt-th" colSpan={16}>
              Отметки о явках и неявках на работу по числам месяца
            </th>
            <th className="tt-th" colSpan={2}>
              Отработано за
            </th>
          </tr>

          {/* ── Row 2: top day labels (1-15 + Х) and section labels ── */}
          <tr>
            {firstHalf.map(d => (
              <th key={d} className="tt-th tt-th-day">{d}</th>
            ))}
            <th className="tt-th tt-th-day tt-th-x">Х</th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 44 }}>
              половину<br />месяца<br />(I, II)
            </th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 44 }}>
              месяц
            </th>
          </tr>

          {/* ── Row 3: bottom day labels (16-31) ── */}
          <tr>
            {secondHalf.map((d, i) => (
              <th key={i} className={`tt-th tt-th-day${d === null ? ' tt-th-inactive' : ''}`}>
                {d ?? ''}
              </th>
            ))}
          </tr>

          {/* ── Row 4: column numbers ── */}
          <tr className="tt-col-numbers">
            <td className="tt-th tt-col-num">1</td>
            <td className="tt-th tt-col-num">2</td>
            <td className="tt-th tt-col-num">3</td>
            <td className="tt-th tt-col-num" colSpan={16}>4</td>
            <td className="tt-th tt-col-num">5</td>
            <td className="tt-th tt-col-num">6</td>
          </tr>
        </thead>

        <tbody>
          {selectedDoctors.length === 0 && (
            <tr>
              <td colSpan={21} className="tt-td"
                style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
                Сотрудники не выбраны
              </td>
            </tr>
          )}

          {selectedDoctors.map((doc, idx) => {
            const t    = calcTotals(doc.id);
            const role = (Array.isArray(doc.roles) && doc.roles.length > 0)
              ? doc.roles.join(', ')
              : (Array.isArray(doc.professions) && doc.professions.length > 0)
                ? doc.professions.join(', ')
                : '';

            return (
              <React.Fragment key={doc.id}>

                {/* ── Row A: codes for first half (days 1-15) + Х ── */}
                <tr className="tt-row-a">
                  <td className="tt-td tt-center" rowSpan={4}>{idx + 1}</td>
                  <td className="tt-td tt-name" rowSpan={4}>
                    <div style={{ lineHeight: 1.3 }}>{doc.name}</div>
                    {role && <div style={{ fontSize: 10, color: '#555', marginTop: 2, lineHeight: 1.2 }}>{role}</div>}
                  </td>
                  <td className="tt-td tt-center" rowSpan={4}>{idx + 1}</td>

                  {firstHalf.map(d => (
                    <td key={d}
                      className={`tt-td tt-code${!readOnly ? ' tt-clickable' : ''}`}
                      onClick={!readOnly ? e => openPicker(doc.id, d, e) : undefined}>
                      {getEntry(doc.id, d).code}
                    </td>
                  ))}
                  {/* Х column row A — status fixed */}
                  <td className="tt-td tt-x-cell">Х</td>

                  {/* Summary: days in first half | total days (rowspan 2) */}
                  <td className="tt-td tt-sum">{t.daysI || ''}</td>
                  <td className="tt-td tt-total" rowSpan={2}>{t.totalDays || ''}</td>
                </tr>

                {/* ── Row B: hours for first half (days 1-15) ── */}
                <tr className="tt-row-b">
                  {firstHalf.map(d => (
                    <td key={d} className="tt-td tt-hours">
                      <input
                        type="number" min="0" step="0.5"
                        className="tt-hours-input"
                        value={getEntry(doc.id, d).hours}
                        onChange={e => setHours(doc.id, d, e.target.value)}
                        disabled={readOnly}
                      />
                    </td>
                  ))}
                  {/* Х column row B — hours fixed */}
                  <td className="tt-td tt-x-cell">Х</td>
                  <td className="tt-td tt-sum">{t.hoursI || ''}</td>
                  {/* totalDays cell merged from row A */}
                </tr>

                {/* ── Row C: codes for second half (days 16-31) ── */}
                <tr className="tt-row-c">
                  {secondHalf.map((d, i) => (
                    d !== null
                      ? <td key={i}
                          className={`tt-td tt-code${!readOnly ? ' tt-clickable' : ''}`}
                          onClick={!readOnly ? e => openPicker(doc.id, d, e) : undefined}>
                          {getEntry(doc.id, d).code}
                        </td>
                      : <td key={i} className="tt-td tt-inactive" />
                  ))}
                  <td className="tt-td tt-sum">{t.daysII || ''}</td>
                  <td className="tt-td tt-total" rowSpan={2}>{t.totalHours || ''}</td>
                </tr>

                {/* ── Row D: hours for second half (days 16-31) ── */}
                <tr className="tt-row-d">
                  {secondHalf.map((d, i) => (
                    d !== null
                      ? <td key={i} className="tt-td tt-hours">
                          <input
                            type="number" min="0" step="0.5"
                            className="tt-hours-input"
                            value={getEntry(doc.id, d).hours}
                            onChange={e => setHours(doc.id, d, e.target.value)}
                            disabled={readOnly}
                          />
                        </td>
                      : <td key={i} className="tt-td tt-inactive" />
                  ))}
                  <td className="tt-td tt-sum">{t.hoursII || ''}</td>
                  {/* totalHours merged from row C */}
                </tr>

              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StepWorkTime({ doctors = [], readOnly }) {
  const { user } = useAuth();
  const now = new Date();

  const [subdivision, setSubdivision] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [year,      setYear]      = useState(now.getFullYear());
  const [month,     setMonth]     = useState(now.getMonth() + 1);
  const [orgName,   setOrgName]   = useState('');
  const [docNumber, setDocNumber] = useState('1');
  const [showDoc,   setShowDoc]   = useState(false);

  const years = [];
  for (let y = now.getFullYear() + 1; y >= 2024; y--) years.push(y);

  const lastDay    = new Date(year, month, 0).getDate();
  const periodFrom = `01.${pad2(month)}.${year}`;
  const periodTo   = `${pad2(lastDay)}.${pad2(month)}.${year}`;
  const docDate    = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`;

  const selectedDoctors = useMemo(
    () => doctors.filter(d => selectedIds.has(d.id)),
    [doctors, selectedIds]
  );

  const userName = (() => {
    const full = user?.displayName || '';
    const parts = full.trim().split(/\s+/);
    if (parts.length >= 2) {
      const [last, ...rest] = parts;
      return last + ' ' + rest.map(p => p[0].toUpperCase() + '.').join(' ');
    }
    return full || user?.username || '';
  })();

  const handleGenerate = () => {
    if (!subdivision.trim())    { toast.error('Укажите структурное подразделение'); return; }
    if (selectedIds.size === 0) { toast.error('Выберите сотрудников'); return; }
    if (!orgName)               { toast.error('Выберите наименование организации'); return; }
    setShowDoc(true);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Settings toolbar ── */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--rb-border)',
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end',
        background: 'var(--rb-bg)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Организация</label>
          <select className="rb-select" value={orgName} onChange={e => setOrgName(e.target.value)}
            disabled={readOnly} style={{ height: 34, padding: '0 10px', minWidth: 200 }}>
            <option value="">Выберите организацию</option>
            {ORGS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Структурное подразделение</label>
          <input type="text" value={subdivision} onChange={e => setSubdivision(e.target.value)}
            placeholder="Например: Регистратура" disabled={readOnly}
            style={{
              height: 34, padding: '0 12px', borderRadius: 8,
              border: '1px solid var(--rb-border)', fontSize: 13,
              background: 'var(--rb-bg)', color: 'var(--rb-text)', minWidth: 220,
            }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Сотрудники</label>
          <EmpSelect doctors={doctors} selectedIds={selectedIds} onChange={setSelectedIds} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Период</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="rb-select" value={month} onChange={e => setMonth(parseInt(e.target.value))}
              disabled={readOnly} style={{ height: 34, padding: '0 10px', width: 130 }}>
              {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
            </select>
            <select className="rb-select" value={year} onChange={e => setYear(parseInt(e.target.value))}
              disabled={readOnly} style={{ height: 34, padding: '0 10px', width: 80 }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>№ документа</label>
          <input type="text" value={docNumber} onChange={e => setDocNumber(e.target.value)}
            disabled={readOnly}
            style={{
              height: 34, padding: '0 12px', borderRadius: 8, width: 70,
              border: '1px solid var(--rb-border)', fontSize: 13,
              background: 'var(--rb-bg)', color: 'var(--rb-text)', textAlign: 'center',
            }} />
        </div>

        {!readOnly && (
          <button className="rb-btn rb-btn-primary" onClick={handleGenerate}
            style={{ height: 34, alignSelf: 'flex-end' }}>
            Сформировать табель
          </button>
        )}
      </div>

      {/* ── Document view ── */}
      {showDoc ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#f1f5f9' }}>
          <div className="tabel-doc">

            {/* 1. Наименование организации */}
            <div className="tabel-org-name">{orgName}</div>

            {/* 2. Структурное подразделение — по центру, как поле подписи */}
            <div style={{ textAlign: 'center', marginTop: 10, marginBottom: 12 }}>
              <div style={{
                display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 280,
              }}>
                <div style={{
                  borderBottom: '1px solid #000', width: '100%', minHeight: 22,
                  textAlign: 'center', fontSize: 13,
                  fontFamily: 'Times New Roman, serif', paddingBottom: 2,
                }}>
                  {subdivision}
                </div>
                <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#555', marginTop: 2 }}>
                  (структурное подразделение)
                </span>
              </div>
            </div>

            {/* 3. Мета-таблица (справа) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 12px' }}>
              <table className="tabel-meta-table">
                <thead>
                  <tr>
                    <th>Номер документа</th>
                    <th>Дата составления</th>
                    <th colSpan={2}>Отчётный период</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{docNumber}</td>
                    <td>{docDate}</td>
                    <td>с {periodFrom}</td>
                    <td>по {periodTo}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 4. Заголовок */}
            <div className="tabel-title">ТАБЕЛЬ УЧЁТА РАБОЧЕГО ВРЕМЕНИ</div>

            {/* 5. Таблица */}
            <TabelTable
              selectedDoctors={selectedDoctors}
              year={year}
              month={month}
              readOnly={readOnly}
            />

            {/* 6. Подписи */}
            <div style={{ marginTop: 36 }}>
              <SigLine role="Ответственное лицо" name={userName} />
              <SigLine role="Руководитель структурного подразделения" name={userName} />
            </div>

          </div>
        </div>
      ) : (
        <div className="rb-loading" style={{ color: 'var(--rb-text-secondary)', marginTop: 60 }}>
          Заполните параметры и нажмите «Сформировать табель»
        </div>
      )}
    </div>
  );
}
