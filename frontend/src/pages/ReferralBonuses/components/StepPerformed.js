import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { performedServiceBonuses, executorSettings, mis } from '../../../services/api';

// ─── Service row with bonus editing ──────────────────────────────────────────

function ServiceRow({ svc, idx, activeClinic, bonuses, globalCabinets, onReload }) {
  const code = svc.code || '';
  const name = svc.title || '';
  const price = svc.price ? ` (${parseFloat(svc.price).toFixed(2)} ₽)` : '';
  const dbClinicId = activeClinic === 'global' ? '' : String(activeClinic);

  // Bonus for this service + active clinic (no cabinet)
  const savedClinic = bonuses.find(b => b.serviceCode === code && b.clinicId === dbClinicId && (!b.cabinetId || b.cabinetId === ''));
  const savedGlobal = dbClinicId !== ''
    ? bonuses.find(b => b.serviceCode === code && (!b.clinicId || b.clinicId === '') && (!b.cabinetId || b.cabinetId === ''))
    : null;
  const saved = savedClinic || savedGlobal;
  const isFallback = !savedClinic && !!savedGlobal;

  const cabinetBonuses = bonuses.filter(b =>
    b.serviceCode === code && b.clinicId === dbClinicId && b.cabinetId && b.cabinetId !== ''
  );

  const hasPct = saved && saved.bonusPercent != null;
  const hasRub = saved && saved.bonusRub != null;
  const initType = hasPct ? 'pct' : hasRub ? 'rub' : 'pct';
  const initVal = hasPct ? saved.bonusPercent : hasRub ? saved.bonusRub : '';

  const [bonusType, setBonusType] = useState(initType);
  const [bonusVal, setBonusVal] = useState(initVal !== '' ? String(initVal) : '');
  const [expanded, setExpanded] = useState(false);
  const [cabForm, setCabForm] = useState({ name: '', val: '', type: 'pct' });
  const [saving, setSaving] = useState(false);

  // sync when bonuses reload
  useEffect(() => {
    const s2 = bonuses.find(b => b.serviceCode === code && b.clinicId === dbClinicId && (!b.cabinetId || b.cabinetId === ''));
    const g2 = dbClinicId !== '' ? bonuses.find(b => b.serviceCode === code && (!b.clinicId || b.clinicId === '') && (!b.cabinetId || b.cabinetId === '')) : null;
    const sv = s2 || g2;
    if (sv) {
      const hp = sv.bonusPercent != null;
      setBonusType(hp ? 'pct' : 'rub');
      setBonusVal(hp ? String(sv.bonusPercent) : sv.bonusRub != null ? String(sv.bonusRub) : '');
    }
  }, [bonuses, code, dbClinicId]); // eslint-disable-line

  const cabCount = cabinetBonuses.length;
  const cabBadgeColor = cabCount > 0 ? 'var(--rb-primary)' : '#94a3b8';
  const cabBadgeLabel = cabCount > 0 ? cabCount : globalCabinets.length;

  const handleSaveRow = async () => {
    if (bonusVal === '') return;
    const val = parseFloat(bonusVal);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId: null, // will be passed via parent save-all; this is per-row save
        clinicId: dbClinicId,
        serviceCode: code,
        serviceName: name,
        bonusPercent: bonusType === 'pct' ? val : null,
        bonusRub: bonusType === 'rub' ? val : null,
      });
      // This save-row path isn't used; saveAll handles bulk
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCab = async () => {
    if (!cabForm.name.trim()) { toast.error('Введите название кабинета'); return; }
    if (!cabForm.val) { toast.error('Введите значение бонуса'); return; }
    const val = parseFloat(cabForm.val);
    if (isNaN(val) || val < 0) { toast.error('Некорректное значение'); return; }
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId,
        doctorName,
        clinicId: dbClinicId,
        cabinetId: cabForm.name.trim(),
        serviceCode: code,
        serviceName: name,
        bonusPercent: cabForm.type === 'pct' ? val : null,
        bonusRub: cabForm.type === 'rub' ? val : null,
      });
      toast.success('Бонус для кабинета сохранён');
      setCabForm({ name: '', val: '', type: 'pct' });
      onReload();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCabBonus = async (cab, updType, updVal) => {
    const val = parseFloat(updVal);
    if (isNaN(val) || val < 0) { toast.error('Некорректное значение'); return; }
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId,
        doctorName,
        clinicId: dbClinicId,
        cabinetId: cab.cabinetId,
        serviceCode: code,
        serviceName: name,
        bonusPercent: updType === 'pct' ? val : null,
        bonusRub: updType === 'rub' ? val : null,
      });
      toast.success('Обновлено');
      onReload();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCabBonus = async (id) => {
    if (!window.confirm('Удалить бонус для кабинета?')) return;
    setSaving(true);
    try {
      await performedServiceBonuses.delete(id);
      toast.success('Удалено');
      onReload();
    } catch {
      toast.error('Ошибка удаления');
    } finally {
      setSaving(false);
    }
  };

  const rowBg = idx % 2 === 0 ? '' : '#f8fafc';

  return (
    <>
      <tr style={{ background: rowBg, borderBottom: '1px solid var(--rb-border)' }}>
        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: expanded ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', fontSize: 11, borderRadius: 3, marginRight: 2 }}
          >
            {expanded ? '▼' : '▶'}{' '}
            {(cabCount > 0 || globalCabinets.length > 0) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, background: cabBadgeColor, color: '#fff', borderRadius: '50%', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>
                {cabBadgeLabel}
              </span>
            )}
          </button>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--rb-text-secondary)' }}>{code}</span>
        </td>
        <td style={{ padding: '6px 10px' }}>
          {name}
          <span style={{ color: 'var(--rb-text-secondary)', fontSize: 11 }}>{price}</span>
          {isFallback && <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8', background: '#f1f5f9', borderRadius: 4, padding: '1px 4px' }}>общий</span>}
        </td>
        <td style={{ padding: '6px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className="rb-exec-type-toggle">
              <button className={`rb-exec-type-btn${bonusType === 'pct' ? ' active' : ''}`} onClick={() => setBonusType('pct')}>%</button>
              <button className={`rb-exec-type-btn${bonusType === 'rub' ? ' active' : ''}`} onClick={() => setBonusType('rub')}>₽</button>
            </div>
            <input
              type="number" min="0" step="any"
              placeholder={bonusType === 'pct' ? '%' : '₽'}
              value={bonusVal}
              onChange={e => setBonusVal(e.target.value)}
              style={{ width: 80, padding: '3px 6px', border: '1px solid var(--rb-border-dark)', borderRadius: 4, textAlign: 'right', fontSize: 12, opacity: isFallback ? 0.65 : 1 }}
            />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#f0f4ff', borderBottom: '1px solid var(--rb-border)' }}>
          <td colSpan="3" style={{ padding: '4px 10px 10px 36px' }}>
            <CabinetsSection
              svcCode={code}
              svcName={name}
              cabinetBonuses={cabinetBonuses}
              globalCabinets={globalCabinets}
              cabForm={cabForm}
              setCabForm={setCabForm}
              onSaveCab={handleSaveCab}
              onUpdateCab={handleUpdateCabBonus}
              onDeleteCab={handleDeleteCabBonus}
              saving={saving}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Cabinet section within expanded row ─────────────────────────────────────

function CabinetsSection({ cabinetBonuses, globalCabinets, cabForm, setCabForm, onSaveCab, onUpdateCab, onDeleteCab, saving }) {
  const extraBonuses = cabinetBonuses.filter(b => !globalCabinets.includes(b.cabinetId));

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 8, fontWeight: 500 }}>
        Бонусы по кабинетам <span style={{ fontWeight: 400 }}>(перекрывают общий бонус для услуги)</span>:
      </div>

      {globalCabinets.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-primary)', marginBottom: 6 }}>Кабинеты врача:</div>
          {globalCabinets.map(cabName => {
            const existing = cabinetBonuses.find(b => b.cabinetId === cabName);
            return (
              <CabEditItem
                key={cabName}
                cabName={cabName}
                existing={existing}
                onUpdate={onUpdateCab}
                onDelete={onDeleteCab}
                isGlobal
                saving={saving}
              />
            );
          })}
          {extraBonuses.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginTop: 8, marginBottom: 4 }}>Другие кабинеты:</div>
              {extraBonuses.map(cab => (
                <CabEditItem key={cab.id} cabName={cab.cabinetId} existing={cab} onUpdate={onUpdateCab} onDelete={onDeleteCab} saving={saving} />
              ))}
            </>
          )}
          <div style={{ marginTop: 8, borderTop: '1px solid var(--rb-border)', paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 4 }}>Добавить кабинет вне списка:</div>
            <CabAddForm form={cabForm} setForm={setCabForm} onSave={onSaveCab} saving={saving} />
          </div>
        </>
      )}

      {globalCabinets.length === 0 && (
        <>
          {cabinetBonuses.map(cab => (
            <CabEditItem key={cab.id} cabName={cab.cabinetId} existing={cab} onUpdate={onUpdateCab} onDelete={onDeleteCab} saving={saving} />
          ))}
          <CabAddForm form={cabForm} setForm={setCabForm} onSave={onSaveCab} saving={saving} />
        </>
      )}
    </div>
  );
}

function CabEditItem({ cabName, existing, onUpdate, onDelete, saving }) {
  const hasPct = existing && existing.bonusPercent != null;
  const initType = hasPct ? 'pct' : 'rub';
  const initVal = existing ? (hasPct ? String(existing.bonusPercent) : existing.bonusRub != null ? String(existing.bonusRub) : '') : '';

  const [type, setType] = useState(initType);
  const [val, setVal] = useState(initVal);

  const isSet = !!existing;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, ...(isSet ? { background: '#f0fdf4', borderRadius: 4, padding: '2px 6px' } : {}) }}>
      <span style={{ minWidth: 130, fontSize: 12, fontWeight: 500, color: 'var(--rb-text)' }}>{isSet ? '✅ ' : '📍 '}{cabName}</span>
      <div className="rb-exec-type-toggle">
        <button className={`rb-exec-type-btn${type === 'pct' ? ' active' : ''}`} onClick={() => setType('pct')}>%</button>
        <button className={`rb-exec-type-btn${type === 'rub' ? ' active' : ''}`} onClick={() => setType('rub')}>₽</button>
      </div>
      <input
        type="number" min="0" step="any"
        placeholder={type === 'pct' ? '%' : '₽'}
        value={val}
        onChange={e => setVal(e.target.value)}
        style={{ width: 72, padding: '3px 6px', border: `1px solid ${isSet ? 'var(--rb-success)' : 'var(--rb-border-dark)'}`, borderRadius: 4, textAlign: 'right', fontSize: 12 }}
      />
      <button onClick={() => onUpdate(existing || { cabinetId: cabName }, type, val)} disabled={saving} style={{ padding: '3px 8px', fontSize: 11, background: 'var(--rb-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        Сохр.
      </button>
      {isSet && (
        <button onClick={() => onDelete(existing.id)} disabled={saving} style={{ padding: '3px 6px', fontSize: 11, background: 'var(--rb-danger)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
      )}
    </div>
  );
}

function CabAddForm({ form, setForm, onSave, saving }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="text" placeholder="Название кабинета..."
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        style={{ width: 130, padding: '3px 7px', border: '1px solid var(--rb-border-dark)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }}
      />
      <div className="rb-exec-type-toggle">
        <button className={`rb-exec-type-btn${form.type === 'pct' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, type: 'pct', val: '' }))}>%</button>
        <button className={`rb-exec-type-btn${form.type === 'rub' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, type: 'rub', val: '' }))}>₽</button>
      </div>
      <input
        type="number" min="0" step="any"
        placeholder={form.type === 'pct' ? '%' : '₽'}
        value={form.val}
        onChange={e => setForm(f => ({ ...f, val: e.target.value }))}
        style={{ width: 72, padding: '3px 6px', border: '1px solid var(--rb-border-dark)', borderRadius: 4, textAlign: 'right', fontSize: 12 }}
      />
      <button onClick={onSave} disabled={saving} style={{ padding: '3px 8px', fontSize: 11, background: 'var(--rb-success)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        + Добавить
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StepPerformed({ selectedDoctor, clinics, readOnly }) {
  const [bonuses, setBonuses] = useState([]);
  const [services, setServices] = useState([]);
  const [globalCabinets, setGlobalCabinets] = useState([]);
  const [activeClinic, setActiveClinic] = useState('global');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // Per-row bonus state for save-all
  const [rowValues, setRowValues] = useState({}); // code -> { type, val }
  // Per-service corp invoices flag (default: false)
  const [corpMap, setCorpMap] = useState({}); // code -> boolean
  const [fullExecData, setFullExecData] = useState(null);

  const autoSaveTimerRef = useRef(null);
  const handleSaveAllRef = useRef(null);

  const loadBonuses = useCallback(async () => {
    if (!selectedDoctor) return;
    const res = await performedServiceBonuses.getByDoctor(selectedDoctor.id);
    setBonuses(Array.isArray(res.data) ? res.data : []);
  }, [selectedDoctor]);

  useEffect(() => {
    if (!selectedDoctor) return;
    setLoading(true);
    setActiveClinic('global');
    setRowValues({});
    setCorpMap({});
    setFullExecData(null);

    Promise.all([
      performedServiceBonuses.getByDoctor(selectedDoctor.id),
      executorSettings.get(selectedDoctor.id),
      mis.getDoctorInfo(selectedDoctor.id),
    ]).then(async ([bonusRes, execRes, doctorRes]) => {
      setBonuses(Array.isArray(bonusRes.data) ? bonusRes.data : []);

      // Cabinets from executor settings
      const execData = execRes.data;
      if (execData && execData.clinicSettings && execData.clinicSettings.global) {
        setGlobalCabinets(execData.clinicSettings.global.cabinets || []);
      } else {
        setGlobalCabinets([]);
      }
      setFullExecData(execData || null);
      setCorpMap(execData?.corpIncludedServices || {});

      // Load services
      try {
        const misData = doctorRes.data;
        if (misData && misData.data && Array.isArray(misData.data.services) && misData.data.services.length > 0) {
          const svcRes = await mis.getServicesByIds(misData.data.services);
          const raw = svcRes.data;
          if (raw && raw.error === 0 && raw.data) {
            const arr = Array.isArray(raw.data) ? raw.data : [raw.data];
            setServices(arr.map(s => ({
              code: s.code || s.sub_code || String(s.service_id || s.id || ''),
              title: s.title || '',
              price: parseFloat(s.price) || 0,
            })));
          } else {
            setServices([]);
          }
        } else {
          setServices([]);
        }
      } catch {
        setServices([]);
      }
    }).catch(() => {
      setBonuses([]);
      setGlobalCabinets([]);
      setServices([]);
    }).finally(() => setLoading(false));
  }, [selectedDoctor]);

  // Build row values map from bonuses when they or active clinic changes
  useEffect(() => {
    const dbClinicId = activeClinic === 'global' ? '' : String(activeClinic);
    const map = {};
    services.forEach(svc => {
      const code = svc.code;
      const savedClinic = bonuses.find(b => b.serviceCode === code && b.clinicId === dbClinicId && (!b.cabinetId || b.cabinetId === ''));
      const savedGlobal = dbClinicId !== ''
        ? bonuses.find(b => b.serviceCode === code && (!b.clinicId || b.clinicId === '') && (!b.cabinetId || b.cabinetId === ''))
        : null;
      const saved = savedClinic || savedGlobal;
      if (saved) {
        const hasPct = saved.bonusPercent != null;
        map[code] = { type: hasPct ? 'pct' : 'rub', val: String(parseFloat(hasPct ? saved.bonusPercent : saved.bonusRub)) };
      } else {
        map[code] = { type: 'pct', val: '' };
      }
    });
    setRowValues(map);
  }, [bonuses, activeClinic, services]);

  const handleSaveAll = async () => {
    if (!selectedDoctor) return;
    const dbClinicId = activeClinic === 'global' ? '' : String(activeClinic);
    const items = [];
    services.forEach(svc => {
      const rv = rowValues[svc.code];
      if (!rv || rv.val === '') return;
      const val = parseFloat(rv.val);
      if (isNaN(val) || val < 0) return;
      items.push({
        serviceCode: svc.code,
        serviceName: svc.title,
        bonusPercent: rv.type === 'pct' ? val : null,
        bonusRub: rv.type === 'rub' ? val : null,
      });
    });

    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId: selectedDoctor.id,
        doctorName: selectedDoctor.name,
        clinicId: dbClinicId,
        items,
      });
      // Save corp invoices map to executor settings
      const newExecData = { ...(fullExecData || {}), corpIncludedServices: corpMap };
      await executorSettings.save({
        misUserId: selectedDoctor.id,
        doctorName: selectedDoctor.name,
        settings: newExecData,
      });
      setFullExecData(newExecData);
      toast.success(`Сохранено ${items.length} бонусов`);
      await loadBonuses();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  // Keep ref to latest handleSaveAll for auto-save timer
  handleSaveAllRef.current = handleSaveAll;

  const triggerAutoSave = useCallback(() => {
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => handleSaveAllRef.current?.(), 1500);
  }, []);

  const filteredServices = services.filter(svc => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (svc.code || '').toLowerCase().includes(term) || (svc.title || '').toLowerCase().includes(term);
  });

  if (!selectedDoctor) {
    return (
      <div className="rb-placeholder">
        <p>Выберите врача из списка слева для настройки бонусов за выполненные услуги</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rb-doctor-card">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--rb-text-secondary)' }}>Загрузка услуг врача...</div>
      </div>
    );
  }

  const dbClinicId = activeClinic === 'global' ? '' : String(activeClinic);

  const allCorpIncluded = services.length > 0 && services.every(s => !!corpMap[s.code]);
  const someCorpIncluded = services.some(s => !!corpMap[s.code]);
  const handleToggleAllCorp = () => {
    const next = {};
    services.forEach(s => { next[s.code] = !allCorpIncluded; });
    setCorpMap(next);
  };

  return (
    <div className="rb-doctor-card">
      {/* Header */}
      <div className="rb-doctor-card-header">
        <div className="rb-doctor-card-info">
          <h2>{selectedDoctor.name}</h2>
        </div>
      </div>

      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <div className="rb-add-service-section" style={{ margin: '12px 0 0' }}>
        <div className="rb-add-service-header">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>
              <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            Бонусы за выполненные услуги
          </h3>
        </div>

        <div className="rb-add-service-body">
          <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 8 }}>
            Вкладка <strong>Общие</strong> — бонусы для всех клиник по умолчанию.
            Выберите клинику, чтобы задать отдельные ставки (перекроют общие для этой клиники).
          </div>

          {/* Clinic tabs */}
          <div className="rb-clinic-tab-wrap" style={{ marginBottom: 12 }}>
            <button
              className={`rb-clinic-tab${activeClinic === 'global' ? ' active' : ''}`}
              style={{ borderColor: 'var(--rb-primary)' }}
              onClick={() => setActiveClinic('global')}
            >
              Общие
            </button>
            {(clinics || []).map(c => (
              <button
                key={c.id}
                className={`rb-clinic-tab${activeClinic === String(c.id) ? ' active' : ''}`}
                style={activeClinic === String(c.id) ? { borderBottomColor: c.color } : {}}
                onClick={() => setActiveClinic(String(c.id))}
              >
                <span className="rb-clinic-tab-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>

          {/* Services table */}
          {services.length === 0 ? (
            <div className="rb-alert rb-alert-warning">Услуги врача не найдены в МИС.</div>
          ) : (
            <>
              <div style={{ marginBottom: 10 }}>
                <input
                  type="text"
                  placeholder="Поиск по коду или названию услуги..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ width: '100%', padding: '7px 12px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--rb-border)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Код</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Услуга</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11 }}>Юр. комп.</span>
                        <input
                          type="checkbox"
                          title="Выбрать/снять все"
                          checked={allCorpIncluded}
                          ref={el => { if (el) el.indeterminate = someCorpIncluded && !allCorpIncluded; }}
                          onChange={handleToggleAllCorp}
                          style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
                        />
                      </div>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, width: 190 }}>Бонус</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((svc, idx) => {
                    const rv = rowValues[svc.code] || { type: 'pct', val: '' };
                    return (
                      <ServiceRowControlled
                        key={svc.code}
                        svc={svc}
                        idx={idx}
                        dbClinicId={dbClinicId}
                        bonuses={bonuses}
                        globalCabinets={globalCabinets}
                        onReload={loadBonuses}
                        rowVal={rv}
                        onRowChange={(code, type, val) => { setRowValues(prev => ({ ...prev, [code]: { type, val } })); triggerAutoSave(); }}
                        misUserId={selectedDoctor.id}
                        doctorName={selectedDoctor.name}
                        corpIncluded={!!corpMap[svc.code]}
                        onCorpToggle={(code) => { setCorpMap(prev => ({ ...prev, [code]: !prev[code] })); triggerAutoSave(); }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      </fieldset>
    </div>
  );
}

// ─── Controlled service row (drives save-all) ─────────────────────────────────

function ServiceRowControlled({ svc, idx, dbClinicId, bonuses, globalCabinets, onReload, rowVal, onRowChange, misUserId, doctorName, corpIncluded, onCorpToggle }) {
  const code = svc.code || '';
  const name = svc.title || '';
  const price = svc.price ? ` (${parseFloat(svc.price).toFixed(2)} ₽)` : '';

  const savedClinic = bonuses.find(b => b.serviceCode === code && b.clinicId === dbClinicId && (!b.cabinetId || b.cabinetId === ''));
  const savedGlobal = dbClinicId !== ''
    ? bonuses.find(b => b.serviceCode === code && (!b.clinicId || b.clinicId === '') && (!b.cabinetId || b.cabinetId === ''))
    : null;
  const isFallback = !savedClinic && !!savedGlobal;

  const cabinetBonuses = bonuses.filter(b =>
    b.serviceCode === code && b.clinicId === dbClinicId && b.cabinetId && b.cabinetId !== ''
  );

  const [expanded, setExpanded] = useState(false);
  const [cabForm, setCabForm] = useState({ name: '', val: '', type: 'pct' });
  const [saving, setSaving] = useState(false);

  const cabCount = cabinetBonuses.length;
  const cabBadgeColor = cabCount > 0 ? 'var(--rb-primary)' : '#94a3b8';
  const showBadge = cabCount > 0 || globalCabinets.length > 0;
  const badgeNum = cabCount > 0 ? cabCount : globalCabinets.length;

  const handleSaveCab = async () => {
    if (!cabForm.name.trim()) { toast.error('Введите название кабинета'); return; }
    if (!cabForm.val) { toast.error('Введите значение бонуса'); return; }
    const val = parseFloat(cabForm.val);
    if (isNaN(val) || val < 0) { toast.error('Некорректное значение'); return; }
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId,
        doctorName,
        clinicId: dbClinicId,
        cabinetId: cabForm.name.trim(),
        serviceCode: code,
        serviceName: name,
        bonusPercent: cabForm.type === 'pct' ? val : null,
        bonusRub: cabForm.type === 'rub' ? val : null,
      });
      toast.success('Бонус для кабинета сохранён');
      setCabForm({ name: '', val: '', type: 'pct' });
      onReload();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCabBonus = async (cab, updType, updVal) => {
    const val = parseFloat(updVal);
    if (isNaN(val) || val < 0) { toast.error('Некорректное значение'); return; }
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId,
        doctorName,
        clinicId: dbClinicId,
        cabinetId: cab.cabinetId,
        serviceCode: code,
        serviceName: name,
        bonusPercent: updType === 'pct' ? val : null,
        bonusRub: updType === 'rub' ? val : null,
      });
      toast.success('Обновлено');
      onReload();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCabBonus = async (id) => {
    if (!window.confirm('Удалить бонус для кабинета?')) return;
    setSaving(true);
    try {
      await performedServiceBonuses.delete(id);
      toast.success('Удалено');
      onReload();
    } catch {
      toast.error('Ошибка удаления');
    } finally {
      setSaving(false);
    }
  };

  const rowBg = idx % 2 === 0 ? '' : '#f8fafc';

  return (
    <>
      <tr style={{ background: rowBg, borderBottom: '1px solid var(--rb-border)' }}>
        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: expanded ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', fontSize: 11, borderRadius: 3, marginRight: 2 }}
          >
            {expanded ? '▼' : '▶'}{' '}
            {showBadge && (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, background: cabBadgeColor, color: '#fff', borderRadius: '50%', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>
                {badgeNum}
              </span>
            )}
          </button>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--rb-text-secondary)' }}>{code}</span>
        </td>
        <td style={{ padding: '6px 10px' }}>
          {name}
          <span style={{ color: 'var(--rb-text-secondary)', fontSize: 11 }}>{price}</span>
          {isFallback && <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8', background: '#f1f5f9', borderRadius: 4, padding: '1px 4px' }}>общий</span>}
        </td>
        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={corpIncluded}
            onChange={() => onCorpToggle(code)}
            style={{ cursor: 'pointer', accentColor: 'var(--rb-primary)', width: 14, height: 14 }}
            title="Учитывать услуги оплаченные юр. компаниями"
          />
        </td>
        <td style={{ padding: '6px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className="rb-exec-type-toggle">
              <button className={`rb-exec-type-btn${rowVal.type === 'pct' ? ' active' : ''}`} onClick={() => onRowChange(code, 'pct', '')}>%</button>
              <button className={`rb-exec-type-btn${rowVal.type === 'rub' ? ' active' : ''}`} onClick={() => onRowChange(code, 'rub', '')}>₽</button>
            </div>
            <input
              type="number" min="0" step="any"
              placeholder={rowVal.type === 'pct' ? '%' : '₽'}
              value={rowVal.val}
              onChange={e => onRowChange(code, rowVal.type, e.target.value)}
              style={{ width: 80, padding: '3px 6px', border: '1px solid var(--rb-border-dark)', borderRadius: 4, textAlign: 'right', fontSize: 12, opacity: isFallback ? 0.65 : 1 }}
            />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#f0f4ff', borderBottom: '1px solid var(--rb-border)' }}>
          <td colSpan="4" style={{ padding: '4px 10px 10px 36px' }}>
            <CabinetsSection
              cabinetBonuses={cabinetBonuses}
              globalCabinets={globalCabinets}
              cabForm={cabForm}
              setCabForm={setCabForm}
              onSaveCab={handleSaveCab}
              onUpdateCab={handleUpdateCabBonus}
              onDeleteCab={handleDeleteCabBonus}
              saving={saving}
            />
          </td>
        </tr>
      )}
    </>
  );
}
