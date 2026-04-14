import React, { useState, useMemo, useRef, useEffect } from 'react';

// ── Date helpers for column filters ──
function parseDisplayDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const num = parseFloat(s);
  if (!isNaN(num) && num > 40000 && num < 60000)
    return new Date(Math.round((num - 25569) * 86400 * 1000));
  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m1) return new Date(+m1[3], +m1[2] - 1, +m1[1]);
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseFilterDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

const FILTER_LABELS = {
  date: 'Дата выставления',
  payDate: 'Дата оплаты',
  clinic: 'Клиника',
  legalCompany: 'Юр. компания',
  code: 'Код',
  executor: 'ФИО врача',
};

const EMPTY_FILTERS = {
  date:         { type: 'dateRange',   from: '', to: '' },
  payDate:      { type: 'dateRange',   from: '', to: '' },
  clinic:       { type: 'multiSelect', selected: null },
  legalCompany: { type: 'multiSelect', selected: null },
  code:         { type: 'multiSelect', selected: null },
  executor:     { type: 'multiSelect', selected: null },
};

/**
 * Modal for reviewing corp-paid transactions before report generation.
 *
 * Props:
 *   corpRows     — array of { row, key } from extractCorpRows()
 *   corpByDoctor — array of { doctor, rows } — grouped for bulk mode (optional)
 *   colMap       — column map from rbMapNewColumns()
 *   isBulk       — boolean, show grouped layout
 *   initialSelected — Set of pre-selected keys
 *   onConfirm    — (includedKeys: Set<string>) => void
 *   onCancel     — () => void
 */
export default function CorpReviewModal({ corpRows, corpByDoctor, colMap, isBulk, initialSelected, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(() =>
    initialSelected instanceof Set ? new Set(initialSelected) : new Set(corpRows.map(r => r.key))
  );
  const [search, setSearch] = useState('');
  const [expandedDoctors, setExpandedDoctors] = useState(() =>
    new Set((corpByDoctor || []).map(g => g.doctor.name))
  );

  // ── Column filters ──
  const [colFilters, setColFilters]     = useState(EMPTY_FILTERS);
  const [openFilter, setOpenFilter]     = useState(null);
  const [filterPos, setFilterPos]       = useState({ top: 0, left: 0 });
  const [filterSearch, setFilterSearch] = useState('');
  const filterDropdownRef               = useRef(null);

  useEffect(() => {
    if (!openFilter) return;
    const onDown = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target))
        setOpenFilter(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openFilter]);

  // ── Selection helpers ──
  const allChecked  = selected.size === corpRows.length;
  const noneChecked = selected.size === 0;

  const toggle = key => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(corpRows.map(r => r.key)));
  };

  const toggleGroup = (groupRows) => {
    const keys = groupRows.map(r => r.key);
    const allIn = keys.every(k => selected.has(k));
    setSelected(prev => {
      const next = new Set(prev);
      if (allIn) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
  };

  const toggleDoctor = name => setExpandedDoctors(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  // ── Row building ──
  const parseAmount = v =>
    parseFloat(String(v || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;

  const buildDisplayRows = rows => rows.map(({ row, key }) => ({
    key,
    date:         (colMap.invoiceCreatedDate || colMap.date) ? String(row[colMap.invoiceCreatedDate || colMap.date] || '') : '',
    payDate:      colMap.date             ? String(row[colMap.date]             || '').trim() : '',
    clinic:       colMap.clinic           ? String(row[colMap.clinic]           || '').trim() : '',
    patientCard:  colMap.patientCard      ? String(row[colMap.patientCard]      || '').trim() : '',
    patientName:  colMap.patientName      ? String(row[colMap.patientName]      || '').trim() : '',
    legalCompany: colMap.legalCompanyName ? String(row[colMap.legalCompanyName] || '').trim() : '',
    code:         colMap.serviceCode      ? String(row[colMap.serviceCode]      || '').trim() : '',
    serviceName:  colMap.serviceName      ? String(row[colMap.serviceName]      || '').trim() : '',
    executor:       colMap.executor         ? String(row[colMap.executor]         || '').trim() : '',
    assistant:      colMap.assistant        ? String(row[colMap.assistant]        || '').trim() : '',
    nurse:          colMap.nurse            ? String(row[colMap.nurse]            || '').trim() : '',
    anesthesiologist: colMap.anesthesiologist ? String(row[colMap.anesthesiologist] || '').trim() : '',
    amount: colMap.totalCost != null
      ? parseAmount(row[colMap.totalCost])
      : colMap.servicePrice ? parseAmount(row[colMap.servicePrice]) : 0,
  }));

  const allDisplayRows = useMemo(() => buildDisplayRows(corpRows), [corpRows, colMap]); // eslint-disable-line

  // ── Unique values for multi-select dropdowns (from all rows) ──
  const uniqueValues = useMemo(() => ({
    clinic:       [...new Set(allDisplayRows.map(r => r.clinic).filter(Boolean))].sort(),
    legalCompany: [...new Set(allDisplayRows.map(r => r.legalCompany).filter(Boolean))].sort(),
    code:         [...new Set(allDisplayRows.map(r => r.code).filter(Boolean))].sort(),
    executor:     [...new Set(allDisplayRows.map(r => r.executor).filter(Boolean))].sort(),
  }), [allDisplayRows]);

  // ── Filter logic ──
  const isFilterActive = (key) => {
    const f = colFilters[key];
    return f.type === 'dateRange' ? !!(f.from || f.to) : f.selected !== null;
  };
  const anyFilterActive = Object.keys(colFilters).some(isFilterActive);

  const openFilterDropdown = (key, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setFilterPos({ top: rect.bottom + 2, left: rect.left });
    setFilterSearch('');
    setOpenFilter(prev => prev === key ? null : key);
  };

  const clearFilter = (key) => setColFilters(prev => ({
    ...prev,
    [key]: prev[key].type === 'dateRange'
      ? { ...prev[key], from: '', to: '' }
      : { ...prev[key], selected: null },
  }));

  const clearAllFilters = () => setColFilters(EMPTY_FILTERS);

  const applyColumnFilters = (r) => {
    for (const field of ['date', 'payDate']) {
      const f = colFilters[field];
      if (f.from || f.to) {
        const rowDate = parseDisplayDate(r[field]);
        if (rowDate) {
          if (f.from && parseFilterDate(f.from) && rowDate < parseFilterDate(f.from)) return false;
          if (f.to   && parseFilterDate(f.to)   && rowDate > parseFilterDate(f.to))   return false;
        }
      }
    }
    for (const field of ['clinic', 'legalCompany', 'code', 'executor']) {
      const f = colFilters[field];
      if (f.selected !== null && !f.selected.has(r[field])) return false;
    }
    return true;
  };

  const filterRow = r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.patientCard, r.patientName, r.legalCompany, r.code, r.serviceName, r.executor, r.date, r.payDate, r.clinic]
      .some(v => v && v.toLowerCase().includes(q));
  };

  // ── Column visibility ──
  const showPayDate         = allDisplayRows.some(r => r.payDate);
  const showClinic          = allDisplayRows.some(r => r.clinic);
  const showPatientCard     = allDisplayRows.some(r => r.patientCard);
  const showPatientName     = allDisplayRows.some(r => r.patientName);
  const showLegalCompany    = allDisplayRows.some(r => r.legalCompany);
  const showCode            = allDisplayRows.some(r => r.code);
  const showExecutor        = allDisplayRows.some(r => r.executor);
  const showAssistant       = allDisplayRows.some(r => r.assistant);
  const showNurse           = allDisplayRows.some(r => r.nurse);
  const showAnesthesiologist = allDisplayRows.some(r => r.anesthesiologist);

  const totalAmount = allDisplayRows
    .filter(r => selected.has(r.key))
    .reduce((s, r) => s + r.amount, 0);

  const fmt = n => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const thStyle  = { padding: '9px 8px', textAlign: 'left',  fontWeight: 600, color: '#475569', whiteSpace: 'nowrap', background: '#f8fafc' };
  const thRStyle = { ...thStyle, textAlign: 'right' };
  const tdStyle  = { padding: '7px 8px', color: '#334155', fontSize: 13 };
  const tdNowrap = { ...tdStyle, whiteSpace: 'nowrap' };

  // ── Filter button in column header ──
  const FilterBtn = ({ field }) => (
    <button
      onMouseDown={(e) => { e.preventDefault(); openFilterDropdown(field, e); }}
      style={{
        background: openFilter === field ? '#eff6ff' : 'none',
        border: 'none', cursor: 'pointer',
        padding: '1px 3px', marginLeft: 3, verticalAlign: 'middle',
        color: isFilterActive(field) ? '#007AFF' : '#cbd5e1',
        lineHeight: 1, display: 'inline-flex', alignItems: 'center',
        borderRadius: 3, transition: 'color 0.15s',
      }}
      title={isFilterActive(field) ? 'Фильтр активен' : 'Фильтровать'}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
        <path d="M1.5 2h13l-5 6.5V14l-3-1.5V8.5L1.5 2z"/>
      </svg>
    </button>
  );

  // ── Table used inside bulk DoctorGroup ──
  function RowsTable({ rows }) {
    const displayRows = useMemo(
      () => buildDisplayRows(rows).filter(r => filterRow(r) && applyColumnFilters(r)),
      [rows] // eslint-disable-line
    );
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ ...thStyle, width: 36, textAlign: 'center' }} />
            <th style={thStyle}>Дата выставления <FilterBtn field="date" /></th>
            {showPayDate      && <th style={thStyle}>Дата оплаты <FilterBtn field="payDate" /></th>}
            {showClinic       && <th style={thStyle}>Клиника <FilterBtn field="clinic" /></th>}
            {showPatientCard  && <th style={thStyle}>№ карты</th>}
            {showPatientName  && <th style={thStyle}>ФИО пациента</th>}
            {showLegalCompany && <th style={thStyle}>Юр. компания <FilterBtn field="legalCompany" /></th>}
            {showCode              && <th style={thStyle}>Код <FilterBtn field="code" /></th>}
            <th style={thStyle}>Услуга</th>
            {showExecutor          && <th style={thStyle}>ФИО врача <FilterBtn field="executor" /></th>}
            {showAssistant         && <th style={thStyle}>Ассистент</th>}
            {showNurse             && <th style={thStyle}>Медсестра</th>}
            {showAnesthesiologist  && <th style={thStyle}>Анестезиолог</th>}
            <th style={thRStyle}>Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map(r => {
            const isChecked = selected.has(r.key);
            return (
              <tr key={r.key} onClick={() => toggle(r.key)}
                style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isChecked ? '#f0f9ff' : '#fff', transition: 'background 0.1s' }}>
                <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                  <input type="checkbox" checked={isChecked} onChange={() => toggle(r.key)} onClick={e => e.stopPropagation()}
                    style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }} />
                </td>
                <td style={tdNowrap}>{r.date || '—'}</td>
                {showPayDate           && <td style={tdNowrap}>{r.payDate || '—'}</td>}
                {showClinic            && <td style={tdNowrap}>{r.clinic || '—'}</td>}
                {showPatientCard       && <td style={tdNowrap}>{r.patientCard || '—'}</td>}
                {showPatientName       && <td style={{ ...tdStyle, minWidth: 130 }}>{r.patientName || '—'}</td>}
                {showLegalCompany      && <td style={{ ...tdStyle, minWidth: 110 }}>{r.legalCompany || '—'}</td>}
                {showCode              && <td style={tdNowrap}>{r.code || '—'}</td>}
                <td style={{ ...tdStyle, minWidth: 150 }}>{r.serviceName || '—'}</td>
                {showExecutor          && <td style={tdStyle}>{r.executor || '—'}</td>}
                {showAssistant         && <td style={tdStyle}>{r.assistant || '—'}</td>}
                {showNurse             && <td style={tdStyle}>{r.nurse || '—'}</td>}
                {showAnesthesiologist  && <td style={tdStyle}>{r.anesthesiologist || '—'}</td>}
                <td style={{ ...tdNowrap, textAlign: 'right', fontWeight: 500 }}>
                  {r.amount > 0 ? fmt(r.amount) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── Doctor group (bulk mode) ──
  function DoctorGroup({ doctor, rows }) {
    const filteredRows = useMemo(
      () => buildDisplayRows(rows).filter(r => filterRow(r) && applyColumnFilters(r)),
      [rows] // eslint-disable-line
    );
    if (filteredRows.length === 0 && (search || anyFilterActive)) return null;
    const isOpen   = (search || anyFilterActive) ? true : expandedDoctors.has(doctor.name);
    const keys     = rows.map(r => r.key);
    const allIn    = keys.every(k => selected.has(k));
    const someIn   = keys.some(k => selected.has(k));
    const countIn  = keys.filter(k => selected.has(k)).length;
    const groupAmt = buildDisplayRows(rows).filter(r => selected.has(r.key)).reduce((s, r) => s + r.amount, 0);

    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f8fafc', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => toggleDoctor(doctor.name)}>
          <input type="checkbox" checked={allIn}
            ref={el => { if (el) el.indeterminate = someIn && !allIn; }}
            onChange={() => toggleGroup(rows)} onClick={e => e.stopPropagation()}
            style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14, flexShrink: 0 }}
            title={allIn ? 'Снять все по врачу' : 'Выбрать все по врачу'} />
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{doctor.name}</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {countIn} / {rows.length} выбрано
            {groupAmt > 0 && <span style={{ marginLeft: 6, color: '#0369a1' }}>· {fmt(groupAmt)} ₽</span>}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</span>
        </div>
        {isOpen && (
          <div style={{ overflowX: 'auto' }}>
            <RowsTable rows={rows} />
          </div>
        )}
      </div>
    );
  }

  // ── Filter dropdown (rendered fixed, outside modal stacking context) ──
  const renderFilterDropdown = () => {
    if (!openFilter) return null;
    const f    = colFilters[openFilter];
    const vals = uniqueValues[openFilter] || [];
    const filteredVals = filterSearch
      ? vals.filter(v => v.toLowerCase().includes(filterSearch.toLowerCase()))
      : vals;

    return (
      <div ref={filterDropdownRef} style={{
        position: 'fixed', top: filterPos.top, left: filterPos.left,
        zIndex: 9999, background: '#fff',
        border: '1px solid #e2e8f0', borderRadius: 8,
        boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
        minWidth: f.type === 'dateRange' ? 200 : 250,
        maxHeight: 360, display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit', fontSize: 13,
      }}>
        {/* Header */}
        <div style={{ padding: '9px 12px 7px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 12 }}>{FILTER_LABELS[openFilter]}</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {isFilterActive(openFilter) && (
              <button onClick={() => clearFilter(openFilter)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11, padding: '2px 5px', borderRadius: 4, fontFamily: 'inherit' }}>
                Сбросить
              </button>
            )}
            <button onClick={() => setOpenFilter(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16, padding: '0 3px', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {f.type === 'dateRange' ? (
          <div style={{ padding: '12px 14px' }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>С</div>
              <input type="text" placeholder="ДД.ММ.ГГГГ" value={f.from}
                onChange={e => setColFilters(prev => ({ ...prev, [openFilter]: { ...prev[openFilter], from: e.target.value } }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>По</div>
              <input type="text" placeholder="ДД.ММ.ГГГГ" value={f.to}
                onChange={e => setColFilters(prev => ({ ...prev, [openFilter]: { ...prev[openFilter], to: e.target.value } }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Search within options */}
            <div style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
              <input type="text" placeholder="Поиск..." value={filterSearch} autoFocus
                onChange={e => setFilterSearch(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
            {/* Select all */}
            <div style={{ padding: '5px 10px', borderBottom: '1px solid #f1f5f9' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, color: '#475569', userSelect: 'none' }}>
                <input type="checkbox" checked={f.selected === null}
                  onChange={() => {
                    if (f.selected !== null)
                      setColFilters(prev => ({ ...prev, [openFilter]: { ...prev[openFilter], selected: null } }));
                  }}
                  style={{ accentColor: 'var(--rb-primary)', width: 13, height: 13 }}
                />
                <span style={{ fontStyle: 'italic' }}>(Выбрать все)</span>
              </label>
            </div>
            {/* Options */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredVals.map(v => {
                const isChecked = f.selected === null || f.selected.has(v);
                return (
                  <label key={v}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: '#334155', userSelect: 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <input type="checkbox" checked={isChecked}
                      onChange={() => {
                        setColFilters(prev => {
                          const cur = prev[openFilter];
                          let newSel;
                          if (cur.selected === null) {
                            newSel = new Set(vals.filter(x => x !== v));
                          } else {
                            newSel = new Set(cur.selected);
                            if (newSel.has(v)) newSel.delete(v); else newSel.add(v);
                            if (newSel.size === vals.length) newSel = null;
                          }
                          return { ...prev, [openFilter]: { ...cur, selected: newSel } };
                        });
                      }}
                      style={{ accentColor: 'var(--rb-primary)', width: 13, height: 13, flexShrink: 0 }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '(пусто)'}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Main render ──
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        width: 'min(1800px, 99vw)', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b' }}>
                Оплаты юридическими компаниями
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
                {isBulk
                  ? `Найдено ${corpRows.length} транзакций по ${(corpByDoctor || []).length} врачам. Выберите какие учитывать в зарплате.`
                  : `Найдено ${corpRows.length} транзакций за период. Отметьте те, которые нужно учесть в зарплате.`
                }
              </div>
            </div>
            {isBulk && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', flexShrink: 0 }}>
                <input type="checkbox" checked={allChecked}
                  ref={el => { if (el) el.indeterminate = !noneChecked && !allChecked; }}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                  title="Выбрать / снять все"
                />
                <span>Все врачи</span>
              </div>
            )}
            <button onClick={onCancel}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#94a3b8', fontSize: 20, lineHeight: 1, flexShrink: 0 }}
              title="Отмена">×</button>
          </div>

          {/* Search + filter reset */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" width="15" height="15"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" placeholder="Поиск по пациенту, услуге, юр. компании, дате..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px 8px 32px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: search ? '#f0f9ff' : '#f8fafc', color: '#1e293b' }}
              />
              {search && (
                <button onClick={() => setSearch('')}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
              )}
            </div>
            {anyFilterActive && (
              <button onClick={clearAllFilters}
                style={{ padding: '7px 12px', fontSize: 12, border: '1px solid #bfdbfe', borderRadius: 7, background: '#eff6ff', color: '#007AFF', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }}>
                Сбросить фильтры
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
          {isBulk && corpByDoctor ? (
            (corpByDoctor || []).map(({ doctor, rows }) => (
              <DoctorGroup key={doctor.name} doctor={doctor} rows={rows} />
            ))
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ ...thStyle, width: 36, textAlign: 'center' }}>
                      <input type="checkbox" checked={allChecked}
                        ref={el => { if (el) el.indeterminate = !noneChecked && !allChecked; }}
                        onChange={toggleAll}
                        style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                        title="Выбрать / снять все" />
                    </th>
                    <th style={thStyle}>Дата выставления <FilterBtn field="date" /></th>
                    {showPayDate      && <th style={thStyle}>Дата оплаты <FilterBtn field="payDate" /></th>}
                    {showClinic       && <th style={thStyle}>Клиника <FilterBtn field="clinic" /></th>}
                    {showPatientCard  && <th style={thStyle}>№ карты</th>}
                    {showPatientName  && <th style={thStyle}>ФИО пациента</th>}
                    {showLegalCompany && <th style={thStyle}>Юр. компания <FilterBtn field="legalCompany" /></th>}
                    {showCode              && <th style={thStyle}>Код <FilterBtn field="code" /></th>}
                    <th style={thStyle}>Услуга</th>
                    {showExecutor          && <th style={thStyle}>ФИО врача <FilterBtn field="executor" /></th>}
                    {showAssistant         && <th style={thStyle}>Ассистент</th>}
                    {showNurse             && <th style={thStyle}>Медсестра</th>}
                    {showAnesthesiologist  && <th style={thStyle}>Анестезиолог</th>}
                    <th style={thRStyle}>Сумма, ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {allDisplayRows.filter(r => filterRow(r) && applyColumnFilters(r)).map(r => {
                    const isChecked = selected.has(r.key);
                    return (
                      <tr key={r.key} onClick={() => toggle(r.key)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isChecked ? '#f0f9ff' : '#fff', transition: 'background 0.1s' }}>
                        <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                          <input type="checkbox" checked={isChecked} onChange={() => toggle(r.key)} onClick={e => e.stopPropagation()}
                            style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }} />
                        </td>
                        <td style={tdNowrap}>{r.date || '—'}</td>
                        {showPayDate           && <td style={tdNowrap}>{r.payDate || '—'}</td>}
                        {showClinic            && <td style={tdNowrap}>{r.clinic || '—'}</td>}
                        {showPatientCard       && <td style={tdNowrap}>{r.patientCard || '—'}</td>}
                        {showPatientName       && <td style={{ ...tdStyle, minWidth: 130 }}>{r.patientName || '—'}</td>}
                        {showLegalCompany      && <td style={{ ...tdStyle, minWidth: 110 }}>{r.legalCompany || '—'}</td>}
                        {showCode              && <td style={tdNowrap}>{r.code || '—'}</td>}
                        <td style={{ ...tdStyle, minWidth: 150 }}>{r.serviceName || '—'}</td>
                        {showExecutor          && <td style={tdStyle}>{r.executor || '—'}</td>}
                        {showAssistant         && <td style={tdStyle}>{r.assistant || '—'}</td>}
                        {showNurse             && <td style={tdStyle}>{r.nurse || '—'}</td>}
                        {showAnesthesiologist  && <td style={tdStyle}>{r.anesthesiologist || '—'}</td>}
                        <td style={{ ...tdNowrap, textAlign: 'right', fontWeight: 500 }}>
                          {r.amount > 0 ? fmt(r.amount) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, fontSize: 13, color: '#475569' }}>
            Выбрано: <b style={{ color: '#1e293b' }}>{selected.size}</b> из {corpRows.length}
            {totalAmount > 0 && (
              <span style={{ marginLeft: 8, color: '#0369a1' }}>· {fmt(totalAmount)} ₽</span>
            )}
          </div>
          <button onClick={onCancel}
            style={{ padding: '8px 16px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer' }}>
            Отмена
          </button>
          <button onClick={() => onConfirm(new Set())}
            style={{ padding: '8px 16px', fontSize: 13, border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
            title="Исключить все юр.компании из расчёта">
            Исключить все
          </button>
          <button onClick={() => onConfirm(selected)}
            style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer' }}>
            Учесть выбранные ({selected.size})
          </button>
        </div>
      </div>

      {/* Filter dropdown — fixed positioned, always on top */}
      {renderFilterDropdown()}
    </div>
  );
}
