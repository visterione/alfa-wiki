import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Bar, Legend,
} from 'recharts';
import { salaryRecords, cashPayments as cashPaymentsApi } from '../../../services/api';
import { buildSingleWorkbook, workbookToBase64 } from '../utils/reportExport';

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
const COLOR_A = '#2563eb';
const COLOR_B = '#ea580c';

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

function HistCard({ record, clinics, onDelete, cashPayments = [], onCashPay }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const finalSalary = getRecordFinalSalary(record);

  const handleDownloadExcel = async (e) => {
    e.stopPropagation();
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
    return s + parseFloat(sal.finalSalary || 0) - parseFloat(sal.advance || 0) - parseFloat(sal.mainPayment || 0);
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

  return (
    <div className="rb-hist-card">
      <div className="rb-hist-card-head" onClick={() => setOpen(o => !o)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="rb-hist-card-period">{period}</div>
          {savedDate && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2 }}>Сохранено {savedDate}</div>}
          <div className="rb-hist-card-tags" style={{ marginTop: 6 }}>
            {basePay > 0            && <span className="rb-hist-card-tag">Оклад: {fmtRub(basePay)}</span>}
            {referralBonuses > 0    && <span className="rb-hist-card-tag">Направления: {fmtRub(referralBonuses)}</span>}
            {performedBonusTotal > 0 && <span className="rb-hist-card-tag">Услуги: {fmtRub(performedBonusTotal)}</span>}
            {extrasTotal > 0        && <span className="rb-hist-card-tag">Надбавки: {fmtRub(extrasTotal)}</span>}
            {deductionsTotal > 0    && <span className="rb-hist-card-tag neg">Удержания: −{fmtRub(deductionsTotal)}</span>}
          </div>
          {cashPaidTotal > 0 && (
            <div className="rb-hist-card-tags" style={{ marginTop: 3 }}>
              <span className="rb-hist-card-tag" style={{ background: '#dcfce7', color: '#15803d' }}>Выдано: −{fmtRub(cashPaidTotal)}</span>
              <span className="rb-hist-card-tag" style={{ background: netRemainder < 0 ? '#fee2e2' : '#f0f9ff', color: netRemainder < 0 ? '#dc2626' : '#0284c7' }}>
                Остаток: {netRemainder < 0 ? '−' : ''}{fmtRub(Math.abs(netRemainder))}
              </span>
            </div>
          )}
        </div>
        <div className="rb-hist-card-total">{fmtRub(finalSalary)}</div>
        {onCashPay && (
          <button
            onClick={e => { e.stopPropagation(); onCashPay(record, netRemainder); }}
            title="Зафиксировать выдачу из кассы"
            style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', border: '1px solid #16a34a', borderRadius: 5, cursor: 'pointer', background: '#f0fdf4', color: '#16a34a', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Касса
          </button>
        )}
        {record.hasExcel && (
          <button
            className="rb-hist-del"
            onClick={handleDownloadExcel}
            disabled={downloading}
            title="Скачать Excel"
            style={{ color: '#16a34a' }}
          >
            {downloading
              ? <span className="rb-spinner" style={{ width: 14, height: 14 }} />
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="15" x2="12" y2="9"/>
                  <polyline points="9 12 12 15 15 12"/>
                </svg>
            }
          </button>
        )}
        {onDelete && (
          <button className="rb-hist-del" onClick={e => { e.stopPropagation(); onDelete(record.id); }} title="Удалить запись">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        )}
        <svg className={`rb-hist-card-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
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
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: {p.value.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
        </div>
      ))}
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
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Режим сравнения</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[{ doc: docA, id: pinnedForCompare[0], letter: 'А', color: COLOR_A }, { doc: docB, id: pinnedForCompare[1], letter: 'Б', color: COLOR_B }].map(({ doc, id, letter, color }) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Dot letter={letter} color={color} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{doc?.name || id}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Year tabs */}
      {multiYear && (
        <div style={{ display: 'flex', borderBottom: '2px solid var(--rb-border)', padding: '0 20px', background: '#f8fafc' }}>
          {years.map(y => (
            <button key={y} onClick={() => { setActiveYear(y); setActiveQuarter(null); }}
              style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: displayYear === y ? '2px solid var(--rb-primary)' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', color: displayYear === y ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', background: displayYear === y ? '#eff6ff' : 'none', transition: 'all .15s' }}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Quarter tabs */}
      {showQuarterTabs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 20px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)' }}>
          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginRight: 6, fontWeight: 500 }}>Квартал:</span>
          {[1, 2, 3, 4].map(q => (
            <button key={q} onClick={() => setActiveQuarter(activeQuarter === q ? null : q)} disabled={!activeQuarters.has(q)}
              style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, background: activeQuarter === q ? '#eff6ff' : 'none', border: activeQuarter === q ? '1px solid var(--rb-primary)' : '1px solid transparent', borderRadius: 4, cursor: activeQuarters.has(q) ? 'pointer' : 'default', color: activeQuarter === q ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', opacity: activeQuarters.has(q) ? 1 : 0.35, transition: 'all .15s' }}>
              {['I', 'II', 'III', 'IV'][q - 1]}
            </button>
          ))}
        </div>
      )}

      {/* Stats comparison table */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontWeight: 600, color: 'var(--rb-text-secondary)', fontSize: 11, padding: '4px 8px 8px 0', textTransform: 'uppercase', letterSpacing: '.03em' }}>Метрика</th>
              {[{ letter: 'А', color: COLOR_A, name: nameA }, { letter: 'Б', color: COLOR_B, name: nameB }].map(({ letter, color, name }) => (
                <th key={letter} style={{ textAlign: 'right', padding: '4px 0 8px', width: '36%' }}>
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
              { label: `Средняя (А: ${salA.length} / Б: ${salB.length} мес.)`, a: avg(salA), b: avg(salB) },
              { label: 'Максимум', a: max(salA), b: max(salB) },
              { label: 'Минимум',  a: min(salA), b: min(salB) },
            ].map((row, i) => {
              const aWins = row.a > 0 && row.a > row.b;
              const bWins = row.b > 0 && row.b > row.a;
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--rb-border)' }}>
                  <td style={{ padding: '7px 8px 7px 0', fontSize: 12, color: 'var(--rb-text-secondary)', fontWeight: 500 }}>{row.label}</td>
                  <td style={{ textAlign: 'right', padding: '7px 0', fontSize: 13, fontWeight: 700, color: aWins ? COLOR_A : 'var(--rb-text)' }}>
                    {fmtRub(row.a)}{aWins ? ' ▲' : ''}
                  </td>
                  <td style={{ textAlign: 'right', padding: '7px 0', fontSize: 13, fontWeight: 700, color: bWins ? COLOR_B : 'var(--rb-text)' }}>
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
          <div className="rb-hist-chart-title">Динамика заработной платы</div>
          <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--rb-border)', padding: '8px 0' }}>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v.toLocaleString('ru-RU')} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
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
                : recs.map(rec => <HistCard key={rec.id} record={rec} clinics={clinics} onDelete={null} />)
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

export default function StepSalaryHistory({ selectedDoctor, clinics, doctors = [], pinnedForCompare = [], readOnly }) {
  const [records, setRecords]             = useState([]);
  const [loading, setLoading]             = useState(false);
  const [activeYear, setActiveYear]       = useState(null);
  const [activeQuarter, setActiveQuarter] = useState(null);
  const [cmpRecords, setCmpRecords]       = useState({});
  const [cmpLoading, setCmpLoading]       = useState({});

  // Cash payments
  const [viewMode, setViewMode]           = useState('history'); // 'history' | 'kassa'
  const [cashPaymentsMap, setCashPaymentsMap] = useState({}); // { [salaryRecordId]: [...] }
  const [kassaData, setKassaData]         = useState([]);
  const [kassaLoading, setKassaLoading]   = useState(false);
  const [cashModal, setCashModal]         = useState(null); // { record, defaultAmount }
  const [cashAmount, setCashAmount]       = useState('');
  const [cashNote, setCashNote]           = useState('');
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [kassaSearch, setKassaSearch]     = useState('');
  const [kassaSortDir, setKassaSortDir]   = useState('desc'); // 'asc' | 'desc'

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
    <div style={{ display: 'flex', borderBottom: '1px solid var(--rb-border)', padding: '6px 12px', gap: 4, background: '#f8fafc', flexShrink: 0 }}>
      {[
        { key: 'history', label: 'История зарплат', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
        { key: 'kassa', label: 'Касса', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
      ].map(({ key, label, icon }) => (
        <button key={key}
          onClick={() => { setViewMode(key); if (key === 'kassa') loadKassa(); }}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600, border: '1px solid', borderRadius: 6, cursor: 'pointer', transition: 'all .15s',
            borderColor: viewMode === key ? 'var(--rb-primary)' : 'transparent',
            background: viewMode === key ? '#eff6ff' : 'none',
            color: viewMode === key ? 'var(--rb-primary)' : 'var(--rb-text-secondary)',
          }}
        >
          {icon}{label}
        </button>
      ))}
    </div>
  );

  // ── Касса view ────────────────────────────────────────────────────────────
  if (viewMode === 'kassa') {
    const kassaFiltered = kassaData
      .filter(p => !kassaSearch || p.doctorName?.toLowerCase().includes(kassaSearch.toLowerCase()))
      .sort((a, b) => {
        const diff = new Date(a.issuedAt) - new Date(b.issuedAt);
        return kassaSortDir === 'asc' ? diff : -diff;
      });
    const kassaTotal = kassaFiltered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

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
                onChange={e => setKassaSearch(e.target.value)}
                placeholder="Поиск по сотруднику..."
                style={{ width: '100%', paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 6, boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            {/* Sort by date */}
            <button
              onClick={() => setKassaSortDir(d => d === 'desc' ? 'asc' : 'desc')}
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
              <button onClick={() => setKassaSearch('')}
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
            <table className="rb-report-table" style={{ width: '100%', marginTop: 12 }}>
              <thead>
                <tr>
                  <th>ФИО сотрудника</th>
                  <th>Период</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setKassaSortDir(d => d === 'desc' ? 'asc' : 'desc')}>
                    Дата выдачи {kassaSortDir === 'desc' ? '↓' : '↑'}
                  </th>
                  <th style={{ textAlign: 'right' }}>Сумма</th>
                  <th>Выдал</th>
                  <th>Примечание</th>
                </tr>
              </thead>
              <tbody>
                {kassaFiltered.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.doctorName}</td>
                    <td style={{ color: 'var(--rb-text-secondary)' }}>{p.periodLabel || '—'}</td>
                    <td style={{ color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(p.issuedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--rb-success)' }}>
                      {parseFloat(p.amount).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                    </td>
                    <td style={{ color: 'var(--rb-text-secondary)' }}>{p.financistName || '—'}</td>
                    <td style={{ color: 'var(--rb-text-secondary)', fontStyle: 'italic', fontSize: 12 }}>{p.note || ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--rb-border)' }}>
                  <td colSpan={3} style={{ fontWeight: 600, fontSize: 12, paddingTop: 8 }}>
                    {kassaSearch ? `${kassaFiltered.length} из ${kassaData.length} записей` : `${kassaData.length} записей`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--rb-success)', paddingTop: 8 }}>
                    {kassaTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
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

      {multiYear && (
        <div style={{ display: 'flex', borderBottom: '2px solid var(--rb-border)', padding: '0 20px', background: '#f8fafc' }}>
          {years.map(y => (
            <button key={y} onClick={() => setActiveYear(y)}
              style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: displayYear === y ? '2px solid var(--rb-primary)' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', color: displayYear === y ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', background: displayYear === y ? '#eff6ff' : 'none', transition: 'all .15s' }}>
              {y}
            </button>
          ))}
        </div>
      )}

      {showQuarterTabs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 20px', background: '#f8fafc', borderBottom: '1px solid var(--rb-border)' }}>
          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginRight: 6, fontWeight: 500 }}>Квартал:</span>
          {[1, 2, 3, 4].map(q => (
            <button key={q} onClick={() => setActiveQuarter(activeQuarter === q ? null : q)} disabled={!activeQuarters.has(q)}
              style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, background: activeQuarter === q ? '#eff6ff' : 'none', border: activeQuarter === q ? '1px solid var(--rb-primary)' : '1px solid transparent', borderRadius: 4, cursor: activeQuarters.has(q) ? 'pointer' : 'default', color: activeQuarter === q ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', opacity: activeQuarters.has(q) ? 1 : 0.35, transition: 'all .15s' }}>
              {['I', 'II', 'III', 'IV'][q - 1]}
            </button>
          ))}
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
              <div className="rb-hist-chart-title">Динамика заработной платы</div>
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--rb-border)', padding: '8px 0' }}>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v.toLocaleString('ru-RU')} width={70} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#3b82f6" fillOpacity={0.85} maxBarSize={48} />
                    <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }} />
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
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, border: '1px solid var(--rb-border)', borderRadius: 6, cursor: 'pointer', background: 'none', color: 'var(--rb-text-secondary)' }}>
                Отмена
              </button>
              <button onClick={handleCashSubmit} disabled={cashSubmitting || !cashAmount}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, cursor: cashAmount ? 'pointer' : 'default', background: cashAmount ? '#16a34a' : '#d1fae5', color: '#fff', opacity: cashSubmitting ? 0.7 : 1, transition: 'all .15s' }}>
                {cashSubmitting ? 'Сохранение...' : 'Выдать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
