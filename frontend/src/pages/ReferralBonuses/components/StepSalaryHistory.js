import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTabSlider } from '../utils/useTabSlider';
import toast from 'react-hot-toast';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Bar, Legend,
} from 'recharts';
import { salaryRecords, cashPayments as cashPaymentsApi, tabelRecords as tabelApi } from '../../../services/api';
import { buildSingleWorkbook, workbookToBase64 } from '../utils/reportExport';
import { downloadTabelExcel } from '../utils/tabelExport';
import TabelTable, { pad2, SigBlock } from './TabelTable';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
import SalaryBlock from './SalaryBlockRenderer';

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const COLOR_A = '#007AFF';
const COLOR_B = '#dc2626';

function histShortLabel(rec) {
  if (rec.dateFrom) {
    const d = new Date(rec.dateFrom);
    if (!isNaN(d)) return MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
  }
  const raw = rec.periodLabel || rec.dateFrom || '';
  const m = raw.match(/(\d{4})-(\d{2})/);
  if (m) return MONTHS[parseInt(m[2]) - 1] + " '" + m[1].slice(2);
  return raw.slice(0, 7) || '?';
}

function getRecordYear(rec) {
  const d = rec.dateFrom || rec.dateTo || rec.createdAt;
  return d ? new Date(d).getFullYear() : null;
}

function getRecordFinalSalary(rec) {
  const reps = (rec.reportData && rec.reportData.clinicReports) || [];
  return reps.reduce((s, cr) => s + parseFloat((cr.salary || {}).finalSalary || 0), 0);
}

function histSortKey(rec) {
  if (rec.dateFrom) { const d = new Date(rec.dateFrom); if (!isNaN(d)) return d.getTime(); }
  return 0;
}

// ─── Salary card ──────────────────────────────────────────────────────────────

function EditHistoryBadge({ editHistory }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  if (!editHistory || editHistory.length === 0) return null;
  const FIELD_LABELS = { amount: 'Сумма', note: 'Примечание', financistName: 'Выдал' };
  const fmtVal = (field, val) => {
    if (val == null || val === '') return '—';
    if (field === 'amount') return parseFloat(val).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽';
    return String(val);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', position: 'relative', verticalAlign: 'middle' }}>
      <span
        onClick={e => { e.stopPropagation(); setPos({ x: e.clientX, y: e.clientY }); setOpen(o => !o); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 15, height: 15, borderRadius: '50%', background: open ? '#fde047' : '#fef9c3',
          border: `1px solid ${open ? '#ca8a04' : '#fde047'}`,
          color: '#b45309', fontSize: 9, fontWeight: 700, cursor: 'pointer', lineHeight: 1, flexShrink: 0,
        }}
      >✎</span>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', left: pos.x + 14, top: pos.y - 10, zIndex: 9999,
            background: '#fff', color: '#1e293b', borderRadius: 10, width: 360,
            boxShadow: '0 4px 6px -1px rgba(0,0,0,.08), 0 12px 32px -4px rgba(0,0,0,.18)',
            border: '1px solid #e2e8f0', overflow: 'hidden',
          }}>
            {/* header */}
            <div style={{ padding: '9px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  История изменений · {editHistory.length}
                </span>
              </div>
              <span onClick={() => setOpen(false)} style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</span>
            </div>
            {/* entries */}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {editHistory.map((entry, i) => (
                <div key={i} style={{ padding: '12px 14px', borderBottom: i < editHistory.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, borderRadius: '50%', background: '#eff6ff',
                      color: '#3b82f6', fontSize: 10, fontWeight: 800, flexShrink: 0,
                    }}>
                      {(entry.editedBy || '?').charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', lineHeight: 1.2 }}>{entry.editedBy || '?'}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.2 }}>
                        {entry.editedAt ? new Date(entry.editedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                  </div>
                  {Object.entries(entry.changes || {}).map(([field, { from, to }]) => (
                    <div key={field} style={{ marginBottom: 6, background: '#f8fafc', borderRadius: 6, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                      <div style={{ padding: '4px 10px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        {FIELD_LABELS[field] || field}
                      </div>
                      <div style={{ padding: '6px 10px' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', flexShrink: 0, width: 12 }}>−</span>
                          <span style={{ fontSize: 12, color: '#ef4444', fontFamily: 'monospace', wordBreak: 'break-all' }}>{fmtVal(field, from)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', flexShrink: 0, width: 12 }}>+</span>
                          <span style={{ fontSize: 12, color: '#16a34a', fontFamily: 'monospace', wordBreak: 'break-all' }}>{fmtVal(field, to)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

function HistCard({ record, clinics, onDelete, cashPayments = [], onCashPay, onCashDelete, onCashEdit }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editingPayId, setEditingPayId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editFinancistName, setEditFinancistName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (p) => {
    setEditingPayId(p.id);
    setEditAmount(parseFloat(p.amount).toFixed(2));
    setEditNote(p.note || '');
    setEditFinancistName(p.financistName || '');
  };
  const cancelEdit = () => setEditingPayId(null);
  const saveEdit = async (p) => {
    if (!onCashEdit) return;
    setEditSaving(true);
    try {
      await onCashEdit(p.id, { amount: parseFloat(editAmount), note: editNote.trim() || null, financistName: editFinancistName.trim() || null });
      setEditingPayId(null);
    } finally {
      setEditSaving(false);
    }
  };
  const finalSalary = getRecordFinalSalary(record);

  const handleDownloadExcel = async () => {
    setDownloading(true);
    try {
      const period = record.periodLabel || (record.dateFrom ? record.dateFrom.slice(0, 7) : 'no-period');
      const name = record.doctorName?.split(' ')[0] || 'salary';
      const rd = record.reportData;
      if (rd?.clinicReports?.length) {
        const wb = buildSingleWorkbook({ doctor: record.doctorName, clinicReports: rd.clinicReports }, cashPayments.length > 0 ? cashPayments : undefined);
        const base64 = await workbookToBase64(wb);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Зарплата_${name}_${period}.xlsx`);
      } else {
        const res = await salaryRecords.downloadExcel(record.id);
        downloadBlob(res.data, `Зарплата_${name}_${period}.xlsx`);
      }
    } catch {
      toast.error('Ошибка скачивания Excel');
    } finally {
      setDownloading(false);
    }
  };
  const fmtRub = v => parseFloat(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  const reps = (record.reportData && record.reportData.clinicReports) || [];

  // Cash payment totals for this record
  const cashPaidTotal = cashPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const totalRemainder = reps.reduce((s, cr) => {
    const sal = cr.salary || {};
    const extraTotal = (sal.extraPayments || []).reduce((e, ep) => e + (parseFloat(ep.amount) || 0), 0);
    return s + parseFloat(sal.finalSalary || 0) - parseFloat(sal.advance || 0) - parseFloat(sal.mainPayment || 0) - extraTotal;
  }, 0);
  const netRemainder = totalRemainder - cashPaidTotal;

  let basePay = 0, referralBonuses = 0, performedBonusTotal = 0, extrasTotal = 0, deductionsTotal = 0;
  reps.forEach(cr => {
    const s = cr.salary || {};
    basePay            += parseFloat(s.basePay || 0);
    referralBonuses    += parseFloat(s.referralBonuses || 0);
    performedBonusTotal += parseFloat(s.performedBonusTotal || 0);
    extrasTotal        += parseFloat(s.extrasTotal || 0);
    deductionsTotal    += parseFloat(s.deductionsTotal || 0);
  });

  const period    = record.periodLabel || (record.dateFrom ? record.dateFrom.slice(0, 7) : 'Без периода');
  const savedDate = record.createdAt ? new Date(record.createdAt).toLocaleDateString('ru-RU') : '';

  const hasActions = !!(onCashPay || onDelete);
  const btnW = 78;

  return (
    <div className="rb-hist-card">
      <div className="rb-hist-card-head" style={{ flexDirection: 'column', alignItems: 'stretch' }} onClick={() => setOpen(o => !o)}>
        {/* Top row: period + salary + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div className="rb-hist-card-period" style={{ flex: 1 }}>
            {period}
            {savedDate && <span style={{ marginLeft: 6 }}>от {savedDate}</span>}
          </div>
          <div className="rb-hist-card-total" style={{ marginRight: 6 }}>{fmtRub(finalSalary)}</div>
          <svg className={`rb-hist-card-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {/* Breakdown rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[
            { label: 'Оклад',        value: fmtRub(basePay),            color: null },
            { label: 'Направления',  value: fmtRub(referralBonuses),    color: null },
            { label: 'Услуги',       value: fmtRub(performedBonusTotal),color: null },
            { label: 'Надбавки',     value: fmtRub(extrasTotal),        color: null },
            { label: 'Удержания',    value: deductionsTotal > 0 ? `−${fmtRub(deductionsTotal)}` : fmtRub(0), color: deductionsTotal > 0 ? 'var(--rb-danger)' : null },
            { label: 'Выдано',       value: cashPaidTotal > 0 ? `−${fmtRub(cashPaidTotal)}` : fmtRub(0),    color: cashPaidTotal > 0 ? '#15803d' : null },
            { label: 'Остаток',      value: cashPaidTotal > 0 ? `${netRemainder < 0 ? '−' : ''}${fmtRub(Math.abs(netRemainder))}` : fmtRub(0), color: cashPaidTotal > 0 ? (netRemainder < 0 ? '#dc2626' : '#0284c7') : null },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{label}</span>
              <span style={{ flex: 1, borderBottom: '1px dotted #cbd5e1', margin: '0 5px 3px' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: color || 'var(--rb-text)', flexShrink: 0 }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Action buttons full-width below breakdown */}
        {hasActions && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
            {onCashPay && (
              <button onClick={() => onCashPay(record, netRemainder)}
                style={{ width: btnW, fontSize: 11, fontWeight: 600, padding: '6px 0', border: 'none', borderRadius: 5, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff' }}>
                Касса
              </button>
            )}
            {record.hasExcel && (
              <button onClick={handleDownloadExcel} disabled={downloading}
                style={{ width: btnW, fontSize: 11, fontWeight: 600, padding: '6px 0', border: 'none', borderRadius: 5, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff' }}>
                {downloading ? '...' : 'Скачать'}
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete(record.id)}
                style={{ width: btnW, fontSize: 11, fontWeight: 600, padding: '6px 0', border: 'none', borderRadius: 5, cursor: 'pointer', background: 'var(--rb-danger)', color: '#fff' }}>
                Удалить
              </button>
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="rb-hist-card-body open">
          {reps.map((cr, i) => {
            const clinic     = (clinics || []).find(c => String(c.id) === String(cr.clinicId));
            const clinicName = clinic ? clinic.name : (cr.clinicLabel || cr.clinicId || '');
            return (
              <div key={i} style={{ marginBottom: 12 }}>
                {clinicName && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.03em' }}>{clinicName}</div>}
                {cr.salary && <SalaryBlock salary={cr.salary} />}
              </div>
            );
          })}
          {cashPayments.length > 0 && (
            <div style={{ borderTop: '2px dashed #bbf7d0', marginTop: 8, paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Выдано из кассы</div>
              {cashPayments.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f0fdf4', flexWrap: 'wrap' }}>
                  <span style={{ width: 16, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    <EditHistoryBadge editHistory={p.editHistory} />
                  </span>
                  <span style={{ color: 'var(--rb-text-secondary)', minWidth: 120, flexShrink: 0 }}>
                    {new Date(p.issuedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {editingPayId === p.id ? (
                    <>
                      <input
                        type="number" min="0" step="0.01"
                        value={editAmount}
                        onChange={e => setEditAmount(e.target.value)}
                        style={{ width: 90, padding: '2px 6px', fontSize: 12, border: '1px solid #16a34a', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                      <input
                        type="text"
                        value={editFinancistName}
                        onChange={e => setEditFinancistName(e.target.value)}
                        placeholder="Выдал..."
                        style={{ width: 110, padding: '2px 6px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                      <input
                        type="text"
                        value={editNote}
                        onChange={e => setEditNote(e.target.value)}
                        placeholder="Примечание..."
                        style={{ flex: 1, minWidth: 80, padding: '2px 6px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                      <button onClick={() => saveEdit(p)} disabled={editSaving || !editAmount}
                        style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', background: '#16a34a', color: '#fff', opacity: editSaving ? 0.6 : 1 }}>
                        {editSaving ? '...' : 'Сохр.'}
                      </button>
                      <button onClick={cancelEdit}
                        style={{ padding: '2px 6px', fontSize: 11, border: '1px solid var(--rb-border)', borderRadius: 4, cursor: 'pointer', background: 'none', color: 'var(--rb-text-secondary)' }}>
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: 600, color: '#16a34a', flex: 1 }}>−{fmtRub(p.amount)}</span>
                      <span style={{ color: 'var(--rb-text-secondary)' }}>{p.financistName || '—'}</span>
                      {p.note && <span style={{ fontStyle: 'italic', color: 'var(--rb-text-secondary)', fontSize: 11 }}>{p.note}</span>}
                      {onCashEdit && (
                        <button onClick={() => startEdit(p)} title="Редактировать"
                          style={{ padding: '1px 5px', fontSize: 11, border: '1px solid var(--rb-border)', borderRadius: 4, cursor: 'pointer', background: 'none', color: 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center' }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                      {onCashDelete && (
                        <button onClick={() => onCashDelete(p.id)} title="Удалить"
                          style={{ padding: '1px 5px', fontSize: 11, border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', background: 'none', color: '#ef4444', display: 'flex', alignItems: 'center' }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--rb-text-secondary)' }}>Итого к выплате: <strong>{fmtRub(totalRemainder)}</strong></span>
                <span style={{ color: '#15803d' }}>Выдано: <strong>−{fmtRub(cashPaidTotal)}</strong></span>
                <span style={{ color: netRemainder < 0 ? 'var(--rb-danger)' : 'var(--rb-text)', fontWeight: 600 }}>
                  Остаток: {netRemainder < 0 ? '−' : ''}{fmtRub(Math.abs(netRemainder))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.filter((p, i, arr) => p.value != null && arr.findIndex(x => x.name === p.name) === i).map((p, i) => {
        const isSingle = p.name === 'value';
        return (
          <div key={i} style={{ color: p.stroke || p.color, marginBottom: 2 }}>
            {isSingle ? '' : `${p.name}: `}{p.value.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
          </div>
        );
      })}
    </div>
  );
}

// ─── Compare view ─────────────────────────────────────────────────────────────

function CompareView({ pinnedForCompare, doctors, clinics, cmpRecords, cmpLoading, activeYear, setActiveYear, activeQuarter, setActiveQuarter }) {
  const fmtRub = v => parseFloat(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';

  const docA = doctors.find(d => d.id === pinnedForCompare[0]);
  const docB = doctors.find(d => d.id === pinnedForCompare[1]);
  const recsA = cmpRecords[pinnedForCompare[0]] || [];
  const recsB = cmpRecords[pinnedForCompare[1]] || [];
  const isLoading = cmpLoading[pinnedForCompare[0]] || cmpLoading[pinnedForCompare[1]];

  // Shared year filter
  const allRecs = [...recsA, ...recsB];
  const years = [...new Set(allRecs.map(getRecordYear).filter(Boolean))].sort((a, b) => a - b);
  const multiYear = years.length > 1;
  const currentYear = new Date().getFullYear();
  const defaultYear = years.includes(currentYear) ? currentYear : (years[years.length - 1] || currentYear);
  const displayYear = activeYear || (multiYear ? defaultYear : years[0]);

  const filterYear = recs => recs.filter(r => getRecordYear(r) === displayYear);
  const yearA = filterYear(recsA);
  const yearB = filterYear(recsB);

  // Shared quarter filter
  const allYear = [...yearA, ...yearB];
  const activeQuarters = new Set(allYear.map(r => {
    const m = r.dateFrom ? new Date(r.dateFrom).getMonth() : -1;
    return m >= 0 ? Math.floor(m / 3) + 1 : null;
  }).filter(Boolean));
  const showQuarterTabs = activeQuarters.size > 1;

  const filterQ = recs => (activeQuarter
    ? recs.filter(r => { const m = r.dateFrom ? new Date(r.dateFrom).getMonth() : -1; return m >= 0 && Math.floor(m / 3) + 1 === activeQuarter; })
    : recs).sort((a, b) => histSortKey(a) - histSortKey(b));

  const filtA = filterQ(yearA);
  const filtB = filterQ(yearB);

  // Stats
  const salA = filtA.map(getRecordFinalSalary);
  const salB = filtB.map(getRecordFinalSalary);
  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const max = arr => arr.length ? Math.max(...arr) : 0;
  const min = arr => arr.length ? Math.min(...arr) : 0;

  // Chart data: merge labels from both doctors, sorted chronologically
  const toChartMap = (recs, sals) => Object.fromEntries(recs.map((r, i) => [histShortLabel(r), sals[i]]));
  const mapA = toChartMap(filtA, salA);
  const mapB = toChartMap(filtB, salB);
  const orderedLabels = [...new Set([...filtA, ...filtB].sort((a, b) => histSortKey(a) - histSortKey(b)).map(histShortLabel))];
  const nameA = docA?.name || 'Врач А';
  const nameB = docB?.name || 'Врач Б';
  const chartData = orderedLabels.map(label => ({
    label,
    [nameA]: mapA[label] ?? null,
    [nameB]: mapB[label] ?? null,
  }));

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Загрузка данных для сравнения...</div>;
  }

  const Dot = ({ letter, color }) => (
    <span style={{ width: 20, height: 20, borderRadius: '50%', background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
      {letter}
    </span>
  );

  return (
    <>
      {/* Compare header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--rb-border)', background: 'linear-gradient(135deg, #eff6ff, #fff7ed)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-evenly' }}>
          {[{ doc: docA, id: pinnedForCompare[0], letter: 'А', color: COLOR_A }, { doc: docB, id: pinnedForCompare[1], letter: 'Б', color: COLOR_B }].map(({ doc, id, letter, color }) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Dot letter={letter} color={color} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{doc?.name || id}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Year + Quarter tabs combined */}
      {(multiYear || showQuarterTabs) && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 20px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)' }}>
          {multiYear && (
            <div style={{ display: 'flex', flex: 1 }}>
              {years.map(y => (
                <button key={y} onClick={() => { setActiveYear(y); setActiveQuarter(null); }}
                  style={{ flex: 1, textAlign: 'center', padding: '5px 8px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', color: displayYear === y ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', background: displayYear === y ? '#eff6ff' : 'none', transition: 'all .15s' }}>
                  {y}
                </button>
              ))}
            </div>
          )}
          {showQuarterTabs && (
            <div className="rb-quarter-roll" key={displayYear}>
              {multiYear && <span style={{ width: 1, height: 20, background: 'var(--rb-border)', margin: '0 10px', flexShrink: 0 }} />}
              <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginRight: 4, fontWeight: 500, whiteSpace: 'nowrap' }}>Квартал:</span>
              {[1, 2, 3, 4].map(q => (
                <button key={q} onClick={() => setActiveQuarter(activeQuarter === q ? null : q)} disabled={!activeQuarters.has(q)}
                  style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, background: activeQuarter === q ? '#eff6ff' : 'none', border: activeQuarter === q ? '1px solid var(--rb-primary)' : '1px solid transparent', borderRadius: 4, cursor: activeQuarters.has(q) ? 'pointer' : 'default', color: activeQuarter === q ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', opacity: activeQuarters.has(q) ? 1 : 0.35, transition: 'all .15s' }}>
                  {['I', 'II', 'III', 'IV'][q - 1]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats comparison table */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rb-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid var(--rb-border)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontWeight: 600, color: 'var(--rb-text)', fontSize: 12, padding: '7px 10px', border: '1px solid var(--rb-border)', background: '#f1f5f9' }}>Метрика</th>
              {[{ letter: 'А', color: COLOR_A, name: nameA }, { letter: 'Б', color: COLOR_B, name: nameB }].map(({ letter, color, name }) => (
                <th key={letter} style={{ textAlign: 'center', padding: '7px 10px', width: '36%', border: '1px solid var(--rb-border)', background: '#f1f5f9' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color }}>
                    <Dot letter={letter} color={color} />
                    {name.split(' ')[0]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Среднее', a: avg(salA), b: avg(salB) },
              { label: 'Максимум', a: max(salA), b: max(salB) },
              { label: 'Минимум',  a: min(salA), b: min(salB) },
            ].map((row, i) => {
              const aWins = row.a > 0 && row.a > row.b;
              const bWins = row.b > 0 && row.b > row.a;
              return (
                <tr key={i} style={{ background: '#fff' }}>
                  <td style={{ padding: '7px 10px', fontSize: 12, color: 'var(--rb-text)', fontWeight: 500, border: '1px solid var(--rb-border)' }}>{row.label}</td>
                  <td style={{ textAlign: 'center', padding: '7px 10px', fontSize: 13, fontWeight: 700, color: aWins ? COLOR_A : 'var(--rb-text)', border: '1px solid var(--rb-border)' }}>
                    {fmtRub(row.a)}{aWins ? ' ▲' : ''}
                  </td>
                  <td style={{ textAlign: 'center', padding: '7px 10px', fontSize: 13, fontWeight: 700, color: bWins ? COLOR_B : 'var(--rb-text)', border: '1px solid var(--rb-border)' }}>
                    {fmtRub(row.b)}{bWins ? ' ▲' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Comparison chart */}
      {chartData.length >= 1 && (
        <div className="rb-hist-chart-wrap">
          <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--rb-border)', padding: '8px 0', position: 'relative' }}>
            <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#000', paddingTop: 6, paddingBottom: 2 }}>Динамика заработной платы</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }} barCategoryGap="40%" barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#000' }} axisLine={{ stroke: '#000' }} tickLine={{ stroke: '#000' }} />
                <YAxis tick={{ fontSize: 11, fill: '#000' }} axisLine={{ stroke: '#000' }} tickLine={{ stroke: '#000' }} tickFormatter={v => v.toLocaleString('ru-RU')} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Bar dataKey={nameA} fill={COLOR_A} fillOpacity={0.25} radius={[4, 4, 0, 0]} legendType="none" />
                <Bar dataKey={nameB} fill={COLOR_B} fillOpacity={0.25} radius={[4, 4, 0, 0]} legendType="none" />
                <Line type="monotone" dataKey={nameA} stroke={COLOR_A} strokeWidth={2.5} dot={{ r: 4, fill: COLOR_A, strokeWidth: 2, stroke: '#fff' }} connectNulls={false} />
                <Line type="monotone" dataKey={nameB} stroke={COLOR_B} strokeWidth={2.5} dot={{ r: 4, fill: COLOR_B, strokeWidth: 2, stroke: '#fff' }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-doctor record lists */}
      {(filtA.length > 0 || filtB.length > 0) ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '12px 16px' }}>
          {[
            { doc: docA, recs: filtA, color: COLOR_A, letter: 'А' },
            { doc: docB, recs: filtB, color: COLOR_B, letter: 'Б' },
          ].map(({ doc, recs, color, letter }) => (
            <div key={letter}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, fontWeight: 600, color }}>
                <Dot letter={letter} color={color} />
                {doc?.name || '—'}
              </div>
              {recs.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', padding: '10px 0' }}>Нет записей за период</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{recs.map(rec => <HistCard key={rec.id} record={rec} clinics={clinics} onDelete={null} />)}</div>
              }
            </div>
          ))}
        </div>
      ) : (
        <div className="rb-hist-empty" style={{ padding: '40px 20px' }}>Нет записей за выбранный период</div>
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StepSalaryHistory({ selectedDoctor, clinics, doctors = [], pinnedForCompare = [], readOnly, onArchiveTabelEdit }) {
  const [records, setRecords]             = useState([]);
  const [loading, setLoading]             = useState(false);
  const [activeYear, setActiveYear]       = useState(null);
  const [activeQuarter, setActiveQuarter] = useState(null);
  const [cmpRecords, setCmpRecords]       = useState({});
  const [cmpLoading, setCmpLoading]       = useState({});

  // Cash payments
  const [viewMode, setViewMode]           = useState('history'); // 'history' | 'kassa' | 'tabel'
  const { wrapRef: salaryTabRef, sliderEl: salarySlider } = useTabSlider(viewMode);
  const [cashPaymentsMap, setCashPaymentsMap] = useState({}); // { [salaryRecordId]: [...] }
  const [kassaData, setKassaData]         = useState([]);
  const [kassaLoading, setKassaLoading]   = useState(false);
  const [cashModal, setCashModal]         = useState(null); // { record, defaultAmount }
  const [cashAmount, setCashAmount]       = useState('');
  const [cashNote, setCashNote]           = useState('');
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [kassaSearch, setKassaSearch]     = useState('');
  const [kassaSortDir, setKassaSortDir]   = useState('desc'); // 'asc' | 'desc'
  const [kassaPage, setKassaPage]         = useState(1);
  const [kassaEditId, setKassaEditId]     = useState(null);
  const [kassaEditAmount, setKassaEditAmount] = useState('');
  const [kassaEditNote, setKassaEditNote] = useState('');
  const [kassaEditFinancistName, setKassaEditFinancistName] = useState('');
  const [kassaEditSaving, setKassaEditSaving] = useState(false);

  // Tabel archive
  const [tabelList,        setTabelList]        = useState([]);
  const [tabelLoading,     setTabelLoading]     = useState(false);
  const [tabelOpenId,      setTabelOpenId]      = useState(null);
  const [tabelDetail,      setTabelDetail]      = useState(null);
  const [tabelDetLoading,  setTabelDetLoading]  = useState(false);
  const [tabelSearch,      setTabelSearch]      = useState('');
  const [tabelEditKey,     setTabelEditKey]      = useState(0);
  const [tabelSaving,      setTabelSaving]      = useState(false);
  const [tabelPage,        setTabelPage]        = useState(1);
  const [tabelFilterMonth, setTabelFilterMonth] = useState('');
  const [tabelFilterYear,  setTabelFilterYear]  = useState('');
  const [tabelFilterSub,   setTabelFilterSub]   = useState('');
  const tabelEditRef = useRef(null);

  const isCompareMode = pinnedForCompare.length === 2;

  const loadRecords = useCallback(async () => {
    if (!selectedDoctor) return;
    setLoading(true);
    try {
      const res = await salaryRecords.getByDoctor(selectedDoctor.id);
      setRecords(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDoctor?.id]); // eslint-disable-line

  const loadCashPayments = useCallback(async (misUserId) => {
    if (!misUserId) return;
    try {
      const res = await cashPaymentsApi.getByMisUser(misUserId);
      const map = {};
      (Array.isArray(res.data) ? res.data : []).forEach(p => {
        if (!map[p.salaryRecordId]) map[p.salaryRecordId] = [];
        map[p.salaryRecordId].push(p);
      });
      setCashPaymentsMap(map);
    } catch { /* ignore */ }
  }, []);

  const loadKassa = useCallback(async () => {
    setKassaLoading(true);
    try {
      const res = await cashPaymentsApi.getAll();
      setKassaData(Array.isArray(res.data) ? res.data : []);
    } catch { setKassaData([]); }
    finally { setKassaLoading(false); }
  }, []);

  const loadTabelList = useCallback(async () => {
    setTabelLoading(true);
    try {
      const res = await tabelApi.list();
      setTabelList(Array.isArray(res.data) ? res.data : []);
    } catch { setTabelList([]); }
    finally { setTabelLoading(false); }
  }, []);

  const openTabelBatch = async (id) => {
    setTabelOpenId(id);
    setTabelDetail(null);
    setTabelEditKey(k => k + 1);
    setTabelDetLoading(true);
    onArchiveTabelEdit?.(true);
    try {
      const res = await tabelApi.get(id);
      setTabelDetail(res.data);
    } catch { toast.error('Не удалось загрузить запись'); }
    finally { setTabelDetLoading(false); }
  };

  const closeTabelBatch = () => {
    setTabelOpenId(null);
    setTabelDetail(null);
    onArchiveTabelEdit?.(false);
  };

  const handleDeleteTabel = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Удалить этот табель из архива?')) return;
    try {
      await tabelApi.delete(id);
      setTabelList(prev => prev.filter(r => r.id !== id));
      if (tabelOpenId === id) { closeTabelBatch(); }
      toast.success('Удалено');
    } catch { toast.error('Ошибка при удалении'); }
  };

  const handleTabelExcel = async (record, doctorFilter) => {
    try {
      const fname = doctorFilter
        ? `Табель_${record.year}_${String(record.month).padStart(2,'0')}_${doctorFilter.doctorName || doctorFilter.misUserId}.xlsx`
        : `Табель_${record.year}_${String(record.month).padStart(2,'0')}.xlsx`;
      await downloadTabelExcel(record, doctorFilter ? [doctorFilter.misUserId] : null, fname);
    } catch { toast.error('Ошибка при генерации Excel'); }
  };

  const handleOpenCashModal = useCallback((record, netRemainder) => {
    setCashModal({ record });
    setCashAmount(netRemainder > 0 ? parseFloat(netRemainder).toFixed(2) : '');
    setCashNote('');
  }, []);

  const handleCashSubmit = async () => {
    if (!cashModal || !cashAmount) return;
    setCashSubmitting(true);
    try {
      const res = await cashPaymentsApi.create({
        salaryRecordId: cashModal.record.id,
        amount: parseFloat(cashAmount),
        note: cashNote.trim() || undefined,
      });
      const payment = res.data;
      setCashPaymentsMap(prev => ({
        ...prev,
        [cashModal.record.id]: [payment, ...(prev[cashModal.record.id] || [])],
      }));
      toast.success('Выдача зафиксирована');
      setCashModal(null);
    } catch {
      toast.error('Ошибка при сохранении');
    } finally {
      setCashSubmitting(false);
    }
  };

  useEffect(() => {
    setActiveYear(null);
    setActiveQuarter(null);
    setRecords([]);
    setCashPaymentsMap({});
    if (selectedDoctor && !isCompareMode) {
      loadRecords();
      loadCashPayments(selectedDoctor.id);
    }
  }, [selectedDoctor?.id, isCompareMode]); // eslint-disable-line

  // Load records for pinned doctors when compare mode activates
  useEffect(() => {
    if (!isCompareMode) return;
    pinnedForCompare.forEach(id => {
      setCmpLoading(prev => ({ ...prev, [id]: true }));
      salaryRecords.getByDoctor(id)
        .then(res => setCmpRecords(prev => ({ ...prev, [id]: Array.isArray(res.data) ? res.data : [] })))
        .catch(() => setCmpRecords(prev => ({ ...prev, [id]: [] })))
        .finally(() => setCmpLoading(prev => ({ ...prev, [id]: false })));
    });
    setActiveYear(null);
    setActiveQuarter(null);
  }, [pinnedForCompare.join(','), isCompareMode]); // eslint-disable-line

  useEffect(() => { if (!isCompareMode) setActiveQuarter(null); }, [activeYear]); // eslint-disable-line

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить эту запись из истории?')) return;
    try {
      await salaryRecords.delete(id);
      toast.success('Запись удалена');
      await loadRecords();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleCashDelete = async (paymentId) => {
    if (!window.confirm('Удалить эту выдачу из кассы?')) return;
    try {
      await cashPaymentsApi.delete(paymentId);
      // Update cashPaymentsMap
      setCashPaymentsMap(prev => {
        const next = {};
        for (const [k, arr] of Object.entries(prev)) {
          next[k] = arr.filter(p => p.id !== paymentId);
        }
        return next;
      });
      // Also update kassaData if loaded
      setKassaData(prev => prev.filter(p => p.id !== paymentId));
      toast.success('Запись удалена');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleCashEdit = async (paymentId, data) => {
    try {
      const res = await cashPaymentsApi.update(paymentId, data);
      const updated = res.data;
      // Update cashPaymentsMap
      setCashPaymentsMap(prev => {
        const next = {};
        for (const [k, arr] of Object.entries(prev)) {
          next[k] = arr.map(p => p.id === paymentId ? updated : p);
        }
        return next;
      });
      // Also update kassaData if loaded
      setKassaData(prev => prev.map(p => p.id === paymentId ? updated : p));
      toast.success('Выдача обновлена');
    } catch {
      toast.error('Ошибка обновления');
      throw new Error('failed');
    }
  };

  const fmtRub = v => parseFloat(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';

  const years = [...new Set(records.map(getRecordYear).filter(Boolean))].sort((a, b) => a - b);
  const multiYear = years.length > 1;
  const currentYear = new Date().getFullYear();
  const defaultYear = years.includes(currentYear) ? currentYear : years[years.length - 1];
  const displayYear = activeYear || (multiYear ? defaultYear : years[0]);

  const yearRecords = records.filter(r => getRecordYear(r) === displayYear);
  const activeQuarters = new Set(yearRecords.map(r => {
    const m = r.dateFrom ? new Date(r.dateFrom).getMonth() : -1;
    return m >= 0 ? Math.floor(m / 3) + 1 : null;
  }).filter(Boolean));
  const showQuarterTabs = activeQuarters.size > 1;

  const filteredRecords = (activeQuarter
    ? yearRecords.filter(r => { const m = r.dateFrom ? new Date(r.dateFrom).getMonth() : -1; return m >= 0 && Math.floor(m / 3) + 1 === activeQuarter; })
    : yearRecords
  ).sort((a, b) => histSortKey(a) - histSortKey(b));

  const salaries  = filteredRecords.map(getRecordFinalSalary);
  const avgSalary = salaries.length ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;
  const maxSalary = salaries.length ? Math.max(...salaries) : 0;
  const minSalary = salaries.length ? Math.min(...salaries) : 0;
  const cnt       = filteredRecords.length;

  const chartData = filteredRecords.map((rec, i) => ({
    label: histShortLabel(rec),
    value: parseFloat((salaries[i] || 0).toFixed(2)),
  }));

  const viewToggle = (
    <div className="rb-clinic-tab-wrap" style={{ margin: '6px 12px', flexShrink: 0 }} ref={salaryTabRef}>
      {salarySlider}
      {[
        { key: 'history', label: 'Архив' },
        { key: 'kassa',   label: 'Касса' },
        { key: 'tabel',   label: 'Табели' },
      ].map(({ key, label }) => (
        <button key={key}
          className={`rb-clinic-tab${viewMode === key ? ' active' : ''}`}
          onClick={() => {
            setViewMode(key);
            if (key === 'kassa') loadKassa();
            if (key === 'tabel') loadTabelList();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const startKassaEdit = (p) => { setKassaEditId(p.id); setKassaEditAmount(parseFloat(p.amount).toFixed(2)); setKassaEditNote(p.note || ''); setKassaEditFinancistName(p.financistName || ''); };
  const cancelKassaEdit = () => setKassaEditId(null);
  const saveKassaEdit = async (p) => {
    setKassaEditSaving(true);
    try {
      await handleCashEdit(p.id, { amount: parseFloat(kassaEditAmount), note: kassaEditNote.trim() || null, financistName: kassaEditFinancistName.trim() || null });
      setKassaEditId(null);
    } catch { /* error already toasted */ } finally { setKassaEditSaving(false); }
  };

  // ── Табели view ───────────────────────────────────────────────────────────
  if (viewMode === 'tabel') {
    const MONTH_NAMES_T = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const filterMisId = selectedDoctor ? (selectedDoctor.misUserId || selectedDoctor.id) : null;

    // ── Full document edit view (when a batch is open) ──────────────────────
    if (tabelOpenId) {
      const doc = tabelDetail;
      const isLoading = tabelDetLoading || !doc;

      // If a doctor is selected in the panel, show only their row
      const visibleDocRows = doc
        ? (doc.doctors || []).filter(d => !filterMisId || d.misUserId === filterMisId)
        : [];

      const archiveDoctors = visibleDocRows.map(d => {
        const matched = doctors.find(dr => (dr.misUserId || dr.id) === d.misUserId);
        return {
          id: d.misUserId,
          name: d.doctorName || d.misUserId,
          roles: matched?.roles || [],
          professions: matched?.professions || [],
        };
      });

      const archiveEntries = {};
      const archivePayData = {};
      if (doc) {
        visibleDocRows.forEach(d => {
          archiveEntries[d.misUserId] = d.entries || {};
          archivePayData[d.misUserId] = d.payData || {};
        });
      }

      const lastDay    = doc ? new Date(doc.year, doc.month, 0).getDate() : 31;
      const periodFrom = doc ? `01.${pad2(doc.month)}.${doc.year}` : '';
      const periodTo   = doc ? `${pad2(lastDay)}.${pad2(doc.month)}.${doc.year}` : '';
      const docDate    = doc && doc.createdAt
        ? new Date(doc.createdAt).toLocaleDateString('ru-RU')
        : '';

      const handleSaveArchive = async () => {
        if (!tabelEditRef.current || !doc) return;
        const { entries, payData } = tabelEditRef.current.getSnapshot();
        setTabelSaving(true);
        try {
          // In filtered mode: merge edited rows back into the full doctor list
          const doctorsPayload = filterMisId
            ? (doc.doctors || []).map(d => d.misUserId === filterMisId
                ? { misUserId: d.misUserId, doctorName: d.doctorName || d.misUserId, entries: entries[d.misUserId] || {}, payData: payData[d.misUserId] || {} }
                : { misUserId: d.misUserId, doctorName: d.doctorName || d.misUserId, entries: d.entries || {}, payData: d.payData || {} }
              )
            : archiveDoctors.map(d => ({
                misUserId:   d.id,
                doctorName:  d.name,
                roles:       d.roles || [],
                professions: d.professions || [],
                entries:     entries[d.id]  || {},
                payData:     payData[d.id]  || {},
              }));
          const res = await tabelApi.update(tabelOpenId, { doctors: doctorsPayload });
          setTabelDetail(res.data);
          toast.success('Табель обновлён');
        } catch {
          toast.error('Ошибка при сохранении');
        } finally {
          setTabelSaving(false);
        }
      };

      const handleDownloadArchiveExcel = async () => {
        if (!doc) return;
        const snapshot = tabelEditRef.current ? tabelEditRef.current.getSnapshot() : { entries: archiveEntries, payData: archivePayData };
        const record = {
          ...doc,
          doctors: archiveDoctors.map(d => ({
            misUserId:   d.id,
            doctorName:  d.name,
            roles:       d.roles || [],
            professions: d.professions || [],
            entries:     snapshot.entries[d.id] || {},
            payData:     snapshot.payData[d.id] || {},
          })),
        };
        const suffix = filterMisId ? (selectedDoctor?.name || filterMisId) : (doc.subdivision || 'таб');
        try {
          await downloadTabelExcel(record, filterMisId ? [filterMisId] : null, `Табель_${doc.year}_${pad2(doc.month)}_${suffix}.xlsx`);
        } catch {
          toast.error('Ошибка при генерации Excel');
        }
      };

      return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* Toolbar */}
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--rb-border)',
            display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', flexShrink: 0,
          }}>
            <button
              onClick={closeTabelBatch}
              style={{ height: 34, width: 34, flexShrink: 0, border: 'none', borderRadius: 7, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              title="Назад">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--rb-text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc ? `${doc.docNumber ? `№ ${doc.docNumber} : ` : ''}${doc.subdivision || doc.orgName || ''} за ${MONTH_NAMES_T[(doc.month || 1) - 1].toLowerCase()} ${doc.year} г.` : 'Загрузка...'}
            </span>
            {!readOnly && (
              <button className="rb-btn rb-btn-primary" onClick={handleSaveArchive}
                disabled={tabelSaving || isLoading}
                style={{ height: 32, width: 96, justifyContent: 'center', opacity: (tabelSaving || isLoading) ? 0.6 : 1 }}>
                {tabelSaving ? 'Сохр...' : 'Сохранить'}
              </button>
            )}
            <button className="rb-btn rb-btn-primary" onClick={handleDownloadArchiveExcel}
              disabled={isLoading}
              style={{ height: 32, width: 96, justifyContent: 'center', opacity: isLoading ? 0.6 : 1 }}>
              Скачать
            </button>
          </div>

          {isLoading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rb-text-secondary)' }}>
              Загрузка...
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#f1f5f9' }}>
              <div className="tabel-doc">

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 8, fontFamily: 'Times New Roman, serif', lineHeight: 1.5 }}>
                      Унифицированная форма № Т-13<br />
                      Утверждена Постановлением Госкомстата<br />
                      России от 05.01.2004 № 1
                    </div>
                    <table style={{ borderCollapse: 'collapse', marginTop: 6, marginLeft: 'auto', fontSize: 8, fontFamily: 'Times New Roman, serif' }}>
                      <tbody>
                        <tr>
                          <td style={{ border: 'none', padding: '1px 8px 1px 0', textAlign: 'right' }}></td>
                          <td style={{ border: '1px solid #000', padding: '2px 8px', textAlign: 'center' }}>Код</td>
                        </tr>
                        <tr>
                          <td style={{ border: 'none', padding: '1px 8px 1px 0', textAlign: 'right' }}>Форма по ОКУД</td>
                          <td style={{ border: '1px solid #000', padding: '2px 8px', textAlign: 'center' }}>0301008</td>
                        </tr>
                        <tr>
                          <td style={{ border: 'none', padding: '1px 8px 1px 0', textAlign: 'right' }}>по ОКПО</td>
                          <td style={{ border: '1px solid #000', padding: '2px 8px', textAlign: 'center' }}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 460 }}>
                    <div style={{ borderBottom: '1px solid #000', width: '100%', minHeight: 22, paddingBottom: 2, textAlign: 'center', fontSize: 13, fontFamily: 'Times New Roman, serif' }}>
                      {doc.orgName}
                    </div>
                    <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#000', marginTop: 2 }}>(наименование организации)</span>
                  </div>
                </div>

                <div style={{ textAlign: 'center', marginTop: 10, marginBottom: 12 }}>
                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 460 }}>
                    <div style={{ borderBottom: '1px solid #000', width: '100%', minHeight: 22, textAlign: 'center', fontSize: 13, fontFamily: 'Times New Roman, serif', paddingBottom: 2 }}>
                      {doc.subdivision}
                    </div>
                    <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#000', marginTop: 2 }}>(структурное подразделение)</span>
                  </div>
                </div>

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
                        <td>{doc.docNumber}</td>
                        <td>{docDate}</td>
                        <td>с {periodFrom}</td>
                        <td>по {periodTo}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="tabel-title">ТАБЕЛЬ УЧЁТА РАБОЧЕГО ВРЕМЕНИ</div>

                <TabelTable
                  key={tabelEditKey}
                  ref={tabelEditRef}
                  selectedDoctors={archiveDoctors}
                  year={doc.year}
                  month={doc.month}
                  readOnly={readOnly}
                  initialEntries={archiveEntries}
                  initialPayData={archivePayData}
                />

                <div style={{ marginTop: 36 }}>
                  <SigBlock name={doc.userName || ''} />
                </div>

              </div>
            </div>
          )}
        </div>
      );
    }

    // ── Batch list view ──────────────────────────────────────────────────────
    const TABEL_PAGE_SIZE = 20;

    // Unique years and subdivisions for filter dropdowns
    const tabelYears = [...new Set(tabelList.map(r => r.year).filter(Boolean))].sort((a, b) => b - a);
    const tabelSubs  = [...new Set(tabelList.map(r => r.subdivision || r.orgName || '').filter(Boolean))].sort();

    const tabelFiltered = tabelList.filter(r => {
      if (filterMisId && !(r.doctors || []).some(d => d.misUserId === filterMisId)) return false;
      if (tabelFilterYear  && String(r.year)  !== tabelFilterYear)  return false;
      if (tabelFilterMonth && String(r.month) !== tabelFilterMonth) return false;
      if (tabelFilterSub   && (r.subdivision || r.orgName || '') !== tabelFilterSub) return false;
      return !tabelSearch ||
        (r.subdivision || '').toLowerCase().includes(tabelSearch.toLowerCase()) ||
        (r.orgName     || '').toLowerCase().includes(tabelSearch.toLowerCase()) ||
        (r.doctors     || []).some(d => (d.doctorName || '').toLowerCase().includes(tabelSearch.toLowerCase()));
    });

    const tabelTotalPages = Math.max(1, Math.ceil(tabelFiltered.length / TABEL_PAGE_SIZE));
    const tabelPageSafe   = Math.min(tabelPage, tabelTotalPages);
    const tabelPageData   = tabelFiltered.slice((tabelPageSafe - 1) * TABEL_PAGE_SIZE, tabelPageSafe * TABEL_PAGE_SIZE);

    const resetTabelPage = () => setTabelPage(1);

    const selectStyle = {
      height: 34, padding: '0 8px', borderRadius: 7, border: '1px solid var(--rb-border-dark)',
      fontSize: 12, background: '#fff', color: 'var(--rb-text)', cursor: 'pointer', outline: 'none',
    };

    return (
      <>
        {viewToggle}

        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--rb-border)', background: '#fafafa', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Month */}
          <select value={tabelFilterMonth} onChange={e => { setTabelFilterMonth(e.target.value); resetTabelPage(); }} style={selectStyle}>
            <option value="">Все месяцы</option>
            {MONTH_NAMES_T.map((name, i) => (
              <option key={i + 1} value={String(i + 1)}>{name}</option>
            ))}
          </select>
          {/* Year */}
          <select value={tabelFilterYear} onChange={e => { setTabelFilterYear(e.target.value); resetTabelPage(); }} style={selectStyle}>
            <option value="">Все годы</option>
            {tabelYears.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          {/* Subdivision */}
          <select value={tabelFilterSub} onChange={e => { setTabelFilterSub(e.target.value); resetTabelPage(); }} style={{ ...selectStyle, flex: 1, minWidth: 120 }}>
            <option value="">Все подразделения</option>
            {tabelSubs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Text search */}
          <input
            type="text"
            placeholder="Поиск по ФИО врача..."
            value={tabelSearch}
            onChange={e => { setTabelSearch(e.target.value); resetTabelPage(); }}
            style={{ ...selectStyle, flex: '2 1 160px', padding: '0 10px' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {tabelLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--rb-text-secondary)' }}>Загрузка...</div>
          ) : tabelFiltered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--rb-text-secondary)', fontSize: 14 }}>
              {filterMisId && !tabelSearch
                ? `Табели для «${selectedDoctor?.name || filterMisId}» не найдены`
                : tabelSearch ? 'Ничего не найдено' : 'Архив табелей пуст'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tabelPageData.map(rec => {
                const btnStyle = { fontSize: 11, fontWeight: 600, width: 76, height: 26, padding: 0, border: 'none', borderRadius: 5, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', flexShrink: 0 };
                const title = [rec.docNumber ? `№ ${rec.docNumber}` : null, rec.subdivision || rec.orgName || null].filter(Boolean).join(' : ');
                return (
                  <div key={rec.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--rb-border)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {title || '—'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginTop: 2 }}>
                          за {MONTH_NAMES_T[(rec.month || 1) - 1].toLowerCase()} {rec.year}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => handleTabelExcel({ ...rec, doctors: rec.doctors || [] }, filterMisId ? (rec.doctors || []).find(d => d.misUserId === filterMisId) || null : null)} style={btnStyle}>
                          Скачать
                        </button>
                        {!readOnly && (
                          <button onClick={e => handleDeleteTabel(rec.id, e)} style={btnStyle}>
                            Удалить
                          </button>
                        )}
                        <button onClick={() => openTabelBatch(rec.id)} style={btnStyle}>
                          Открыть
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {tabelFiltered.length > TABEL_PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0 4px' }}>
              <button
                onClick={() => setTabelPage(p => Math.max(1, p - 1))}
                disabled={tabelPageSafe === 1}
                style={{ height: 28, width: 28, border: '1px solid var(--rb-border)', borderRadius: 6, background: '#fff', cursor: tabelPageSafe === 1 ? 'default' : 'pointer', opacity: tabelPageSafe === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', minWidth: 80, textAlign: 'center' }}>
                {tabelPageSafe} / {tabelTotalPages}
              </span>
              <button
                onClick={() => setTabelPage(p => Math.min(tabelTotalPages, p + 1))}
                disabled={tabelPageSafe === tabelTotalPages}
                style={{ height: 28, width: 28, border: '1px solid var(--rb-border)', borderRadius: 6, background: '#fff', cursor: tabelPageSafe === tabelTotalPages ? 'default' : 'pointer', opacity: tabelPageSafe === tabelTotalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          )}
        </div>
      </>
    );
  }


  // ── Касса view ────────────────────────────────────────────────────────────
  if (viewMode === 'kassa') {
    const kassaFiltered = kassaData
      .filter(p => !kassaSearch || p.doctorName?.toLowerCase().includes(kassaSearch.toLowerCase()))
      .sort((a, b) => {
        const diff = new Date(a.issuedAt) - new Date(b.issuedAt);
        return kassaSortDir === 'asc' ? diff : -diff;
      });
    const kassaTotal = kassaFiltered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const KASSA_PAGE_SIZE = 50;
    const kassaTotalPages = Math.max(1, Math.ceil(kassaFiltered.length / KASSA_PAGE_SIZE));
    const kassaPageSafe = Math.min(kassaPage, kassaTotalPages);
    const kassaPageData = kassaFiltered.slice((kassaPageSafe - 1) * KASSA_PAGE_SIZE, kassaPageSafe * KASSA_PAGE_SIZE);

    return (
      <>
        {viewToggle}
        <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--rb-border)', background: '#fafafa' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--rb-text-secondary)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                value={kassaSearch}
                onChange={e => { setKassaSearch(e.target.value); setKassaPage(1); }}
                placeholder="Поиск по сотруднику..."
                style={{ width: '100%', paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 6, boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            {/* Sort by date */}
            <button
              onClick={() => { setKassaSortDir(d => d === 'desc' ? 'asc' : 'desc'); setKassaPage(1); }}
              title={kassaSortDir === 'desc' ? 'Сначала новые' : 'Сначала старые'}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12, fontWeight: 500, border: '1px solid var(--rb-border)', borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                {kassaSortDir === 'desc'
                  ? <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/></>
                  : <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 5 5 12"/></>
                }
              </svg>
              Дата: {kassaSortDir === 'desc' ? 'новые ↓' : 'старые ↑'}
            </button>
            {kassaSearch && (
              <button onClick={() => { setKassaSearch(''); setKassaPage(1); }}
                style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--rb-border)', borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--rb-text-secondary)' }}>
                Сбросить
              </button>
            )}
          </div>
        </div>

        {kassaLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Загрузка...</div>
        ) : kassaData.length === 0 ? (
          <div className="rb-hist-empty">Нет записей о выдаче средств</div>
        ) : kassaFiltered.length === 0 ? (
          <div className="rb-hist-empty" style={{ padding: '30px 20px' }}>Ничего не найдено</div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '0 16px 16px' }}>
            <table className="rb-report-table rb-report-table--bordered" style={{ width: '100%', marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 22, padding: '0 4px' }} />
                  <th>ФИО сотрудника</th>
                  <th>Период</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => { setKassaSortDir(d => d === 'desc' ? 'asc' : 'desc'); setKassaPage(1); }}>
                    Дата выдачи {kassaSortDir === 'desc' ? '↓' : '↑'}
                  </th>
                  <th style={{ textAlign: 'right' }}>Сумма</th>
                  <th>Выдал</th>
                  <th>Примечание</th>
                  {!readOnly && <th style={{ width: 52 }} />}
                </tr>
              </thead>
              <tbody>
                {kassaPageData.map(p => (
                  <tr key={p.id}>
                    <td style={{ padding: '0 4px', textAlign: 'center' }}>
                      <EditHistoryBadge editHistory={p.editHistory} />
                    </td>
                    <td style={{ fontWeight: 500 }}>{p.doctorName}</td>
                    <td>{p.periodLabel || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(p.issuedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    {kassaEditId === p.id ? (
                      <>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min="0" step="0.01" value={kassaEditAmount} onChange={e => setKassaEditAmount(e.target.value)}
                            style={{ width: 90, padding: '2px 5px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 4, textAlign: 'right', boxSizing: 'border-box' }} />
                        </td>
                        <td>
                          <input type="text" value={kassaEditFinancistName} onChange={e => setKassaEditFinancistName(e.target.value)} placeholder="Выдал..."
                            style={{ width: '100%', padding: '2px 5px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 4, boxSizing: 'border-box' }} />
                        </td>
                        <td>
                          <input type="text" value={kassaEditNote} onChange={e => setKassaEditNote(e.target.value)} placeholder="Примечание..."
                            style={{ width: '100%', padding: '2px 5px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 4, boxSizing: 'border-box' }} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => saveKassaEdit(p)} disabled={kassaEditSaving || !kassaEditAmount}
                              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', opacity: kassaEditSaving ? 0.6 : 1, flexShrink: 0 }}>
                              {kassaEditSaving
                                ? <span className="rb-spinner" style={{ width: 12, height: 12 }} />
                                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>
                              }
                            </button>
                            <button onClick={cancelKassaEdit}
                              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, cursor: 'pointer', background: 'var(--rb-danger)', color: '#fff', flexShrink: 0 }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--rb-success)' }}>
                          {parseFloat(p.amount).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                        </td>
                        <td>{p.financistName || '—'}</td>
                        <td style={{ fontStyle: 'italic', fontSize: 12 }}>{p.note || ''}</td>
                        {!readOnly && (
                          <td>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <button onClick={() => startKassaEdit(p)} title="Редактировать"
                                style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', flexShrink: 0 }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button onClick={() => handleCashDelete(p.id)} title="Удалить"
                                style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, cursor: 'pointer', background: 'var(--rb-danger)', color: '#fff', flexShrink: 0 }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                              </button>
                            </div>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--rb-border)' }}>
                  <td colSpan={4} style={{ fontWeight: 600, fontSize: 12, paddingTop: 8, border: 'none' }}>
                    {kassaSearch ? `${kassaFiltered.length} из ${kassaData.length} записей` : `${kassaData.length} записей`}
                    {kassaTotalPages > 1 && (
                      <span style={{ fontWeight: 400, color: 'var(--rb-text-secondary)', marginLeft: 8 }}>
                        (показаны {(kassaPageSafe - 1) * KASSA_PAGE_SIZE + 1}–{Math.min(kassaPageSafe * KASSA_PAGE_SIZE, kassaFiltered.length)})
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--rb-success)', paddingTop: 8, border: 'none' }}>
                    {kassaTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                  </td>
                  <td colSpan={!readOnly ? 3 : 2} style={{ border: 'none' }} />
                </tr>
              </tfoot>
            </table>
            {kassaTotalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 12 }}>
                <button onClick={() => setKassaPage(1)} disabled={kassaPageSafe === 1}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: kassaPageSafe === 1 ? 'default' : 'pointer', background: '#fff', color: kassaPageSafe === 1 ? '#cbd5e1' : 'var(--rb-text-secondary)', lineHeight: 1 }}>
                  «
                </button>
                <button onClick={() => setKassaPage(p => Math.max(1, p - 1))} disabled={kassaPageSafe === 1}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: kassaPageSafe === 1 ? 'default' : 'pointer', background: '#fff', color: kassaPageSafe === 1 ? '#cbd5e1' : 'var(--rb-text-secondary)', lineHeight: 1 }}>
                  ‹
                </button>
                {Array.from({ length: kassaTotalPages }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === kassaTotalPages || Math.abs(n - kassaPageSafe) <= 2)
                  .reduce((acc, n, idx, arr) => {
                    if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…');
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((item, idx) => item === '…'
                    ? <span key={`ellipsis-${idx}`} style={{ padding: '4px 6px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>…</span>
                    : <button key={item} onClick={() => setKassaPage(item)}
                        style={{ padding: '4px 9px', fontSize: 12, fontWeight: item === kassaPageSafe ? 700 : 400, border: '1px solid', borderColor: item === kassaPageSafe ? 'var(--rb-primary)' : 'var(--rb-border)', borderRadius: 5, cursor: item === kassaPageSafe ? 'default' : 'pointer', background: item === kassaPageSafe ? '#eff6ff' : '#fff', color: item === kassaPageSafe ? 'var(--rb-primary)' : 'var(--rb-text)', lineHeight: 1 }}>
                        {item}
                      </button>
                  )}
                <button onClick={() => setKassaPage(p => Math.min(kassaTotalPages, p + 1))} disabled={kassaPageSafe === kassaTotalPages}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: kassaPageSafe === kassaTotalPages ? 'default' : 'pointer', background: '#fff', color: kassaPageSafe === kassaTotalPages ? '#cbd5e1' : 'var(--rb-text-secondary)', lineHeight: 1 }}>
                  ›
                </button>
                <button onClick={() => setKassaPage(kassaTotalPages)} disabled={kassaPageSafe === kassaTotalPages}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: kassaPageSafe === kassaTotalPages ? 'default' : 'pointer', background: '#fff', color: kassaPageSafe === kassaTotalPages ? '#cbd5e1' : 'var(--rb-text-secondary)', lineHeight: 1 }}>
                  »
                </button>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  // ── Compare mode ──────────────────────────────────────────────────────────
  if (isCompareMode) {
    return (
      <>
        {viewToggle}
        <CompareView
          pinnedForCompare={pinnedForCompare}
          doctors={doctors}
          clinics={clinics}
          cmpRecords={cmpRecords}
          cmpLoading={cmpLoading}
          activeYear={activeYear}
          setActiveYear={setActiveYear}
          activeQuarter={activeQuarter}
          setActiveQuarter={setActiveQuarter}
        />
      </>
    );
  }

  // ── Single doctor ─────────────────────────────────────────────────────────
  if (!selectedDoctor) {
    return (
      <>
        {viewToggle}
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>
          <p style={{ fontSize: 14 }}>Выберите врача из списка слева</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        {viewToggle}
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Загрузка истории...</div>
      </>
    );
  }

  if (!records.length) {
    return (
      <>
        {viewToggle}
        <div className="rb-hist-header">
          <div className="rb-hist-doctor-name">{selectedDoctor.name}</div>
        </div>
        <div className="rb-hist-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="36" height="36" style={{ opacity: 0.4, display: 'block', margin: '0 auto 10px' }}>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <div>История зарплат пуста</div>
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>Сохраните расчёт во вкладке «Отчёт», нажав «Сохранить в историю»</div>
        </div>
      </>
    );
  }

  return (
    <>
      {viewToggle}

      <div className="rb-hist-header">
        <div className="rb-hist-doctor-name">{selectedDoctor.name}</div>
      </div>

      {years.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 20px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)', gap: 8 }}>
          {multiYear && (
            <div style={{ display: 'flex', flex: 1 }}>
              {years.map(y => (
                <button key={y} onClick={() => setActiveYear(y)}
                  style={{ flex: 1, textAlign: 'center', padding: '5px 8px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', color: displayYear === y ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', background: displayYear === y ? '#eff6ff' : 'none', transition: 'all .15s' }}>
                  {y}
                </button>
              ))}
            </div>
          )}
          {multiYear && <span style={{ width: 1, height: 20, background: 'var(--rb-border)', flexShrink: 0 }} />}
          <div className="rb-quarter-roll" key={displayYear}>
            <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginRight: 4, fontWeight: 500, whiteSpace: 'nowrap' }}>Квартал:</span>
            {[1, 2, 3, 4].map(q => (
              <button key={q} onClick={() => activeQuarters.has(q) && setActiveQuarter(activeQuarter === q ? null : q)}
                style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, background: activeQuarter === q ? '#eff6ff' : 'none', border: activeQuarter === q ? '1px solid var(--rb-primary)' : '1px solid transparent', borderRadius: 4, cursor: activeQuarters.has(q) ? 'pointer' : 'default', color: activeQuarter === q ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', opacity: activeQuarters.has(q) ? 1 : 0.3, transition: 'all .15s' }}>
                {['I', 'II', 'III', 'IV'][q - 1]}
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredRecords.length === 0 ? (
        <div className="rb-hist-empty" style={{ padding: '40px 20px' }}>
          Нет записей{activeQuarter ? ` за Q${activeQuarter} ${displayYear}` : displayYear ? ` за ${displayYear} год` : ''}
        </div>
      ) : (
        <>
          <div className="rb-hist-stats">
            <div className="rb-hist-stat"><div className="rb-hist-stat-label">Средняя ({cnt} мес.)</div><div className="rb-hist-stat-value">{fmtRub(avgSalary)}</div></div>
            <div className="rb-hist-stat"><div className="rb-hist-stat-label">Максимум</div><div className="rb-hist-stat-value">{fmtRub(maxSalary)}</div></div>
            <div className="rb-hist-stat"><div className="rb-hist-stat-label">Минимум</div><div className="rb-hist-stat-value">{fmtRub(minSalary)}</div></div>
          </div>

          {filteredRecords.length >= 2 && (
            <div className="rb-hist-chart-wrap">
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--rb-border)', padding: '8px 0' }}>
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#000', paddingTop: 6, paddingBottom: 2 }}>Динамика заработной платы</div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#000' }} axisLine={{ stroke: '#000' }} tickLine={{ stroke: '#000' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#000' }} axisLine={{ stroke: '#000' }} tickLine={{ stroke: '#000' }} tickFormatter={v => v.toLocaleString('ru-RU')} width={70} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#3b82f6" fillOpacity={0.85} maxBarSize={48} />
                    <Line type="monotone" dataKey="value" stroke="#007AFF" strokeWidth={2} dot={{ r: 4, fill: '#007AFF', strokeWidth: 2, stroke: '#fff' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="rb-hist-records">
            {filteredRecords.map(rec => (
              <HistCard
                key={rec.id}
                record={rec}
                clinics={clinics}
                onDelete={readOnly ? undefined : handleDelete}
                cashPayments={cashPaymentsMap[rec.id] || []}
                onCashPay={readOnly ? undefined : handleOpenCashModal}
                onCashDelete={readOnly ? undefined : handleCashDelete}
                onCashEdit={readOnly ? undefined : handleCashEdit}
              />
            ))}
          </div>
        </>
      )}

      {/* Cash payment modal */}
      {cashModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setCashModal(null); }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 380, padding: '24px', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Выдача из кассы</div>
            <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 16 }}>
              {cashModal.record.doctorName} · {cashModal.record.periodLabel || cashModal.record.dateFrom?.slice(0, 7) || ''}
            </div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 4 }}>Сумма, ₽</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cashAmount}
              onChange={e => setCashAmount(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '8px 10px', fontSize: 15, border: '1.5px solid var(--rb-border)', borderRadius: 6, marginBottom: 12, boxSizing: 'border-box' }}
              placeholder="0.00"
            />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 4 }}>Примечание (необязательно)</label>
            <input
              type="text"
              value={cashNote}
              onChange={e => setCashNote(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1.5px solid var(--rb-border)', borderRadius: 6, marginBottom: 20, boxSizing: 'border-box' }}
              placeholder="Комментарий..."
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCashModal(null)}
                style={{ width: 100, padding: '8px 0', fontSize: 13, fontWeight: 500, border: '1px solid var(--rb-border)', borderRadius: 6, cursor: 'pointer', background: 'none', color: 'var(--rb-text-secondary)' }}>
                Отмена
              </button>
              <button onClick={handleCashSubmit} disabled={cashSubmitting || !cashAmount}
                style={{ width: 100, padding: '8px 0', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, cursor: cashAmount ? 'pointer' : 'default', background: cashAmount ? 'var(--rb-primary)' : '#bfdbfe', color: '#fff', opacity: cashSubmitting ? 0.7 : 1, transition: 'all .15s' }}>
                {cashSubmitting ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
