import React, { useState, useRef, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTabSlider } from '../utils/useTabSlider';
import { referralBonuses as rbApi, performedServiceBonuses as psbApi, salaryRecords, doctorSchedules as schedulesApi, rbHolidays as holidaysApi, rbDoctorHeaders } from '../../../services/api';
import { parseExcelFile, rbMapNewColumns } from '../utils/excelUtils';
import { fetchSourceFile } from '../utils/excelSources';
import DateRangePicker from './DateRangePicker';
import { buildReport, loadExecSettings, rbGetClinicSettings, extractCorpRows } from '../utils/reportEngine';
import { exportReport, exportBulkReport, buildSingleWorkbook, workbookToBase64 } from '../utils/reportExport';
import { exportReportPdf, exportBulkReportPdf } from '../utils/reportPdf';
import { rbNamesMatch } from '../utils/nameMatching';
import SalaryBlock from './SalaryBlockRenderer';
import CorpReviewModal from './CorpReviewModal';

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
function Toolbar({ dateFrom, setDateFrom, dateTo, setDateTo, clinics, filterClinic, setFilterClinic, actionDisabled, actionLabel, onAction, actionSpinner, onExport, exporting, onExportPdf, exportingPdf, onSave, saving, readOnly, hasReport }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const busy = exporting || exportingPdf || saving;

  useEffect(() => {
    if (!menuOpen) return;
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const menuItems = [
    onSave && !readOnly && {
      label: saving ? 'Сохранение...' : 'Сохранить',
      disabled: saving,
      action: () => { setMenuOpen(false); onSave(); },
    },
    onExportPdf && {
      label: exportingPdf ? 'Генерация PDF...' : 'Сохранить как PDF',
      disabled: exportingPdf,
      action: () => { setMenuOpen(false); onExportPdf(); },
    },
    onExport && {
      label: exporting ? 'Генерация Excel...' : 'Сохранить как Excel',
      disabled: exporting,
      action: () => { setMenuOpen(false); onExport(); },
    },
  ].filter(Boolean);

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
        <button
          className="rb-btn rb-btn-primary rb-btn-sm"
          disabled={actionDisabled}
          onClick={onAction}
          style={{ width: 90, justifyContent: 'center' }}
        >
          {actionLabel}
        </button>

        {hasReport && menuItems.length > 0 && (
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              title="Действия"
              style={{
                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 7,
                background: menuOpen ? 'var(--rb-primary-dark, #0062cc)' : 'var(--rb-primary)',
                cursor: 'pointer', color: '#fff',
                opacity: busy ? 0.7 : 1,
                transition: 'background .15s, opacity .15s',
              }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
              </svg>
            </button>

            {menuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 300,
                background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 190, overflow: 'hidden',
              }}>
                {menuItems.map((item, i) => (
                  <button
                    key={i}
                    onClick={item.action}
                    disabled={item.disabled}
                    style={{
                      width: '100%', padding: '9px 14px', border: 'none', background: 'none',
                      cursor: item.disabled ? 'default' : 'pointer', textAlign: 'left',
                      fontSize: 13, color: item.disabled ? 'var(--rb-text-secondary)' : 'var(--rb-text)',
                      borderTop: i > 0 ? '1px solid var(--rb-border)' : 'none',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Source conflict picker ────────────────────────────────────────────────────
function SourceConflictModal({ sources, onPick, onDismiss }) {
  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  };
  return (
    <div className="rb-modal-overlay" onClick={onDismiss}>
      <div className="rb-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="rb-modal-header">
          Несколько источников для этого периода
        </div>
        <div className="rb-modal-body" style={{ padding: '12px 20px' }}>
          <p style={{ fontSize: 13, color: 'var(--rb-text-secondary)', margin: '0 0 12px' }}>
            Найдено несколько Excel-файлов с совпадающим периодом. Выберите нужный:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.map(src => (
              <button
                key={src.id}
                onClick={() => onPick(src)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--rb-border)', borderRadius: 8, background: '#f8fafc', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                onMouseLeave={e => e.currentTarget.style.background = '#f8fafc'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" width="18" height="18" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {src.periodLabel || `${fmtDate(src.dateFrom)} – ${fmtDate(src.dateTo)}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.fileName}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="rb-modal-footer">
          <button className="rb-btn rb-btn-secondary" onClick={onDismiss}>Отмена — выберу файл сам</button>
        </div>
      </div>
    </div>
  );
}

// ─── Missing bonus detection helpers ──────────────────────────────────────────
function collectMissingBonuses(clinicReports) {
  const mp = (clinicReports || []).flatMap(cr =>
    (cr.salary?.performedSections || [])
      .filter(s => s.bonusLabel === '—')
      .map(s => ({ name: s.name || s.code || '—', code: s.code || '', clinic: cr.clinicLabel || '' }))
  );
  const mr = (clinicReports || []).flatMap(cr =>
    (cr.salary?.referralSections || []).flatMap(sec =>
      (sec.services || [])
        .filter(svc => svc.bonusLabel === '—')
        .map(svc => ({ name: svc.name || svc.code || '—', code: svc.code || '', clinic: cr.clinicLabel || '' }))
    )
  );
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(x => { const k = `${x.code}||${x.name}||${x.clinic}`; return seen.has(k) ? false : (seen.add(k), true); });
  };
  return { missingPerformed: dedup(mp), missingReferral: dedup(mr) };
}

function MissingBonusBanner({ clinicReports }) {
  const [expanded, setExpanded] = useState(false);
  const { missingPerformed, missingReferral } = collectMissingBonuses(clinicReports);
  if (!missingPerformed.length && !missingReferral.length) return null;
  const total = missingPerformed.length + missingReferral.length;

  return (
    <div style={{ marginBottom: 16, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', userSelect: 'none' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0 }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#92400e' }}>
          Не настроен бонус для {total} {total === 1 ? 'услуги' : 'услуг'} — бонус не будет начислен
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid #fde68a' }}>
          {missingPerformed.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', margin: '10px 0 5px' }}>Выполненные услуги (нет в «Услуги»):</div>
              {missingPerformed.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: '#78350f', padding: '1px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ color: '#a16207', flexShrink: 0 }}>·</span>
                  <span>{s.name}{s.code ? <span style={{ color: '#a16207', marginLeft: 4 }}>({s.code})</span> : ''}{missingPerformed.length > 1 && s.clinic ? <span style={{ color: '#a16207', marginLeft: 4 }}>— {s.clinic}</span> : ''}</span>
                </div>
              ))}
            </>
          )}
          {missingReferral.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', margin: '10px 0 5px' }}>Направления (нет в «Направления»):</div>
              {missingReferral.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: '#78350f', padding: '1px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ color: '#a16207', flexShrink: 0 }}>·</span>
                  <span>{s.name}{s.code ? <span style={{ color: '#a16207', marginLeft: 4 }}>({s.code})</span> : ''}{missingReferral.length > 1 && s.clinic ? <span style={{ color: '#a16207', marginLeft: 4 }}>— {s.clinic}</span> : ''}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Individual mode ───────────────────────────────────────────────────────────
function ModeIndividual({ selectedDoctor, doctors, clinics, readOnly, interim = false, excelSources = [] }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [generating, setGenerating]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [reportData, setReportData]     = useState(null);
  const [error, setError]               = useState('');

  const [corpModalState, setCorpModalState]     = useState(null);
  // corpModalState = { corpRows, colMap, pendingData } | null
  const [corpRecalcState, setCorpRecalcState]   = useState(null);
  // corpRecalcState = { corpRows, colMap, corpIncludedKeys, pendingData } — kept after generation for re-editing

  // 'auto' = loaded from source, 'manual' = user picked, null = empty/ready for auto-load
  const autoSrcRef = useRef(null);
  const [sourceConflict, setSourceConflict] = useState(null); // array of matching sources | null

  // Auto-load Excel from saved sources when period changes
  useEffect(() => {
    if (!dateFrom || !dateTo || !excelSources.length) return;
    if (autoSrcRef.current === 'manual') return; // never override user's own file
    const matches = excelSources.filter(s => s.dateFrom === dateFrom && s.dateTo === dateTo);
    if (matches.length === 0) {
      // Period changed away — clear previously auto-loaded file
      if (autoSrcRef.current === 'auto') {
        autoSrcRef.current = null;
        setUploadedFile(null);
        setReportData(null);
      }
      return;
    }
    if (matches.length === 1) {
      autoSrcRef.current = 'auto';
      fetchSourceFile(matches[0]).then(file => {
        setUploadedFile(file);
        setReportData(null);
        toast.success(`Файл из Источников: ${matches[0].fileName}`, { duration: 3000 });
      }).catch(() => toast.error('Не удалось загрузить файл из Источников'));
    } else {
      setSourceConflict(matches);
    }
  }, [dateFrom, dateTo, excelSources]); // eslint-disable-line

  const handleSourcePick = (src) => {
    setSourceConflict(null);
    autoSrcRef.current = 'auto';
    fetchSourceFile(src).then(file => {
      setUploadedFile(file);
      setReportData(null);
    }).catch(() => toast.error('Не удалось загрузить файл из Источников'));
  };

  const handleSourceConflictDismiss = () => {
    setSourceConflict(null);
    autoSrcRef.current = 'manual'; // treat as manual so we don't re-trigger
  };

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
        loadExecSettings(selectedDoctor.id, selectedDoctor.roles),
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

  const handleExportPdf = async () => {
    if (!reportData) return;
    setExportingPdf(true);
    try {
      let tabelNumber = '';
      try {
        const res = await rbDoctorHeaders.list();
        const row = (res.data || []).find(h => h.misUserId === selectedDoctor.id);
        tabelNumber = row?.tabelNumber || '';
      } catch { /* non-critical */ }
      exportReportPdf(reportData, tabelNumber);
    } catch (e) {
      toast.error('Ошибка PDF: ' + e.message);
    } finally {
      setExportingPdf(false);
    }
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
        onExportPdf={handleExportPdf} exportingPdf={exportingPdf}
        onSave={handleSaveToHistory} saving={saving}
        readOnly={readOnly}
      />

      {sourceConflict && (
        <SourceConflictModal
          sources={sourceConflict}
          onPick={handleSourcePick}
          onDismiss={handleSourceConflictDismiss}
        />
      )}
      <DropZone
        uploadedFile={uploadedFile}
        onSelect={f => { autoSrcRef.current = 'manual'; setUploadedFile(f); setReportData(null); setError(''); }}
        onClear={() => { autoSrcRef.current = null; setUploadedFile(null); setReportData(null); }}
        compact={!!reportData}
        onDms={corpRecalcState ? () => setCorpModalState({ corpRows: corpRecalcState.corpRows, colMap: corpRecalcState.colMap, pendingData: corpRecalcState.pendingData, isRecalc: true }) : null}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {error && <div className="rb-alert rb-alert-danger" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
        {reportData && (
          <div className="rb-report">
            <MissingBonusBanner clinicReports={reportData.clinicReports} />
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
function ModeBulk({ doctors, clinics, bulkSelectedIds, readOnly, interim = false, excelSources = [] }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [generating, setGenerating]     = useState(false);
  const [savingAll, setSavingAll]       = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [dupConfirm, setDupConfirm]     = useState(null);

  const [progress, setProgress]       = useState({ current: 0, total: 0, currentName: '' });
  const [bulkResults, setBulkResults] = useState([]);
  const [expanded, setExpanded]       = useState(new Set());
  const [corpModalState, setCorpModalState] = useState(null);

  // 'auto' = loaded from source, 'manual' = user picked, null = empty/ready for auto-load
  const autoSrcRef = useRef(null);
  const [sourceConflict, setSourceConflict] = useState(null);

  // Auto-load Excel from saved sources when period changes
  useEffect(() => {
    if (!dateFrom || !dateTo || !excelSources.length) return;
    if (autoSrcRef.current === 'manual') return;
    const matches = excelSources.filter(s => s.dateFrom === dateFrom && s.dateTo === dateTo);
    if (matches.length === 0) {
      if (autoSrcRef.current === 'auto') {
        autoSrcRef.current = null;
        setUploadedFile(null);
        setBulkResults([]);
      }
      return;
    }
    if (matches.length === 1) {
      autoSrcRef.current = 'auto';
      fetchSourceFile(matches[0]).then(file => {
        setUploadedFile(file);
        setBulkResults([]);
        toast.success(`Файл из Источников: ${matches[0].fileName}`, { duration: 3000 });
      }).catch(() => toast.error('Не удалось загрузить файл из Источников'));
    } else {
      setSourceConflict(matches);
    }
  }, [dateFrom, dateTo, excelSources]); // eslint-disable-line

  const handleSourcePick = (src) => {
    setSourceConflict(null);
    autoSrcRef.current = 'auto';
    fetchSourceFile(src).then(file => {
      setUploadedFile(file);
      setBulkResults([]);
    }).catch(() => toast.error('Не удалось загрузить файл из Источников'));
  };

  const handleSourceConflictDismiss = () => {
    setSourceConflict(null);
    autoSrcRef.current = 'manual';
  };

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
          loadExecSettings(doctor.id, doctor.roles),
          schedulesApi.list(doctor.misUserId || doctor.id).catch(() => ({ data: [] })),
        ]);
        const referralBonuses    = Array.isArray(rbRes.data)   ? rbRes.data   : [];
        const performedDbBonuses = Array.isArray(pbRes.data)   ? pbRes.data   : [];
        const scheduleEntries    = Array.isArray(schedRes.data) ? schedRes.data : [];
        const isNormed = Object.values(execSettings?.clinicSettings || {}).some(
          cs => cs.payType === 'normed' || cs.payType === 'hourly' || cs.payType === 'salary'
        );
        const result = await buildReport({
          rows, colMap, doctor,
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

  const handleExportBulkPdf = async () => {
    setExportingPdf(true);
    try {
      const tabelNumbers = {};
      try {
        const res = await rbDoctorHeaders.list();
        (res.data || []).forEach(h => { tabelNumbers[h.misUserId] = h.tabelNumber || ''; });
      } catch { /* non-critical */ }
      exportBulkReportPdf(bulkResults, tabelNumbers);
    } catch (e) {
      toast.error('Ошибка PDF: ' + e.message);
    } finally {
      setExportingPdf(false);
    }
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
        onExportPdf={handleExportBulkPdf} exportingPdf={exportingPdf}
        onSave={handleSaveAll} saving={savingAll}
        readOnly={readOnly}
      />

      {sourceConflict && (
        <SourceConflictModal
          sources={sourceConflict}
          onPick={handleSourcePick}
          onDismiss={handleSourceConflictDismiss}
        />
      )}
      <DropZone
        uploadedFile={uploadedFile}
        onSelect={f => { autoSrcRef.current = 'manual'; setUploadedFile(f); setBulkResults([]); }}
        onClear={() => { autoSrcRef.current = null; setUploadedFile(null); setBulkResults([]); }}
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
              const { missingPerformed: bmp, missingReferral: bmr } = hasClinics && !r.error ? collectMissingBonuses(r.clinicReports) : { missingPerformed: [], missingReferral: [] };
              const total      = (r.clinicReports || []).reduce((s, cr) => {
                const sal = cr.salary;
                if (!sal) return s;
                const extraT = (sal.extraPayments || []).reduce((sum, ep) => sum + (parseFloat(ep.amount) || 0), 0);
                return s + (sal.finalSalary || 0) - (sal.ndflTotal || 0) - (sal.advance || 0) - (sal.mainPayment || 0) - (sal.normPremiumAmount || 0) - extraT;
              }, 0);
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
                      {(bmp.length > 0 || bmr.length > 0) && (
                        <div style={{ marginTop: 4, fontSize: 11, color: '#92400e', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {bmp.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" width="11" height="11" style={{ flexShrink: 0, marginTop: 1 }}>
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                              </svg>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontWeight: 600 }}>Услуги без бонуса: </span>
                                <span style={{ color: '#78350f' }}>{bmp.map(s => s.name || s.code || '—').join(', ')}</span>
                              </div>
                            </div>
                          )}
                          {bmr.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" width="11" height="11" style={{ flexShrink: 0, marginTop: 1 }}>
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                              </svg>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontWeight: 600 }}>Направления без бонуса: </span>
                                <span style={{ color: '#78350f' }}>{bmr.map(s => s.name || s.code || '—').join(', ')}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
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

export default function StepReport({ selectedDoctor, doctors, clinics, reportMode, setReportMode, bulkSelectedIds, readOnly, excelSources = [] }) {
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
          <ModeIndividual selectedDoctor={selectedDoctor} doctors={doctors} clinics={clinics} readOnly={readOnly} interim={false} excelSources={excelSources} />
        </div>
        <div style={{ display: reportMode === 'individual_interim' ? 'contents' : 'none' }}>
          <ModeIndividual selectedDoctor={selectedDoctor} doctors={doctors} clinics={clinics} readOnly={readOnly} interim={true} excelSources={excelSources} />
        </div>
        <div style={{ display: reportMode === 'bulk' ? 'contents' : 'none' }}>
          <ModeBulk doctors={doctors} clinics={clinics} bulkSelectedIds={bulkSelectedIds} readOnly={readOnly} interim={false} excelSources={excelSources} />
        </div>
        <div style={{ display: reportMode === 'bulk_interim' ? 'contents' : 'none' }}>
          <ModeBulk doctors={doctors} clinics={clinics} bulkSelectedIds={bulkSelectedIds} readOnly={readOnly} interim={true} excelSources={excelSources} />
        </div>
      </div>
    </div>
  );
}
