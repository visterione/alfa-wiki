import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import ExcelJS from 'exceljs';
import { salaryRecords } from '../../../services/api';
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

// Извлекает сумму НДФЛ из объекта salary (поддерживает % и ₽, любой регистр имени)
function getNdflAmount(salary) {
  if (!salary) return 0;
  const deductions = salary.deductions || [];
  const ndfl = deductions.find(d => (d.name || '').trim().toUpperCase() === 'НДФЛ');
  if (!ndfl) return 0;
  const value = parseFloat(ndfl.value) || 0;
  if (ndfl.valueType === 'rub') return value;
  // процент — нужна база
  if (ndfl.deductionType === 'final') {
    const preFinal = (parseFloat(salary.finalSalary) || 0)
      + (parseFloat(salary.finalDeductionsTotal) || 0)
      + (parseFloat(salary.materialsTotal) || 0);
    return preFinal * value / 100;
  }
  // от оборота
  const base = parseFloat(salary.performedServicesSum) || 0;
  return base * value / 100;
}

const fmtDate = s => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
};

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function StepSummary({ doctors = [], clinics = [], permissions = {} }) {
  const [records, setRecords]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const [exporting, setExporting]   = useState(false);

  const [searchName, setSearchName]     = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [sortBy, setSortBy]             = useState('date_desc');

  useEffect(() => {
    setLoading(true);
    salaryRecords.getAll()
      .then(res => setRecords(Array.isArray(res.data) ? res.data : []))
      .catch(() => toast.error('Ошибка загрузки сводки'))
      .finally(() => setLoading(false));
  }, []);

  const getDoctorSpecialty = (misUserId) => {
    const doc = doctors.find(d => d.id === String(misUserId));
    if (!doc) return '—';
    return doc.professions
      .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
      .filter(Boolean).join(', ') || '—';
  };

  // ── Flatten records → one row per clinic report ───────────────────────────
  const allRows = useMemo(() => {
    const allowedClinics = permissions.clinics?.length > 0 ? permissions.clinics.map(String) : null;
    const rows = [];
    records.forEach(rec => {
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

  // ── Filter & sort ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const targetClinic = filterClinic ? clinics.find(c => String(c.id) === String(filterClinic)) : null;

    return allRows
      .filter(row => {
        if (searchName && !row.rec.doctorName?.toLowerCase().includes(searchName.toLowerCase())) return false;
        if (targetClinic && row.clinicName !== targetClinic.name) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date_asc')    return new Date(a.rec.dateFrom || 0) - new Date(b.rec.dateFrom || 0);
        if (sortBy === 'name')        return (a.rec.doctorName || '').localeCompare(b.rec.doctorName || '', 'ru');
        if (sortBy === 'salary_desc') return parseFloat(b.cr?.salary?.finalSalary || 0) - parseFloat(a.cr?.salary?.finalSalary || 0);
        return new Date(b.rec.dateFrom || 0) - new Date(a.rec.dateFrom || 0); // date_desc
      });
  }, [allRows, searchName, filterClinic, clinics, sortBy]);

  // ── Excel export ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Сводка зарплат');

      ws.columns = [
        { header: 'ФИО врача',     key: 'name',      width: 32 },
        { header: 'Медцентр',      key: 'clinic',    width: 22 },
        { header: 'Специальность', key: 'specialty', width: 26 },
        { header: 'Дата',          key: 'date',      width: 18 },
        { header: 'Начислено',     key: 'total',     width: 16 },
        { header: 'НДФЛ',          key: 'ndfl',      width: 16 },
        { header: 'Аванс',         key: 'advance',   width: 16 },
        { header: 'Тело',          key: 'body',      width: 16 },
        { header: 'Премия',        key: 'bonus',     width: 16 },
        { header: 'Переплата',     key: 'overpay',   width: 16 },
      ];

      const hRow = ws.getRow(1);
      hRow.font      = { bold: true, name: 'Calibri', size: 11 };
      hRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
      hRow.alignment = { horizontal: 'center', vertical: 'middle' };

      filtered.forEach(({ rec, cr, clinicName }) => {
        const s = cr?.salary || {};
        const remainder = (parseFloat(s.finalSalary || 0)) - (parseFloat(s.advance || 0)) - (parseFloat(s.mainPayment || 0));
        const row = ws.addRow({
          name:      rec.doctorName || '—',
          clinic:    clinicName,
          specialty: getDoctorSpecialty(rec.misUserId),
          date:      rec.periodLabel || (rec.dateFrom ? rec.dateFrom.slice(0, 7) : '—'),
          total:     parseFloat(s.finalSalary || 0),
          ndfl:      getNdflAmount(s),
          advance:   parseFloat(s.advance     || 0),
          body:      parseFloat(s.mainPayment || 0),
          bonus:     remainder >= 0 ? remainder : 0,
          overpay:   remainder < 0  ? remainder : 0,
        });
      });

      ['total', 'ndfl', 'advance', 'body', 'bonus', 'overpay'].forEach(key => {
        ws.getColumn(key).numFmt = '#,##0.00 ₽';
      });

      // Итоговая строка
      const totalRow = ws.addRow({
        name:    'ИТОГО',
        clinic:  '',
        specialty: '',
        date:    '',
        total:   filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.finalSalary || 0), 0),
        ndfl:    filtered.reduce((s, r) => s + getNdflAmount(r.cr?.salary), 0),
        advance: filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.advance     || 0), 0),
        body:    filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.mainPayment || 0), 0),
        bonus:   filtered.reduce((s, r) => {
          const rem = (parseFloat(r.cr?.salary?.finalSalary || 0)) - (parseFloat(r.cr?.salary?.advance || 0)) - (parseFloat(r.cr?.salary?.mainPayment || 0));
          return s + (rem >= 0 ? rem : 0);
        }, 0),
        overpay: filtered.reduce((s, r) => {
          const rem = (parseFloat(r.cr?.salary?.finalSalary || 0)) - (parseFloat(r.cr?.salary?.advance || 0)) - (parseFloat(r.cr?.salary?.mainPayment || 0));
          return s + (rem < 0 ? rem : 0);
        }, 0),
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
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>
        <span className="rb-spinner" /> Загрузка сводки...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Toolbar ── */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 160, padding: '6px 10px', border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 13, background: '#fff' }}
          placeholder="Поиск по ФИО..."
          value={searchName}
          onChange={e => setSearchName(e.target.value)}
        />
        <select
          style={{ padding: '6px 10px', border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 13, background: '#fff' }}
          value={filterClinic}
          onChange={e => setFilterClinic(e.target.value)}
        >
          <option value="">Все медцентры</option>
          {clinics.filter(c => String(c.id) !== '8').map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          style={{ padding: '6px 10px', border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 13, background: '#fff' }}
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
        >
          <option value="date_desc">По дате ↓</option>
          <option value="date_asc">По дате ↑</option>
          <option value="name">По имени</option>
          <option value="salary_desc">По зарплате ↓</option>
        </select>
        <button
          onClick={handleExport}
          disabled={exporting || filtered.length === 0}
          style={{ padding: '6px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: filtered.length === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: (exporting || filtered.length === 0) ? 0.55 : 1 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="15" x2="12" y2="9"/>
            <polyline points="9 12 12 15 15 12"/>
          </svg>
          {exporting ? 'Экспорт...' : 'Excel'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
          {filtered.length} строк
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>
          {records.length === 0
            ? 'История зарплат пуста. Сохраните расчёт во вкладке «Отчёт».'
            : 'Нет записей по заданному фильтру.'}
        </div>
      ) : (() => {
        const totalSalary = filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.finalSalary || 0), 0);
        const totalBody   = filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.mainPayment  || 0), 0);
        return (
        <>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f1f5f9' }}>
                {['ФИО врача', 'Медцентр', 'Специальность', 'Дата', 'Зарплата'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '2px solid var(--rb-border)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
                <th style={{ width: 28, borderBottom: '2px solid var(--rb-border)' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ key, rec, cr, clinicObj, clinicName }) => {
                const s         = cr?.salary || {};
                const advance   = parseFloat(s.advance     || 0);
                const body      = parseFloat(s.mainPayment || 0);
                const total     = parseFloat(s.finalSalary || 0);
                const remainder = total - advance - body;
                const bonus     = remainder >= 0 ? remainder : 0;
                const overpay   = remainder < 0  ? remainder : 0;
                const isOpen    = expandedKey === key;
                const dateLabel = rec.periodLabel || (rec.dateFrom ? fmtDate(rec.dateFrom) : '—');

                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => setExpandedKey(isOpen ? null : key)}
                      style={{ cursor: 'pointer', background: isOpen ? '#eff6ff' : 'transparent', borderBottom: isOpen ? 'none' : '1px solid var(--rb-border)', transition: 'background .1s' }}
                      onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{rec.doctorName || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {clinicObj ? (
                          <span style={{ background: clinicObj.color || '#94a3b8', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {clinicName}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--rb-text-secondary)' }}>{clinicName}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--rb-text-secondary)' }}>
                        {getDoctorSpecialty(rec.misUserId)}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>
                        {dateLabel}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 700, color: '#1e40af' }}>{fmtRub(total)}</div>
                        {(advance > 0 || body > 0 || bonus > 0 || overpay < 0) && (
                          <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                            {advance > 0 && <span>Аванс: {fmtRub(advance)}</span>}
                            {body > 0    && <span>Тело: {fmtRub(body)}</span>}
                            {bonus > 0   && <span>Премия: {fmtRub(bonus)}</span>}
                            {overpay < 0 && <span>Переплата: {fmtRub(overpay)}</span>}
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

                    {isOpen && (
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={6} style={{ padding: '0 16px 16px', borderBottom: '2px solid var(--rb-border)' }}>
                          <div style={{ paddingTop: 14 }}>
                            {cr?.salary
                              ? <SalaryBlock salary={cr.salary} />
                              : <div style={{ color: 'var(--rb-text-secondary)', fontSize: 13 }}>Нет данных</div>
                            }
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Totals footer ── */}
        <div style={{ borderTop: '2px solid var(--rb-border)', background: '#f8fafc', padding: '12px 20px', display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Итого ({filtered.length} строк)
          </span>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Сумма зарплат</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e40af' }}>{fmtRub(totalSalary)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Сумма авансов</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#92400e' }}>{fmtRub(filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.advance || 0), 0))}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Сумма тел</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#166534' }}>{fmtRub(totalBody)}</div>
            </div>
          </div>
        </div>
        </>
        );
      })()}
    </div>
  );
}
