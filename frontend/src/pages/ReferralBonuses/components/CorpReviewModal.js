import React, { useState, useMemo } from 'react';

/**
 * Modal for reviewing corp-paid transactions before report generation.
 * User selects which individual payments to include in salary calculation.
 *
 * Props:
 *   corpRows     — array of { row, key } from extractCorpRows() (all rows)
 *   corpByDoctor — array of { doctor, rows } — grouped for bulk mode (optional)
 *   colMap       — column map from rbMapNewColumns()
 *   isBulk       — boolean, show grouped layout
 *   onConfirm    — (includedKeys: Set<string>) => void
 *   onCancel     — () => void
 */
export default function CorpReviewModal({ corpRows, corpByDoctor, colMap, isBulk, initialSelected, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(() =>
    initialSelected instanceof Set ? new Set(initialSelected) : new Set(corpRows.map(r => r.key))
  );
  const [search, setSearch] = useState('');
  // Which doctor sections are expanded (bulk mode)
  const [expandedDoctors, setExpandedDoctors] = useState(() =>
    new Set((corpByDoctor || []).map(g => g.doctor.name))
  );

  const allChecked  = selected.size === corpRows.length;
  const noneChecked = selected.size === 0;

  const toggle = key => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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

  const toggleDoctor = name => {
    setExpandedDoctors(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const parseAmount = v =>
    parseFloat(String(v || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;

  const buildDisplayRows = rows => rows.map(({ row, key }) => ({
    key,
    date:         (colMap.invoiceCreatedDate || colMap.date) ? String(row[colMap.invoiceCreatedDate || colMap.date] || '') : '',
    patientCard:  colMap.patientCard     ? String(row[colMap.patientCard]      || '').trim() : '',
    patientName:  colMap.patientName     ? String(row[colMap.patientName]      || '').trim() : '',
    legalCompany: colMap.legalCompanyName ? String(row[colMap.legalCompanyName] || '').trim() : '',
    code:         colMap.serviceCode     ? String(row[colMap.serviceCode]      || '').trim() : '',
    serviceName:  colMap.serviceName     ? String(row[colMap.serviceName]      || '').trim() : '',
    executor:     colMap.executor        ? String(row[colMap.executor]          || '').trim() : '',
    amount: colMap.totalCost != null
      ? parseAmount(row[colMap.totalCost])
      : colMap.servicePrice ? parseAmount(row[colMap.servicePrice]) : 0,
  }));

  const allDisplayRows = useMemo(() => buildDisplayRows(corpRows), [corpRows, colMap]); // eslint-disable-line

  const filterRow = r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.patientCard, r.patientName, r.legalCompany, r.code, r.serviceName, r.executor, r.date]
      .some(v => v && v.toLowerCase().includes(q));
  };

  const showPatientCard  = allDisplayRows.some(r => r.patientCard);
  const showPatientName  = allDisplayRows.some(r => r.patientName);
  const showLegalCompany = allDisplayRows.some(r => r.legalCompany);
  const showCode         = allDisplayRows.some(r => r.code);
  // Executor column only in flat mode (bulk groups by doctor already)
  const showExecutor     = !isBulk && allDisplayRows.some(r => r.executor);

  const totalAmount = allDisplayRows
    .filter(r => selected.has(r.key))
    .reduce((s, r) => s + r.amount, 0);

  const fmt = n => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const thStyle  = { padding: '9px 8px', textAlign: 'left',  fontWeight: 600, color: '#475569', whiteSpace: 'nowrap', background: '#f8fafc' };
  const thRStyle = { ...thStyle, textAlign: 'right' };

  // Number of visible columns (for colSpan use)
  function RowsTable({ rows }) {
    const displayRows = useMemo(() => buildDisplayRows(rows).filter(filterRow), [rows]); // eslint-disable-line
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ ...thStyle, width: 36, textAlign: 'center' }} />
            <th style={thStyle}>Дата</th>
            {showPatientCard  && <th style={thStyle}>№ карты</th>}
            {showPatientName  && <th style={thStyle}>ФИО пациента</th>}
            {showLegalCompany && <th style={thStyle}>Юр. компания</th>}
            {showCode         && <th style={thStyle}>Код</th>}
            <th style={thStyle}>Услуга</th>
            {showExecutor     && <th style={thStyle}>Исполнитель</th>}
            <th style={thRStyle}>Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map(r => {
            const isChecked = selected.has(r.key);
            return (
              <tr
                key={r.key}
                onClick={() => toggle(r.key)}
                style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isChecked ? '#f0f9ff' : '#fff', transition: 'background 0.1s' }}
              >
                <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                  <input
                    type="checkbox" checked={isChecked}
                    onChange={() => toggle(r.key)}
                    onClick={e => e.stopPropagation()}
                    style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                  />
                </td>
                <td style={{ padding: '7px 8px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.date || '—'}</td>
                {showPatientCard && (
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{r.patientCard || '—'}</td>
                )}
                {showPatientName && (
                  <td style={{ padding: '7px 8px', color: '#1e293b', minWidth: 130 }}>{r.patientName || '—'}</td>
                )}
                {showLegalCompany && (
                  <td style={{ padding: '7px 8px', color: '#7c3aed', fontSize: 12, minWidth: 110 }}>{r.legalCompany || '—'}</td>
                )}
                {showCode && (
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.code || '—'}</td>
                )}
                <td style={{ padding: '7px 8px', color: '#334155', minWidth: 150 }}>{r.serviceName || '—'}</td>
                {showExecutor && (
                  <td style={{ padding: '7px 8px', color: '#475569', fontSize: 12 }}>{r.executor || '—'}</td>
                )}
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 500, color: isChecked ? '#0369a1' : '#64748b', whiteSpace: 'nowrap' }}>
                  {r.amount > 0 ? fmt(r.amount) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function DoctorGroup({ doctor, rows }) {
    const filteredRows = useMemo(() => buildDisplayRows(rows).filter(filterRow), [rows]); // eslint-disable-line
    if (filteredRows.length === 0 && search) return null;
    const isOpen   = search ? true : expandedDoctors.has(doctor.name);
    const keys     = rows.map(r => r.key);
    const allIn    = keys.every(k => selected.has(k));
    const someIn   = keys.some(k => selected.has(k));
    const countIn  = keys.filter(k => selected.has(k)).length;
    const groupAmt = buildDisplayRows(rows).filter(r => selected.has(r.key)).reduce((s, r) => s + r.amount, 0);

    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
        {/* Group header */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f8fafc', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => toggleDoctor(doctor.name)}
        >
          {/* Group checkbox */}
          <input
            type="checkbox"
            checked={allIn}
            ref={el => { if (el) el.indeterminate = someIn && !allIn; }}
            onChange={() => toggleGroup(rows)}
            onClick={e => e.stopPropagation()}
            style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14, flexShrink: 0 }}
            title={allIn ? 'Снять все по врачу' : 'Выбрать все по врачу'}
          />
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{doctor.name}</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {countIn} / {rows.length} выбрано
            {groupAmt > 0 && <span style={{ marginLeft: 6, color: '#0369a1' }}>· {fmt(groupAmt)} ₽</span>}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</span>
        </div>
        {/* Rows table */}
        {isOpen && (
          <div style={{ overflowX: 'auto' }}>
            <RowsTable rows={rows} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        width: 'min(1100px, 96vw)', maxHeight: '85vh',
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
            {/* Global select all (for bulk - controls all groups) */}
            {isBulk && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = !noneChecked && !allChecked; }}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                  title="Выбрать / снять все"
                />
                <span>Все врачи</span>
              </div>
            )}
            <button
              onClick={onCancel}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#94a3b8', fontSize: 20, lineHeight: 1, flexShrink: 0 }}
              title="Отмена"
            >×</button>
          </div>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" width="15" height="15"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Поиск по пациенту, услуге, юр. компании, дате..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 32px 8px 32px',
                border: '1px solid #e2e8f0', borderRadius: 8,
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
                background: search ? '#f0f9ff' : '#f8fafc',
                color: '#1e293b',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 2 }}
                title="Очистить поиск"
              >×</button>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
          {isBulk && corpByDoctor ? (
            // Grouped by doctor
            (corpByDoctor || []).map(({ doctor, rows }) => (
              <DoctorGroup key={doctor.name} doctor={doctor} rows={rows} />
            ))
          ) : (
            // Flat table (individual report)
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ ...thStyle, width: 36, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = !noneChecked && !allChecked; }}
                        onChange={toggleAll}
                        style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                        title="Выбрать / снять все"
                      />
                    </th>
                    <th style={thStyle}>Дата</th>
                    {showPatientCard  && <th style={thStyle}>№ карты</th>}
                    {showPatientName  && <th style={thStyle}>ФИО пациента</th>}
                    {showLegalCompany && <th style={thStyle}>Юр. компания</th>}
                    {showCode         && <th style={thStyle}>Код</th>}
                    <th style={thStyle}>Услуга</th>
                    {showExecutor     && <th style={thStyle}>Исполнитель</th>}
                    <th style={thRStyle}>Сумма, ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {allDisplayRows.filter(filterRow).map(r => {
                    const isChecked = selected.has(r.key);
                    return (
                      <tr
                        key={r.key}
                        onClick={() => toggle(r.key)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isChecked ? '#f0f9ff' : '#fff', transition: 'background 0.1s' }}
                      >
                        <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                          <input
                            type="checkbox" checked={isChecked}
                            onChange={() => toggle(r.key)}
                            onClick={e => e.stopPropagation()}
                            style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                          />
                        </td>
                        <td style={{ padding: '7px 8px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.date || '—'}</td>
                        {showPatientCard && (
                          <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{r.patientCard || '—'}</td>
                        )}
                        {showPatientName && (
                          <td style={{ padding: '7px 8px', color: '#1e293b', minWidth: 130 }}>{r.patientName || '—'}</td>
                        )}
                        {showLegalCompany && (
                          <td style={{ padding: '7px 8px', color: '#7c3aed', fontSize: 12, minWidth: 110 }}>{r.legalCompany || '—'}</td>
                        )}
                        {showCode && (
                          <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.code || '—'}</td>
                        )}
                        <td style={{ padding: '7px 8px', color: '#334155', minWidth: 150 }}>{r.serviceName || '—'}</td>
                        {showExecutor && (
                          <td style={{ padding: '7px 8px', color: '#475569', fontSize: 12 }}>{r.executor || '—'}</td>
                        )}
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 500, color: isChecked ? '#0369a1' : '#64748b', whiteSpace: 'nowrap' }}>
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
          <button
            onClick={onCancel}
            style={{ padding: '8px 16px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer' }}
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(new Set())}
            style={{ padding: '8px 16px', fontSize: 13, border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
            title="Исключить все юр.компании из расчёта"
          >
            Исключить все
          </button>
          <button
            onClick={() => onConfirm(selected)}
            style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer' }}
          >
            Учесть выбранные ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
