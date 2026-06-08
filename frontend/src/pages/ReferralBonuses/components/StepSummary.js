import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import toast from 'react-hot-toast';
import ExcelJS from 'exceljs';
import { salaryRecords, executorSettings as execSettingsApi, cashPayments as cashPaymentsApi } from '../../../services/api';
import { clearExecCache } from '../utils/reportEngine';
import SalaryBlock from './SalaryBlockRenderer';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const fmtRub = v =>
  parseFloat(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';

// Вычисляет остаток к доплате (к выплате = финалсалари − аванс − тело − доп.выплаты)
function calcRemainder(sal) {
  if (!sal) return 0;
  const extraTotal = (sal.extraPayments || []).reduce((s, ep) => s + (parseFloat(ep.amount) || 0), 0);
  return parseFloat(sal.finalSalary || 0) - parseFloat(sal.ndflTotal || 0) - parseFloat(sal.advance || 0) - parseFloat(sal.mainPayment || 0) - parseFloat(sal.normPremiumAmount || 0) - extraTotal;
}

// Извлекает сумму вычета по имени из объекта salary (поддерживает % и ₽)
function _getDeductionAmount(salary, namePredicate) {
  if (!salary) return 0;
  const deductions = salary.deductions || [];
  const ded = deductions.find(d => namePredicate((d.name || '').trim()));
  if (!ded) return 0;
  const value = parseFloat(ded.value) || 0;
  if (ded.valueType === 'rub') return value;
  if (ded.deductionType === 'final') {
    const preFinal = (parseFloat(salary.finalSalary) || 0)
      + (parseFloat(salary.finalDeductionsTotal) || 0)
      + (parseFloat(salary.materialsTotal) || 0);
    return preFinal * value / 100;
  }
  const base = parseFloat(salary.performedServicesSum) || 0;
  return base * value / 100;
}

function getNdflAmount(salary) {
  if (!salary) return 0;
  if ((salary.ndflTotal || 0) > 0) return salary.ndflTotal;
  return _getDeductionAmount(salary, n => n.toUpperCase() === 'НДФЛ');
}

function getDeductionsTotal(salary) {
  if (!salary) return 0;
  const dedsTotal = parseFloat(salary.finalDeductionsTotal || 0);
  const matsTotal = parseFloat(salary.finalMaterialsTotal || 0);
  const total = dedsTotal + matsTotal;
  // If НДФЛ is stored inside deductions array (legacy format), subtract it to avoid
  // double-counting with the separately displayed "Сумма НДФЛ"
  const ndflInList = (salary.deductions || []).find(d => (d.name || '').trim() === 'НДФЛ');
  if (!ndflInList) return total;
  return Math.max(0, total - _getDeductionAmount(salary, n => n.toUpperCase() === 'НДФЛ'));
}

function getUderzhanieInfo(salary) {
  if (!salary) return { amount: 0, percent: null };
  const deductions = salary.deductions || [];
  const ded = deductions.find(d => (d.name || '').trim().toLowerCase().includes('удержан'));
  if (!ded) return { amount: 0, percent: null };
  const value = parseFloat(ded.value) || 0;
  if (ded.valueType === 'rub') return { amount: value, percent: null };
  const percent = value;
  if (ded.deductionType === 'final') {
    const preFinal = (parseFloat(salary.finalSalary) || 0)
      + (parseFloat(salary.finalDeductionsTotal) || 0)
      + (parseFloat(salary.materialsTotal) || 0);
    return { amount: preFinal * percent / 100, percent };
  }
  const base = parseFloat(salary.performedServicesSum) || 0;
  return { amount: base * percent / 100, percent };
}

function getUderzhanieAmount(salary) {
  return getUderzhanieInfo(salary).amount;
}

const fmtDate = s => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
};

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 28, height: 16, borderRadius: 8, background: checked ? 'var(--rb-primary)' : '#d1d5db', cursor: 'pointer', flexShrink: 0, position: 'relative', transition: 'background .15s' }}>
      <div style={{ position: 'absolute', top: 2, left: checked ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .15s' }} />
    </div>
  );
}

// ── MultiSelect dropdown with toggles ─────────────────────────────────────────
function MultiSelect({ options, value, onChange, placeholder, renderLabel, renderOption }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const ref = useRef(null);
  const dropdownRef = useRef(null);
  useEffect(() => {
    const h = e => {
      if (ref.current?.contains(e.target) || dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 160) });
    }
    setOpen(v => !v);
  };
  const displayLabel = renderLabel
    ? renderLabel(value)
    : value.length === 0 ? placeholder : value.length === 1 ? (renderOption ? renderOption(value[0]) : value[0]) : `${value.length} выбрано`;
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <button ref={btnRef} onClick={handleOpen} style={{ width: '100%', padding: '4px 7px', border: `1px solid ${value.length ? 'var(--rb-primary)' : '#d1d5db'}`, borderRadius: 5, fontSize: 12, background: value.length ? '#eff6ff' : '#fff', color: value.length ? 'var(--rb-primary)' : '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, textAlign: 'left', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={dropdownRef} style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 14px rgba(0,0,0,0.12)', zIndex: 9999 }}>
          {value.length > 0 && (
            <div onClick={() => onChange([])} style={{ padding: '6px 10px', fontSize: 11, color: 'var(--rb-primary)', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', fontWeight: 500 }}>Сбросить</div>
          )}
          {options.map(opt => (
            <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }} onClick={() => toggle(opt)}>
              <span onClick={e => e.stopPropagation()}><Toggle checked={value.includes(opt)} onChange={() => toggle(opt)} /></span>
              {renderOption ? renderOption(opt) : opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── SpecialtyFilter: text input + dropdown with toggles ───────────────────────
function SpecialtyFilter({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const ref = useRef(null);
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const h = e => {
      if (ref.current?.contains(e.target) || dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Sync text when external values change
  useEffect(() => {
    if (value.length === 0) setText('');
    else if (value.length === 1) setText(value[0]);
    else setText('');
  }, [value]);

  const handleText = e => {
    const v = e.target.value;
    setText(v);
    if (!v) { onChange([]); return; }
    const exact = options.find(o => o.toLowerCase() === v.toLowerCase());
    if (exact) onChange([exact]);
  };

  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);

  const displayText = value.length > 1 ? `${value.length} выбрано` : text;
  const active = value.length > 0;
  const filtered = text && value.length <= 1 ? options.filter(o => o.toLowerCase().includes(text.toLowerCase())) : options;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        <input
          value={displayText}
          onChange={handleText}
          placeholder="Все"
          style={{ flex: 1, minWidth: 0, padding: '4px 6px', border: `1px solid ${active ? 'var(--rb-primary)' : '#d1d5db'}`, borderRadius: 5, fontSize: 12, background: active ? '#eff6ff' : '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', color: active ? 'var(--rb-primary)' : '#374151' }}
        />
        <button ref={btnRef} onClick={() => {
          if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ top: r.bottom + 2, left: r.right - Math.max(r.width * 4, 180), width: Math.max(r.width * 4, 180) });
          }
          setOpen(v => !v);
        }} style={{ flexShrink: 0, padding: '4px 5px', border: `1px solid ${open ? 'var(--rb-primary)' : '#d1d5db'}`, borderRadius: 5, background: open ? '#eff6ff' : '#f9fafb', cursor: 'pointer', color: '#6b7280', fontSize: 10, lineHeight: 1 }}>▾</button>
      </div>
      {open && ReactDOM.createPortal(
        <div ref={dropdownRef} style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 14px rgba(0,0,0,0.12)', zIndex: 9999 }}>
          {value.length > 0 && (
            <div onClick={() => { onChange([]); setText(''); }} style={{ padding: '6px 10px', fontSize: 11, color: 'var(--rb-primary)', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', fontWeight: 500 }}>Сбросить</div>
          )}
          {filtered.map(opt => (
            <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }} onClick={() => toggle(opt)}>
              <span onClick={e => e.stopPropagation()}><Toggle checked={value.includes(opt)} onChange={() => toggle(opt)} /></span>
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Autocomplete input ────────────────────────────────────────────────────────
function AutocompleteInput({ value, onChange, suggestions, placeholder, inputStyle }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const matches = value
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase())
    : [];

  const updatePos = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: r.width });
  };

  const handleChange = e => {
    onChange(e.target.value);
    updatePos();
    setOpen(true);
  };

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onFocus={() => { if (matches.length > 0) { updatePos(); setOpen(true); } }}
        placeholder={placeholder}
        style={inputStyle}
      />
      {open && matches.length > 0 && ReactDOM.createPortal(
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 14px rgba(0,0,0,0.12)', zIndex: 9999 }}>
          {matches.map(s => (
            <div
              key={s}
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
              style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ''; }}
            >
              {s}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Period multi-select: выбор нескольких месяцев/лет ────────────────────────
const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function PeriodMultiFilter({ value, onChange, allYears }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const ref = useRef(null);
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const h = e => {
      if (ref.current?.contains(e.target) || dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = period =>
    onChange(value.includes(period) ? value.filter(p => p !== period) : [...value, period]);

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 260) });
    }
    setOpen(v => !v);
  };

  // все годы: из загруженных данных + из уже выбранных
  const selectedYears = [...new Set(value.map(p => parseInt(p.split('-')[0], 10)))];
  const years = [...new Set([...allYears, ...selectedYears])].sort((a, b) => b - a);

  const displayLabel = value.length === 0
    ? 'Все периоды'
    : value.length === 1
      ? (() => { const [y, m] = value[0].split('-'); return `${MONTHS_SHORT[parseInt(m,10)-1]} ${y}`; })()
      : `${value.length} периода`;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <button ref={btnRef} onClick={handleOpen} style={{ width: '100%', padding: '4px 7px', border: `1px solid ${value.length ? 'var(--rb-primary)' : '#d1d5db'}`, borderRadius: 5, fontSize: 12, background: value.length ? '#eff6ff' : '#fff', color: value.length ? 'var(--rb-primary)' : '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, textAlign: 'left', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={dropdownRef} style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: 420, overflowY: 'auto', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 14px rgba(0,0,0,0.12)', zIndex: 9999, padding: 10 }}>
          {value.length > 0 && (
            <div onClick={() => onChange([])} style={{ padding: '4px 2px', marginBottom: 8, fontSize: 11, color: 'var(--rb-primary)', cursor: 'pointer', fontWeight: 500, borderBottom: '1px solid #f3f4f6', paddingBottom: 8 }}>
              Сбросить ({value.length})
            </div>
          )}
          {years.map(year => (
            <div key={year} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{year}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
                {MONTHS_SHORT.map((m, i) => {
                  const period = `${year}-${String(i + 1).padStart(2, '0')}`;
                  const sel = value.includes(period);
                  return (
                    <button key={period} onClick={() => toggle(period)} style={{ padding: '4px 2px', fontSize: 11, border: `1px solid ${sel ? 'var(--rb-primary)' : '#e5e7eb'}`, borderRadius: 4, background: sel ? 'var(--rb-primary)' : '#fff', color: sel ? '#fff' : '#374151', cursor: 'pointer', fontWeight: sel ? 600 : 400, fontFamily: 'inherit' }}>
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function SummaryBtn({ onClick, disabled, loading, label }) {
  const [hov, setHov] = React.useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ width: 90, height: 32, border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', background: 'var(--rb-primary)', color: '#fff', opacity: disabled ? 0.55 : 1, filter: hov && !disabled ? 'brightness(0.88)' : '', transition: 'filter .15s' }}
    >
      {loading ? '...' : label}
    </button>
  );
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function StepSummary({ doctors = [], clinics = [], permissions = {} }) {
  const [records, setRecords]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const [exporting, setExporting]   = useState(false);
  const [exportingPayout, setExportingPayout] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState({});
  const [recalcDone, setRecalcDone]       = useState({});
  const [cashPaymentsMap, setCashPaymentsMap] = useState({});
  const [cashOverpayLoading, setCashOverpayLoading] = useState({});
  const [cashOverpayDone, setCashOverpayDone]       = useState({});
  const [commentsMap, setCommentsMap] = useState({});
  const [commentSaving, setCommentSaving] = useState({});
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentValue, setEditingCommentValue] = useState('');

  const handleRecalculate = async (rec, rowKey, overpay, periodLabel, clinicId) => {
    const key = rowKey;
    setRecalcLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await execSettingsApi.get(rec.misUserId);
      const raw = res.data && Object.keys(res.data).length ? res.data : null;
      const settings = raw || {
        assistants: [],
        clinicSettings: {
          global: {
            payType: 'salary', fixedSalary: 0, hourlyRate: 0, hoursWorked: 0,
            executorPercent: 0, plusPercent: false, paymentMethod: 'card',
            mainPaymentMethod: 'card', advance: 0, mainPayment: 0,
            includeReferralBonuses: true, includeReferralDeductions: true,
            includeCorpInvoices: true, assistancePercent: 0, cabinets: [],
            deductions: [], materials: [], serviceMaterials: [],
            extras: [], normServices: [], harmfulness: false,
          },
        },
      };
      // Если есть настройки конкретного медцентра — пишем туда, иначе в global
      const clinicKey = clinicId && settings.clinicSettings?.[String(clinicId)] ? String(clinicId) : 'global';
      const clinicData = settings.clinicSettings?.[clinicKey] || {};
      const deductions = [...(clinicData.deductions || [])];
      deductions.push({
        name: `Переплата за ${periodLabel}`,
        value: parseFloat(Math.abs(overpay).toFixed(2)),
        valueType: 'rub',
        deductionType: 'final',
        locked: false,
      });
      const newSettings = {
        ...settings,
        clinicSettings: { ...settings.clinicSettings, [clinicKey]: { ...clinicData, deductions } },
      };
      await execSettingsApi.save({ misUserId: rec.misUserId, doctorName: rec.doctorName, settings: newSettings });
      clearExecCache(rec.misUserId);
      // Сохраняем флаг в reportData записи зарплаты
      const updatedReportData = { ...(rec.reportData || {}), recalcDone: { ...(rec.reportData?.recalcDone || {}), [key]: true } };
      await salaryRecords.update(rec.id, { dateFrom: rec.dateFrom, dateTo: rec.dateTo, periodLabel: rec.periodLabel, reportData: updatedReportData });
      // Обновляем локальный список записей
      setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, reportData: updatedReportData } : r));
      setRecalcDone(prev => ({ ...prev, [key]: true }));
      toast.success(`Переплата зафиксирована у ${rec.doctorName}`);
    } catch {
      toast.error('Ошибка при фиксации переплаты');
    } finally {
      setRecalcLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleCashOverpay = async (rec, amount, dateLabel, clinicId) => {
    const key = rec.id;
    setCashOverpayLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await execSettingsApi.get(rec.misUserId);
      const raw = res.data && Object.keys(res.data).length ? res.data : null;
      const settings = raw || {
        assistants: [],
        clinicSettings: {
          global: {
            payType: 'salary', fixedSalary: 0, hourlyRate: 0, hoursWorked: 0,
            executorPercent: 0, plusPercent: false, paymentMethod: 'card',
            mainPaymentMethod: 'card', advance: 0, mainPayment: 0,
            includeReferralBonuses: true, includeReferralDeductions: true,
            includeCorpInvoices: true, assistancePercent: 0, cabinets: [],
            deductions: [], materials: [], serviceMaterials: [],
            extras: [], normServices: [], harmfulness: false,
          },
        },
      };
      const clinicKey = clinicId && settings.clinicSettings?.[String(clinicId)] ? String(clinicId) : 'global';
      const clinicData = settings.clinicSettings?.[clinicKey] || {};
      let newClinicData;
      if (amount < 0) {
        const deductions = [...(clinicData.deductions || [])];
        deductions.push({
          name: `Переплата (касса) за ${dateLabel}`,
          value: parseFloat(Math.abs(amount).toFixed(2)),
          valueType: 'rub',
          deductionType: 'final',
          locked: false,
        });
        newClinicData = { ...clinicData, deductions };
      } else {
        const extras = [...(clinicData.extras || [])];
        extras.push({
          name: `Остаток (касса) за ${dateLabel}`,
          amount: parseFloat(amount.toFixed(2)),
          hours: 0,
        });
        newClinicData = { ...clinicData, extras };
      }
      const newSettings = {
        ...settings,
        clinicSettings: { ...settings.clinicSettings, [clinicKey]: newClinicData },
      };
      await execSettingsApi.save({ misUserId: rec.misUserId, doctorName: rec.doctorName, settings: newSettings });
      clearExecCache(rec.misUserId);
      const updatedReportData = { ...(rec.reportData || {}), cashOverpayDone: { ...(rec.reportData?.cashOverpayDone || {}), [key]: true } };
      await salaryRecords.update(rec.id, { dateFrom: rec.dateFrom, dateTo: rec.dateTo, periodLabel: rec.periodLabel, reportData: updatedReportData });
      setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, reportData: updatedReportData } : r));
      setCashOverpayDone(prev => ({ ...prev, [key]: true }));
      toast.success(amount < 0 ? `Переплата (касса) добавлена в расходники — ${rec.doctorName}` : `Остаток (касса) добавлен в дополнительно — ${rec.doctorName}`);
    } catch {
      toast.error('Ошибка при фиксации переплаты (касса)');
    } finally {
      setCashOverpayLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSaveComment = async (rec, value) => {
    const prev = rec.reportData?.summaryComment || '';
    if (value === prev) return;
    setCommentSaving(s => ({ ...s, [rec.id]: true }));
    try {
      const updatedReportData = { ...(rec.reportData || {}), summaryComment: value };
      await salaryRecords.update(rec.id, { dateFrom: rec.dateFrom, dateTo: rec.dateTo, periodLabel: rec.periodLabel, reportData: updatedReportData });
      setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, reportData: updatedReportData } : r));
    } catch {
      toast.error('Ошибка сохранения комментария');
    } finally {
      setCommentSaving(s => ({ ...s, [rec.id]: false }));
    }
  };

  const [searchName, setSearchName]           = useState('');
  const [filterClinics, setFilterClinics]     = useState([]);
  const [filterSpecialties, setFilterSpecialties] = useState([]);
  const [filterPeriods, setFilterPeriods]     = useState([]); // ['2025-01', '2026-02']
  const [sortBy, setSortBy]                   = useState('date_desc');
  const [dataLoaded, setDataLoaded]           = useState(false);
  const [committedFilters, setCommittedFilters] = useState({ searchName: '', filterClinics: [], filterSpecialties: [], filterPeriods: [] });

  const loadData = () => {
    setCommittedFilters({ searchName, filterClinics, filterSpecialties, filterPeriods });
    setLoading(true);
    const params = {};
    if (filterPeriods.length > 0) params.periods = filterPeriods.join(',');
    salaryRecords.getAll(params)
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : [];
        setRecords(list);
        setDataLoaded(true);
        const done = {};
        const cashDone = {};
        const comments = {};
        list.forEach(rec => {
          const flags = rec.reportData?.recalcDone || {};
          Object.keys(flags).forEach(rowKey => { if (flags[rowKey]) done[rowKey] = true; });
          const cashFlags = rec.reportData?.cashOverpayDone || {};
          Object.keys(cashFlags).forEach(k => { if (cashFlags[k]) cashDone[k] = true; });
          if (rec.reportData?.summaryComment) comments[rec.id] = rec.reportData.summaryComment;
        });
        setRecalcDone(done);
        setCashOverpayDone(cashDone);
        setCommentsMap(comments);
        cashPaymentsApi.getAll()
          .then(cpRes => {
            const cpList = Array.isArray(cpRes.data) ? cpRes.data : [];
            const cpMap = {};
            const standaloneByUser = {};
            cpList.forEach(p => {
              if (p.salaryRecordId) {
                if (!cpMap[p.salaryRecordId]) cpMap[p.salaryRecordId] = [];
                cpMap[p.salaryRecordId].push(p);
              } else if (p.misUserId) {
                if (!standaloneByUser[p.misUserId]) standaloneByUser[p.misUserId] = [];
                standaloneByUser[p.misUserId].push(p);
              }
            });
            const matchedPaymentIds = new Set();
            list.forEach(rec => {
              const userPayments = standaloneByUser[String(rec.misUserId)];
              if (!userPayments || userPayments.length === 0) return;
              const recPeriod = rec.periodLabel || (rec.dateFrom ? String(rec.dateFrom).slice(0, 7) : null);
              const matching = userPayments.filter(p =>
                !matchedPaymentIds.has(p.id) &&
                p.periodLabel &&
                recPeriod &&
                p.periodLabel === recPeriod
              );
              matching.forEach(p => matchedPaymentIds.add(p.id));
              if (matching.length > 0) {
                if (!cpMap[rec.id]) cpMap[rec.id] = [];
                cpMap[rec.id].push(...matching);
              }
            });
            setCashPaymentsMap(cpMap);
          })
          .catch(() => {});
      })
      .catch(() => toast.error('Ошибка загрузки сводки'))
      .finally(() => setLoading(false));
  };

  const getDoctorSpecialty = (misUserId) => {
    const doc = doctors.find(d => d.id === String(misUserId));
    if (!doc) return '—';
    return doc.roles.filter(Boolean).join(', ') || '—';
  };

  // ── Flatten records → one row per clinic report ───────────────────────────
  const allRows = useMemo(() => {
    const allowedClinics = permissions.clinics?.length > 0 ? permissions.clinics.map(String) : null;
    const rows = [];
    records.forEach(rec => {
      if (rec.reportType === 'interim') return; // промежуточные отчёты не учитываются в сводке
      const reps = (rec.reportData && rec.reportData.clinicReports) || [];
      if (reps.length === 0) {
        if (allowedClinics) return; // строки без клиники скрываем при ограничении
        rows.push({ key: `${rec.id}_0`, rec, cr: null, clinicObj: null, clinicName: '—' });
      } else {
        reps.forEach((cr, i) => {
          if (allowedClinics && !allowedClinics.includes(String(cr.clinicId))) return;
          const clinicObj = clinics.find(c => String(c.id) === String(cr.clinicId));
          const clinicName = clinicObj ? clinicObj.name : (cr.clinicLabel || String(cr.clinicId || '') || '—');
          rows.push({ key: `${rec.id}_${i}`, rec, cr, clinicObj, clinicName });
        });
      }
    });
    return rows;
  }, [records, clinics, permissions.clinics]);

  // ── Unique specialties for filter ────────────────────────────────────────────
  const allSpecialties = useMemo(() => {
    const set = new Set();
    if (allRows.length > 0) {
      allRows.forEach(({ rec }) => {
        const s = getDoctorSpecialty(rec.misUserId);
        if (s && s !== '—') s.split(', ').forEach(sp => set.add(sp.trim()));
      });
    } else {
      // до первой загрузки — берём роли из списка врачей
      doctors.forEach(d => (d.roles || []).filter(Boolean).forEach(r => set.add(r)));
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [allRows, doctors]);

  // ── Unique doctor names for autocomplete ─────────────────────────────────────
  const allDoctorNames = useMemo(() => {
    const set = new Set(records.map(r => r.doctorName).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [records]);

  // ── Unique years for filter ───────────────────────────────────────────────────
  const allYears = useMemo(() => {
    const set = new Set();
    allRows.forEach(({ rec }) => {
      if (rec.dateFrom) set.add(new Date(rec.dateFrom).getFullYear());
    });
    const cur = new Date().getFullYear();
    if (set.size === 0) return [cur - 1, cur, cur + 1];
    return [...set].sort((a, b) => b - a);
  }, [allRows]);

  // ── Filter & sort (применяются только по committedFilters — снимок на момент нажатия «Загрузить») ──
  const filtered = useMemo(() => {
    const { searchName: sn, filterClinics: fc, filterSpecialties: fs, filterPeriods: fp } = committedFilters;
    const clinicNames = fc.length > 0
      ? new Set(fc.map(id => { const c = clinics.find(c => String(c.id) === String(id)); return c?.name; }).filter(Boolean))
      : null;

    return allRows
      .filter(row => {
        if (sn && !row.rec.doctorName?.toLowerCase().includes(sn.toLowerCase())) return false;
        if (clinicNames && !clinicNames.has(row.clinicName)) return false;
        if (fs.length > 0) {
          const sp = getDoctorSpecialty(row.rec.misUserId).split(', ').map(s => s.trim());
          if (!fs.some(f => sp.includes(f))) return false;
        }
        if (fp.length > 0 && row.rec.dateFrom) {
          const d = new Date(row.rec.dateFrom);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!fp.includes(key)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date_asc')     return new Date(a.rec.dateFrom || 0) - new Date(b.rec.dateFrom || 0);
        if (sortBy === 'name_asc')     return (a.rec.doctorName || '').localeCompare(b.rec.doctorName || '', 'ru');
        if (sortBy === 'name_desc')    return (b.rec.doctorName || '').localeCompare(a.rec.doctorName || '', 'ru');
        if (sortBy === 'salary_desc')  return parseFloat(b.cr?.salary?.finalSalary || 0) - parseFloat(a.cr?.salary?.finalSalary || 0);
        if (sortBy === 'salary_asc')   return parseFloat(a.cr?.salary?.finalSalary || 0) - parseFloat(b.cr?.salary?.finalSalary || 0);
        return new Date(b.rec.dateFrom || 0) - new Date(a.rec.dateFrom || 0); // date_desc
      });
  }, [allRows, committedFilters, clinics, sortBy]);

  // Вспомогательная функция: получить карту кассовых выплат (свежий запрос)
  // Логика матчинга идентична loadData: сначала по salaryRecordId, затем по misUserId+periodLabel
  const fetchCashMap = async () => {
    try {
      const res = await cashPaymentsApi.getAll();
      const cpList = Array.isArray(res.data) ? res.data : [];
      const map = {};
      const standaloneByUser = {};
      cpList.forEach(p => {
        if (p.salaryRecordId) {
          if (!map[p.salaryRecordId]) map[p.salaryRecordId] = [];
          map[p.salaryRecordId].push(p);
        } else if (p.misUserId) {
          if (!standaloneByUser[p.misUserId]) standaloneByUser[p.misUserId] = [];
          standaloneByUser[p.misUserId].push(p);
        }
      });
      const matchedPaymentIds = new Set();
      records.forEach(rec => {
        const userPayments = standaloneByUser[String(rec.misUserId)];
        if (!userPayments || userPayments.length === 0) return;
        const recPeriod = rec.periodLabel || (rec.dateFrom ? String(rec.dateFrom).slice(0, 7) : null);
        const matching = userPayments.filter(p =>
          !matchedPaymentIds.has(p.id) &&
          p.periodLabel &&
          recPeriod &&
          p.periodLabel === recPeriod
        );
        matching.forEach(p => matchedPaymentIds.add(p.id));
        if (matching.length > 0) {
          if (!map[rec.id]) map[rec.id] = [];
          map[rec.id].push(...matching);
        }
      });
      return map;
    } catch { return {}; }
  };

  // ── Выплата export ───────────────────────────────────────────────────────────
  const handlePayoutExport = async () => {
    setExportingPayout(true);
    try {
      const liveCashMap = await fetchCashMap();
      const payoutRows = filtered.filter(({ cr }) => {
        const s = cr?.salary || {};
        const remainder = calcRemainder(s);
        return remainder > 0;
      });

      if (payoutRows.length === 0) {
        toast('Нет врачей с премией в текущей выборке');
        return;
      }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Выплата премий');

      ws.columns = [
        { header: 'ФИО врача',      key: 'name',      width: 36 },
        { header: 'Премия',         key: 'bonus',     width: 18 },
        { header: 'Выдано (касса)', key: 'cashPaid',  width: 18 },
        { header: 'Начислено',       key: 'netBonus',  width: 18 },
        { header: 'Подпись врача',  key: 'signature', width: 36 },
      ];

      const hRow = ws.getRow(1);
      hRow.font      = { bold: true, name: 'Calibri', size: 11 };
      hRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
      hRow.alignment = { horizontal: 'center', vertical: 'middle' };

      const sortedPayoutRows = [...payoutRows].sort((a, b) =>
        (a.rec.doctorName || '').localeCompare(b.rec.doctorName || '', 'ru')
      );

      sortedPayoutRows.forEach(({ rec, cr }) => {
        const s = cr?.salary || {};
        const remainder = calcRemainder(s);
        const cashPaid = (liveCashMap[rec.id] || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        ws.addRow({
          name:      rec.doctorName || '—',
          bonus:     remainder,
          cashPaid:  cashPaid || null,
          netBonus:  remainder - cashPaid,
          signature: '',
        });
      });

      ['bonus', 'cashPaid', 'netBonus'].forEach(k => { ws.getColumn(k).numFmt = '#,##0.00 ₽'; });

      const blackBorder = { style: 'thin', color: { argb: 'FF000000' } };
      ws.eachRow(row => {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.border = { top: blackBorder, left: blackBorder, bottom: blackBorder, right: blackBorder };
        });
      });

      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        'Выплата_премий.xlsx'
      );
    } catch (err) {
      console.error(err);
      toast.error('Ошибка экспорта');
    } finally {
      setExportingPayout(false);
    }
  };

  // ── Excel export ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const liveCashMap = await fetchCashMap();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Сводка зарплат');

      ws.columns = [
        { header: 'ФИО врача',      key: 'name',       width: 32 },
        { header: 'Медцентр',       key: 'clinic',     width: 22 },
        { header: 'Должность',       key: 'specialty',  width: 26 },
        { header: 'Дата',           key: 'date',       width: 18 },
        { header: 'Начислено',      key: 'total',      width: 16 },
        { header: 'НДФЛ',           key: 'ndfl',       width: 16 },
        { header: 'Взыскания',      key: 'deductions', width: 16 },
        { header: 'Детализация',    key: 'detail',     width: 52 },
        { header: 'Аванс',          key: 'advance',    width: 16 },
        { header: 'Основная ЗП',    key: 'body',       width: 16 },
        { header: 'Премия',         key: 'bonus',      width: 16 },
        { header: 'Переплата',      key: 'overpay',    width: 16 },
        { header: 'Выдано (касса)', key: 'cashPaid',   width: 16 },
        { header: 'Комментарий',    key: 'comment',    width: 36 },
      ];

      const hRow = ws.getRow(1);
      hRow.font      = { bold: true, name: 'Calibri', size: 11 };
      hRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
      hRow.alignment = { horizontal: 'center', vertical: 'middle' };

      // Формирует строку детализации из расходников, материалов и дополнительно
      const buildDetail = (salary) => {
        if (!salary) return '';
        const fmtA = v => parseFloat(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const preFinal = (parseFloat(salary.basePay || 0)) + (parseFloat(salary.referralBonuses || 0))
          + (parseFloat(salary.performedBonusTotal || 0)) + (parseFloat(salary.extrasTotal || 0))
          + (parseFloat(salary.assistanceIncomeTotal || 0)) - (parseFloat(salary.referralCostTotal || 0));
        const turnoverBase = parseFloat(salary.performedServicesSum || 0);
        const lines = [];
        const formatDed = (d) => {
          const v = parseFloat(d.value) || 0;
          if (d.valueType === 'rub') return `${d.name}: -${fmtA(v)} ₽`;
          const base = d.deductionType === 'final' ? preFinal : turnoverBase;
          const amt = base * v / 100;
          const tag = d.deductionType === 'final' ? '% от зп' : '% от об.';
          return `${d.name}: -${fmtA(amt)} ₽ (${v}${tag})`;
        };
        (salary.deductions || []).filter(d => (d.name || '').trim().toUpperCase() !== 'НДФЛ' && d.deductionType !== 'final').forEach(d => lines.push(formatDed(d)));
        (salary.materials  || []).filter(m => m.deductionType !== 'final').forEach(m => lines.push(formatDed(m)));
        (salary.extras     || []).forEach(e => {
          const hrs = parseFloat(e.hours) || 0;
          const amt = hrs > 0 ? parseFloat(e.amount) * hrs : parseFloat(e.amount);
          lines.push(`${e.name}: +${fmtA(amt)} ₽`);
        });
        (salary.deductions || []).filter(d => (d.name || '').trim().toUpperCase() !== 'НДФЛ' && d.deductionType === 'final').forEach(d => lines.push(formatDed(d)));
        (salary.materials  || []).filter(m => m.deductionType === 'final').forEach(m => lines.push(formatDed(m)));
        return lines.join('\n');
      };

      const dataRows = [];
      const seenRecForCash = new Set();
      filtered.forEach(({ rec, cr, clinicName }) => {
        const s = cr?.salary || {};
        const _rowExtraTotal = (s.extraPayments || []).reduce((a, ep) => a + (parseFloat(ep.amount) || 0), 0);
        const remainder = calcRemainder(s);
        const cashPaidForRow = !seenRecForCash.has(rec.id)
          ? (liveCashMap[rec.id] || []).reduce((acc, p) => acc + parseFloat(p.amount || 0), 0)
          : 0;
        seenRecForCash.add(rec.id);
        const netRemainder = remainder - cashPaidForRow;
        const cashPaid = (liveCashMap[rec.id] || []).reduce((acc, p) => acc + parseFloat(p.amount || 0), 0);
        const detailStr = buildDetail(s);
        const row = ws.addRow({
          name:       rec.doctorName || '—',
          clinic:     clinicName,
          specialty:  getDoctorSpecialty(rec.misUserId),
          date:       rec.periodLabel || (rec.dateFrom ? rec.dateFrom.slice(0, 7) : '—'),
          total:      parseFloat(s.finalSalary || 0) + parseFloat(s.finalDeductionsTotal || 0) + parseFloat(s.finalMaterialsTotal || 0) + parseFloat(s.svcMatFinalTotal || 0),
          ndfl:       getNdflAmount(s) || null,
          deductions: getDeductionsTotal(s) || null,
          advance:    parseFloat(s.advance     || 0),
          body:       parseFloat(s.mainPayment || 0) + _rowExtraTotal,
          bonus:      netRemainder >= 0 ? netRemainder : 0,
          overpay:    netRemainder < 0  ? netRemainder : 0,
          cashPaid:   cashPaid || null,
          detail:     detailStr || null,
          comment:    rec.reportData?.summaryComment || null,
        });
        dataRows.push({ row, detailStr });
      });

      ['total', 'ndfl', 'deductions', 'advance', 'body', 'bonus', 'overpay', 'cashPaid'].forEach(key => {
        ws.getColumn(key).numFmt = '#,##0.00 ₽';
      });

      // Перенос текста и высота строк по содержимому
      dataRows.forEach(({ row, detailStr }) => {
        row.alignment = { vertical: 'top' };
        const detailCell = row.getCell('detail');
        detailCell.alignment = { wrapText: true, vertical: 'top' };
        const commentCell = row.getCell('comment');
        commentCell.alignment = { wrapText: true, vertical: 'top' };
        const lineCount = detailStr ? detailStr.split('\n').length : 1;
        row.height = Math.max(20, lineCount * 16);
      });

      // Автоширина числовых и текстовых колонок по содержимому
      const colKeys = ['name', 'clinic', 'specialty', 'date'];
      colKeys.forEach(key => {
        let maxLen = ws.getColumn(key).header?.length || 10;
        ws.getColumn(key).eachCell({ includeEmpty: false }, cell => {
          const len = String(cell.value || '').length;
          if (len > maxLen) maxLen = len;
        });
        ws.getColumn(key).width = Math.min(50, maxLen + 2);
      });

      // Итоговая строка
      const excelCashTotal = (() => {
        const seen = new Set();
        return filtered.reduce((s, { rec }) => {
          if (seen.has(rec.id)) return s;
          seen.add(rec.id);
          return s + (liveCashMap[rec.id] || []).reduce((ps, p) => ps + parseFloat(p.amount || 0), 0);
        }, 0);
      })();
      const totalRow = ws.addRow({
        name:       'ИТОГО',
        total:      filtered.reduce((s, r) => {
          const sal = r.cr?.salary || {};
          return s + parseFloat(sal.finalSalary || 0) + parseFloat(sal.finalDeductionsTotal || 0) + parseFloat(sal.finalMaterialsTotal || 0) + parseFloat(sal.svcMatFinalTotal || 0);
        }, 0),
        ndfl:       filtered.reduce((s, r) => s + getNdflAmount(r.cr?.salary), 0) || null,
        deductions: filtered.reduce((s, r) => s + getDeductionsTotal(r.cr?.salary), 0) || null,
        advance:    filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.advance     || 0), 0),
        body:       filtered.reduce((s, r) => {
          const sal = r.cr?.salary || {};
          const et = (sal.extraPayments || []).reduce((a, ep) => a + (parseFloat(ep.amount) || 0), 0);
          return s + parseFloat(sal.mainPayment || 0) + et;
        }, 0),
        bonus:   (() => {
          const seenB = new Set();
          return filtered.reduce((s, r) => {
            const rem = calcRemainder(r.cr?.salary);
            const cash = !seenB.has(r.rec.id) ? (liveCashMap[r.rec.id] || []).reduce((a, p) => a + parseFloat(p.amount || 0), 0) : 0;
            seenB.add(r.rec.id);
            const net = rem - cash; return s + (net >= 0 ? net : 0);
          }, 0);
        })(),
        overpay: (() => {
          const seenO = new Set();
          return filtered.reduce((s, r) => {
            const rem = calcRemainder(r.cr?.salary);
            const cash = !seenO.has(r.rec.id) ? (liveCashMap[r.rec.id] || []).reduce((a, p) => a + parseFloat(p.amount || 0), 0) : 0;
            seenO.add(r.rec.id);
            const net = rem - cash; return s + (net < 0 ? net : 0);
          }, 0);
        })(),
        cashPaid: excelCashTotal || null,
      });
      totalRow.font = { bold: true, name: 'Calibri', size: 11 };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
      totalRow.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } };

      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        'Сводка_зарплат.xlsx'
      );
    } catch (err) {
      console.error(err);
      toast.error('Ошибка экспорта Excel');
    } finally {
      setExporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {(() => {
        const totalSalary  = filtered.reduce((s, r) => {
          const sal = r.cr?.salary || {};
          return s + parseFloat(sal.finalSalary || 0) + parseFloat(sal.finalDeductionsTotal || 0) + parseFloat(sal.finalMaterialsTotal || 0) + parseFloat(sal.svcMatFinalTotal || 0);
        }, 0);
        const totalBase    = filtered.reduce((s, r) => {
          const sal = r.cr?.salary || {};
          const et = (sal.extraPayments || []).reduce((a, ep) => a + (parseFloat(ep.amount) || 0), 0);
          return s + parseFloat(sal.mainPayment || 0) + et;
        }, 0);
        const totalOverpay = filtered.reduce((s, r) => {
          const rem = calcRemainder(r.cr?.salary);
          return s + (rem < 0 ? rem : 0);
        }, 0);
        const totalNdfl = filtered.reduce((s, r) => s + getNdflAmount(r.cr?.salary), 0);
        const totalDeductions = filtered.reduce((s, r) => s + getDeductionsTotal(r.cr?.salary), 0);
        const totalVacationPay = filtered.reduce((s, r) => {
          return s + (r.cr?.salary?.extraPayments || [])
            .filter(ep => (ep.label || '').trim() === 'Отпускные')
            .reduce((es, ep) => es + (parseFloat(ep.amount) || 0), 0);
        }, 0);
        const totalCashPaid = (() => {
          const seen = new Set();
          return filtered.reduce((s, { rec }) => {
            if (seen.has(rec.id)) return s;
            seen.add(rec.id);
            return s + (cashPaymentsMap[rec.id] || []).reduce((ps, p) => ps + parseFloat(p.amount || 0), 0);
          }, 0);
        })();
        return (
        <>
        {/* ── Totals bar — всегда виден ── */}
        <div style={{ borderBottom: '2px solid var(--rb-border)', background: '#f8fafc', padding: '12px 20px', display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0, minHeight: 56 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
            Сводка
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', flex: 1, justifyContent: 'space-between' }}>
            {[
              { label: 'Зарплаты',      value: totalSalary,      color: '#1e40af' },
              { label: 'Авансы',        value: filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.advance || 0), 0), color: '#92400e' },
              { label: 'Осн. зарплата', value: totalBase,        color: '#166534' },
              { label: 'Отпускные',     value: totalVacationPay, color: '#0369a1' },
              { label: 'НДФЛ',          value: totalNdfl,        color: '#dc2626', prefix: '−' },
              { label: 'Взыскания',     value: totalDeductions,  color: '#dc2626', prefix: '−' },
              { label: 'Переплаты',     value: totalOverpay,     color: '#dc2626' },
              { label: 'Касса',         value: totalCashPaid,    color: 'var(--rb-text-secondary)', prefix: '−' },
            ].map(({ label, value, color, prefix }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2, whiteSpace: 'nowrap' }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: dataLoaded ? color : '#d1d5db' }}>
                  {dataLoaded ? `${prefix || ''}${fmtRub(value)}` : '—'}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <SummaryBtn onClick={handleExport} disabled={exporting || !dataLoaded || filtered.length === 0} loading={exporting} label="Excel" />
            <SummaryBtn onClick={handlePayoutExport} disabled={exportingPayout || !dataLoaded || filtered.length === 0} loading={exportingPayout} label="Выплата" />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="rb-summary-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {[
                  { label: 'ФИО врача',      key: 'name' },
                  { label: 'Медцентр',        key: null },
                  { label: 'Должность',        key: null },
                  { label: 'Дата',            key: 'date' },
                  { label: 'НДФЛ',            key: null },
                  { label: 'Зарплата',        key: 'salary' },
                  { label: 'Комментарий',     key: null },
                ].map(({ label, key: col }) => {
                  const isAsc  = sortBy === `${col}_asc`;
                  const isDesc = sortBy === `${col}_desc`;
                  const active = isAsc || isDesc;
                  const handleSort = col ? () => {
                    if (isDesc) setSortBy(`${col}_asc`);
                    else setSortBy(`${col}_desc`);
                  } : undefined;
                  return (
                    <th key={label}
                      onClick={handleSort}
                      style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f1f5f9', textAlign: 'center', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--rb-text)', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--rb-border)', borderRight: '1px solid #c8d3e0', whiteSpace: 'nowrap', cursor: col ? 'pointer' : 'default', userSelect: 'none' }}>
                      {label}{col && <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3 }}>{isAsc ? '↑' : '↓'}</span>}
                    </th>
                  );
                })}
                <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f1f5f9', width: 36, borderBottom: '1px solid var(--rb-border)', textAlign: 'center', padding: '0 4px' }}>
                  <button
                    onClick={loadData}
                    title="Загрузить данные"
                    style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#e2e8f0', color: '#475569', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                  </button>
                </th>
              </tr>
              <tr onClick={e => e.stopPropagation()} style={{ background: '#fff' }}>
                {/* ФИО */}
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', padding: '4px 6px', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }}>
                  <AutocompleteInput
                    value={searchName}
                    onChange={setSearchName}
                    suggestions={allDoctorNames}
                    placeholder="Поиск..."
                    inputStyle={{ width: '100%', padding: '4px 7px', border: `1px solid ${searchName ? 'var(--rb-primary)' : '#d1d5db'}`, borderRadius: 5, fontSize: 12, fontFamily: 'inherit', background: searchName ? '#eff6ff' : '#fff', outline: 'none', boxSizing: 'border-box' }}
                  />
                </th>
                {/* Медцентр */}
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', padding: '4px 6px', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }}>
                  <MultiSelect options={clinics.filter(c => String(c.id) !== '8').map(c => c.id)} value={filterClinics} onChange={setFilterClinics} placeholder="Все"
                    renderLabel={v => v.length === 0 ? 'Все' : v.length === 1 ? (clinics.find(c => String(c.id) === String(v[0]))?.name || v[0]) : `${v.length} выбрано`}
                    renderOption={id => clinics.find(c => String(c.id) === String(id))?.name || id}
                  />
                </th>
                {/* Специальность */}
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', padding: '4px 6px', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }}>
                  <MultiSelect options={allSpecialties} value={filterSpecialties} onChange={setFilterSpecialties} placeholder="Все" />
                </th>
                {/* Дата */}
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', padding: '4px 6px', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }}>
                  <PeriodMultiFilter value={filterPeriods} onChange={setFilterPeriods} allYears={allYears} />
                </th>
                {/* НДФЛ, Зарплата, Комментарий — пусто */}
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }} />
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }} />
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', borderBottom: '2px solid var(--rb-border)', borderRight: '1px solid #c8d3e0' }} />
                <th style={{ position: 'sticky', top: 41, zIndex: 2, background: '#fff', borderBottom: '2px solid var(--rb-border)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>
                    <span className="rb-spinner" style={{ display: 'inline-block', marginRight: 8 }} /> Загрузка сводки...
                  </td>
                </tr>
              ) : !dataLoaded ? (
                <tr>
                  <td colSpan={8} style={{ padding: 60, textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14, lineHeight: 2 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="36" height="36" style={{ opacity: 0.25, display: 'block', margin: '0 auto 12px' }}>
                      <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>
                    </svg>
                    Задайте фильтры и нажмите «Загрузить»
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>
                    Нет записей по заданному фильтру.
                  </td>
                </tr>
              ) : filtered.map(({ key, rec, cr, clinicObj, clinicName }) => {
                const s           = cr?.salary || {};
                const advance     = parseFloat(s.advance     || 0);
                const body        = parseFloat(s.mainPayment || 0);
                const total       = parseFloat(s.finalSalary || 0);
                const extraPayments = s.extraPayments || [];
                const extraTotal  = extraPayments.reduce((acc, ep) => acc + (parseFloat(ep.amount) || 0), 0);
                const remainder   = calcRemainder(s);
                const bonus       = remainder >= 0 ? remainder : 0;
                const overpay     = remainder < 0  ? remainder : 0;
                const isOpen    = expandedKey === key;
                const dateLabel = rec.periodLabel || (rec.dateFrom ? fmtDate(rec.dateFrom) : '—');
                const recalcKey = key;

                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => setExpandedKey(isOpen ? null : key)}
                      style={{ cursor: 'pointer', background: '#fff', borderBottom: isOpen ? 'none' : '1px solid var(--rb-border)', transition: 'background .1s' }}
                      onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = '#fff'; }}
                    >
                      <td style={{ padding: '10px 12px' }}>{rec.doctorName || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {clinicObj ? (
                          <span style={{ background: clinicObj.color || '#94a3b8', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {clinicName}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--rb-text-secondary)' }}>{clinicName}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {getDoctorSpecialty(rec.misUserId)}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {dateLabel}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {(() => { const n = getNdflAmount(s); return n > 0 ? <span style={{ color: '#dc2626', fontWeight: 600 }}>−{fmtRub(n)}</span> : <span style={{ color: 'var(--rb-text-secondary)' }}>—</span>; })()}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 700, color: '#1e40af' }}>{fmtRub(total)}</div>
                        {(advance > 0 || body > 0 || extraTotal > 0 || bonus > 0 || overpay < 0 || (() => { const rowCash = cashPaymentsMap[rec.id] || []; return rowCash.length > 0; })()) && (
                          <div style={{ fontSize: 11, color: 'var(--rb-text)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0 6px', alignItems: 'center' }}>
                            {advance > 0 && <span>Аванс: {fmtRub(advance)}</span>}
                            {(body + extraTotal) > 0 && <span>Основная ЗП: {fmtRub(body + extraTotal)}</span>}
                            {bonus > 0   && <span>Премия: {fmtRub(bonus)}</span>}
                            {(() => {
                              const rowCash = cashPaymentsMap[rec.id] || [];
                              if (!rowCash.length) return null;
                              const rowCashTotal = rowCash.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
                              const allRem = (rec.reportData?.clinicReports || []).reduce((s, c) => {
                                const sal = c.salary || {};
                                return s + calcRemainder(sal);
                              }, 0);
                              const netRem = allRem - rowCashTotal;
                              return (
                                <>
                                  <span style={{ color: '#15803d' }}>Касса: −{fmtRub(rowCashTotal)}</span>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: netRem < 0 ? (cashOverpayDone[rec.id] ? 'var(--rb-text-secondary)' : '#dc2626') : '#0284c7' }}>Остаток: {netRem < 0 ? '−' : ''}{fmtRub(Math.abs(netRem))}</span>
                                    {netRem !== 0 && (
                                      <button
                                        onClick={e => { e.stopPropagation(); handleCashOverpay(rec, netRem, dateLabel, cr?.clinicId); }}
                                        disabled={!!cashOverpayLoading[rec.id]}
                                        title={cashOverpayDone[rec.id]
                                          ? 'Уже зафиксировано (можно повторить)'
                                          : netRem < 0 ? 'Добавить переплату в расходники' : 'Добавить остаток в дополнительно'}
                                        style={{ padding: '3px 5px', background: cashOverpayDone[rec.id] ? '#f0fdf4' : '#f8fafc', border: `1px solid ${cashOverpayDone[rec.id] ? '#86efac' : '#e2e8f0'}`, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', lineHeight: 1, opacity: cashOverpayLoading[rec.id] ? 0.4 : 1 }}
                                      >
                                        {cashOverpayDone[rec.id] ? (
                                          <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>
                                        ) : (
                                          <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" width="13" height="13"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.02"/></svg>
                                        )}
                                      </button>
                                    )}
                                  </span>
                                </>
                              );
                            })()}
                            {overpay < 0 && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: recalcDone[recalcKey] ? 'var(--rb-text-secondary)' : '#dc2626' }}>Переплата: {fmtRub(overpay)}</span>
                                <button
                                  onClick={e => { e.stopPropagation(); handleRecalculate(rec, recalcKey, overpay, dateLabel, cr?.clinicId); }}
                                  disabled={!!recalcLoading[recalcKey]}
                                  title={recalcDone[recalcKey] ? 'Переплата зафиксирована (можно повторить)' : 'Зафиксировать переплату в расходниках сотрудника'}
                                  style={{ padding: '3px 5px', background: recalcDone[recalcKey] ? '#f0fdf4' : '#f8fafc', border: `1px solid ${recalcDone[recalcKey] ? '#86efac' : '#e2e8f0'}`, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', lineHeight: 1, opacity: recalcLoading[recalcKey] ? 0.4 : 1 }}
                                >
                                  {recalcDone[recalcKey] ? (
                                    <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" width="13" height="13">
                                      <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                  ) : (
                                    <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" width="13" height="13">
                                      <polyline points="1 4 1 10 7 10"/>
                                      <path d="M3.51 15a9 9 0 1 0 .49-4.02"/>
                                    </svg>
                                  )}
                                </button>
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', minWidth: 150, maxWidth: 260 }} onClick={e => e.stopPropagation()}>
                        {editingCommentId === rec.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <textarea
                              autoFocus
                              value={editingCommentValue}
                              onChange={e => setEditingCommentValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Escape') { setEditingCommentId(null); } }}
                              rows={3}
                              style={{ width: '100%', fontSize: 12, padding: '5px 7px', border: '1px solid #93c5fd', borderRadius: 6, resize: 'none', lineHeight: 1.5, boxSizing: 'border-box', outline: 'none', background: '#f8fafc' }}
                            />
                            <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => setEditingCommentId(null)}
                                style={{ padding: '3px 8px', fontSize: 11, background: '#f1f5f9', border: '1px solid var(--rb-border)', borderRadius: 5, cursor: 'pointer', color: 'var(--rb-text-secondary)' }}
                              >Отмена</button>
                              <button
                                disabled={!!commentSaving[rec.id]}
                                onClick={async () => { await handleSaveComment(rec, editingCommentValue); setEditingCommentId(null); }}
                                style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: '#007AFF', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: commentSaving[rec.id] ? 0.5 : 1 }}
                              >{commentSaving[rec.id] ? '...' : 'Сохранить'}</button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => { setEditingCommentId(rec.id); setEditingCommentValue(commentsMap[rec.id] ?? (rec.reportData?.summaryComment || '')); }}
                            title="Нажмите для редактирования"
                            style={{ minHeight: 32, padding: '4px 6px', borderRadius: 6, border: '1px solid transparent', cursor: 'text', fontSize: 12, lineHeight: 1.5, color: commentsMap[rec.id] || rec.reportData?.summaryComment ? 'var(--rb-text)' : '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', transition: 'border-color .15s, background .15s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--rb-border)'; e.currentTarget.style.background = '#f8fafc'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
                          >
                            {commentsMap[rec.id] || rec.reportData?.summaryComment || ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <svg
                          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
                          style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform .2s', color: 'var(--rb-text-secondary)', display: 'block', margin: 'auto' }}
                        >
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </td>
                    </tr>

                    {isOpen && (() => {
                      const recCashPayments = cashPaymentsMap[rec.id] || [];
                      const cashPaidTotal = recCashPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
                      const allClinicRemainder = (rec.reportData?.clinicReports || []).reduce((s, c) => {
                        return s + calcRemainder(c.salary);
                      }, 0);
                      const netRemainder = allClinicRemainder - cashPaidTotal;
                      return (
                        <tr style={{ background: '#fff' }}>
                          <td colSpan={8} style={{ padding: '0 16px 16px', borderBottom: '2px solid var(--rb-border)' }}>
                            <div style={{ paddingTop: 14 }}>
                              {cr?.salary
                                ? <SalaryBlock salary={cr.salary} />
                                : <div style={{ color: 'var(--rb-text-secondary)', fontSize: 13 }}>Нет данных</div>
                              }
                            </div>
                            {recCashPayments.length > 0 && (
                              <div style={{ borderTop: '2px dashed #bbf7d0', marginTop: 8, paddingTop: 10 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Выдано из кассы</div>
                                {recCashPayments.map(p => (
                                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f0fdf4' }}>
                                    <span style={{ color: 'var(--rb-text-secondary)', minWidth: 120 }}>
                                      {new Date(p.issuedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <span style={{ fontWeight: 600, color: '#16a34a', flex: 1 }}>−{fmtRub(p.amount)}</span>
                                    <span style={{ color: 'var(--rb-text-secondary)' }}>{p.financistName || '—'}</span>
                                    {p.note && <span style={{ fontStyle: 'italic', color: 'var(--rb-text-secondary)', fontSize: 11 }}>{p.note}</span>}
                                  </div>
                                ))}
                                <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12 }}>
                                  <span style={{ color: 'var(--rb-text-secondary)' }}>Итого к выплате: <strong>{fmtRub(allClinicRemainder)}</strong></span>
                                  <span style={{ color: '#15803d' }}>Выдано: <strong>−{fmtRub(cashPaidTotal)}</strong></span>
                                  <span style={{ color: netRemainder < 0 ? 'var(--rb-danger)' : 'var(--rb-text)', fontWeight: 600 }}>
                                    Остаток: {netRemainder < 0 ? '−' : ''}{fmtRub(Math.abs(netRemainder))}
                                  </span>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        </>
        );
      })()}
    </div>
  );
}
