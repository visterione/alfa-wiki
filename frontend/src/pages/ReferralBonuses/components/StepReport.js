import React, { useState, useRef, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { referralBonuses as rbApi, performedServiceBonuses as psbApi, salaryRecords } from '../../../services/api';
import { parseExcelFile, rbMapNewColumns } from '../utils/excelUtils';
import { buildReport, loadExecSettings } from '../utils/reportEngine';
import { exportReport, exportBulkReport, buildSingleWorkbook, workbookToBase64 } from '../utils/reportExport';
import SalaryBlock from './SalaryBlockRenderer';

// ─── Inline file picker (small, fits in a toolbar) ────────────────────────────
function FilePicker({ uploadedFile, onSelect, onClear, onDragOver, onDragLeave, onDrop }) {
  const ref = useRef();
  if (uploadedFile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', height: 32, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12, maxWidth: 220 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ color: '#16a34a', flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadedFile.name}</span>
        <button
          onClick={onClear}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#6b7280', lineHeight: 1, fontSize: 14, flexShrink: 0 }}
          title="Убрать файл"
        >×</button>
      </div>
    );
  }
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        onClick={() => ref.current?.click()}
        className="rb-btn rb-btn-secondary rb-btn-sm"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Загрузить Excel
      </button>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={e => { onSelect(e.target.files[0]); e.target.value = ''; }}
      />
    </div>
  );
}

// ─── Toolbar: period + file + action button ────────────────────────────────────
function Toolbar({ dateFrom, setDateFrom, dateTo, setDateTo, uploadedFile, onFileSelect, onFileClear, actionDisabled, actionLabel, onAction, actionSpinner }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = (file) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) { toast.error('Выберите файл Excel (.xlsx или .xls)'); return; }
    onFileSelect(file);
  };

  const periodMissing = !dateFrom || !dateTo;
  const inputBorder = (val) => val ? '1px solid var(--rb-border-dark)' : '1.5px solid #f59e0b';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 16px',
      borderBottom: '1px solid var(--rb-border)',
      background: '#f8fafc',
      flexWrap: 'wrap',
    }}>
      {/* Period */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>
            Период с <span style={{ color: '#ef4444', fontWeight: 600 }}>*</span>
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{ fontSize: 12, padding: '5px 7px', border: inputBorder(dateFrom), borderRadius: 6, outline: 'none', height: 32 }}
          />
          <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
            по <span style={{ color: '#ef4444', fontWeight: 600 }}>*</span>
          </span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{ fontSize: 12, padding: '5px 7px', border: inputBorder(dateTo), borderRadius: 6, outline: 'none', height: 32 }}
          />
        </div>
      </div>

      {/* File */}
      <FilePicker
        uploadedFile={uploadedFile}
        onSelect={handleFileSelect}
        onClear={onFileClear}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          handleFileSelect(e.dataTransfer.files[0]);
        }}
      />
      {isDragging && <span style={{ fontSize: 11, color: 'var(--rb-primary)' }}>Отпустите файл...</span>}

      {/* Action */}
      <button
        className="rb-btn rb-btn-primary rb-btn-sm"
        disabled={actionDisabled}
        onClick={onAction}
        style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
      >
        {actionSpinner
          ? <><span className="rb-spinner" style={{ marginRight: 5 }} />{actionLabel}</>
          : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> {actionLabel}</>
        }
      </button>
    </div>
  );
}

// ─── Individual mode ───────────────────────────────────────────────────────────
function ModeIndividual({ selectedDoctor, doctors, clinics, readOnly, interim = false }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [generating, setGenerating]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [reportData, setReportData]     = useState(null);
  const [error, setError]               = useState('');

  // Reset report when doctor changes
  useEffect(() => {
    setReportData(null);
    setError('');
  }, [selectedDoctor?.id]); // eslint-disable-line

  const handleGenerate = async () => {
    if (!selectedDoctor) { toast.error('Выберите врача из списка слева'); return; }
    if (!uploadedFile)   { toast.error('Загрузите файл Excel'); return; }
    if (!dateFrom || !dateTo) { toast.error('Укажите период (дата с и по) для корректного расчёта', { duration: 5000 }); return; }
    setGenerating(true); setError(''); setReportData(null);
    try {
      const rows   = await parseExcelFile(uploadedFile);
      const colMap = rbMapNewColumns(rows);
      const [rbRes, pbRes, execSettings, savedAsstRes] = await Promise.all([
        rbApi.getByDoctor(selectedDoctor.id),
        psbApi.getByDoctor(selectedDoctor.id),
        loadExecSettings(selectedDoctor.id),
        (dateFrom || dateTo) ? salaryRecords.getAssistanceIncome({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }) : Promise.resolve({ data: [] }),
      ]);
      const referralBonuses    = Array.isArray(rbRes.data) ? rbRes.data : [];
      const performedDbBonuses = Array.isArray(pbRes.data)  ? pbRes.data  : [];
      const savedAssistanceIncome = Array.isArray(savedAsstRes.data) ? savedAsstRes.data : [];
      if (!colMap.cabinet && performedDbBonuses.some(b => b.cabinetId && b.cabinetId !== '')) {
        toast.error('В файле не найдена колонка «Кабинет» — бонусы по кабинетам не могут быть применены.', { duration: 7000 });
      }
      const result = await buildReport({
        rows, colMap, doctor: selectedDoctor,
        referralBonuses, performedDbBonuses, execSettings,
        dateFrom: dateFrom || null, dateTo: dateTo || null,
        allDoctors: doctors, savedAssistanceIncome,
        interim,
      });
      setReportData({ ...result, doctor: selectedDoctor, dateFrom, dateTo });
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
                style={{ padding: '7px 18px', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, background: '#2563eb', color: '#fff', cursor: 'pointer' }}
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
        uploadedFile={uploadedFile}
        onFileSelect={f => { setUploadedFile(f); setReportData(null); setError(''); }}
        onFileClear={() => { setUploadedFile(null); setReportData(null); }}
        actionDisabled={!selectedDoctor || !uploadedFile || generating}
        actionLabel={generating ? 'Формирование...' : 'Сформировать'}
        actionSpinner={generating}
        onAction={handleGenerate}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {!selectedDoctor && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>
            Выберите врача из списка слева
          </div>
        )}
        {selectedDoctor && !reportData && !error && !generating && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>
            Загрузите файл Excel и нажмите «Сформировать»
          </div>
        )}
        {error && <div className="rb-alert rb-alert-danger" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
        {reportData && (
          <div className="rb-report">
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              <button className="rb-btn rb-btn-success rb-btn-sm" onClick={handleExport} disabled={exporting}>
                {exporting
                  ? <><span className="rb-spinner" style={{ marginRight: 5 }} />Экспорт...</>
                  : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="15" x2="12" y2="9"/><polyline points="9 12 12 9 15 12"/></svg> Скачать Excel</>
                }
              </button>
              {!readOnly && (
                <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={handleSaveToHistory} disabled={saving}>
                  {saving
                    ? <><span className="rb-spinner" style={{ marginRight: 5 }} />Сохранение...</>
                    : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Сохранить в историю</>
                  }
                </button>
              )}
            </div>
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
                    {reportData.periodLabel && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>{reportData.periodLabel}</div>}
                  </div>
                  <SalaryBlock salary={salary} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bulk mode ─────────────────────────────────────────────────────────────────
// Doctor selection is handled by the shared rb-panel (bulkSelectedIds from props)
function ModeBulk({ doctors, bulkSelectedIds, readOnly, interim = false }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [generating, setGenerating]     = useState(false);
  const [savingAll, setSavingAll]       = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [dupConfirm, setDupConfirm]     = useState(null);

  const [progress, setProgress]       = useState({ current: 0, total: 0, currentName: '' });
  const [bulkResults, setBulkResults] = useState([]);
  const [expanded, setExpanded]       = useState(new Set());

  const handleBulkGenerate = async () => {
    if (bulkSelectedIds.size === 0) { toast.error('Выберите врачей в списке слева'); return; }
    if (!uploadedFile)              { toast.error('Загрузите файл Excel'); return; }
    if (!dateFrom || !dateTo) { toast.error('Укажите период (дата с и по) для корректного расчёта', { duration: 5000 }); return; }
    setGenerating(true); setBulkResults([]); setExpanded(new Set());

    let rows, colMap;
    try {
      rows   = await parseExcelFile(uploadedFile);
      colMap = rbMapNewColumns(rows);
    } catch (e) {
      toast.error('Ошибка чтения файла: ' + e.message);
      setGenerating(false); return;
    }

    const doctorList = doctors.filter(d => bulkSelectedIds.has(d.id));
    const results = [];

    // Fetch saved assistance income once for the whole bulk run
    let savedAssistanceIncome = [];
    if (dateFrom || dateTo) {
      try {
        const savedAsstRes = await salaryRecords.getAssistanceIncome({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
        savedAssistanceIncome = Array.isArray(savedAsstRes.data) ? savedAsstRes.data : [];
      } catch { /* non-critical, ignore */ }
    }

    for (let i = 0; i < doctorList.length; i++) {
      const doctor = doctorList[i];
      setProgress({ current: i + 1, total: doctorList.length, currentName: doctor.name });
      try {
        const [rbRes, pbRes, execSettings] = await Promise.all([
          rbApi.getByDoctor(doctor.id),
          psbApi.getByDoctor(doctor.id),
          loadExecSettings(doctor.id),
        ]);
        const referralBonuses    = Array.isArray(rbRes.data) ? rbRes.data : [];
        const performedDbBonuses = Array.isArray(pbRes.data)  ? pbRes.data  : [];
        const result = await buildReport({
          rows, colMap, doctor,
          referralBonuses, performedDbBonuses, execSettings,
          dateFrom: dateFrom || null, dateTo: dateTo || null,
          allDoctors: doctors, savedAssistanceIncome,
          interim,
        });
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
                style={{ padding: '7px 18px', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, background: '#2563eb', color: '#fff', cursor: 'pointer' }}
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
        uploadedFile={uploadedFile}
        onFileSelect={f => { setUploadedFile(f); setBulkResults([]); }}
        onFileClear={() => { setUploadedFile(null); setBulkResults([]); }}
        actionDisabled={generating || bulkSelectedIds.size === 0 || !uploadedFile}
        actionLabel={generating ? `${progress.current}/${progress.total}...` : `Сформировать (${bulkSelectedIds.size})`}
        actionSpinner={generating}
        onAction={handleBulkGenerate}
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
        {!generating && bulkResults.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>
            {bulkSelectedIds.size === 0
              ? 'Отметьте врачей в списке слева (галочками), загрузите файл Excel и нажмите «Сформировать»'
              : `Выбрано ${bulkSelectedIds.size} врачей. Загрузите файл Excel и нажмите «Сформировать»`
            }
          </div>
        )}

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
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="rb-btn rb-btn-success rb-btn-sm" onClick={handleExportAll} disabled={exporting || !successResults.length}>
                  {exporting ? <><span className="rb-spinner" style={{ marginRight: 4 }} />Экспорт...</> : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="15" x2="12" y2="9"/><polyline points="9 12 12 9 15 12"/></svg> Скачать Excel</>}
                </button>
                {!readOnly && (
                  <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={handleSaveAll} disabled={savingAll || !successResults.length}>
                    {savingAll ? <><span className="rb-spinner" style={{ marginRight: 4 }} />Сохранение...</> : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Сохранить в историю</>}
                  </button>
                )}
              </div>
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
  );
}

// ─── Main StepReport ───────────────────────────────────────────────────────────
const REPORT_MODES = [
  ['individual',         'Индивидуальный'],
  ['bulk',               'Сводный'],
  ['individual_interim', 'Инд. промежуточный'],
  ['bulk_interim',       'Своднй промежуточный'],
];

export default function StepReport({ selectedDoctor, doctors, clinics, reportMode, setReportMode, bulkSelectedIds, readOnly }) {
  const isBulk    = reportMode === 'bulk' || reportMode === 'bulk_interim';
  const isInterim = reportMode === 'individual_interim' || reportMode === 'bulk_interim';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--rb-border)', padding: '0 16px', background: '#fff', flexShrink: 0, flexWrap: 'wrap' }}>
        {REPORT_MODES.map(([key, label]) => {
          const isInterimTab = key.includes('interim');
          return (
            <button
              key={key}
              onClick={() => setReportMode(key)}
              style={{
                padding: '10px 16px',
                background: 'none',
                border: 'none',
                borderBottom: reportMode === key ? `2px solid ${isInterimTab ? '#d97706' : 'var(--rb-primary)'}` : '2px solid transparent',
                marginBottom: -2,
                cursor: 'pointer',
                fontWeight: reportMode === key ? 700 : 400,
                color: reportMode === key ? (isInterimTab ? '#d97706' : 'var(--rb-primary)') : 'var(--rb-text-secondary)',
                fontSize: 13,
                transition: 'all 0.15s',
              }}
            >
              {label}
              {isInterimTab && <span style={{ marginLeft: 5, fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>пром.</span>}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {!isBulk
          ? <ModeIndividual selectedDoctor={selectedDoctor} doctors={doctors} clinics={clinics} readOnly={readOnly} interim={isInterim} />
          : <ModeBulk doctors={doctors} bulkSelectedIds={bulkSelectedIds} readOnly={readOnly} interim={isInterim} />
        }
      </div>
    </div>
  );
}
