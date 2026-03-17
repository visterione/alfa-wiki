import React, { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { executorSettings } from '../../../services/api';

const EXEC_DEDUCTION_SUGGESTS = ['Штраф', 'Взыскание', 'Кредит', 'Алименты', 'Удержание'];
const EXEC_MATERIAL_SUGGESTS  = ['Расходники', 'Медикаменты', 'Инструменты', 'Перевязочный материал', 'Реагенты'];
const EXEC_EXTRA_SUGGESTS     = ['Дежурство', 'Обучение', 'Сверхурочные', 'Премия', 'Командировка'];

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
    includeReferralBonuses: true,
    includeReferralDeductions: true,
    includeCorpInvoices: true,
    assistancePercent: 0,
    cabinets: [],
    deductions: [],
    materials: [],
    serviceMaterials: [],
    extras: [],
  };
}

function execDefault() {
  return { assistants: [], clinicSettings: { global: execClinicDefault() } };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ItemsList({ items, section, onDelete, readOnly }) {
  if (!items || !items.length) {
    return <div className="rb-exec-empty">Нет записей</div>;
  }
  return (
    <div className="rb-exec-items">
      {items.map((item, i) => (
        <div key={i} className="rb-exec-item">
          <div className="rb-exec-item-name">
            {item.name}
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
              {item.valueType === 'percent' ? `${item.value}%` : `${item.value} ₽`}
            </span>
            {section === 'deductions' && item.deductionType === 'turnover' && (
              <span style={{ marginLeft: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '1px 5px' }}>оборот</span>
            )}
            {section === 'deductions' && item.deductionType !== 'turnover' && (
              <span style={{ marginLeft: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '1px 5px' }}>от з/п</span>
            )}
          </div>
          {!readOnly && (
            <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(section, i)} title="Удалить">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ExtrasList({ extras, onDelete, readOnly }) {
  if (!extras || !extras.length) {
    return <div className="rb-exec-empty">Нет записей</div>;
  }
  return (
    <div className="rb-exec-items">
      {extras.map((e, i) => (
        <div key={i} className="rb-exec-item">
          <div className="rb-exec-item-name">
            {e.name}
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>{e.amount} ₽</span>
            {e.hours > 0 && <span style={{ marginLeft: 4, fontSize: 11, color: '#94a3b8' }}>{e.hours} ч.</span>}
          </div>
          {!readOnly && (
            <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SvcMaterialsList({ items, onDelete, readOnly }) {
  if (!items || !items.length) {
    return <div className="rb-exec-empty">Нет записей</div>;
  }
  return (
    <div className="rb-exec-items">
      {items.map((item, i) => (
        <div key={i} className="rb-exec-item">
          <div className="rb-exec-item-name">
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.serviceName || item.serviceCode}</span>
            {' — '}
            {item.name}
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
              {item.valueType === 'percent' ? `${item.value}%` : `${item.value} ₽`}
            </span>
            {item.deductionType === 'turnover' && (
              <span style={{ marginLeft: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '1px 5px' }}>оборот</span>
            )}
          </div>
          {!readOnly && (
            <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddItemForm({ section, suggests, onAdd, readOnly }) {
  if (readOnly) return null;
  const [visible, setVisible] = useState(false);
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
          <div className="rb-exec-suggests" style={{ marginBottom: 8 }}>
            {suggests.map(s => (
              <span key={s} className="rb-exec-suggest" onClick={() => setName(s)}>{s}</span>
            ))}
          </div>
          <div className="rb-exec-add-row">
            <div className="rb-exec-add-field flex-grow">
              <label>Название</label>
              <input type="text" placeholder="Введите название..." value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="rb-exec-add-field">
              <label>Значение</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="number" placeholder="0" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} style={{ width: 80 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className={`rb-exec-type-btn${valueType === 'percent' ? ' active' : ''}`} onClick={() => setValueType('percent')}>%</button>
                  <button className={`rb-exec-type-btn${valueType === 'rub' ? ' active' : ''}`} onClick={() => setValueType('rub')}>₽</button>
                </div>
              </div>
            </div>
            {section === 'deductions' && (
              <div className="rb-exec-add-field">
                <label>Тип</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className={`rb-exec-type-btn${deductionType === 'final' ? ' active' : ''}`} onClick={() => setDeductionType('final')} title="Вычитается из итоговой зарплаты">от з/п</button>
                  <button className={`rb-exec-type-btn${deductionType === 'turnover' ? ' active' : ''}`} onClick={() => setDeductionType('turnover')} title="Вычитается от оборота выполненных услуг">оборот</button>
                </div>
              </div>
            )}
            <div style={{ paddingBottom: 1 }}>
              <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAdd}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
      <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={() => setVisible(v => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        {visible ? 'Скрыть' : 'Добавить запись'}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StepExecutors({ selectedDoctor, clinics, doctors, readOnly }) {
  const [execData, setExecData] = useState(execDefault());
  const [activeClinic, setActiveClinic] = useState('global');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cabinetInput, setCabinetInput] = useState('');
  const autoSaveTimer = useRef(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDoctor) return;
    setLoading(true);
    setActiveClinic('global');
    executorSettings.get(selectedDoctor.id)
      .then(res => {
        const raw = res.data;
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
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, global: { ...(execData.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets } } };
    await saveToServer(newData);
    toast.success(`Кабинет "${name}" добавлен`);
  };

  const handleDeleteCabinet = async (idx) => {
    const newCabinets = globalCabinets.filter((_, i) => i !== idx);
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, global: { ...(execData.clinicSettings?.global || execClinicDefault()), cabinets: newCabinets } } };
    setExecData(newData);
    await saveToServer(newData);
    toast.success('Кабинет удалён');
  };

  // ── Items (deductions / materials) ───────────────────────────────────────
  const handleAddItem = async (section, item) => {
    const current = getClinicData();
    const arr = [...(current[section] || []), item];
    updateClinicData({ [section]: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), [section]: arr } } };
    await saveToServer(newData);
    toast.success('Добавлено');
  };

  const handleDeleteItem = async (section, idx) => {
    const current = getClinicData();
    const arr = (current[section] || []).filter((_, i) => i !== idx);
    updateClinicData({ [section]: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), [section]: arr } } };
    await saveToServer(newData);
  };

  const handleAddSvcMaterial = async (item) => {
    const current = getClinicData();
    const arr = [...(current.serviceMaterials || []), item];
    updateClinicData({ serviceMaterials: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), serviceMaterials: arr } } };
    await saveToServer(newData);
    toast.success('Добавлено');
  };

  const handleDeleteSvcMaterial = async (idx) => {
    const current = getClinicData();
    const arr = (current.serviceMaterials || []).filter((_, i) => i !== idx);
    updateClinicData({ serviceMaterials: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), serviceMaterials: arr } } };
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
    toast.success('Добавлено');
  };

  const handleDeleteExtra = async (idx) => {
    const current = getClinicData();
    const arr = (current.extras || []).filter((_, i) => i !== idx);
    updateClinicData({ extras: arr });
    const newData = { ...execData, clinicSettings: { ...execData.clinicSettings, [activeClinic]: { ...(execData.clinicSettings?.[activeClinic] || execClinicDefault()), extras: arr } } };
    await saveToServer(newData);
  };

  // ── Assistants (global, not per-clinic) ───────────────────────────────────
  const handleAddAssistant = async (item) => {
    const arr = [...(execData.assistants || []), item];
    const newData = { ...execData, assistants: arr };
    setExecData(newData);
    await saveToServer(newData);
    toast.success('Добавлено');
  };

  const handleDeleteAssistant = async (idx) => {
    const arr = (execData.assistants || []).filter((_, i) => i !== idx);
    const newData = { ...execData, assistants: arr };
    setExecData(newData);
    await saveToServer(newData);
  };

  // ── SvcMaterial add form state ────────────────────────────────────────────
  const [svcMatForm, setSvcMatForm] = useState({ name: '', value: '', valueType: 'percent', deductionType: 'final' });

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
      {/* Header */}
      <div className="rb-doctor-card-header">
        <div className="rb-doctor-card-info">
          <h2>{selectedDoctor.name}</h2>
        </div>
      </div>

      {/* Clinic tabs */}
      {clinicTabs.length > 1 && (
        <div className="rb-clinic-tab-wrap">
          {clinicTabs.map(tab => (
            <button
              key={tab.id}
              className={`rb-clinic-tab${activeClinic === tab.id ? ' active' : ''}`}
              style={activeClinic === tab.id ? { borderBottomColor: tab.color } : {}}
              onClick={() => handleSwitchClinic(tab.id)}
            >
              {tab.id !== 'global' && (
                <span className="rb-clinic-tab-dot" style={{ background: tab.color }} />
              )}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <div style={{ padding: '0 20px 20px' }}>

        {/* ── Payment section ── */}
        <div className="rb-exec-section">
          <div className="rb-exec-section-header">
            <div className="rb-exec-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
              Оплата
            </div>
          </div>
          <div className="rb-exec-section-body">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>Тип оплаты</div>
            <div className="rb-paytype-toggle">
              {['salary', 'hourly', 'percent'].map((type, i) => (
                <button
                  key={type}
                  className={`rb-paytype-btn${pt === type ? ' active' : ''}`}
                  onClick={() => handlePayTypeChange(type)}
                >
                  {['Фиксированный оклад', 'Почасовой оклад', '% от услуг'][i]}
                </button>
              ))}
            </div>

            {pt === 'salary' && (
              <div className="rb-exec-field">
                <label>Фиксированный оклад, ₽</label>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.fixedSalary || ''}
                  onChange={e => handlePaymentFieldChange('fixedSalary', parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            {pt === 'hourly' && (
              <div>
                <div className="rb-exec-fields-grid">
                  <div className="rb-exec-field">
                    <label>Ставка, ₽/час</label>
                    <input
                      type="number" min="0" step="any" placeholder="0"
                      value={data.hourlyRate || ''}
                      onChange={e => handlePaymentFieldChange('hourlyRate', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="rb-exec-field">
                    <label>Часов за период</label>
                    <input
                      type="number" min="0" step="0.5" placeholder="0"
                      value={data.hoursWorked || ''}
                      onChange={e => handlePaymentFieldChange('hoursWorked', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="rb-hourly-preview">= {hourlyTotal.toFixed(2)} ₽</div>
              </div>
            )}

            {pt === 'percent' && (
              <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', padding: '6px 0', lineHeight: 1.5 }}>
                Базовая оплата = сумма бонусов из вкладки <strong>«Выполненные услуги»</strong>.
                Укажите там бонус (% или ₽) для каждой нужной услуги.
              </div>
            )}

            {pt !== 'percent' && (
              <div className="rb-plus-pct-row">
                <input
                  type="checkbox" id="exec-plus-pct"
                  checked={!!data.plusPercent}
                  onChange={e => handlePaymentFieldChange('plusPercent', e.target.checked)}
                />
                <label htmlFor="exec-plus-pct">+ Бонусы за выполненные услуги</label>
              </div>
            )}

            <div className="rb-plus-pct-row">
              <input
                type="checkbox" id="exec-include-ref-bonuses"
                checked={data.includeReferralBonuses !== false}
                onChange={e => handlePaymentFieldChange('includeReferralBonuses', e.target.checked)}
              />
              <label htmlFor="exec-include-ref-bonuses">Начислять бонусы за направления</label>
            </div>
            <div className="rb-plus-pct-row">
              <input
                type="checkbox" id="exec-include-ref-deductions"
                checked={data.includeReferralDeductions !== false}
                onChange={e => handlePaymentFieldChange('includeReferralDeductions', e.target.checked)}
              />
              <label htmlFor="exec-include-ref-deductions">Списывать бонусы направителям</label>
            </div>
            <div className="rb-exec-fields-grid" style={{ marginTop: 12 }}>
              <div className="rb-exec-field">
                <label>Способ выплаты аванса</label>
                <select value={data.paymentMethod || 'card'} onChange={e => handlePaymentFieldChange('paymentMethod', e.target.value)}>
                  <option value="card">Карта</option>
                  <option value="cash">Наличные</option>
                </select>
              </div>
              <div className="rb-exec-field">
                <label>Аванс, ₽</label>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.advance || ''}
                  onChange={e => handlePaymentFieldChange('advance', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="rb-exec-field">
                <label>Способ выплаты тела ЗП</label>
                <select value={data.mainPaymentMethod || 'card'} onChange={e => handlePaymentFieldChange('mainPaymentMethod', e.target.value)}>
                  <option value="card">Карта</option>
                  <option value="cash">Наличные</option>
                </select>
              </div>
              <div className="rb-exec-field">
                <label>Тело ЗП, ₽</label>
                <input
                  type="number" min="0" step="any" placeholder="0"
                  value={data.mainPayment || ''}
                  onChange={e => handlePaymentFieldChange('mainPayment', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="rb-exec-save-row">
              <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleSavePayment} disabled={saving}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                </svg>
                Сохранить
              </button>
            </div>
          </div>
        </div>

        {/* ── Cabinets (global only) ── */}
        {activeClinic === 'global' && (
          <div className="rb-exec-section">
            <div className="rb-exec-section-header">
              <div className="rb-exec-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/>
                </svg>
                Кабинеты
              </div>
            </div>
            <div className="rb-exec-section-body">
              <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
                Укажите кабинеты, где работает врач. В шаге «Выполненные услуги» они появятся в виде готового списка.
              </div>
              {globalCabinets.length === 0
                ? <div className="rb-exec-empty">Кабинеты не указаны</div>
                : (
                  <div className="rb-exec-items">
                    {globalCabinets.map((cab, i) => (
                      <div key={i} className="rb-exec-item">
                        <div className="rb-exec-item-name">📍 {cab}</div>
                        <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => handleDeleteCabinet(i)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )
              }
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <input
                  type="text" placeholder="Название кабинета..."
                  value={cabinetInput}
                  onChange={e => setCabinetInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCabinet()}
                  style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
                <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAddCabinet}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Добавить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Deductions ── */}
        <div className="rb-exec-section">
          <div className="rb-exec-section-header">
            <div className="rb-exec-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              Расходники / Штрафы / Взыскания
            </div>
          </div>
          <div className="rb-exec-section-body">
            {/* Assistance percent */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 8px' }}>
              <label style={{ fontSize: 13, color: 'var(--rb-text)', flex: 1 }}>
                % на ассистирование <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(по умолчанию)</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number" min="0" max="100" step="0.1" placeholder="0"
                  value={data.assistancePercent || ''}
                  onChange={e => handlePaymentFieldChange('assistancePercent', parseFloat(e.target.value) || 0)}
                  style={{ width: 80, padding: '6px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
                />
                <span style={{ fontSize: 13, color: 'var(--rb-text-secondary)' }}>%</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10, lineHeight: 1.4 }}>
              Если при выполнении услуги задействован ассистент, этот % вычитается из бонуса врача и начисляется ассистенту.
              Применяется для всех ассистентов, у которых не задан индивидуальный %.
            </div>
            {/* Per-assistant overrides */}
            <div style={{ borderTop: '1px dashed var(--rb-border)', paddingTop: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>
                Индивидуальный % для ассистентов:
              </div>
              <AssistantsList assistants={execData.assistants || []} onDelete={handleDeleteAssistant} readOnly={readOnly} />
              <AssistantAddForm doctors={doctors} onAdd={handleAddAssistant} saving={saving} readOnly={readOnly} />
            </div>
            <div style={{ borderTop: '1px dashed var(--rb-border)', marginBottom: 10 }} />
            <ItemsList items={data.deductions || []} section="deductions" onDelete={handleDeleteItem} readOnly={readOnly} />
            <AddItemForm section="deductions" suggests={EXEC_DEDUCTION_SUGGESTS} onAdd={handleAddItem} readOnly={readOnly} />
          </div>
        </div>

        {/* ── Materials ── */}
        <div className="rb-exec-section">
          <div className="rb-exec-section-header">
            <div className="rb-exec-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
              </svg>
              Чистый расход на материалы
            </div>
          </div>
          <div className="rb-exec-section-body">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>Общие (для всех услуг)</div>
            <ItemsList items={data.materials || []} section="materials" onDelete={handleDeleteItem} readOnly={readOnly} />
            <AddItemForm section="materials" suggests={EXEC_MATERIAL_SUGGESTS} onAdd={handleAddItem} readOnly={readOnly} />

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed #e2e8f0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 2 }}>Индивидуальные расходники по услугам</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>Для выбранных услуг применяется своё значение вместо общего</div>
              <SvcMaterialsList items={data.serviceMaterials || []} onDelete={handleDeleteSvcMaterial} readOnly={readOnly} />
              {/* Simplified add form for svc materials */}
              <SvcMaterialAddForm suggests={EXEC_MATERIAL_SUGGESTS} form={svcMatForm} setForm={setSvcMatForm} onAdd={handleAddSvcMaterial} readOnly={readOnly} />
            </div>
          </div>
        </div>

        {/* ── Extras ── */}
        <div className="rb-exec-section">
          <div className="rb-exec-section-header">
            <div className="rb-exec-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              Дополнительно
            </div>
          </div>
          <div className="rb-exec-section-body">
            <ExtrasList extras={data.extras || []} onDelete={handleDeleteExtra} readOnly={readOnly} />
            <ExtraAddForm
              suggests={EXEC_EXTRA_SUGGESTS}
              form={extraForm}
              setForm={setExtraForm}
              onAdd={handleAddExtra}
              readOnly={readOnly}
            />
          </div>
        </div>

      </div>
      </fieldset>
    </div>
  );
}

// ─── Extra add form ───────────────────────────────────────────────────────────

function ExtraAddForm({ suggests, form, setForm, onAdd, readOnly }) {
  const [visible, setVisible] = useState(false);
  if (readOnly) return null;
  return (
    <div>
      {visible && (
        <div className="rb-exec-add-form visible" style={{ marginBottom: 8 }}>
          <div className="rb-exec-suggests" style={{ marginBottom: 8 }}>
            {suggests.map(s => (
              <span key={s} className="rb-exec-suggest" onClick={() => setForm(f => ({ ...f, name: s }))}>{s}</span>
            ))}
          </div>
          <div className="rb-exec-add-row">
            <div className="rb-exec-add-field flex-grow">
              <label>Услуга / описание</label>
              <input type="text" placeholder="Введите название..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="rb-exec-add-field">
              <label>Сумма, ₽</label>
              <input type="number" placeholder="0" min="0" step="any" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 90 }} />
            </div>
            <div className="rb-exec-add-field">
              <label>Часов</label>
              <input type="number" placeholder="0" min="0" step="0.5" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} style={{ width: 70 }} />
            </div>
            <div style={{ paddingBottom: 1 }}>
              <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={onAdd}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
      <button className="rb-btn rb-btn-secondary rb-btn-sm" onClick={() => setVisible(v => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {visible ? 'Скрыть' : 'Добавить запись'}
      </button>
    </div>
  );
}

// ─── Svc material add form ────────────────────────────────────────────────────

function SvcMaterialAddForm({ suggests, form, setForm, onAdd, readOnly }) {
  const [visible, setVisible] = useState(false);
  if (readOnly) return null;

  const handleAdd = () => {
    const value = parseFloat(form.value);
    if (!form.name.trim()) { toast.error('Укажите название'); return; }
    if (isNaN(value) || value < 0) { toast.error('Укажите значение'); return; }
    // serviceCode/serviceName left blank — user can add them as part of the name
    onAdd({ serviceCode: '', serviceName: form.name.trim(), name: form.name.trim(), value, valueType: form.valueType, deductionType: form.deductionType });
    setForm({ name: '', value: '', valueType: 'percent', deductionType: 'final' });
  };

  return (
    <div>
      {visible && (
        <div className="rb-exec-add-form visible" style={{ marginBottom: 8 }}>
          <div className="rb-exec-suggests" style={{ marginBottom: 8 }}>
            {suggests.map(s => (
              <span key={s} className="rb-exec-suggest" onClick={() => setForm(f => ({ ...f, name: s }))}>{s}</span>
            ))}
          </div>
          <div className="rb-exec-add-row">
            <div className="rb-exec-add-field flex-grow">
              <label>Материал / услуга</label>
              <input type="text" placeholder="Название..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="rb-exec-add-field">
              <label>Значение</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="number" placeholder="0" min="0" step="any" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} style={{ width: 80 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className={`rb-exec-type-btn${form.valueType === 'percent' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, valueType: 'percent' }))}>%</button>
                  <button className={`rb-exec-type-btn${form.valueType === 'rub' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, valueType: 'rub' }))}>₽</button>
                </div>
              </div>
            </div>
            <div className="rb-exec-add-field">
              <label>Тип</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
      )}
      <button className="rb-btn rb-btn-secondary rb-btn-sm" style={{ marginTop: 6 }} onClick={() => setVisible(v => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {visible ? 'Скрыть' : 'Добавить индивидуальный расходник'}
      </button>
    </div>
  );
}

// ─── Assistants list ──────────────────────────────────────────────────────────

function AssistantsList({ assistants, onDelete, readOnly }) {
  if (!assistants || !assistants.length) {
    return <div className="rb-exec-empty">Нет записей</div>;
  }
  return (
    <div className="rb-exec-items">
      {assistants.map((a, i) => (
        <div key={i} className="rb-exec-item">
          <div className="rb-exec-item-name">
            {a.name}
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
              {a.percent}%
            </span>
          </div>
          {!readOnly && (
            <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(i)} title="Удалить">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Assistant add form with MIS autocomplete ─────────────────────────────────

function AssistantAddForm({ doctors, onAdd, saving, readOnly }) {
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);

  if (readOnly) return null;

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
    const pct = parseFloat(percent);
    if (isNaN(pct) || pct < 0) { toast.error('Укажите процент'); return; }
    onAdd({ name: name.trim(), percent: pct });
    setName('');
    setPercent('');
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
          type="number" min="0" max="100" step="0.1"
          placeholder="%"
          value={percent}
          onChange={e => setPercent(e.target.value)}
          style={{ width: 60, padding: '6px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>%</span>
      </div>
      <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleAdd} disabled={saving}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Добавить
      </button>
    </div>
  );
}
