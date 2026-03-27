import React, { useState, useEffect, useMemo } from 'react';
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
  return _getDeductionAmount(salary, n => n.toUpperCase() === 'НДФЛ');
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

  const [searchName, setSearchName]         = useState('');
  const [filterClinic, setFilterClinic]     = useState('');
  const [filterSpecialty, setFilterSpecialty] = useState('');
  const [filterYear, setFilterYear]         = useState('');
  const [filterMonth, setFilterMonth]       = useState('');
  const [sortBy, setSortBy]                 = useState('date_desc');

  useEffect(() => {
    setLoading(true);
    salaryRecords.getAll()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : [];
        setRecords(list);
        const done = {};
        list.forEach(rec => {
          const flags = rec.reportData?.recalcDone || {};
          Object.keys(flags).forEach(rowKey => { if (flags[rowKey]) done[rowKey] = true; });
        });
        setRecalcDone(done);
        // Загружаем кассу отдельно — не критично если упадёт
        cashPaymentsApi.getAll()
          .then(cpRes => {
            const cpMap = {};
            (Array.isArray(cpRes.data) ? cpRes.data : []).forEach(p => {
              if (!cpMap[p.salaryRecordId]) cpMap[p.salaryRecordId] = [];
              cpMap[p.salaryRecordId].push(p);
            });
            setCashPaymentsMap(cpMap);
          })
          .catch(() => {});
      })
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
    allRows.forEach(({ rec }) => {
      const s = getDoctorSpecialty(rec.misUserId);
      if (s && s !== '—') s.split(', ').forEach(sp => set.add(sp.trim()));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [allRows, doctors]);

  // ── Unique years for filter ───────────────────────────────────────────────────
  const allYears = useMemo(() => {
    const set = new Set();
    allRows.forEach(({ rec }) => {
      if (rec.dateFrom) set.add(new Date(rec.dateFrom).getFullYear());
    });
    return [...set].sort((a, b) => b - a);
  }, [allRows]);

  // ── Filter & sort ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const targetClinic = filterClinic ? clinics.find(c => String(c.id) === String(filterClinic)) : null;
    const yr  = filterYear  ? parseInt(filterYear,  10) : null;
    const mon = filterMonth ? parseInt(filterMonth, 10) : null;

    return allRows
      .filter(row => {
        if (searchName && !row.rec.doctorName?.toLowerCase().includes(searchName.toLowerCase())) return false;
        if (targetClinic && row.clinicName !== targetClinic.name) return false;
        if (filterSpecialty) {
          const sp = getDoctorSpecialty(row.rec.misUserId);
          if (!sp.split(', ').map(s => s.trim()).includes(filterSpecialty)) return false;
        }
        if (yr !== null && row.rec.dateFrom) {
          const d = new Date(row.rec.dateFrom);
          if (d.getFullYear() !== yr) return false;
          if (mon !== null && d.getMonth() + 1 !== mon) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date_asc')    return new Date(a.rec.dateFrom || 0) - new Date(b.rec.dateFrom || 0);
        if (sortBy === 'name')        return (a.rec.doctorName || '').localeCompare(b.rec.doctorName || '', 'ru');
        if (sortBy === 'salary_desc') return parseFloat(b.cr?.salary?.finalSalary || 0) - parseFloat(a.cr?.salary?.finalSalary || 0);
        if (sortBy === 'salary_asc')  return parseFloat(a.cr?.salary?.finalSalary || 0) - parseFloat(b.cr?.salary?.finalSalary || 0);
        return new Date(b.rec.dateFrom || 0) - new Date(a.rec.dateFrom || 0); // date_desc
      });
  }, [allRows, searchName, filterClinic, filterSpecialty, filterYear, filterMonth, clinics, sortBy]);

  // Вспомогательная функция: получить карту кассовых выплат (свежий запрос)
  const fetchCashMap = async () => {
    try {
      const res = await cashPaymentsApi.getAll();
      const map = {};
      (Array.isArray(res.data) ? res.data : []).forEach(p => {
        if (!map[p.salaryRecordId]) map[p.salaryRecordId] = [];
        map[p.salaryRecordId].push(p);
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
        const remainder = parseFloat(s.finalSalary || 0) - parseFloat(s.advance || 0) - parseFloat(s.mainPayment || 0);
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
        { header: 'К выплате',      key: 'netBonus',  width: 18 },
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
        const remainder = parseFloat(s.finalSalary || 0) - parseFloat(s.advance || 0) - parseFloat(s.mainPayment || 0);
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
        { header: 'ФИО врача',      key: 'name',      width: 32 },
        { header: 'Медцентр',       key: 'clinic',    width: 22 },
        { header: 'Специальность',  key: 'specialty', width: 26 },
        { header: 'Дата',           key: 'date',      width: 18 },
        { header: 'Начислено',      key: 'total',     width: 16 },
        { header: 'Удержание % от оборота', key: 'uderzh', width: 22 },
        { header: 'НДФЛ',           key: 'ndfl',      width: 16 },
        { header: 'Аванс',          key: 'advance',   width: 16 },
        { header: 'Тело',           key: 'body',      width: 16 },
        { header: 'Премия',         key: 'bonus',     width: 16 },
        { header: 'Переплата',      key: 'overpay',   width: 16 },
        { header: 'Выдано (касса)', key: 'cashPaid',  width: 16 },
      ];

      const hRow = ws.getRow(1);
      hRow.font      = { bold: true, name: 'Calibri', size: 11 };
      hRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
      hRow.alignment = { horizontal: 'center', vertical: 'middle' };

      filtered.forEach(({ rec, cr, clinicName }) => {
        const s = cr?.salary || {};
        const remainder = (parseFloat(s.finalSalary || 0)) - (parseFloat(s.advance || 0)) - (parseFloat(s.mainPayment || 0));
        const cashPaid = (liveCashMap[rec.id] || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        ws.addRow({
          name:      rec.doctorName || '—',
          clinic:    clinicName,
          specialty: getDoctorSpecialty(rec.misUserId),
          date:      rec.periodLabel || (rec.dateFrom ? rec.dateFrom.slice(0, 7) : '—'),
          total:     parseFloat(s.finalSalary || 0),
          uderzh:    (() => { const { amount, percent } = getUderzhanieInfo(s); if (!amount) return null; const neg = parseFloat((-amount).toFixed(2)); return percent != null ? `${neg.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽ (${percent}%)` : neg; })(),
          ndfl:      -getNdflAmount(s) || null,
          advance:   parseFloat(s.advance     || 0),
          body:      parseFloat(s.mainPayment || 0),
          bonus:     remainder >= 0 ? remainder : 0,
          overpay:   remainder < 0  ? remainder : 0,
          cashPaid:  cashPaid || null,
        });
      });

      ['total', 'ndfl', 'advance', 'body', 'bonus', 'overpay', 'cashPaid'].forEach(key => {
        ws.getColumn(key).numFmt = '#,##0.00 ₽';
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
        name:    'ИТОГО',
        clinic:  '',
        specialty: '',
        date:    '',
        total:   filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.finalSalary || 0), 0),
        uderzh:  -filtered.reduce((s, r) => s + getUderzhanieAmount(r.cr?.salary), 0) || null,
        ndfl:    -filtered.reduce((s, r) => s + getNdflAmount(r.cr?.salary), 0) || null,
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
        cashPaid: excelCashTotal || null,
      });
      totalRow.font = { bold: true, name: 'Calibri', size: 11 };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
      totalRow.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } };
      totalRow.getCell('uderzh').numFmt = '#,##0.00 ₽';

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
          value={filterSpecialty}
          onChange={e => setFilterSpecialty(e.target.value)}
        >
          <option value="">Все специальности</option>
          {allSpecialties.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          style={{ padding: '6px 10px', border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 13, background: '#fff' }}
          value={filterYear}
          onChange={e => setFilterYear(e.target.value)}
        >
          <option value="">Все годы</option>
          {allYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          style={{ padding: '6px 10px', border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 13, background: '#fff' }}
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
        >
          <option value="">Все месяцы</option>
          {['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'].map((m, i) => (
            <option key={i+1} value={i+1}>{m}</option>
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
          <option value="salary_asc">По зарплате ↑</option>
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
        <button
          onClick={handlePayoutExport}
          disabled={exportingPayout || filtered.length === 0}
          style={{ padding: '6px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: filtered.length === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: (exportingPayout || filtered.length === 0) ? 0.55 : 1 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="15" x2="12" y2="9"/>
            <polyline points="9 12 12 15 15 12"/>
          </svg>
          {exportingPayout ? 'Экспорт...' : 'Выплата'}
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
        const totalSalary  = filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.finalSalary || 0), 0);
        const totalBase    = filtered.reduce((s, r) => s + parseFloat(r.cr?.salary?.mainPayment || 0) + parseFloat(r.cr?.salary?.advance || 0), 0);
        const totalOverpay = filtered.reduce((s, r) => {
          const rem = parseFloat(r.cr?.salary?.finalSalary || 0) - parseFloat(r.cr?.salary?.advance || 0) - parseFloat(r.cr?.salary?.mainPayment || 0);
          return s + (rem < 0 ? rem : 0);
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
                const recalcKey = key;

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
                        {(() => {
                          const rowCash = cashPaymentsMap[rec.id] || [];
                          if (!rowCash.length) return null;
                          const rowCashTotal = rowCash.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
                          const allRem = (rec.reportData?.clinicReports || []).reduce((s, c) => {
                            const sal = c.salary || {};
                            return s + parseFloat(sal.finalSalary || 0) - parseFloat(sal.advance || 0) - parseFloat(sal.mainPayment || 0);
                          }, 0);
                          const netRem = allRem - rowCashTotal;
                          return (
                            <div style={{ fontSize: 11, marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                              <span style={{ color: '#15803d', fontWeight: 600 }}>Касса: −{fmtRub(rowCashTotal)}</span>
                              <span style={{ color: netRem < 0 ? '#dc2626' : '#0284c7' }}>Остаток: {netRem < 0 ? '−' : ''}{fmtRub(Math.abs(netRem))}</span>
                            </div>
                          );
                        })()}
                        {(advance > 0 || body > 0 || bonus > 0 || overpay < 0) && (
                          <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                            {advance > 0 && <span>Аванс: {fmtRub(advance)}</span>}
                            {body > 0    && <span>Тело: {fmtRub(body)}</span>}
                            {bonus > 0   && <span>Премия: {fmtRub(bonus)}</span>}
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
                        const sal = c.salary || {};
                        return s + parseFloat(sal.finalSalary || 0) - parseFloat(sal.advance || 0) - parseFloat(sal.mainPayment || 0);
                      }, 0);
                      const netRemainder = allClinicRemainder - cashPaidTotal;
                      return (
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan={6} style={{ padding: '0 16px 16px', borderBottom: '2px solid var(--rb-border)' }}>
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
              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Сумма основных зарплат</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#166534' }}>{fmtRub(totalBase)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Сумма переплат</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626' }}>{fmtRub(totalOverpay)}</div>
            </div>
            {totalCashPaid > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Сумма по кассе</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--rb-text-secondary)' }}>−{fmtRub(totalCashPaid)}</div>
              </div>
            )}
          </div>
        </div>
        </>
        );
      })()}
    </div>
  );
}
