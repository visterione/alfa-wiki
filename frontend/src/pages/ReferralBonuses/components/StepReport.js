import React, { useState, useRef, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTabSlider } from '../utils/useTabSlider';
import { referralBonuses as rbApi, performedServiceBonuses as psbApi, salaryRecords, doctorSchedules as schedulesApi, rbHolidays as holidaysApi } from '../../../services/api';
import { parseExcelFile, rbMapNewColumns } from '../utils/excelUtils';
import { buildReport, loadExecSettings, rbGetClinicSettings, extractCorpRows } from '../utils/reportEngine';
import { exportReport, exportBulkReport, buildSingleWorkbook, workbookToBase64 } from '../utils/reportExport';
import { rbNamesMatch } from '../utils/nameMatching';
import SalaryBlock from './SalaryBlockRenderer';
import CorpReviewModal from './CorpReviewModal';

// ─── Calendar ─────────────────────────────────────────────────────────────────
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

  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayRaw  = new Date(viewYear, viewMonth, 1).getDay();
  const firstDay     = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
  const cells        = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const prevMonth = () => viewMonth === 0 ? (setViewMonth(11), setViewYear(y => y-1)) : setViewMonth(m => m-1);
  const nextMonth = () => viewMonth === 11 ? (setViewMonth(0),  setViewYear(y => y+1)) : setViewMonth(m => m+1);

  // When actively picking 'to', hover previews the range; otherwise show confirmed dateTo
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
          const ds       = fmt(viewYear, viewMonth, day);
          const start    = isStart(ds);
          const end      = isEnd(ds);
          const inRange  = isInRange(ds);
          const isToday  = ds === today;
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

const fmtDisplay = str => { if (!str) return ''; const [y,m,d] = str.split('-'); return `${d}.${m}.${y}`; };
const parseManual = str => {
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

function DateRangePicker({ dateFrom, setDateFrom, dateTo, setDateTo }) {
  const [open, setOpen]       = useState(null);
  const [calPos, setCalPos]   = useState({ top: 0, left: 0 });
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

// ─── Drop zone ────────────────────────────────────────────────────────────────
function DropZone({ uploadedFile, onSelect, onClear, compact, onDms }) {
  const ref = useRef();
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = file => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) { toast.error('Выберите файл Excel (.xlsx или .xls)'); return; }
    onSelect(file);
  };

  const dragProps = {
    onDragOver:  e => { e.preventDefault(); setIsDragging(true); },
    onDragLeave: () => setIsDragging(false),
    onDrop:      e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]); },
  };

  const input = <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />;

  const compactBtn = { height: 30, padding: '0 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)', fontSize: 13 }} {...dragProps}>
        {uploadedFile ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#16a34a', fontWeight: 500 }}>{uploadedFile.name}</span>
            {onDms && <button onClick={onDms} style={{ ...compactBtn, width: 90 }}>Юр. комп.</button>}
            <button onClick={onClear} style={{ ...compactBtn, width: 90 }}>Удалить</button>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ color: 'var(--rb-text-secondary)', flexShrink: 0 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span style={{ color: 'var(--rb-text-secondary)' }}>Файл Excel не загружен</span>
            <button onClick={() => ref.current?.click()} style={{ ...compactBtn, background: 'none', border: '1px solid var(--rb-border-dark)', color: 'var(--rb-text-secondary)' }}>Выбрать файл</button>
            {isDragging && <span style={{ fontSize: 12, color: 'var(--rb-primary)', marginLeft: 4 }}>Отпустите...</span>}
          </>
        )}
        {input}
      </div>
    );
  }

  return (
    <div
      {...dragProps}
      onClick={() => !uploadedFile && ref.current?.click()}
      style={{
        margin: '16px 20px 0',
        border: `2px dashed ${isDragging ? 'var(--rb-primary)' : uploadedFile ? '#16a34a' : '#cbd5e1'}`,
        borderRadius: 10,
        padding: '24px 20px',
        textAlign: 'center',
        background: isDragging ? '#f0f7ff' : uploadedFile ? '#f0fdf4' : '#f8fafc',
        cursor: uploadedFile ? 'default' : 'pointer',
        transition: 'all .15s',
      }}
    >
      {uploadedFile ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" width="28" height="28"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 12 12 15 16 10"/></svg>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#16a34a' }}>{uploadedFile.name}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {onDms && <button onClick={e => { e.stopPropagation(); onDms(); }} style={{ width: 90, padding: '4px 0', fontSize: 12, border: 'none', borderRadius: 6, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Юр. комп.</button>}
            <button onClick={e => { e.stopPropagation(); ref.current?.click(); }} style={{ width: 90, padding: '4px 0', fontSize: 12, border: 'none', borderRadius: 6, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Заменить</button>
            <button onClick={e => { e.stopPropagation(); onClear(); }} style={{ width: 90, padding: '4px 0', fontSize: 12, border: 'none', borderRadius: 6, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Удалить</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke={isDragging ? 'var(--rb-primary)' : '#94a3b8'} strokeWidth="1.5" width="32" height="32"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style={{ fontSize: 13, fontWeight: 500, color: isDragging ? 'var(--rb-primary)' : 'var(--rb-text-secondary)' }}>
            {isDragging ? 'Отпустите файл' : 'Перетащите Excel-файл или нажмите для выбора'}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>.xlsx / .xls</div>
        </div>
      )}
      {input}
    </div>
  );
}

// ─── Toolbar: period + clinic filter + action button ──────────────────────────
function Toolbar({ dateFrom, setDateFrom, dateTo, setDateTo, clinics, filterClinic, setFilterClinic, actionDisabled, actionLabel, onAction, actionSpinner, onExport, exporting, onSave, saving, readOnly, hasReport }) {
  const [hovExport, setHovExport] = useState(false);
  const [hovSave, setHovSave]     = useState(false);
  const btnBlue = { fontSize: 12, fontWeight: 600, padding: '0 12px', height: 30, width: 90, border: 'none', borderRadius: 6, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, whiteSpace: 'nowrap', transition: 'filter .15s' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', flexWrap: 'wrap' }}>
      <DateRangePicker dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />

      {clinics?.length > 0 && (
        <select
          value={filterClinic}
          onChange={e => setFilterClinic(e.target.value)}
          style={{ fontSize: 12, padding: '5px 7px', border: filterClinic ? '1.5px solid var(--rb-primary)' : '1px solid var(--rb-border-dark)', borderRadius: 6, height: 32, background: filterClinic ? '#f0f7ff' : '#fff', color: filterClinic ? 'var(--rb-primary)' : 'inherit', cursor: 'pointer' }}
          title="Фильтр по клинике"
        >
          <option value="">Все клиники</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {hasReport && onExport && (
          <button
            style={{ ...btnBlue, filter: hovExport && !exporting ? 'brightness(0.88)' : exporting ? 'opacity(0.7)' : '', opacity: exporting ? 0.7 : 1 }}
            onClick={onExport} disabled={exporting}
            onMouseEnter={() => setHovExport(true)} onMouseLeave={() => setHovExport(false)}
          >
            {exporting ? 'Скачать...' : 'Скачать'}
          </button>
        )}
        {hasReport && onSave && !readOnly && (
          <button
            style={{ ...btnBlue, filter: hovSave && !saving ? 'brightness(0.88)' : '', opacity: saving ? 0.7 : 1 }}
            onClick={onSave} disabled={saving}
            onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
          >
            {saving ? 'Сохранить...' : 'Сохранить'}
          </button>
        )}
        <button
          className="rb-btn rb-btn-primary rb-btn-sm"
          disabled={actionDisabled}
          onClick={onAction}
          style={{ width: 90, justifyContent: 'center' }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Individual mode ───────────────────────────────────────────────────────────
function ModeIndividual({ selectedDoctor, doctors, clinics, readOnly, interim = false }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [generating, setGenerating]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [reportData, setReportData]     = useState(null);
  const [error, setError]               = useState('');

  const [corpModalState, setCorpModalState]     = useState(null);
  // corpModalState = { corpRows, colMap, pendingData } | null
  const [corpRecalcState, setCorpRecalcState]   = useState(null);
  // corpRecalcState = { corpRows, colMap, corpIncludedKeys, pendingData } — kept after generation for re-editing

  // Reset report when doctor changes
  useEffect(() => {
    setReportData(null);
    setError('');
    setCorpRecalcState(null);
  }, [selectedDoctor?.id]); // eslint-disable-line

  const runBuildReport = async ({ rows, colMap, rbRes, pbRes, execSettings, savedAsstRes, corpIncludedKeys, corpRows, scheduleEntries = [], holidayDates = null }) => {
    const referralBonuses    = Array.isArray(rbRes.data) ? rbRes.data : [];
    const performedDbBonuses = Array.isArray(pbRes.data)  ? pbRes.data  : [];
    const savedAssistanceIncome = Array.isArray(savedAsstRes.data) ? savedAsstRes.data : [];
    const isNormed = Object.values(execSettings?.clinicSettings || {}).some(
      cs => cs.payType === 'normed' || cs.payType === 'hourly' || cs.payType === 'salary'
    );
    const result = await buildReport({
      rows, colMap, doctor: selectedDoctor,
      referralBonuses, performedDbBonuses, execSettings,
      dateFrom: dateFrom || null, dateTo: dateTo || null,
      allDoctors: doctors, savedAssistanceIncome,
      interim, normedOnly: isNormed && !uploadedFile,
      corpIncludedKeys,
      scheduleEntries,
      holidayDates,
    });
    if (filterClinic) {
      result.clinicReports = result.clinicReports.filter(cr => String(cr.clinicId) === String(filterClinic));
    }
    setReportData({ ...result, doctor: selectedDoctor, dateFrom, dateTo });
    // Save context for post-generation re-editing
    if (corpRows?.length > 0) {
      setCorpRecalcState({ corpRows, colMap, corpIncludedKeys, pendingData: { rows, colMap, rbRes, pbRes, execSettings, savedAsstRes } });
    } else {
      setCorpRecalcState(null);
    }
  };

  const handleGenerate = async () => {
    if (!selectedDoctor) { toast.error('Выберите врача из списка слева'); return; }
    if (!dateFrom || !dateTo) { toast.error('Укажите период (дата с и по) для корректного расчёта', { duration: 5000 }); return; }
    setGenerating(true); setError(''); setReportData(null);
    try {
      const [rbRes, pbRes, execSettings, savedAsstRes, schedRes, holidaysRes] = await Promise.all([
        rbApi.getByDoctor(selectedDoctor.id),
        psbApi.getByDoctor(selectedDoctor.id),
        loadExecSettings(selectedDoctor.id),
        (dateFrom || dateTo) ? salaryRecords.getAssistanceIncome({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }) : Promise.resolve({ data: [] }),
        schedulesApi.list(selectedDoctor.misUserId || selectedDoctor.id).catch(() => ({ data: [] })),
        holidaysApi.list().catch(() => ({ data: [] })),
      ]);
      const scheduleEntries = Array.isArray(schedRes.data) ? schedRes.data : [];
      const holidayDates = new Set((holidaysRes.data || []).map(h => h.date));

      const isNormed = Object.values(execSettings?.clinicSettings || {}).some(
        cs => cs.payType === 'normed' || cs.payType === 'hourly' || cs.payType === 'salary'
      );
      if (!isNormed && !uploadedFile) { toast.error('Загрузите файл Excel'); setGenerating(false); return; }

      let rows = [], colMap = {};
      if (uploadedFile) {
        rows   = await parseExcelFile(uploadedFile);
        colMap = rbMapNewColumns(rows);
        if (!colMap.cabinet && Array.isArray(pbRes.data) && pbRes.data.some(b => b.cabinetId && b.cabinetId !== '')) {
          toast.error('В файле не найдена колонка «Кабинет» — бонусы по кабинетам не могут быть применены.', { duration: 7000 });
        }
      }

      const allCorpRows = extractCorpRows(rows, colMap, dateFrom, dateTo);
      // For individual report — show rows where this doctor appears in any role column
      const corpRows = allCorpRows.filter(({ row }) => {
        const name = selectedDoctor.name;
        if (colMap.executor        && rbNamesMatch(name, String(row[colMap.executor]         || '').trim())) return true;
        if (colMap.assistant       && rbNamesMatch(name, String(row[colMap.assistant]        || '').trim())) return true;
        if (colMap.nurse           && rbNamesMatch(name, String(row[colMap.nurse]            || '').trim())) return true;
        if (colMap.anesthesiologist && rbNamesMatch(name, String(row[colMap.anesthesiologist] || '').trim())) return true;
        return false;
      });
      if (corpRows.length > 0) {
        // Pause generation, show modal
        setGenerating(false);
        setCorpModalState({ corpRows, colMap, pendingData: { rows, colMap, rbRes, pbRes, execSettings, savedAsstRes, scheduleEntries, holidayDates } });
        return;
      }

      await runBuildReport({ rows, colMap, rbRes, pbRes, execSettings, savedAsstRes, corpIncludedKeys: null, corpRows, scheduleEntries, holidayDates });
    } catch (e) {
      setError(e.message || 'Ошибка при построении отчёта');
    } finally {
      setGenerating(false);
    }
  };

  const handleCorpConfirm = async (includedKeys) => {
    const { pendingData, corpRows: cr, isRecalc } = corpModalState;
    setCorpModalState(null);
    if (!pendingData) return;
    setGenerating(true); setError('');
    if (isRecalc) setReportData(null);
    try {
      await runBuildReport({ ...pendingData, corpIncludedKeys: includedKeys, corpRows: cr });
    } catch (e) {
      setError(e.message || 'Ошибка при построении отчёта');
    } finally {
      setGenerating(false);
    }
  };

  const [dupConfirm, setDupConfirm] = useState(null); // { existingId, period, onConfirm }

  const doSaveIndividual = async (existingId = null) => {
    setSaving(true);
    try {
      let excelBase64 = null;
      try {
        const wb = buildSingleWorkbook(reportData);
        excelBase64 = await workbookToBase64(wb);
      } catch { /* non-critical */ }

      const payload = {
        misUserId: selectedDoctor.id,
        doctorName: selectedDoctor.name,
        dateFrom: reportData.dateFrom || null,
        dateTo: reportData.dateTo || null,
        reportData: { clinicReports: reportData.clinicReports, grandTotal: reportData.grandTotal, periodLabel: reportData.periodLabel },
        reportType: interim ? 'interim' : 'final',
        excelBase64,
      };

      if (existingId) {
        await salaryRecords.update(existingId, payload);
        toast.success('Запись обновлена');
      } else {
        await salaryRecords.create(payload);
        toast.success('Отчёт сохранён в историю зарплат');
      }
    } catch (e) {
      toast.error('Ошибка сохранения: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToHistory = async () => {
    if (!reportData || !selectedDoctor) return;
    setSaving(true);
    try {
      const res = await salaryRecords.find(selectedDoctor.id, reportData.dateFrom);
      const existing = res.data;
      if (existing) {
        setSaving(false);
        setDupConfirm({
          existingId: existing.id,
          period: existing.periodLabel || (existing.dateFrom ? new Date(existing.dateFrom).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : 'этот период'),
        });
        return;
      }
      await doSaveIndividual(null);
    } catch (e) {
      toast.error('Ошибка сохранения: ' + (e.response?.data?.error || e.message));
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!reportData) return;
    setExporting(true);
    try { await exportReport(reportData); }
    catch (e) { toast.error('Ошибка экспорта: ' + e.message); }
    finally { setExporting(false); }
  };

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Duplicate confirmation modal ── */}
      {dupConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" width="22" height="22"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Запись уже существует</span>
            </div>
            {dupConfirm.isBulk ? (
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
                Среди выбранных врачей <strong>{dupConfirm.dupCount}</strong> уже {dupConfirm.dupCount === 1 ? 'имеет запись' : 'имеют записи'} за этот период.
                {dupConfirm.newCount > 0 && <> Новых записей: <strong>{dupConfirm.newCount}</strong>.</>}
                <br />Перезаписать существующие данные?
              </p>
            ) : (
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
                Запись за <strong>{dupConfirm.period}</strong> уже существует в истории.<br />
                Перезаписать её новыми данными?
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDupConfirm(null)}
                style={{ padding: '7px 18px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, fontWeight: 600, background: '#fff', cursor: 'pointer', color: '#475569' }}
              >
                Отменить
              </button>
              <button
                onClick={() => {
                  const confirm = dupConfirm;
                  setDupConfirm(null);
                  if (confirm.isBulk) confirm.onConfirmBulk();
                  else doSaveIndividual(confirm.existingId);
                }}
                style={{ padding: '7px 18px', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, background: '#007AFF', color: '#fff', cursor: 'pointer' }}
              >
                Перезаписать
              </button>
            </div>
          </div>
        </div>
      )}

      <Toolbar
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        clinics={clinics} filterClinic={filterClinic} setFilterClinic={setFilterClinic}
        actionDisabled={!selectedDoctor || generating}
        actionLabel={generating ? 'Расчёт...' : 'Расчёт'}
        actionSpinner={generating}
        onAction={handleGenerate}
        hasReport={!!reportData}
        onExport={handleExport} exporting={exporting}
        onSave={handleSaveToHistory} saving={saving}
        readOnly={readOnly}
      />

      <DropZone
        uploadedFile={uploadedFile}
        onSelect={f => { setUploadedFile(f); setReportData(null); setError(''); }}
        onClear={() => { setUploadedFile(null); setReportData(null); }}
        compact={!!reportData}
        onDms={corpRecalcState ? () => setCorpModalState({ corpRows: corpRecalcState.corpRows, colMap: corpRecalcState.colMap, pendingData: corpRecalcState.pendingData, isRecalc: true }) : null}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {error && <div className="rb-alert rb-alert-danger" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
        {reportData && (
          <div className="rb-report">
            {/* Clinic reports */}
            {reportData.clinicReports.map(({ clinicLabel, clinicColor, salary }, idx) => {
              const isMulti = reportData.clinicReports.length > 1;
              return (
                <div key={idx} style={{ marginBottom: isMulti ? 40 : 20, ...(isMulti && idx > 0 ? { borderTop: '3px dashed var(--rb-border)', paddingTop: 28 } : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '12px 16px', background: `${clinicColor}18`, border: `2px solid ${clinicColor}`, borderRadius: 8 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: clinicColor, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="rb-report-title" style={{ color: clinicColor }}>{clinicLabel}</div>
                      {isMulti && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2 }}>Расчётный лист {idx + 1} из {reportData.clinicReports.length}</div>}
                    </div>
                    {reportData.periodLabel && <div style={{ fontSize: 15, color: 'var(--rb-text)' }}>{reportData.periodLabel}</div>}
                  </div>
                  <SalaryBlock salary={salary} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    {corpModalState && (
      <CorpReviewModal
        corpRows={corpModalState.corpRows}
        colMap={corpModalState.colMap}
        initialSelected={corpModalState.isRecalc ? corpRecalcState?.corpIncludedKeys : undefined}
        onConfirm={handleCorpConfirm}
        onCancel={() => setCorpModalState(null)}
      />
    )}
    </>
  );
}

// ─── Bulk mode ─────────────────────────────────────────────────────────────────
// Doctor selection is handled by the shared rb-panel (bulkSelectedIds from props)
function ModeBulk({ doctors, clinics, bulkSelectedIds, readOnly, interim = false }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [generating, setGenerating]     = useState(false);
  const [savingAll, setSavingAll]       = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [dupConfirm, setDupConfirm]     = useState(null);

  const [progress, setProgress]       = useState({ current: 0, total: 0, currentName: '' });
  const [bulkResults, setBulkResults] = useState([]);
  const [expanded, setExpanded]       = useState(new Set());
  const [corpModalState, setCorpModalState] = useState(null);

  const runBulk = async ({ rows, colMap, savedAssistanceIncome, corpIncludedKeys, holidayDates }) => {
    const doctorList = doctors.filter(d => bulkSelectedIds.has(d.id));
    const results = [];
    for (let i = 0; i < doctorList.length; i++) {
      const doctor = doctorList[i];
      setProgress({ current: i + 1, total: doctorList.length, currentName: doctor.name });
      try {
        const [rbRes, pbRes, execSettings, schedRes] = await Promise.all([
          rbApi.getByDoctor(doctor.id),
          psbApi.getByDoctor(doctor.id),
          loadExecSettings(doctor.id),
          schedulesApi.list(doctor.misUserId || doctor.id).catch(() => ({ data: [] })),
        ]);
        const referralBonuses    = Array.isArray(rbRes.data)   ? rbRes.data   : [];
        const performedDbBonuses = Array.isArray(pbRes.data)   ? pbRes.data   : [];
        const scheduleEntries    = Array.isArray(schedRes.data) ? schedRes.data : [];
        const result = await buildReport({
          rows, colMap, doctor,
          referralBonuses, performedDbBonuses, execSettings,
          dateFrom: dateFrom || null, dateTo: dateTo || null,
          allDoctors: doctors, savedAssistanceIncome,
          interim, corpIncludedKeys,
          scheduleEntries,
          holidayDates,
        });
        if (filterClinic) {
          result.clinicReports = result.clinicReports.filter(cr => String(cr.clinicId) === String(filterClinic));
        }
        results.push({ doctor, ...result, dateFrom, dateTo, error: null });
      } catch (e) {
        results.push({ doctor, clinicReports: [], grandTotal: 0, periodLabel: '', dateFrom, dateTo, error: e.message || 'Ошибка' });
      }
    }
    setBulkResults(results);
    setGenerating(false);
    const ok  = results.filter(r => !r.error).length;
    const err = results.filter(r => r.error).length;
    if (err > 0) toast.error(`Готово: ${ok} успешно, ${err} ошибок`);
    else toast.success(`Сводный отчёт готов: ${ok} врачей`);
  };

  const handleBulkGenerate = async () => {
    if (bulkSelectedIds.size === 0) { toast.error('Выберите врачей в списке слева'); return; }
    if (!dateFrom || !dateTo) { toast.error('Укажите период (дата с и по) для корректного расчёта', { duration: 5000 }); return; }
    setGenerating(true); setBulkResults([]); setExpanded(new Set());

    let rows = [], colMap = {};
    if (uploadedFile) {
      try {
        rows   = await parseExcelFile(uploadedFile);
        colMap = rbMapNewColumns(rows);
      } catch (e) {
        toast.error('Ошибка чтения файла: ' + e.message);
        setGenerating(false); return;
      }
    }

    // Fetch saved assistance income and holidays once for the whole bulk run
    let savedAssistanceIncome = [];
    let bulkHolidayDates = null;
    if (dateFrom || dateTo) {
      try {
        const savedAsstRes = await salaryRecords.getAssistanceIncome({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
        savedAssistanceIncome = Array.isArray(savedAsstRes.data) ? savedAsstRes.data : [];
      } catch { /* non-critical, ignore */ }
    }
    try {
      const holidaysRes = await holidaysApi.list();
      bulkHolidayDates = new Set((holidaysRes.data || []).map(h => h.date));
    } catch { /* non-critical */ }

    const corpRows = extractCorpRows(rows, colMap, dateFrom, dateTo);
    if (corpRows.length > 0) {
      // Group corp rows by selected doctor using name matching
      const doctorList = doctors.filter(d => bulkSelectedIds.has(d.id));
      const corpByDoctor = doctorList.map(doctor => ({
        doctor,
        rows: colMap.executor
          ? corpRows.filter(({ row }) => rbNamesMatch(doctor.name, String(row[colMap.executor] || '').trim()))
          : [],
      })).filter(g => g.rows.length > 0);
      // Rows not matched to any doctor — append as "Прочие"
      const matchedKeys = new Set(corpByDoctor.flatMap(g => g.rows.map(r => r.key)));
      const unmatched = corpRows.filter(r => !matchedKeys.has(r.key));
      if (unmatched.length > 0) corpByDoctor.push({ doctor: { name: 'Прочие' }, rows: unmatched });

      setGenerating(false);
      setCorpModalState({ corpRows, corpByDoctor, colMap, pendingData: { rows, colMap, savedAssistanceIncome, holidayDates: bulkHolidayDates }, isBulk: true });
      return;
    }

    await runBulk({ rows, colMap, savedAssistanceIncome, corpIncludedKeys: null, holidayDates: bulkHolidayDates });
  };

  const handleBulkCorpConfirm = async (includedKeys) => {
    const pending = corpModalState?.pendingData;
    setCorpModalState(null);
    if (!pending) return;
    setGenerating(true); setBulkResults([]); setExpanded(new Set());
    await runBulk({ ...pending, corpIncludedKeys: includedKeys });
  };

  const handleExportAll = async () => {
    setExporting(true);
    try { await exportBulkReport(bulkResults); }
    catch (e) { toast.error('Ошибка экспорта: ' + e.message); }
    finally { setExporting(false); }
  };

  const doSaveAll = async (ok, existingMap) => {
    setSavingAll(true);
    let saved = 0, updated = 0, failed = 0;
    for (const r of ok) {
      try {
        let excelBase64 = null;
        try {
          const wb = buildSingleWorkbook({ doctor: r.doctor, clinicReports: r.clinicReports, periodLabel: r.periodLabel });
          excelBase64 = await workbookToBase64(wb);
        } catch { /* non-critical */ }

        const payload = {
          misUserId: r.doctor.id, doctorName: r.doctor.name,
          dateFrom: r.dateFrom || null, dateTo: r.dateTo || null,
          reportData: { clinicReports: r.clinicReports, grandTotal: r.grandTotal, periodLabel: r.periodLabel },
          reportType: interim ? 'interim' : 'final',
          excelBase64,
        };
        const existingId = existingMap[r.doctor.id];
        if (existingId) {
          await salaryRecords.update(existingId, payload);
          updated++;
        } else {
          await salaryRecords.create(payload);
          saved++;
        }
      } catch { failed++; }
    }
    setSavingAll(false);
    const parts = [];
    if (saved > 0)   parts.push(`создано: ${saved}`);
    if (updated > 0) parts.push(`обновлено: ${updated}`);
    if (failed > 0)  parts.push(`ошибок: ${failed}`);
    if (failed > 0) toast.error(parts.join(', '));
    else toast.success('Сохранено в историю — ' + parts.join(', '));
  };

  const handleSaveAll = async () => {
    const ok = bulkResults.filter(r => !r.error && r.clinicReports?.length > 0);
    if (ok.length === 0) return;
    setSavingAll(true);

    // Проверяем дубли для каждого врача
    const existingMap = {}; // misUserId → existingId
    await Promise.all(ok.map(async r => {
      try {
        const res = await salaryRecords.find(r.doctor.id, r.dateFrom);
        if (res.data) existingMap[r.doctor.id] = res.data.id;
      } catch { /* пропускаем */ }
    }));
    setSavingAll(false);

    const dupCount = Object.keys(existingMap).length;
    if (dupCount > 0) {
      setDupConfirm({
        isBulk: true,
        dupCount,
        newCount: ok.length - dupCount,
        onConfirmBulk: () => doSaveAll(ok, existingMap),
        ok,
      });
      return;
    }

    await doSaveAll(ok, {});
  };

  const toggleExpanded = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const successResults   = bulkResults.filter(r => !r.error && r.clinicReports?.length > 0);
  const totalFinalSalary = successResults.reduce((sum, r) => sum + (r.grandTotal || 0), 0);
  const fmtRub = v => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(v || 0);

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Duplicate confirmation modal ── */}
      {dupConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" width="22" height="22"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Записи уже существуют</span>
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
              Среди выбранных врачей <strong>{dupConfirm.dupCount}</strong> уже {dupConfirm.dupCount === 1 ? 'имеет запись' : 'имеют записи'} за этот период.
              {dupConfirm.newCount > 0 && <> Новых записей: <strong>{dupConfirm.newCount}</strong>.</>}
              <br />Перезаписать существующие данные?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDupConfirm(null)}
                style={{ padding: '7px 18px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, fontWeight: 600, background: '#fff', cursor: 'pointer', color: '#475569' }}
              >
                Отменить
              </button>
              <button
                onClick={() => { const c = dupConfirm; setDupConfirm(null); c.onConfirmBulk(); }}
                style={{ padding: '7px 18px', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, background: '#007AFF', color: '#fff', cursor: 'pointer' }}
              >
                Перезаписать
              </button>
            </div>
          </div>
        </div>
      )}

      <Toolbar
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        clinics={clinics} filterClinic={filterClinic} setFilterClinic={setFilterClinic}
        actionDisabled={generating || bulkSelectedIds.size === 0}
        actionLabel={generating ? `${progress.current}/${progress.total}...` : `Расчёт (${bulkSelectedIds.size})`}
        actionSpinner={generating}
        onAction={handleBulkGenerate}
        hasReport={bulkResults.length > 0}
        onExport={handleExportAll} exporting={exporting}
        onSave={handleSaveAll} saving={savingAll}
        readOnly={readOnly}
      />

      <DropZone
        uploadedFile={uploadedFile}
        onSelect={f => { setUploadedFile(f); setBulkResults([]); }}
        onClear={() => { setUploadedFile(null); setBulkResults([]); }}
        compact={bulkResults.length > 0}
      />

      {/* Progress bar */}
      {generating && progress.total > 0 && (
        <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--rb-border)', background: '#eff6ff' }}>
          <div style={{ height: 5, background: '#dbeafe', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
            <div style={{ height: '100%', background: 'var(--rb-primary)', borderRadius: 3, width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{progress.currentName} ({progress.current} из {progress.total})</div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {!generating && bulkResults.length === 0 && null}

        {bulkResults.length > 0 && (
          <>
            {/* Summary + action buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '12px 16px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1D4ED8' }}>Сводный отчёт готов</div>
                <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 2 }}>
                  {successResults.length} из {bulkResults.length} врачей · Итого: <strong>{fmtRub(totalFinalSalary)}</strong>
                  {bulkResults.filter(r => r.error).length > 0 && (
                    <span style={{ color: 'var(--rb-danger)', marginLeft: 8 }}>· {bulkResults.filter(r => r.error).length} ошибок</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }} />
            </div>

            {/* Per-doctor collapsible cards */}
            {bulkResults.map(r => {
              const isOpen     = expanded.has(r.doctor.id);
              const hasClinics = r.clinicReports?.length > 0;
              const total      = (r.clinicReports || []).reduce((s, cr) => s + (cr.salary?.finalSalary || 0), 0);
              return (
                <div key={r.doctor.id} style={{ marginBottom: 6, border: '1px solid var(--rb-border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    onClick={() => hasClinics && toggleExpanded(r.doctor.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: r.error ? '#FEF2F2' : (isOpen ? '#F0FDF4' : '#FAFAFA'), cursor: hasClinics ? 'pointer' : 'default', userSelect: 'none' }}
                  >
                    {/* Clinic colour bars */}
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {(r.clinicReports || []).slice(0, 4).map((cr, i) => (
                        <div key={i} style={{ width: 4, height: 30, borderRadius: 2, background: cr.clinicColor || '#94a3b8' }} />
                      ))}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.doctor.name}</div>
                      {r.error
                        ? <div style={{ fontSize: 11, color: 'var(--rb-danger)' }}>Ошибка: {r.error}</div>
                        : hasClinics
                          ? <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{(r.clinicReports || []).map(cr => cr.clinicLabel).join(' · ')}</div>
                          : <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>Нет данных за период</div>
                      }
                    </div>
                    {hasClinics && (
                      <div style={{ fontWeight: 700, fontSize: 13, color: total >= 0 ? 'var(--rb-success)' : 'var(--rb-danger)', whiteSpace: 'nowrap' }}>
                        {fmtRub(total)}
                      </div>
                    )}
                    {hasClinics && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, color: 'var(--rb-text-secondary)' }}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    )}
                  </div>
                  {isOpen && hasClinics && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--rb-border)' }}>
                      {r.clinicReports.map((cr, cidx) => (
                        <div key={cidx} style={{ marginTop: 16, ...(cidx > 0 ? { borderTop: '2px dashed var(--rb-border)', paddingTop: 16 } : {}) }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: `${cr.clinicColor}18`, border: `2px solid ${cr.clinicColor}`, borderRadius: 8 }}>
                            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: cr.clinicColor, flexShrink: 0 }} />
                            <div className="rb-report-title" style={{ color: cr.clinicColor }}>{cr.clinicLabel}</div>
                            {r.periodLabel && <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--rb-text-secondary)' }}>{r.periodLabel}</div>}
                          </div>
                          <SalaryBlock salary={cr.salary} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
    {corpModalState && (
      <CorpReviewModal
        corpRows={corpModalState.corpRows}
        corpByDoctor={corpModalState.corpByDoctor}
        colMap={corpModalState.colMap}
        isBulk={!!corpModalState.isBulk}
        onConfirm={handleBulkCorpConfirm}
        onCancel={() => setCorpModalState(null)}
      />
    )}
    </>
  );
}

// ─── Main StepReport ───────────────────────────────────────────────────────────
const REPORT_MODES = [
  ['individual',         'Индивидуальный'],
  ['individual_interim', 'Инд. промежуточный'],
  ['bulk',               'Сводный'],
  ['bulk_interim',       'Сводный промежуточный'],
];

export default function StepReport({ selectedDoctor, doctors, clinics, reportMode, setReportMode, bulkSelectedIds, readOnly }) {
  const isBulk    = reportMode === 'bulk' || reportMode === 'bulk_interim';
  const isInterim = reportMode === 'individual_interim' || reportMode === 'bulk_interim';
  const { wrapRef: reportTabRef, sliderEl: reportSlider } = useTabSlider(reportMode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode tabs */}
      <div className="rb-clinic-tab-wrap" style={{ margin: '8px 12px', flexShrink: 0 }} ref={reportTabRef}>
        {reportSlider}
        {REPORT_MODES.map(([key, label]) => (
          <button
            key={key}
            className={`rb-clinic-tab${reportMode === key ? ' active' : ''}`}
            onClick={() => setReportMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: reportMode === 'individual' ? 'contents' : 'none' }}>
          <ModeIndividual selectedDoctor={selectedDoctor} doctors={doctors} clinics={clinics} readOnly={readOnly} interim={false} />
        </div>
        <div style={{ display: reportMode === 'individual_interim' ? 'contents' : 'none' }}>
          <ModeIndividual selectedDoctor={selectedDoctor} doctors={doctors} clinics={clinics} readOnly={readOnly} interim={true} />
        </div>
        <div style={{ display: reportMode === 'bulk' ? 'contents' : 'none' }}>
          <ModeBulk doctors={doctors} clinics={clinics} bulkSelectedIds={bulkSelectedIds} readOnly={readOnly} interim={false} />
        </div>
        <div style={{ display: reportMode === 'bulk_interim' ? 'contents' : 'none' }}>
          <ModeBulk doctors={doctors} clinics={clinics} bulkSelectedIds={bulkSelectedIds} readOnly={readOnly} interim={true} />
        </div>
      </div>
    </div>
  );
}
