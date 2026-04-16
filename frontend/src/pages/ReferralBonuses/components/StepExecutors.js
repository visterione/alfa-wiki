import React, { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { executorSettings, performedServiceBonuses, referralBonuses } from '../../../services/api';
import { clearExecCache } from '../utils/reportEngine';
import { useTabSlider } from '../utils/useTabSlider';

const DEFAULT_SUGGESTS = {
  deductions:   ['НДФЛ', 'Штраф', 'Взыскание', 'Кредит', 'Алименты', 'Удержание'],
  materials:    ['Расходники', 'Медикаменты', 'Инструменты', 'Перевязочный материал', 'Реагенты'],
  extras:       ['Дежурство', 'Обучение', 'Сверхурочные', 'Премия', 'Командировка'],
  extrasNormed: ['Отпускные', 'Увольнение'],
  normServices: ['Консультация', 'Приём', 'Процедура', 'Операция', 'Диагностика'],
};

function execClinicDefault() {
  return {
    payType: 'salary',
    fixedSalary: 0,
    hourlyRate: 0,
    hoursWorked: 0,
    executorPercent: 0,
    plusPercent: false,
    paymentMethod: 'card',
    mainPaymentMethod: 'card',
    advance: 0,
    mainPayment: 0,
    extraPayments: [],
    includeReferralBonuses: true,
    includeReferralDeductions: true,
    includeCorpInvoices: true,
    assistancePercent: 0,
    cabinets: [],
    deductions: [],
    materials: [],
    serviceMaterials: [],
    extras: [],
    normServices: [],
    harmfulness: false,
  };
}

function execDefault() {
  return { assistants: [], clinicSettings: { global: execClinicDefault() } };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LockBtn({ locked, onClick }) {
  return (
    <button
      className="rb-btn rb-btn-xs"
      onClick={onClick}
      title={locked ? 'Снять фиксацию (будет сброшен)' : 'Зафиксировать (не сбрасывать)'}
      style={{ color: locked ? '#007AFF' : '#cbd5e1', background: 'transparent', border: 'none', padding: '0 2px', lineHeight: 1 }}
    >
      <svg viewBox="0 0 24 24" fill={locked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" width="13" height="13">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        {locked
          ? <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          : <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        }
      </svg>
    </button>
  );
}

function ItemsList({ items, section, onDelete, onUpdate, readOnly }) {
  const [editIdx, setEditIdx] = useState(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editValueType, setEditValueType] = useState('percent');
  const [editDeductionType, setEditDeductionType] = useState('final');
  const showDeductionType = section === 'deductions' || section === 'materials';

  if (!items || !items.length) return null;

  const startEdit = (i) => {
    setEditIdx(i);
    setEditName(items[i].name);
    setEditValue(String(items[i].value ?? ''));
    setEditValueType(items[i].valueType || 'percent');
    setEditDeductionType(items[i].deductionType || 'final');
  };
  const commitEdit = (i) => {
    const name = editName.trim();
    const val = parseFloat(editValue);
    if (!name || isNaN(val) || val < 0) { setEditIdx(null); return; }
    onUpdate(section, i, { ...items[i], name, value: val, valueType: editValueType, deductionType: showDeductionType ? editDeductionType : items[i].deductionType });
    setEditIdx(null);
  };

  return (
    <div className="rb-exec-items">
      {items.map((item, i) => (
        <div key={i} className="rb-exec-item" style={item.locked ? { background: '#eff6ff' } : {}}>
          {editIdx === i ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
              <input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(i); if (e.key === 'Escape') setEditIdx(null); }}
                placeholder="Название"
                style={{ flex: 1, minWidth: 80, padding: '4px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }}
              />
              <input
                type="number" min="0" step="any"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(i); if (e.key === 'Escape') setEditIdx(null); }}
                style={{ width: 70, padding: '4px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }}
              />
              <div className="rb-exec-type-toggle">
                <button className={`rb-exec-type-btn${editValueType === 'percent' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setEditValueType('percent')}>%</button>
                <button className={`rb-exec-type-btn${editValueType === 'rub' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setEditValueType('rub')}>₽</button>
              </div>
              {showDeductionType && (
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${editDeductionType === 'final' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setEditDeductionType('final')} title="от з/п">з/п</button>
                  <button className={`rb-exec-type-btn${editDeductionType === 'turnover' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setEditDeductionType('turnover')} title="от оборота">обор.</button>
                </div>
              )}
              <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={() => commitEdit(i)} title="Сохранить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button className="rb-btn rb-btn-xs" onClick={() => setEditIdx(null)} title="Отмена" style={{ color: '#94a3b8' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <>
              <div
                className="rb-exec-item-name"
                style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: readOnly ? 'default' : 'pointer' }}
                onClick={() => !readOnly && startEdit(i)}
                title={readOnly ? undefined : 'Нажмите для редактирования'}
              >
                {item.name}
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: readOnly ? 'default' : 'pointer' }}
                onClick={() => !readOnly && startEdit(i)}
              >
                {showDeductionType && (
                  <span style={{ fontSize: 10, color: '#fff', background: 'var(--rb-primary)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', width: 52, textAlign: 'center', display: 'inline-block' }}>
                    {item.deductionType === 'turnover' ? 'оборот' : 'от з/п'}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--rb-danger)', fontWeight: 600, whiteSpace: 'nowrap', width: 64, textAlign: 'right', display: 'inline-block' }}>
                  {item.valueType === 'percent' ? `${item.value}%` : `${item.value} ₽`}
                </span>
              </div>
            </>
          )}
          {!readOnly && editIdx !== i && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <LockBtn locked={!!item.locked} onClick={() => onUpdate(section, i, { ...item, locked: !item.locked })} />
              <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(section, i)} title="Удалить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExtrasList({ extras, onDelete, onUpdate, readOnly }) {
  const [editIdx, setEditIdx] = useState(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editHours, setEditHours] = useState('');

  if (!extras || !extras.length) return null;

  const startEdit = (i) => {
    setEditIdx(i);
    setEditName(extras[i].name);
    setEditAmount(String(extras[i].amount ?? ''));
    setEditHours(String(extras[i].hours ?? ''));
  };
  const commitEdit = (i) => {
    const name = editName.trim();
    const amount = parseFloat(editAmount);
    if (!name || isNaN(amount) || amount < 0) { setEditIdx(null); return; }
    const hours = parseFloat(editHours) || 0;
    onUpdate(i, { ...extras[i], name, amount, hours });
    setEditIdx(null);
  };

  return (
    <div className="rb-exec-items">
      {extras.map((e, i) => (
        <div key={i} className="rb-exec-item" style={e.locked ? { background: '#eff6ff' } : {}}>
          {editIdx === i ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
              <input
                autoFocus
                value={editName}
                onChange={ev => setEditName(ev.target.value)}
                onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(i); if (ev.key === 'Escape') setEditIdx(null); }}
                placeholder="Название"
                style={{ flex: 1, minWidth: 80, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }}
              />
              <input
                type="number" min="0" step="any"
                value={editAmount}
                onChange={ev => setEditAmount(ev.target.value)}
                onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(i); if (ev.key === 'Escape') setEditIdx(null); }}
                placeholder="₽"
                style={{ width: 70, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }}
              />
              <input
                type="number" min="0" step="0.5"
                value={editHours}
                onChange={ev => setEditHours(ev.target.value)}
                onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(i); if (ev.key === 'Escape') setEditIdx(null); }}
                placeholder="ч"
                style={{ width: 50, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }}
              />
              <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={() => commitEdit(i)} title="Сохранить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button className="rb-btn rb-btn-xs" onClick={() => setEditIdx(null)} title="Отмена" style={{ color: '#94a3b8' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <>
              <div
                className="rb-exec-item-name"
                style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: readOnly ? 'default' : 'pointer' }}
                onClick={() => !readOnly && startEdit(i)}
                title={readOnly ? undefined : 'Нажмите для редактирования'}
              >{e.name}</div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: readOnly ? 'default' : 'pointer' }}
                onClick={() => !readOnly && startEdit(i)}
              >
                {e.hours > 0 && (
                  <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', width: 44, textAlign: 'right', display: 'inline-block' }}>{e.hours} ч.</span>
                )}
                <span style={{ fontSize: 12, color: 'var(--rb-success)', fontWeight: 600, whiteSpace: 'nowrap', width: 70, textAlign: 'right', display: 'inline-block' }}>{e.amount} ₽</span>
              </div>
            </>
          )}
          {!readOnly && editIdx !== i && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <LockBtn locked={!!e.locked} onClick={() => onUpdate(i, { ...e, locked: !e.locked })} />
              <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Norm services list ────────────────────────────────────────────────────────

function NormServicesList({ items, onDelete, onUpdate, readOnly }) {
  const [editIdx, setEditIdx] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRate, setEditRate] = useState('');
  const [editHours, setEditHours] = useState('');

  if (!items || !items.length) return null;

  const startEdit = (i) => {
    setEditIdx(i);
    setEditName(items[i].name);
    setEditRate(String(items[i].rate ?? ''));
    setEditHours(String(items[i].hours ?? ''));
  };
  const commitEdit = (i) => {
    const name = editName.trim();
    const rate = items[i].lockedRate ? items[i].rate : (parseFloat(editRate) || 0);
    const hours = items[i].lockedHours ? items[i].hours : (parseFloat(editHours) || 0);
    if (!name || rate < 0 || hours < 0) { setEditIdx(null); return; }
    onUpdate(i, { ...items[i], name, rate, hours });
    setEditIdx(null);
  };

  return (
    <div className="rb-exec-items">
      {items.map((item, i) => (
        <div key={i} className="rb-exec-item" style={item.locked ? { background: '#eff6ff' } : {}}>
          {editIdx === i ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
              <input autoFocus value={editName} onChange={ev => setEditName(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(i); if (ev.key === 'Escape') setEditIdx(null); }} placeholder="Деятельность" style={{ flex: 1, minWidth: 80, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }} />
              <input type="number" min="0" step="any" value={editRate} onChange={ev => setEditRate(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(i); if (ev.key === 'Escape') setEditIdx(null); }} placeholder="₽/ч" disabled={!!item.lockedRate} style={{ width: 70, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', opacity: item.lockedRate ? 0.6 : 1 }} />
              <input type="number" min="0" step="0.5" value={editHours} onChange={ev => setEditHours(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(i); if (ev.key === 'Escape') setEditIdx(null); }} placeholder="ч" disabled={!!item.lockedHours} style={{ width: 50, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', opacity: item.lockedHours ? 0.6 : 1 }} />
              <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={() => commitEdit(i)} title="Сохранить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button className="rb-btn rb-btn-xs" onClick={() => setEditIdx(null)} title="Отмена" style={{ color: '#94a3b8' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <div className="rb-exec-item-name" style={{ flex: 1, minWidth: 0 }}>
              <span onClick={() => !readOnly && startEdit(i)} title={readOnly ? undefined : 'Нажмите для редактирования'} style={{ cursor: readOnly ? 'default' : 'pointer' }}>{item.name}</span>
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                {item.lockedRate && <span style={{ color: '#007AFF', marginRight: 2 }}>🔒</span>}{item.rate} ₽/ч × {item.lockedHours && <span style={{ color: '#007AFF', marginRight: 2 }}>🔒</span>}{item.hours} ч.
              </span>
              <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--rb-success)', fontWeight: 600 }}>= {((parseFloat(item.rate) || 0) * (parseFloat(item.hours) || 0)).toFixed(2)} ₽</span>
            </div>
          )}
          {!readOnly && editIdx !== i && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <LockBtn locked={!!item.lockedRate} onClick={() => onUpdate(i, { ...item, lockedRate: !item.lockedRate })} title={item.lockedRate ? 'Снять фиксацию ставки' : 'Зафиксировать ставку'} />
              <LockBtn locked={!!item.lockedHours} onClick={() => onUpdate(i, { ...item, lockedHours: !item.lockedHours })} title={item.lockedHours ? 'Снять фиксацию часов' : 'Зафиксировать часы'} />
              <LockBtn locked={!!item.locked} onClick={() => onUpdate(i, { ...item, locked: !item.locked })} />
              <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Norm service add form ─────────────────────────────────────────────────────

function NormServiceAddForm({ form, setForm, onAdd, readOnly, visible, suggests, onEditSuggests }) {
  if (readOnly || !visible) return null;
  return (
    <div className="rb-exec-add-form visible" style={{ marginBottom: 8 }}>
      {suggests && suggests.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div className="rb-exec-suggests" style={{ flex: 1, marginBottom: 0 }}>
            {suggests.map(s => (
              <span key={s} className="rb-exec-suggest" onClick={() => setForm(f => ({ ...f, name: s }))}>{s}</span>
            ))}
          </div>
          {onEditSuggests && (
            <button onClick={onEditSuggests} title="Редактировать подсказки" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--rb-text-secondary)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
        </div>
      )}
      <div className="rb-exec-add-row">
        <div className="rb-exec-add-field flex-grow">
          <label>Вид деятельности</label>
          <input type="text" placeholder="Название..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="rb-exec-add-field">
          <label>Ставка, ₽/ч</label>
          <input type="number" placeholder="0" min="0" step="any" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} style={{ width: 90 }} />
        </div>
        <div className="rb-exec-add-field">
          <label>Часов</label>
          <input type="number" placeholder="0" min="0" step="0.5" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} style={{ width: 70 }} />
        </div>
        <div style={{ paddingBottom: 1 }}>
          <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={onAdd}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function SvcMaterialsList({ items, onDelete, onUpdate, readOnly }) {
  const [editIdx, setEditIdx] = useState(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editValueType, setEditValueType] = useState('percent');

  if (!items || !items.length) return null;

  const startEdit = (i) => {
    setEditIdx(i);
    setEditName(items[i].name || '');
    setEditValue(String(items[i].value ?? ''));
    setEditValueType(items[i].valueType || 'percent');
  };
  const commitEdit = (i) => {
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) { setEditIdx(null); return; }
    onUpdate(i, { ...items[i], name: editName.trim() || items[i].serviceName, value: val, valueType: editValueType });
    setEditIdx(null);
  };

  return (
    <div className="rb-exec-items">
      {items.map((item, i) => {
        const svcLabel = item.serviceName || item.serviceCode || '—';
        const matLabel = item.name && item.name !== svcLabel ? item.name : null;
        return (
          <div key={i} className="rb-exec-item" style={item.locked ? { background: '#eff6ff' } : {}}>
            {editIdx === i ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{svcLabel}</span>
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(i); if (e.key === 'Escape') setEditIdx(null); }}
                  placeholder="Название расходника"
                  style={{ flex: 1, minWidth: 80, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }}
                />
                <input
                  type="number" min="0" step="any"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(i); if (e.key === 'Escape') setEditIdx(null); }}
                  style={{ width: 70, padding: '2px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }}
                />
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${editValueType === 'percent' ? ' active' : ''}`} onClick={() => setEditValueType('percent')}>%</button>
                  <button className={`rb-exec-type-btn${editValueType === 'rub' ? ' active' : ''}`} onClick={() => setEditValueType('rub')}>₽</button>
                </div>
                <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={() => commitEdit(i)} title="Сохранить">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button className="rb-btn rb-btn-xs" onClick={() => setEditIdx(null)} title="Отмена" style={{ color: '#94a3b8' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ) : (
              <div className="rb-exec-item-name" style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{svcLabel}</span>
                {matLabel && (
                  <span
                    onClick={() => !readOnly && startEdit(i)}
                    title={readOnly ? undefined : 'Нажмите для редактирования'}
                    style={{ fontSize: 11, color: 'var(--rb-text-secondary)', cursor: readOnly ? 'default' : 'pointer' }}
                  >{' → '}{matLabel}</span>
                )}
                <span
                  onClick={() => !readOnly && startEdit(i)}
                  title={readOnly ? undefined : 'Нажмите для редактирования'}
                  style={{ marginLeft: 6, fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 600, cursor: readOnly ? 'default' : 'pointer' }}
                >
                  {item.valueType === 'percent' ? `${item.value}%` : `${item.value} ₽`}
                </span>
                {item.deductionType === 'turnover'
                  ? <span style={{ marginLeft: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '1px 5px' }}>оборот</span>
                  : <span style={{ marginLeft: 4, fontSize: 10, color: '#64748b', background: '#fff7ed', borderRadius: 4, padding: '1px 5px' }}>от з/п</span>
                }
              </div>
            )}
            {!readOnly && editIdx !== i && (
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                <LockBtn locked={!!item.locked} onClick={() => onUpdate(i, { ...item, locked: !item.locked })} />
                <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SuggestsEditorModal({ title, items, onSave, onClose }) {
  const [draft, setDraft] = useState([...items]);
  const [newItem, setNewItem] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editingVal, setEditingVal] = useState('');
  const dragIdx = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const add = () => {
    if (!newItem.trim()) return;
    setDraft(d => [...d, newItem.trim()]);
    setNewItem('');
  };
  const remove = (i) => setDraft(d => d.filter((_, idx) => idx !== i));
  const startEdit = (i) => { setEditingIdx(i); setEditingVal(draft[i]); };
  const saveEdit = () => {
    if (!editingVal.trim()) return;
    setDraft(d => d.map((v, idx) => idx === editingIdx ? editingVal.trim() : v));
    setEditingIdx(null);
  };

  const onDragStart = (i) => { dragIdx.current = i; };
  const onDragOver = (e, i) => { e.preventDefault(); setDragOverIdx(i); };
  const onDrop = (i) => {
    if (dragIdx.current === null || dragIdx.current === i) { setDragOverIdx(null); return; }
    setDraft(d => {
      const n = [...d];
      const [moved] = n.splice(dragIdx.current, 1);
      n.splice(i, 0, moved);
      return n;
    });
    dragIdx.current = null;
    setDragOverIdx(null);
  };
  const onDragEnd = () => { dragIdx.current = null; setDragOverIdx(null); };

  const iconBtn = (color) => ({ border: 'none', borderRadius: 5, cursor: 'pointer', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: color });

  return (
    <div className="rb-modal-overlay" onClick={onClose}>
      <div className="rb-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="rb-modal-header">
          <h3 style={{ fontSize: 15 }}>Редактировать подсказки: {title}</h3>
          <button className="rb-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rb-modal-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--rb-border)' }}>
            <input
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              placeholder="Новый пункт..."
              onKeyDown={e => e.key === 'Enter' && add()}
              style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none' }}
            />
            <button onClick={add} style={{ padding: '6px 12px', background: 'var(--rb-primary)', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              Добавить
            </button>
          </div>
          {draft.length === 0 && <p style={{ fontSize: 13, color: 'var(--rb-text-secondary)', margin: 0 }}>Нет подсказок</p>}
          {draft.map((item, i) => (
            <div
              key={i}
              draggable={editingIdx !== i}
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={() => onDrop(i)}
              onDragEnd={onDragEnd}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 6px', borderRadius: 7, border: `2px solid ${dragOverIdx === i ? 'var(--rb-primary)' : 'transparent'}`, background: dragOverIdx === i ? '#eff6ff' : 'transparent', transition: 'border-color .1s, background .1s' }}
            >
              {/* Drag handle */}
              <span style={{ cursor: 'grab', color: 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
              </span>
              {editingIdx === i ? (
                <>
                  <input
                    value={editingVal}
                    onChange={e => setEditingVal(e.target.value)}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingIdx(null); }}
                    style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 13, outline: 'none' }}
                  />
                  <button onClick={saveEdit} style={iconBtn('#16a34a')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <button onClick={() => setEditingIdx(null)} style={iconBtn('#ef4444')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13 }}>{item}</span>
                  <button onClick={() => startEdit(i)} style={iconBtn('#e2e8f0')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => remove(i)} style={iconBtn('#ef4444')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="rb-modal-footer">
          <button className="rb-btn" style={{ background: 'var(--rb-primary)', color: '#fff', border: 'none' }} onClick={() => { onSave(draft); onClose(); }}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function AddItemForm({ section, suggests, onAdd, readOnly, visible: visibleProp, onToggle, submitLabel, noIcon, onEditSuggests }) {
  if (readOnly) return null;
  const controlled = visibleProp !== undefined;
  const [visibleInternal, setVisibleInternal] = useState(false);
  const visible = controlled ? visibleProp : visibleInternal;
  const toggle = controlled ? onToggle : () => setVisibleInternal(v => !v);

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [valueType, setValueType] = useState('percent');
  const [deductionType, setDeductionType] = useState('final');

  const handleAdd = () => {
    const v = parseFloat(value);
    if (!name.trim()) { toast.error('Укажите название'); return; }
    if (isNaN(v) || v < 0) { toast.error('Укажите значение'); return; }
    onAdd(section, { name: name.trim(), value: v, valueType, deductionType });
    setName(''); setValue('');
  };

  return (
    <div>
      {visible && (
        <div className="rb-exec-add-form visible" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div className="rb-exec-suggests" style={{ flex: 1, marginBottom: 0 }}>
              {suggests.map(s => (
                <span key={s} className="rb-exec-suggest" onClick={() => setName(s)}>{s}</span>
              ))}
            </div>
            {onEditSuggests && (
              <button onClick={onEditSuggests} title="Редактировать подсказки" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--rb-text-secondary)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
          </div>
          <div className="rb-exec-add-row">
            <div className="rb-exec-add-field flex-grow">
              <label>Название</label>
              <input type="text" placeholder="Введите название..." value={name} onChange={e => setName(e.target.value)} autoFocus={controlled} />
            </div>
            <div className="rb-exec-add-field">
              <label>Значение</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="number" placeholder="0" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} style={{ width: 80 }} />
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${valueType === 'percent' ? ' active' : ''}`} onClick={() => setValueType('percent')}>%</button>
                  <button className={`rb-exec-type-btn${valueType === 'rub' ? ' active' : ''}`} onClick={() => setValueType('rub')}>₽</button>
                </div>
              </div>
            </div>
            {(section === 'deductions' || section === 'materials') && (
              <div className="rb-exec-add-field">
                <label>Тип</label>
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${deductionType === 'final' ? ' active' : ''}`} onClick={() => setDeductionType('final')} title="Вычитается из итоговой зарплаты">от з/п</button>
                  <button className={`rb-exec-type-btn${deductionType === 'turnover' ? ' active' : ''}`} onClick={() => setDeductionType('turnover')} title="Вычитается от оборота выполненных услуг">оборот</button>
                </div>
              </div>
            )}
            <div style={{ paddingBottom: 1 }}>
              <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAdd}>
                {!noIcon && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>}
                {submitLabel || 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
      {!controlled && (
        <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={toggle}>
          {visible ? 'Скрыть' : 'Добавить запись'}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StepExecutors({ selectedDoctor, clinics, doctors, readOnly, panelCollapsed, onTogglePanel }) {
  const [execData, setExecData] = useState(execDefault());
  const [activeClinic, setActiveClinic] = useState('global');
  const { wrapRef: clinicTabRef, sliderEl: clinicSlider } = useTabSlider(activeClinic);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const serviceSpecialties = React.useMemo(() => {
    const set = new Set();
    (doctors || []).forEach(d => {
      (d.professions || []).forEach(p => {
        const t = typeof p === 'object' ? (p.title || '') : String(p || '');
        if (t) set.add(t);
      });
    });
    return [...set].sort();
  }, [doctors]);
  const [cabinetInput, setCabinetInput] = useState('');
  const [showCabinetForm, setShowCabinetForm] = useState(false);
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [showNormServiceForm, setShowNormServiceForm] = useState(false);
  const [showDeductionForm, setShowDeductionForm] = useState(false);
  const [showAssistantForm, setShowAssistantForm] = useState(false);
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [showSvcMaterialForm, setShowSvcMaterialForm] = useState(false);
  const autoSaveTimer = useRef(null);

  const [suggests, setSuggests] = useState(DEFAULT_SUGGESTS);
  const [suggestsModal, setSuggestsModal] = useState(null); // { key, title }

  useEffect(() => {
    referralBonuses.getSuggests().then(res => {
      const data = res.data || {};
      setSuggests({
        deductions:   data.deductions   || DEFAULT_SUGGESTS.deductions,
        materials:    data.materials    || DEFAULT_SUGGESTS.materials,
        extras:       data.extras       || DEFAULT_SUGGESTS.extras,
        extrasNormed: data.extrasNormed || DEFAULT_SUGGESTS.extrasNormed,
        normServices: data.normServices || DEFAULT_SUGGESTS.normServices,
      });
    }).catch(() => {});
  }, []);

  const handleSaveSuggests = async (key, items) => {
    const next = { ...suggests, [key]: items };
    setSuggests(next);
    try { await referralBonuses.saveSuggests(next); } catch { toast.error('Не удалось сохранить подсказки'); }
  };

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDoctor) return;
    setLoading(true);
    setActiveClinic('global');
    setDoctorServices([]);
    Promise.all([
      executorSettings.get(selectedDoctor.id),
      performedServiceBonuses.getByDoctor(selectedDoctor.id).catch(() => ({ data: [] })),
    ]).then(([settingsRes, bonusRes]) => {
      const raw = settingsRes.data;
      if (!raw || !Object.keys(raw).length) {
        setExecData(execDefault());
      } else if (!raw.clinicSettings) {
        // Old format migration
        const global = execClinicDefault();
        global.deductions = raw.deductions || [];
        global.materials  = raw.materials  || [];
        global.extras     = raw.extras     || [];
        global.payType = 'salary';
        global.fixedSalary = raw.wage || raw.payment || 0;
        global.advance     = raw.advance || 0;
        global.paymentMethod = raw.method || 'card';
        setExecData({ clinicSettings: { global } });
      } else {
        setExecData(raw);
      }
      const bonuses = Array.isArray(bonusRes.data) ? bonusRes.data : [];
      const seen = new Set();
      const svcs = [];
      bonuses.forEach(b => {
        const key = b.serviceCode || b.serviceName;
        if (key && !seen.has(key)) {
          seen.add(key);
          svcs.push({ code: b.serviceCode || '', name: b.serviceName || b.serviceCode || '' });
        }
      });
      setDoctorServices(svcs);
    })
    .catch(() => setExecData(execDefault()))
    .finally(() => setLoading(false));
  }, [selectedDoctor]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getClinicData = useCallback((clinicId = activeClinic, data = execData) => {
    const cs = data.clinicSettings || {};
    if (!cs[clinicId]) {
      const globalData = cs['global'] || execClinicDefault();
      return {
        ...execClinicDefault(),
        payType: globalData.payType,
        fixedSalary: globalData.fixedSalary,
        hourlyRate: globalData.hourlyRate,
        hoursWorked: globalData.hoursWorked,
        executorPercent: globalData.executorPercent,
        plusPercent: globalData.plusPercent,
        advance: globalData.advance,
        paymentMethod: globalData.paymentMethod,
        mainPayment: globalData.mainPayment || 0,
        mainPaymentMethod: globalData.mainPaymentMethod || 'card',
      };
    }
    return cs[clinicId];
  }, [activeClinic, execData]);

  const updateClinicData = useCallback((updates) => {
    setExecData(prev => {
      const cs = { ...prev.clinicSettings };
      cs[activeClinic] = { ...(cs[activeClinic] || execClinicDefault()), ...updates };
      return { ...prev, clinicSettings: cs };
    });
  }, [activeClinic]);

  const saveToServer = useCallback(async (dataOverride) => {
    if (!selectedDoctor) return;
    setSaving(true);
    try {
      const toSave = dataOverride || execData;
      await executorSettings.save({ misUserId: selectedDoctor.id, doctorName: selectedDoctor.name, settings: toSave });
      clearExecCache(selectedDoctor.id);
      toast.success('Сохранено');
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [selectedDoctor, execData]);

  const scheduleAutoSave = useCallback(() => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveToServer(), 1500);
  }, [saveToServer]);

  // ── Clinic tabs ───────────────────────────────────────────────────────────
  const clinicTabs = [
    { id: 'global', label: 'Общие', color: 'var(--rb-primary)' },
    ...(clinics || []).filter(c => {
      const cs = execData.clinicSettings || {};
      return cs[String(c.id)] || (selectedDoctor?.clinics || []).includes(String(c.id));
    }).map(c => ({ id: String(c.id), label: c.name, color: c.color })),
  ];

  const handleSwitchClinic = (clinicId) => {
    setActiveClinic(clinicId);
    setExecData(prev => {
      const cs = { ...prev.clinicSettings };
      if (!cs[clinicId]) {
        const globalData = cs['global'] || execClinicDefault();
        cs[clinicId] = {
          ...execClinicDefault(),
          payType: globalData.payType,
          fixedSalary: globalData.fixedSalary,
          hourlyRate: globalData.hourlyRate,
          hoursWorked: globalData.hoursWorked,
          executorPercent: globalData.executorPercent,
          plusPercent: globalData.plusPercent,
          advance: globalData.advance,
          paymentMethod: globalData.paymentMethod,
          mainPayment: globalData.mainPayment || 0,
          mainPaymentMethod: globalData.mainPaymentMethod || 'card',
        };
        return { ...prev, clinicSettings: cs };
      }
      return prev;
    });
  };

  // ── Payment section ───────────────────────────────────────────────────────
  const data = getClinicData();
  const pt = data.payType || 'salary';

  const handlePayTypeChange = (type) => {
    updateClinicData({ payType: type, ...(type === 'percent' ? { plusPercent: false } : {}) });
    scheduleAutoSave();
  };

  const handlePaymentFieldChange = (field, val) => {
    updateClinicData({ [field]: val });
    scheduleAutoSave();
  };

  const handleSavePayment = async () => {
    clearTimeout(autoSaveTimer.current);
    await saveToServer();
  };

  const handleToggleMainPaymentLock = async () => {
    const newLocked = !data.lockedMainPayment;
    updateClinicData({ lockedMainPayment: newLocked });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), lockedMainPayment: newLocked } } };
    await saveToServer(newData);
  };

  const handleToggleAdvanceLock = async () => {
    const newLocked = !data.lockedAdvance;
    updateClinicData({ lockedAdvance: newLocked });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), lockedAdvance: newLocked } } };
    await saveToServer(newData);
  };

  const handleToggleFixedSalaryLock = async () => {
    const newLocked = !data.lockedFixedSalary;
    updateClinicData({ lockedFixedSalary: newLocked });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), lockedFixedSalary: newLocked } } };
    await saveToServer(newData);
  };

  const handleToggleHourlyRateLock = async () => {
    const newLocked = !data.lockedHourlyRate;
    updateClinicData({ lockedHourlyRate: newLocked });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), lockedHourlyRate: newLocked } } };
    await saveToServer(newData);
  };

  const handleToggleHoursWorkedLock = async () => {
    const newLocked = !data.lockedHoursWorked;
    updateClinicData({ lockedHoursWorked: newLocked });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), lockedHoursWorked: newLocked } } };
    await saveToServer(newData);
  };

  // ── Cabinets ──────────────────────────────────────────────────────────────
  const globalCabinets = (execData.clinicSettings?.global?.cabinets) || [];

  const handleAddCabinet = async () => {
    const name = cabinetInput.trim();
    if (!name) { toast.error('Введите название кабинета'); return; }
    if (globalCabinets.includes(name)) { toast.error('Такой кабинет уже добавлен'); return; }
    const newCabinets = [...globalCabinets, name];
    setExecData(prev => ({
      ...prev,
      clinicSettings: {
        ...prev.clinicSettings,
        global: { ...(prev.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets },
      },
    }));
    setCabinetInput('');
    setShowCabinetForm(false);
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, global: { ...(execData.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets } } };
    await saveToServer(newData);
    toast.success(`Кабинет "${name}" добавлен`);
  };

  const handleDeleteCabinet = async (idx) => {
    const newCabinets = globalCabinets.filter((_, i) => i !== idx);
    const lockedCabs = (execData.clinicSettings?.global?.lockedCabinets || []).filter(n => n !== globalCabinets[idx]);
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, global: { ...(execData.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets, lockedCabinets: lockedCabs } } };
    setExecData(newData);
    await saveToServer(newData);
    toast.success('Кабинет удалён');
  };

  const handleToggleCabinetLock = async (cabName) => {
    const locked = execData.clinicSettings?.global?.lockedCabinets || [];
    const newLocked = locked.includes(cabName) ? locked.filter(n => n !== cabName) : [...locked, cabName];
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, global: { ...(execData.clinicSettings?.global || execClinicDefault()), lockedCabinets: newLocked } } };
    setExecData(newData);
    await saveToServer(newData);
  };

  const handleResetCabinets = async () => {
    if (!window.confirm('Удалить все незафиксированные кабинеты?')) return;
    const locked = execData.clinicSettings?.global?.lockedCabinets || [];
    const newCabinets = globalCabinets.filter(c => locked.includes(c));
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, global: { ...(execData.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets } } };
    setExecData(newData);
    await saveToServer(newData);
    toast.success('Сброшено');
  };

  // ── Items (deductions / materials) ───────────────────────────────────────
  const handleAddItem = async (section, item) => {
    const current = getClinicData();
    const arr = [...(current[section] || []), item];
    updateClinicData({ [section]: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), [section]: arr } } };
    await saveToServer(newData);
    if (section === 'deductions') setShowDeductionForm(false);
    if (section === 'materials') setShowMaterialForm(false);
    toast.success('Добавлено');
  };

  const handleDeleteItem = async (section, idx) => {
    const current = getClinicData();
    const arr = (current[section] || []).filter((_, i) => i !== idx);
    updateClinicData({ [section]: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), [section]: arr } } };
    await saveToServer(newData);
  };

  const handleUpdateItem = async (section, idx, newItem) => {
    const current = getClinicData();
    const arr = (current[section] || []).map((it, i) => i === idx ? newItem : it);
    updateClinicData({ [section]: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), [section]: arr } } };
    await saveToServer(newData);
  };

  const handleResetSection = async (section) => {
    if (!window.confirm('Удалить все незафиксированные записи этого раздела?')) return;
    const current = getClinicData();
    const arr = (current[section] || []).filter(it => it.locked === true);
    updateClinicData({ [section]: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), [section]: arr } } };
    await saveToServer(newData);
    toast.success('Сброшено');
  };

  const handleResetAll = async () => {
    if (!window.confirm('Сбросить все незафиксированные записи по всем разделам (Расходники, Материалы, Выполненные услуги, Дополнительно, Кабинеты, Основная ЗП, Аванс)?')) return;
    const current = getClinicData();
    const newDeductions     = (current.deductions     || []).filter(it => it.locked === true);
    const newMaterials      = (current.materials      || []).filter(it => it.locked === true);
    const newSvcMaterials   = (current.serviceMaterials || []).filter(it => it.locked === true);
    const newExtras         = (current.extras         || []).filter(it => it.locked === true);
    const newNormServices   = (current.normServices   || []).filter(it => it.locked === true).map(it => ({
      ...it,
      rate:  it.lockedRate  ? it.rate  : 0,
      hours: it.lockedHours ? it.hours : 0,
    }));
    const lockedCabs        = execData.clinicSettings?.global?.lockedCabinets || [];
    const newCabinets       = (execData.clinicSettings?.global?.cabinets || []).filter(c => lockedCabs.includes(c));
    const newGlobal = { ...(execData.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets };
    const resetMain    = current.lockedMainPayment ? {} : { mainPayment: 0 };
    const resetAdvance = current.lockedAdvance     ? {} : { advance: 0 };
    const newExtraPayments = (current.extraPayments || []).filter(ep => ep.locked === true);
    updateClinicData({ deductions: newDeductions, materials: newMaterials, serviceMaterials: newSvcMaterials, extras: newExtras, normServices: newNormServices, extraPayments: newExtraPayments, ...resetMain, ...resetAdvance });
    const newData = {
      ...execData,
      clinicSettings: {
        ...execData.clinicSettings,
        global: newGlobal,
        [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), deductions: newDeductions, materials: newMaterials, serviceMaterials: newSvcMaterials, extras: newExtras, normServices: newNormServices, extraPayments: newExtraPayments, ...resetMain, ...resetAdvance },
      },
    };
    await saveToServer(newData);
    toast.success('Все незафиксированные записи сброшены');
  };

  const handleAddSvcMaterial = async (item) => {
    const current = getClinicData();
    const arr = [...(current.serviceMaterials || []), item];
    updateClinicData({ serviceMaterials: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), serviceMaterials: arr } } };
    await saveToServer(newData);
    setShowSvcMaterialForm(false);
    toast.success('Добавлено');
  };

  const handleDeleteSvcMaterial = async (idx) => {
    const current = getClinicData();
    const arr = (current.serviceMaterials || []).filter((_, i) => i !== idx);
    updateClinicData({ serviceMaterials: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), serviceMaterials: arr } } };
    await saveToServer(newData);
  };

  const handleUpdateSvcMaterial = async (idx, newItem) => {
    const current = getClinicData();
    const arr = (current.serviceMaterials || []).map((it, i) => i === idx ? newItem : it);
    updateClinicData({ serviceMaterials: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), serviceMaterials: arr } } };
    await saveToServer(newData);
  };

  const handleResetSvcMaterials = async () => {
    if (!window.confirm('Удалить все незафиксированные индивидуальные расходники?')) return;
    const current = getClinicData();
    const arr = (current.serviceMaterials || []).filter(it => it.locked === true);
    updateClinicData({ serviceMaterials: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), serviceMaterials: arr } } };
    await saveToServer(newData);
    toast.success('Сброшено');
  };

  // ── Norm services ──────────────────────────────────────────────────────────
  const [normServiceForm, setNormServiceForm] = useState({ name: '', rate: '', hours: '' });

  const handleAddNormService = async () => {
    const name = normServiceForm.name.trim();
    const rate = parseFloat(normServiceForm.rate);
    const hours = parseFloat(normServiceForm.hours);
    if (!name) { toast.error('Укажите название деятельности'); return; }
    if (isNaN(rate) || rate < 0) { toast.error('Укажите часовую ставку'); return; }
    if (isNaN(hours) || hours < 0) { toast.error('Укажите количество часов'); return; }
    const current = getClinicData();
    const arr = [...(current.normServices || []), { name, rate, hours }];
    updateClinicData({ normServices: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), normServices: arr } } };
    await saveToServer(newData);
    setNormServiceForm({ name: '', rate: '', hours: '' });
    toast.success('Добавлено');
  };

  const handleDeleteNormService = async (idx) => {
    const current = getClinicData();
    const arr = (current.normServices || []).filter((_, i) => i !== idx);
    updateClinicData({ normServices: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), normServices: arr } } };
    await saveToServer(newData);
  };

  const handleUpdateNormService = async (idx, newItem) => {
    const current = getClinicData();
    const arr = (current.normServices || []).map((it, i) => i === idx ? newItem : it);
    updateClinicData({ normServices: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), normServices: arr } } };
    await saveToServer(newData);
  };

  // ── Extras ────────────────────────────────────────────────────────────────
  const [extraForm, setExtraForm] = useState({ name: '', amount: '', hours: '' });

  const handleAddExtra = async () => {
    const name = extraForm.name.trim();
    const amount = parseFloat(extraForm.amount);
    const hours = parseFloat(extraForm.hours) || 0;
    if (!name) { toast.error('Укажите название'); return; }
    if (isNaN(amount) || amount < 0) { toast.error('Укажите сумму'); return; }
    const current = getClinicData();
    const arr = [...(current.extras || []), { name, amount, hours }];
    updateClinicData({ extras: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), extras: arr } } };
    await saveToServer(newData);
    setExtraForm({ name: '', amount: '', hours: '' });
    setShowExtraForm(false);
    toast.success('Добавлено');
  };

  const handleDeleteExtra = async (idx) => {
    const current = getClinicData();
    const arr = (current.extras || []).filter((_, i) => i !== idx);
    updateClinicData({ extras: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), extras: arr } } };
    await saveToServer(newData);
  };

  const handleUpdateExtra = async (idx, newItem) => {
    const current = getClinicData();
    const arr = (current.extras || []).map((it, i) => i === idx ? newItem : it);
    updateClinicData({ extras: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), extras: arr } } };
    await saveToServer(newData);
  };

  const handleResetExtras = async () => {
    if (!window.confirm('Удалить все незафиксированные записи раздела «Дополнительно»?')) return;
    const current = getClinicData();
    const arr = (current.extras || []).filter(it => it.locked === true);
    updateClinicData({ extras: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), extras: arr } } };
    await saveToServer(newData);
    toast.success('Сброшено');
  };

  // ── Assistants (global, not per-clinic) ───────────────────────────────────
  const handleAddAssistant = async (item) => {
    const arr = [...(execData.assistants || []), item];
    const newData = { ...execData, assistants: arr };
    setExecData(newData);
    await saveToServer(newData);
    setShowAssistantForm(false);
    toast.success('Добавлено');
  };

  const handleDeleteAssistant = async (idx) => {
    const arr = (execData.assistants || []).filter((_, i) => i !== idx);
    const newData = { ...execData, assistants: arr };
    setExecData(newData);
    await saveToServer(newData);
  };

  // ── SvcMaterial add form state ────────────────────────────────────────────
  const [svcMatForm, setSvcMatForm] = useState({ serviceName: '', serviceCode: '', materialName: '', value: '', valueType: 'percent', deductionType: 'final' });
  const [doctorServices, setDoctorServices] = useState([]);

  // ─────────────────────────────────────────────────────────────────────────
  if (!selectedDoctor) {
    return (
      <div className="rb-placeholder">
        <p>Выберите врача из списка слева для настройки оклада и удержаний</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rb-doctor-card">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Загрузка...</div>
      </div>
    );
  }

  const hourlyTotal = pt === 'hourly' ? (data.hourlyRate || 0) * (data.hoursWorked || 0) : 0;

  return (
    <div className="rb-doctor-card">
      {suggestsModal && (
        <SuggestsEditorModal
          title={suggestsModal.title}
          items={suggests[suggestsModal.key]}
          onSave={(items) => handleSaveSuggests(suggestsModal.key, items)}
          onClose={() => setSuggestsModal(null)}
        />
      )}
      {/* Header */}
      <div className="rb-doctor-card-header">
        <div className="rb-doctor-card-info">
          <h2>{selectedDoctor.name}</h2>
        </div>
        {onTogglePanel && (
          <button onClick={onTogglePanel} title={panelCollapsed ? 'Свернуть' : 'На всю ширину'} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center' }}>
            {panelCollapsed ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            )}
          </button>
        )}
      </div>

      {/* Clinic tabs */}
      {clinicTabs.length > 1 && (
        <div className="rb-clinic-tab-wrap" ref={clinicTabRef}>
          {clinicSlider}
          {clinicTabs.map(tab => (
            <button
              key={tab.id}
              className={`rb-clinic-tab${activeClinic === tab.id ? ' active' : ''}`}
              onClick={() => handleSwitchClinic(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <div style={{ padding: '0 20px 20px' }}>

        {/* ── Payment section ── */}
        <div className="rb-exec-flat-section">
          <div className="rb-exec-flat-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Оплата
            </span>
            {!readOnly && (
              <button
                onClick={() => {
                  const arr = [...(data.extraPayments || []), { label: '', amount: 0, method: 'card' }];
                  handlePaymentFieldChange('extraPayments', arr);
                }}
                style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                title="Добавить доп. выплату"
              >+</button>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>Тип оплаты</div>
            <div className="rb-paytype-toggle">
              {['salary', 'hourly', 'percent', 'normed'].map((type, i) => (
                <button
                  key={type}
                  className={`rb-paytype-btn${pt === type ? ' active' : ''}`}
                  onClick={() => handlePayTypeChange(type)}
                >
                  {['Фиксированный оклад', 'Почасовой оклад', '% от услуг', 'Нормированный'][i]}
                </button>
              ))}
            </div>

            {pt === 'salary' && (
              <div className="rb-exec-field" style={data.lockedFixedSalary ? { background: '#eff6ff', borderRadius: 6 } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ marginBottom: 0 }}>Фиксированный оклад, ₽</label>
                  {!readOnly && <LockBtn locked={!!data.lockedFixedSalary} onClick={handleToggleFixedSalaryLock} />}
                </div>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.fixedSalary || ''}
                  onChange={e => handlePaymentFieldChange('fixedSalary', parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            {pt === 'hourly' && (
              <div className="rb-exec-fields-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="rb-exec-field" style={data.lockedHourlyRate ? { background: '#eff6ff', borderRadius: 6 } : {}}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ marginBottom: 0 }}>Ставка, ₽/час</label>
                    {!readOnly && <LockBtn locked={!!data.lockedHourlyRate} onClick={handleToggleHourlyRateLock} />}
                  </div>
                  <input
                    type="number" min="0" step="any" placeholder="0"
                    value={data.hourlyRate || ''}
                    onChange={e => handlePaymentFieldChange('hourlyRate', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="rb-exec-field" style={data.lockedHoursWorked ? { background: '#eff6ff', borderRadius: 6 } : {}}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <label style={{ marginBottom: 0 }}>Часов за период</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!readOnly && (
                        <label className="rb-toggle-item" style={{ marginBottom: 0, gap: 4 }} title="Считать часы по расписанию сотрудника">
                          <span className="rb-toggle-switch">
                            <input
                              type="checkbox"
                              checked={!!data.hoursFromSchedule}
                              onChange={() => handlePaymentFieldChange('hoursFromSchedule', !data.hoursFromSchedule)}
                            />
                            <span className="rb-toggle-slider" />
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>из расписания</span>
                        </label>
                      )}
                      {!readOnly && <LockBtn locked={!!data.lockedHoursWorked} onClick={handleToggleHoursWorkedLock} />}
                    </div>
                  </div>
                  {data.hoursFromSchedule ? (
                    <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', border: '1px solid var(--rb-border)', borderRadius: 8, background: 'var(--rb-bg-alt, #f8fafc)', fontSize: 12, color: 'var(--rb-text-secondary)' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      Рассчитается по периоду отчёта
                    </div>
                  ) : (
                    <input
                      type="number" min="0" step="0.5" placeholder="0"
                      value={data.hoursWorked || ''}
                      onChange={e => handlePaymentFieldChange('hoursWorked', parseFloat(e.target.value) || 0)}
                    />
                  )}
                </div>
                <div className="rb-exec-field">
                  <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
                    <label style={{ marginBottom: 0 }}>Итого</label>
                  </div>
                  <div style={{ padding: '0 10px', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 13, fontWeight: 700, color: 'var(--rb-primary)', background: '#eff6ff', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38, boxSizing: 'border-box' }}>= {hourlyTotal.toFixed(2)} ₽</div>
                </div>
              </div>
            )}


            {pt === 'normed' && (
              <div className="rb-exec-field" style={data.lockedFixedSalary ? { background: '#eff6ff', borderRadius: 6 } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ marginBottom: 0 }}>Оклад, ₽</label>
                  {!readOnly && <LockBtn locked={!!data.lockedFixedSalary} onClick={handleToggleFixedSalaryLock} />}
                </div>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.fixedSalary || ''}
                  onChange={e => handlePaymentFieldChange('fixedSalary', parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            <div className="rb-plus-pct-row rb-plus-pct-row--inline">
              {pt !== 'percent' && (
                <label className="rb-toggle-item">
                  <span className="rb-toggle-switch">
                    <input
                      type="checkbox" id="exec-plus-pct"
                      checked={!!data.plusPercent}
                      onChange={e => handlePaymentFieldChange('plusPercent', e.target.checked)}
                    />
                    <span className="rb-toggle-slider" />
                  </span>
                  <span className="rb-toggle-label">Выполненные услуги</span>
                </label>
              )}
              <label className="rb-toggle-item">
                <span className="rb-toggle-switch">
                  <input
                    type="checkbox" id="exec-include-ref-bonuses"
                    checked={data.includeReferralBonuses !== false}
                    onChange={e => handlePaymentFieldChange('includeReferralBonuses', e.target.checked)}
                  />
                  <span className="rb-toggle-slider" />
                </span>
                <span className="rb-toggle-label">Бонусы за направления</span>
              </label>
              <label className="rb-toggle-item">
                <span className="rb-toggle-switch">
                  <input
                    type="checkbox" id="exec-include-ref-deductions"
                    checked={data.includeReferralDeductions !== false}
                    onChange={e => handlePaymentFieldChange('includeReferralDeductions', e.target.checked)}
                  />
                  <span className="rb-toggle-slider" />
                </span>
                <span className="rb-toggle-label">Бонусы направителям</span>
              </label>
            </div>
            <div className="rb-exec-fields-grid" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr 24px 1fr 1fr' }}>
              <div className="rb-exec-field">
                <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
                  <label style={{ marginBottom: 0 }}>Способ выплаты аванса</label>
                </div>
                <select value={data.paymentMethod || 'card'} onChange={e => handlePaymentFieldChange('paymentMethod', e.target.value)}>
                  <option value="card">Карта</option>
                  <option value="cash">Наличные</option>
                </select>
              </div>
              <div className="rb-exec-field" style={data.lockedAdvance ? { background: '#eff6ff', borderRadius: 6 } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 20 }}>
                  <label style={{ marginBottom: 0 }}>Аванс, ₽</label>
                  {!readOnly && <LockBtn locked={!!data.lockedAdvance} onClick={handleToggleAdvanceLock} />}
                </div>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.advance || ''}
                  onChange={e => handlePaymentFieldChange('advance', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div />
              <div className="rb-exec-field">
                <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
                  <label style={{ marginBottom: 0 }}>Способ выплаты основной ЗП</label>
                </div>
                <select value={data.mainPaymentMethod || 'card'} onChange={e => handlePaymentFieldChange('mainPaymentMethod', e.target.value)}>
                  <option value="card">Карта</option>
                  <option value="cash">Наличные</option>
                </select>
              </div>
              <div className="rb-exec-field" style={data.lockedMainPayment ? { background: '#eff6ff', borderRadius: 6 } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 20 }}>
                  <label style={{ marginBottom: 0 }}>Основная ЗП, ₽</label>
                  {!readOnly && <LockBtn locked={!!data.lockedMainPayment} onClick={handleToggleMainPaymentLock} />}
                </div>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.mainPayment || ''}
                  onChange={e => handlePaymentFieldChange('mainPayment', parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* Extra payments */}
              {(data.extraPayments || []).map((ep, idx) => (
                <div key={idx} className="rb-exec-field" style={{ gridColumn: '1 / -1', ...(ep.locked ? { background: '#eff6ff', borderRadius: 6 } : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ marginBottom: 0 }}>Доп. выплата {idx + 1}</label>
                    {!readOnly && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <LockBtn locked={!!ep.locked} onClick={() => {
                          const arr = [...(data.extraPayments || [])];
                          arr[idx] = { ...arr[idx], locked: !ep.locked };
                          handlePaymentFieldChange('extraPayments', arr);
                        }} />
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rb-danger)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                          onClick={() => {
                            const arr = (data.extraPayments || []).filter((_, i) => i !== idx);
                            handlePaymentFieldChange('extraPayments', arr);
                          }}
                          title="Удалить"
                        >×</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={ep.method || 'card'}
                      onChange={e => {
                        const arr = [...(data.extraPayments || [])];
                        arr[idx] = { ...arr[idx], method: e.target.value };
                        handlePaymentFieldChange('extraPayments', arr);
                      }}
                      style={{ flexShrink: 0 }}
                    >
                      <option value="card">Карта</option>
                      <option value="cash">Наличные</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Название"
                      value={ep.label || ''}
                      onChange={e => {
                        const arr = [...(data.extraPayments || [])];
                        arr[idx] = { ...arr[idx], label: e.target.value };
                        handlePaymentFieldChange('extraPayments', arr);
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number" min="0" step="any" placeholder="0"
                      value={ep.amount || ''}
                      onChange={e => {
                        const arr = [...(data.extraPayments || [])];
                        arr[idx] = { ...arr[idx], amount: parseFloat(e.target.value) || 0 };
                        handlePaymentFieldChange('extraPayments', arr);
                      }}
                      style={{ width: 90, flexShrink: 0, textAlign: 'right' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="rb-exec-save-row" style={{ justifyContent: 'flex-end' }}>
              <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleSavePayment} disabled={saving}>
                Сохранить
              </button>
            </div>
        </div>

        {/* ── Norm services (normed pay type only) ── */}
        {pt === 'normed' && (
          <div className="rb-exec-flat-section">
            <div className="rb-exec-flat-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>
                Выполненные услуги
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!readOnly && (
                  <label className="rb-toggle-item" style={{ marginBottom: 0, gap: 4 }} title="Считать часы по расписанию сотрудника">
                    <span className="rb-toggle-switch">
                      <input
                        type="checkbox"
                        checked={!!data.hoursFromSchedule}
                        onChange={() => handlePaymentFieldChange('hoursFromSchedule', !data.hoursFromSchedule)}
                      />
                      <span className="rb-toggle-slider" />
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>часы из расписания</span>
                  </label>
                )}
                {!readOnly && (
                  <button
                    onClick={() => setShowNormServiceForm(v => !v)}
                    style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                    title="Добавить запись"
                  >+</button>
                )}
              </span>
            </div>
            {data.hoursFromSchedule && (
              <div style={{ margin: '0 12px 6px', padding: '6px 10px', background: '#eff6ff', borderRadius: 7, fontSize: 12, color: 'var(--rb-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Часы будут рассчитаны по расписанию за период отчёта. Значения ниже используются как веса при распределении.
              </div>
            )}
            <NormServicesList items={data.normServices || []} onDelete={handleDeleteNormService} onUpdate={handleUpdateNormService} readOnly={readOnly} />
            <NormServiceAddForm form={normServiceForm} setForm={setNormServiceForm} onAdd={handleAddNormService} readOnly={readOnly} visible={showNormServiceForm} suggests={suggests.normServices} onEditSuggests={!readOnly ? () => setSuggestsModal({ key: 'normServices', title: 'Выполненные услуги' }) : undefined} />
          </div>
        )}

        {/* ── Deductions ── */}
        {/* ── Deductions ── */}
        <div className="rb-exec-flat-section">
          <div className="rb-exec-flat-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              Взыскания
            </span>
            {!readOnly && (
              <button
                onClick={() => setShowDeductionForm(v => !v)}
                style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                title="Добавить взыскание"
              >+</button>
            )}
          </div>
          <div style={{ marginBottom: 8 }}>
            <ItemsList items={data.deductions || []} section="deductions" onDelete={handleDeleteItem} onUpdate={handleUpdateItem} readOnly={readOnly} />
            <AddItemForm section="deductions" suggests={suggests.deductions} onAdd={handleAddItem} readOnly={readOnly} visible={showDeductionForm} onToggle={() => setShowDeductionForm(v => !v)} submitLabel="Сохранить" noIcon onEditSuggests={!readOnly ? () => setSuggestsModal({ key: 'deductions', title: 'Взыскания' }) : undefined} />
          </div>
          {pt === 'normed' && (
            <label className="rb-toggle-item" style={{ padding: '6px 0 14px' }}>
              <span className="rb-toggle-switch">
                <input type="checkbox" checked={!!data.harmfulness} onChange={e => handlePaymentFieldChange('harmfulness', e.target.checked)} />
                <span className="rb-toggle-slider" />
              </span>
              <span className="rb-toggle-label">Вредность</span>
            </label>
          )}
        </div>

        {/* ── Materials (not shown for normed) ── */}
        {pt !== 'normed' && (
          <div className="rb-exec-flat-section">
            <div className="rb-exec-flat-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/></svg>
              Материалы-расходники
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Общие</span>
              {!readOnly && (
                <button
                  onClick={() => setShowMaterialForm(v => !v)}
                  style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                  title="Добавить расход"
                >+</button>
              )}
            </div>
            <ItemsList items={data.materials || []} section="materials" onDelete={handleDeleteItem} onUpdate={handleUpdateItem} readOnly={readOnly} />
            <AddItemForm section="materials" suggests={suggests.materials} onAdd={handleAddItem} readOnly={readOnly} visible={showMaterialForm} onToggle={() => setShowMaterialForm(v => !v)} submitLabel="Сохранить" noIcon onEditSuggests={!readOnly ? () => setSuggestsModal({ key: 'materials', title: 'Материалы' }) : undefined} />
            <div className="rb-exec-sep">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Индивидуальные расходники по услугам</span>
                {!readOnly && (
                  <button
                    onClick={() => setShowSvcMaterialForm(v => !v)}
                    style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                    title="Добавить индивидуальный расходник"
                  >+</button>
                )}
              </div>
              <SvcMaterialsList items={data.serviceMaterials || []} onDelete={handleDeleteSvcMaterial} onUpdate={handleUpdateSvcMaterial} readOnly={readOnly} />
              <SvcMaterialAddForm suggests={suggests.materials} form={svcMatForm} setForm={setSvcMatForm} onAdd={handleAddSvcMaterial} readOnly={readOnly} doctorServices={doctorServices} visible={showSvcMaterialForm} onToggle={() => setShowSvcMaterialForm(v => !v)} />
            </div>
          </div>
        )}

        {/* ── Assistance (not shown for normed) ── */}
        {pt !== 'normed' && (
          <div className="rb-exec-flat-section">
            <div className="rb-exec-flat-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Ассистирование
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 10px' }}>
              <label style={{ fontSize: 13, color: 'var(--rb-text)', flex: 1 }}>Услуги ассистирования</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number" min="0" step="0.1" placeholder="0"
                  value={data.assistancePercent || ''}
                  onChange={e => handlePaymentFieldChange('assistancePercent', parseFloat(e.target.value) || 0)}
                  style={{ width: 80, padding: '6px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
                />
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${(data.assistanceValueType || 'percent') === 'percent' ? ' active' : ''}`} onClick={() => handlePaymentFieldChange('assistanceValueType', 'percent')}>%</button>
                  <button className={`rb-exec-type-btn${data.assistanceValueType === 'rub' ? ' active' : ''}`} onClick={() => handlePaymentFieldChange('assistanceValueType', 'rub')}>₽</button>
                </div>
              </div>
            </div>
            <div className="rb-exec-sep">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Индивидуально для ассистентов:</span>
                {!readOnly && (
                  <button
                    onClick={() => setShowAssistantForm(v => !v)}
                    style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                    title="Добавить ассистента"
                  >+</button>
                )}
              </div>
              <AssistantsList assistants={execData.assistants || []} onDelete={handleDeleteAssistant} readOnly={readOnly} />
              <AssistantAddForm doctors={doctors} onAdd={handleAddAssistant} saving={saving} readOnly={readOnly} visible={showAssistantForm} onToggle={() => setShowAssistantForm(v => !v)} />
            </div>
          </div>
        )}

        {/* ── Extras ── */}
        <div className="rb-exec-flat-section">
          <div className="rb-exec-flat-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Дополнительно
            </span>
            {!readOnly && (
              <button
                onClick={() => setShowExtraForm(v => !v)}
                style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                title="Добавить запись"
              >+</button>
            )}
          </div>
          <ExtrasList extras={data.extras || []} onDelete={handleDeleteExtra} onUpdate={handleUpdateExtra} readOnly={readOnly} />
          <ExtraAddForm
            suggests={pt === 'normed' ? suggests.extrasNormed : suggests.extras}
            form={extraForm}
            setForm={setExtraForm}
            onAdd={handleAddExtra}
            readOnly={readOnly}
            visible={showExtraForm}
            onToggle={() => setShowExtraForm(v => !v)}
            onEditSuggests={!readOnly ? () => setSuggestsModal(pt === 'normed' ? { key: 'extrasNormed', title: 'Дополнительно (норм.)' } : { key: 'extras', title: 'Дополнительно' }) : undefined}
          />
        </div>

        {/* ── Cabinets (global only, not for normed) ── */}
        {activeClinic === 'global' && pt !== 'normed' && (
          <div className="rb-exec-flat-section">
            <div className="rb-exec-flat-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
                Кабинеты
              </span>
              {!readOnly && (
                <button
                  onClick={() => setShowCabinetForm(v => !v)}
                  style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 12 }}
                  title="Добавить кабинет"
                >+</button>
              )}
            </div>

              {globalCabinets.length > 0 && (() => {
                  const lockedCabs = execData.clinicSettings?.global?.lockedCabinets || [];
                  return (
                  <div className="rb-exec-items">
                    {globalCabinets.map((cab, i) => {
                      const isLocked = lockedCabs.includes(cab);
                      return (
                      <div key={i} className="rb-exec-item" style={isLocked ? { background: '#eff6ff' } : {}}>
                        <div className="rb-exec-item-name" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
                            <rect x="4" y="2" width="16" height="20" rx="1"/>
                            <circle cx="15.5" cy="12" r="1" fill="#007AFF" stroke="none"/>
                            <line x1="4" y1="22" x2="20" y2="22"/>
                          </svg>
                          {cab}
                        </div>
                        {!readOnly && (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            <LockBtn locked={isLocked} onClick={() => handleToggleCabinetLock(cab)} />
                            <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => handleDeleteCabinet(i)}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                  );
                })()
              }
              {showCabinetForm && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text" placeholder="Название кабинета..."
                    value={cabinetInput}
                    onChange={e => setCabinetInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddCabinet()}
                    autoFocus
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAddCabinet}>
                    Сохранить
                  </button>
                </div>
              )}
          </div>
        )}

      </div>
      </fieldset>
    </div>
  );
}

// ─── Extra add form ───────────────────────────────────────────────────────────

function ExtraAddForm({ suggests, form, setForm, onAdd, readOnly, visible, onToggle, onEditSuggests }) {
  if (readOnly) return null;
  if (!visible) return null;
  return (
    <div className="rb-exec-add-form visible" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div className="rb-exec-suggests" style={{ flex: 1, marginBottom: 0 }}>
          {suggests.map(s => (
            <span key={s} className="rb-exec-suggest" onClick={() => setForm(f => ({ ...f, name: s }))}>{s}</span>
          ))}
        </div>
        {onEditSuggests && (
          <button onClick={onEditSuggests} title="Редактировать подсказки" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--rb-text-secondary)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        )}
      </div>
      <div className="rb-exec-add-row">
        <div className="rb-exec-add-field flex-grow">
          <label>Услуга / описание</label>
          <input type="text" placeholder="Введите название..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
        </div>
        <div className="rb-exec-add-field">
          <label>Часов</label>
          <input type="number" placeholder="0" min="0" step="0.5" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} style={{ width: 70 }} />
        </div>
        <div className="rb-exec-add-field">
          <label>Сумма, ₽</label>
          <input type="number" placeholder="0" min="0" step="any" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 90 }} />
        </div>
        <div style={{ paddingBottom: 1 }}>
          <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={onAdd}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Svc material add form ────────────────────────────────────────────────────

function SvcMaterialAddForm({ suggests, form, setForm, onAdd, readOnly, doctorServices, visible, onToggle }) {
  const [svcOpen, setSvcOpen] = useState(false);
  const [svcSuggestions, setSvcSuggestions] = useState([]);
  if (readOnly) return null;

  const handleSvcInput = (val) => {
    setForm(f => ({ ...f, serviceName: val }));
    if (val.length >= 1 && doctorServices && doctorServices.length > 0) {
      const q = val.toLowerCase();
      const matches = doctorServices.filter(s =>
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
      ).slice(0, 10);
      setSvcSuggestions(matches);
      setSvcOpen(matches.length > 0);
    } else {
      setSvcSuggestions([]);
      setSvcOpen(false);
    }
  };

  const handleSvcSelect = (svc) => {
    setForm(f => ({ ...f, serviceName: svc.name, serviceCode: svc.code }));
    setSvcSuggestions([]);
    setSvcOpen(false);
  };

  const handleAdd = () => {
    const value = parseFloat(form.value);
    if (!(form.serviceName || '').trim()) { toast.error('Укажите услугу из Excel'); return; }
    if (isNaN(value) || value < 0) { toast.error('Укажите значение'); return; }
    const serviceName = form.serviceName.trim();
    const serviceCode = (form.serviceCode || '').trim();
    const materialName = (form.materialName || '').trim() || serviceName;
    onAdd({ serviceCode, serviceName, name: materialName, value, valueType: form.valueType, deductionType: form.deductionType });
    setForm({ serviceName: '', serviceCode: '', materialName: '', value: '', valueType: 'percent', deductionType: 'final' });
    setSvcOpen(false);
  };

  if (!visible) return null;
  return (
    <div>
      <div className="rb-exec-add-form visible" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, lineHeight: 1.4 }}>
            <strong>Услуга</strong> — точное название как в Excel-файле (используется для сопоставления).
            <br/><strong>Расходник</strong> — отображаемое название в отчёте (можно оставить пустым).
          </div>
          <div className="rb-exec-add-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div className="rb-exec-add-field flex-grow" style={{ position: 'relative', minWidth: 160 }}>
              <label>Услуга (как в Excel) <span style={{ color: 'var(--rb-danger)' }}>*</span></label>
              <input
                type="text"
                placeholder="Название услуги..."
                value={form.serviceName || ''}
                onChange={e => handleSvcInput(e.target.value)}
                onBlur={() => setTimeout(() => setSvcOpen(false), 150)}
                onFocus={() => svcSuggestions.length > 0 && setSvcOpen(true)}
              />
              {svcOpen && svcSuggestions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--rb-border-dark)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 180, overflowY: 'auto' }}>
                  {svcSuggestions.map((s, i) => (
                    <div
                      key={i}
                      onMouseDown={() => handleSvcSelect(s)}
                      style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f1f5f9' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      {s.code && <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#94a3b8', marginRight: 6 }}>{s.code}</span>}
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rb-exec-add-field flex-grow" style={{ minWidth: 130 }}>
              <label>Название расходника</label>
              <div>
                <div className="rb-exec-suggests" style={{ marginBottom: 4 }}>
                  {suggests.map(s => (
                    <span key={s} className="rb-exec-suggest" onMouseDown={() => setForm(f => ({ ...f, materialName: s }))}>{s}</span>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Необязательно..."
                  value={form.materialName || ''}
                  onChange={e => setForm(f => ({ ...f, materialName: e.target.value }))}
                />
              </div>
            </div>
            <div className="rb-exec-add-field">
              <label>Значение</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="number" placeholder="0" min="0" step="any" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} style={{ width: 80 }} />
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${form.valueType === 'percent' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, valueType: 'percent' }))}>%</button>
                  <button className={`rb-exec-type-btn${form.valueType === 'rub' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, valueType: 'rub' }))}>₽</button>
                </div>
              </div>
            </div>
            <div className="rb-exec-add-field">
              <label>Тип</label>
              <div className="rb-exec-type-toggle">
                <button className={`rb-exec-type-btn${form.deductionType === 'final' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, deductionType: 'final' }))}>от з/п</button>
                <button className={`rb-exec-type-btn${form.deductionType === 'turnover' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, deductionType: 'turnover' }))}>оборот</button>
              </div>
            </div>
            <div style={{ paddingBottom: 1 }}>
              <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAdd}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                Добавить
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}

// ─── Assistants list ──────────────────────────────────────────────────────────

function AssistantsList({ assistants, onDelete, readOnly }) {
  if (!assistants || !assistants.length) return null;
  return (
    <div className="rb-exec-items">
      {assistants.map((a, i) => {
        const vt = a.valueType || 'percent';
        const val = a.value ?? a.percent ?? 0;
        return (
          <div key={i} className="rb-exec-item">
            <div className="rb-exec-item-name" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.name}
            </div>
            <span style={{ fontSize: 12, color: 'var(--rb-danger)', fontWeight: 600, whiteSpace: 'nowrap', width: 60, textAlign: 'right', display: 'inline-block', flexShrink: 0 }}>
              {vt === 'rub' ? `${val} ₽` : `${val}%`}
            </span>
            {!readOnly && (
              <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Assistant add form with MIS autocomplete ─────────────────────────────────

function AssistantAddForm({ doctors, onAdd, saving, readOnly, visible, onToggle }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [valueType, setValueType] = useState('percent');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);

  if (readOnly || !visible) return null;

  const handleNameChange = (val) => {
    setName(val);
    if (val.length >= 1) {
      const matches = (doctors || [])
        .filter(d => d.name.toLowerCase().includes(val.toLowerCase()))
        .slice(0, 8);
      setSuggestions(matches);
      setOpen(matches.length > 0);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  };

  const handleSelect = (doctorName) => {
    setName(doctorName);
    setSuggestions([]);
    setOpen(false);
  };

  const handleAdd = () => {
    if (!name.trim()) { toast.error('Укажите имя ассистента'); return; }
    const v = parseFloat(value);
    if (isNaN(v) || v < 0) { toast.error('Укажите значение'); return; }
    onAdd({ name: name.trim(), value: v, valueType });
    setName('');
    setValue('');
  };

  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="text"
          placeholder="Имя ассистента..."
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        {open && suggestions.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--rb-border-dark)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
            {suggestions.map(d => (
              <div
                key={d.id}
                onMouseDown={() => handleSelect(d.name)}
                style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f1f5f9' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                {d.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number" min="0" step="0.1"
          placeholder="0"
          value={value}
          onChange={e => setValue(e.target.value)}
          style={{ width: 70, padding: '6px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
        />
        <div className="rb-exec-type-toggle">
          <button className={`rb-exec-type-btn${valueType === 'percent' ? ' active' : ''}`} onClick={() => setValueType('percent')}>%</button>
          <button className={`rb-exec-type-btn${valueType === 'rub' ? ' active' : ''}`} onClick={() => setValueType('rub')}>₽</button>
        </div>
      </div>
      <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAdd} disabled={saving}>
        Добавить
      </button>
    </div>
  );
}

// ─── Anesthesiologist list ────────────────────────────────────────────────────

function AnesthesiologistsList({ anesthesiologists, onDelete, onReorderRules, onEditRule, readOnly }) {
  const [editKey, setEditKey] = useState(null); // `${anestIdx}:${ruleIdx}`
  const [editContains, setEditContains] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editValueType, setEditValueType] = useState('rub');

  if (!anesthesiologists || !anesthesiologists.length) return null;

  const startEdit = (i, j, r) => {
    setEditKey(`${i}:${j}`);
    setEditContains(r.contains);
    setEditValue(String(r.value));
    setEditValueType(r.valueType || 'rub');
  };
  const cancelEdit = () => setEditKey(null);
  const saveEdit = (i, j) => {
    if (!editContains.trim()) return;
    const v = parseFloat(editValue);
    if (isNaN(v) || v < 0) return;
    onEditRule(i, j, { contains: editContains.trim(), value: v, valueType: editValueType });
    setEditKey(null);
  };

  const handleDragStart = (e, anestIdx, ruleIdx) => {
    e.dataTransfer.setData('anest-idx', String(anestIdx));
    e.dataTransfer.setData('rule-idx', String(ruleIdx));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e) => { e.preventDefault(); e.currentTarget.style.borderTop = '2px solid #3b82f6'; };
  const handleDragLeave = (e) => { e.currentTarget.style.borderTop = ''; };
  const handleDrop = (e, anestIdx, ruleIdx) => {
    e.preventDefault();
    e.currentTarget.style.borderTop = '';
    const fromAnest = parseInt(e.dataTransfer.getData('anest-idx'));
    const fromRule  = parseInt(e.dataTransfer.getData('rule-idx'));
    if (fromAnest === anestIdx && fromRule !== ruleIdx) onReorderRules(anestIdx, fromRule, ruleIdx);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      {anesthesiologists.map((a, i) => (
        <div key={i} style={{ border: '1px solid var(--rb-border)', borderRadius: 8, padding: '8px 10px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--rb-text)' }}>{a.name}</div>
            {!readOnly && (
              <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          {(a.rules || []).map((r, j) => {
              const key = `${i}:${j}`;
              const isEditing = editKey === key;
              return isEditing ? (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0', borderTop: '2px solid transparent' }}>
                  <span style={{ color: '#94a3b8', minWidth: 14, textAlign: 'right', flexShrink: 0, fontSize: 11 }}>{j + 1}.</span>
                  <input
                    autoFocus
                    value={editContains}
                    onChange={e => setEditContains(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(i, j); if (e.key === 'Escape') cancelEdit(); }}
                    style={{ flex: 1, padding: '3px 7px', border: '1px solid #3b82f6', borderRadius: 5, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <input
                    type="number" min="0" step="0.1"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(i, j); if (e.key === 'Escape') cancelEdit(); }}
                    style={{ width: 65, padding: '3px 7px', border: '1px solid #3b82f6', borderRadius: 5, fontSize: 12, outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
                  />
                  <div className="rb-exec-type-toggle">
                    <button className={`rb-exec-type-btn${editValueType === 'percent' ? ' active' : ''}`} onClick={() => setEditValueType('percent')}>%</button>
                    <button className={`rb-exec-type-btn${editValueType === 'rub' ? ' active' : ''}`} onClick={() => setEditValueType('rub')}>₽</button>
                  </div>
                  <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={() => saveEdit(i, j)} title="Сохранить">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <button className="rb-btn rb-btn-secondary rb-btn-xs" onClick={cancelEdit} title="Отмена">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ) : (
                <div
                  key={j}
                  draggable={!readOnly}
                  onDragStart={readOnly ? undefined : e => handleDragStart(e, i, j)}
                  onDragOver={readOnly ? undefined : handleDragOver}
                  onDragLeave={readOnly ? undefined : handleDragLeave}
                  onDrop={readOnly ? undefined : e => handleDrop(e, i, j)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--rb-text-secondary)', padding: '2px 0', borderTop: '2px solid transparent', cursor: readOnly ? 'default' : 'grab' }}
                >
                  {!readOnly && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{ color: '#cbd5e1', flexShrink: 0 }}>
                      <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/>
                      <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/>
                      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
                      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
                      <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/>
                      <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>
                    </svg>
                  )}
                  <span style={{ color: '#94a3b8', minWidth: 14, textAlign: 'right', flexShrink: 0 }}>{j + 1}.</span>
                  <span style={{ color: '#64748b' }}>содержит </span>
                  <span style={{ fontWeight: 600, color: 'var(--rb-text)' }}>«{r.contains}»</span>
                  <span style={{ color: '#64748b' }}> → </span>
                  <span style={{ fontWeight: 600, color: 'var(--rb-success)' }}>{r.valueType === 'rub' ? `${r.value} ₽` : `${r.value}%`}</span>
                  {!readOnly && (
                    <button className="rb-btn rb-btn-secondary rb-btn-xs" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => startEdit(i, j, r)} title="Редактировать">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                </div>
              );
            })
          }
        </div>
      ))}
    </div>
  );
}

// ─── Anesthesiologist add form with MIS autocomplete ──────────────────────────

function AnesthesiologistAddForm({ doctors, onAdd, saving, readOnly }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [ruleContains, setRuleContains] = useState('');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleValueType, setRuleValueType] = useState('rub');

  if (readOnly) return null;

  const handleNameChange = (val) => {
    setName(val);
    if (val.length >= 1) {
      const matches = (doctors || []).filter(d => d.name.toLowerCase().includes(val.toLowerCase())).slice(0, 8);
      setSuggestions(matches);
      setOpen(matches.length > 0);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  };

  const handleAddRule = () => {
    if (!ruleContains.trim()) { toast.error('Укажите текст для поиска в названии услуги'); return; }
    const v = parseFloat(ruleValue);
    if (isNaN(v) || v < 0) { toast.error('Укажите значение'); return; }
    setRules(prev => [...prev, { contains: ruleContains.trim(), value: v, valueType: ruleValueType }]);
    setRuleContains('');
    setRuleValue('');
  };

  const handleDeleteRule = (idx) => setRules(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!name.trim()) { toast.error('Укажите имя анестезиолога'); return; }
    if (!rules.length) { toast.error('Добавьте хотя бы одно правило'); return; }
    onAdd({ name: name.trim(), rules });
    setName(''); setRules([]); setRuleContains(''); setRuleValue(''); setExpanded(false);
  };

  if (!expanded) {
    return (
      <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={() => setExpanded(true)} style={{ marginTop: 4 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Добавить анестезиолога
      </button>
    );
  }

  return (
    <div style={{ border: '1px dashed var(--rb-border-dark)', borderRadius: 8, padding: 12, marginTop: 6, background: '#f0f7ff' }}>
      {/* Doctor name */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 4 }}>Врач-анестезиолог</div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Начните вводить имя..."
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          {open && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--rb-border-dark)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
              {suggestions.map(d => (
                <div key={d.id} onMouseDown={() => { setName(d.name); setSuggestions([]); setOpen(false); }}
                  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f1f5f9' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>{d.name}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rules */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>Правила начисления</div>
        {rules.length > 0 && (
          <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rules.map((r, i) => (
              <div
                key={i}
                draggable
                onDragStart={e => { e.dataTransfer.setData('form-rule-idx', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderTop = '2px solid #3b82f6'; }}
                onDragLeave={e => { e.currentTarget.style.borderTop = ''; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderTop = '';
                  const from = parseInt(e.dataTransfer.getData('form-rule-idx'));
                  if (!isNaN(from) && from !== i) {
                    setRules(prev => {
                      const arr = [...prev];
                      const [moved] = arr.splice(from, 1);
                      arr.splice(i, 0, moved);
                      return arr;
                    });
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 6, padding: '4px 8px', cursor: 'grab', borderTop: '2px solid transparent' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{ color: '#cbd5e1', flexShrink: 0 }}>
                  <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/>
                  <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/>
                  <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
                  <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
                  <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/>
                  <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>
                </svg>
                <span style={{ color: '#94a3b8', minWidth: 14, textAlign: 'right' }}>{i + 1}.</span>
                <span style={{ color: '#64748b' }}>содержит</span>
                <span style={{ fontWeight: 600 }}>«{r.contains}»</span>
                <span style={{ color: '#64748b' }}>→</span>
                <span style={{ fontWeight: 600, color: 'var(--rb-success)' }}>{r.valueType === 'rub' ? `${r.value} ₽` : `${r.value}%`}</span>
                <button className="rb-btn rb-btn-danger rb-btn-xs" style={{ marginLeft: 'auto' }} onClick={() => handleDeleteRule(i)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Add rule row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Название содержит..."
            value={ruleContains}
            onChange={e => setRuleContains(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddRule()}
            style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
          />
          <input
            type="number" min="0" step="0.1" placeholder="0"
            value={ruleValue}
            onChange={e => setRuleValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddRule()}
            style={{ width: 70, padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
          />
          <div className="rb-exec-type-toggle">
            <button className={`rb-exec-type-btn${ruleValueType === 'percent' ? ' active' : ''}`} onClick={() => setRuleValueType('percent')}>%</button>
            <button className={`rb-exec-type-btn${ruleValueType === 'rub' ? ' active' : ''}`} onClick={() => setRuleValueType('rub')}>₽</button>
          </div>
          <button className="rb-btn rb-btn-secondary rb-btn-xs" onClick={handleAddRule} title="Добавить правило">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={() => { setExpanded(false); setName(''); setRules([]); setRuleContains(''); setRuleValue(''); }}>Отмена</button>
        <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleSave} disabled={saving}>Сохранить</button>
      </div>
    </div>
  );
}
