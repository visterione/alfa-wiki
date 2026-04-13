import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { performedServiceBonuses, executorSettings, mis } from '../../../services/api';
import { useTabSlider } from '../utils/useTabSlider';

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

  const handleSaveCab = async (form) => {
    if (!form.name.trim()) { toast.error('Введите название кабинета'); return; }
    if (!form.val) { toast.error('Введите значение бонуса'); return; }
    const val = parseFloat(form.val);
    if (isNaN(val) || val < 0) { toast.error('Некорректное значение'); return; }
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId,
        doctorName,
        clinicId: dbClinicId,
        cabinetId: form.name.trim(),
        serviceCode: code,
        serviceName: name,
        bonusPercent: form.type === 'pct' ? val : null,
        bonusRub: form.type === 'rub' ? val : null,
      });
      toast.success('Бонус для кабинета сохранён');
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

  const rowBg = '';

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
          <span style={{ fontSize: 13, color: 'var(--rb-text)' }}>{code}</span>
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
              cabinetBonuses={cabinetBonuses}
              globalCabinets={globalCabinets}
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

function CabinetsSection({ cabinetBonuses, globalCabinets, onSaveCab, onUpdateCab, onDeleteCab, saving }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [cabForm, setCabForm] = useState({ name: '', val: '', type: 'pct' });
  const extraBonuses = cabinetBonuses.filter(b => !globalCabinets.includes(b.cabinetId));
  const allItems = globalCabinets.length > 0
    ? [
        ...globalCabinets.map(cabName => ({ cabName, existing: cabinetBonuses.find(b => b.cabinetId === cabName) })),
        ...extraBonuses.map(cab => ({ cabName: cab.cabinetId, existing: cab })),
      ]
    : cabinetBonuses.map(cab => ({ cabName: cab.cabinetId, existing: cab }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)', fontWeight: 600 }}>Бонус кабинета</span>
        <button
          onClick={() => setShowAddForm(v => !v)}
          style={{ background: 'var(--rb-primary)', border: 'none', borderRadius: 6, width: 22, height: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, lineHeight: 1, padding: 0 }}
          title="Добавить кабинет"
        >+</button>
      </div>

      {allItems.length > 0 && (
        <div className="rb-exec-items">
          {allItems.map(({ cabName, existing }) => (
            <CabEditItem key={cabName} cabName={cabName} existing={existing} onUpdate={onUpdateCab} onDelete={onDeleteCab} saving={saving} />
          ))}
        </div>
      )}

      {showAddForm && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <input
            type="text" placeholder="Название кабинета..."
            value={cabForm.name}
            onChange={e => setCabForm(f => ({ ...f, name: e.target.value }))}
            autoFocus
            style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
          />
          <div className="rb-exec-type-toggle">
            <button className={`rb-exec-type-btn${cabForm.type === 'pct' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setCabForm(f => ({ ...f, type: 'pct', val: '' }))}>%</button>
            <button className={`rb-exec-type-btn${cabForm.type === 'rub' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setCabForm(f => ({ ...f, type: 'rub', val: '' }))}>₽</button>
          </div>
          <input
            type="number" min="0" step="any"
            placeholder={cabForm.type === 'pct' ? '%' : '₽'}
            value={cabForm.val}
            onChange={e => setCabForm(f => ({ ...f, val: e.target.value }))}
            style={{ width: 72, padding: '4px 6px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, textAlign: 'right', fontSize: 12 }}
          />
          <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={() => { onSaveCab(cabForm); setShowAddForm(false); setCabForm({ name: '', val: '', type: 'pct' }); }} disabled={saving} title="Сохранить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button className="rb-btn rb-btn-xs" onClick={() => setShowAddForm(false)} title="Отмена" style={{ color: '#94a3b8' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function CabEditItem({ cabName, existing, onUpdate, onDelete, saving }) {
  const hasPct = existing && existing.bonusPercent != null;
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(hasPct ? 'pct' : 'rub');
  const [val, setVal] = useState(existing ? (hasPct ? String(existing.bonusPercent) : existing.bonusRub != null ? String(existing.bonusRub) : '') : '');

  const isSet = !!existing;
  const fmt = v => parseFloat(v) % 1 === 0 ? String(parseInt(v)) : parseFloat(v).toString();
  const displayVal = isSet ? (hasPct ? `${fmt(existing.bonusPercent)}%` : `${fmt(existing.bonusRub)} ₽`) : '—';

  const commit = () => {
    onUpdate(existing || { cabinetId: cabName }, type, val);
    setEditing(false);
  };

  return (
    <div className="rb-exec-item" style={isSet ? { background: '#eff6ff' } : {}}>
      {editing ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
          <div className="rb-exec-item-name" style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 80 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
              <rect x="4" y="2" width="16" height="20" rx="1"/>
              <circle cx="15.5" cy="12" r="1" fill="#007AFF" stroke="none"/>
              <line x1="4" y1="22" x2="20" y2="22"/>
            </svg>
            {cabName}
          </div>
          <div className="rb-exec-type-toggle">
            <button className={`rb-exec-type-btn${type === 'pct' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setType('pct')}>%</button>
            <button className={`rb-exec-type-btn${type === 'rub' ? ' active' : ''}`} style={{ padding: '4px 9px' }} onClick={() => setType('rub')}>₽</button>
          </div>
          <input
            autoFocus
            type="number" min="0" step="any"
            placeholder={type === 'pct' ? '%' : '₽'}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            style={{ width: 70, padding: '4px 6px', border: '1px solid var(--rb-primary)', borderRadius: 4, fontSize: 12, textAlign: 'right' }}
          />
          <button className="rb-btn rb-btn-primary rb-btn-xs" onClick={commit} disabled={saving} title="Сохранить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button className="rb-btn rb-btn-xs" onClick={() => setEditing(false)} title="Отмена" style={{ color: '#94a3b8' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ) : (
        <>
          <div
            className="rb-exec-item-name"
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
            onClick={() => setEditing(true)}
            title="Нажмите для редактирования"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
              <rect x="4" y="2" width="16" height="20" rx="1"/>
              <circle cx="15.5" cy="12" r="1" fill="#007AFF" stroke="none"/>
              <line x1="4" y1="22" x2="20" y2="22"/>
            </svg>
            {cabName}
          </div>
          <span
            style={{ fontSize: 12, color: 'var(--rb-success)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}
            onClick={() => setEditing(true)}
          >{displayVal}</span>
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {isSet && (
              <button className="rb-btn rb-btn-danger rb-btn-xs" onClick={() => onDelete(existing.id)} disabled={saving}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StepPerformed({ selectedDoctor, clinics, readOnly, panelCollapsed, onTogglePanel }) {
  const [bonuses, setBonuses] = useState([]);
  const [services, setServices] = useState([]);
  const [globalCabinets, setGlobalCabinets] = useState([]);
  const [activeClinic, setActiveClinic] = useState('global');
  const { wrapRef: clinicTabRef, sliderEl: clinicSlider } = useTabSlider(activeClinic);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // Per-row bonus state for save-all
  const [rowValues, setRowValues] = useState({}); // code -> { type, val }
  const [perfPage, setPerfPage] = useState(1);
  const [perfShowAll, setPerfShowAll] = useState(false);

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
    setPerfPage(1);

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

      // Load services
      try {
        const misData = doctorRes.data;
        if (misData && misData.data && Array.isArray(misData.data.services) && misData.data.services.length > 0) {
          const svcRes = await mis.getServicesByIds(misData.data.services);
          const raw = svcRes.data;
          if (raw && raw.error === 0 && raw.data) {
            const arr = Array.isArray(raw.data) ? raw.data : [raw.data];
            setServices(arr.map(s => ({
              code: (s.code || s.sub_code || String(s.service_id || s.id || '')).trim(),
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

  const PERF_PAGE_SIZE = 100;
  const perfTotalPages = Math.max(1, Math.ceil(filteredServices.length / PERF_PAGE_SIZE));
  const perfPageSafe = Math.min(perfPage, perfTotalPages);
  const perfPageData = perfShowAll ? filteredServices : filteredServices.slice((perfPageSafe - 1) * PERF_PAGE_SIZE, perfPageSafe * PERF_PAGE_SIZE);

  function PerfPagination() {
    if (perfShowAll || perfTotalPages <= 1) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 0 2px' }}>
        <button onClick={() => setPerfPage(1)} disabled={perfPageSafe === 1}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: perfPageSafe === 1 ? 'default' : 'pointer', background: '#fff', color: perfPageSafe === 1 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>«</button>
        <button onClick={() => setPerfPage(p => Math.max(1, p - 1))} disabled={perfPageSafe === 1}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: perfPageSafe === 1 ? 'default' : 'pointer', background: '#fff', color: perfPageSafe === 1 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>‹</button>
        {Array.from({ length: perfTotalPages }, (_, i) => i + 1)
          .filter(n => n === 1 || n === perfTotalPages || Math.abs(n - perfPageSafe) <= 2)
          .reduce((acc, n, idx, arr) => { if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…'); acc.push(n); return acc; }, [])
          .map((item, idx) => item === '…'
            ? <span key={`e${idx}`} style={{ padding: '4px 4px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>…</span>
            : <button key={item} onClick={() => setPerfPage(item)}
                style={{ padding: '4px 9px', fontSize: 12, fontWeight: item === perfPageSafe ? 700 : 400, border: '1px solid', borderColor: item === perfPageSafe ? 'var(--rb-primary)' : 'var(--rb-border)', borderRadius: 5, cursor: item === perfPageSafe ? 'default' : 'pointer', background: item === perfPageSafe ? '#eff6ff' : '#fff', color: item === perfPageSafe ? 'var(--rb-primary)' : 'var(--rb-text)' }}>
                {item}
              </button>
          )}
        <button onClick={() => setPerfPage(p => Math.min(perfTotalPages, p + 1))} disabled={perfPageSafe === perfTotalPages}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: perfPageSafe === perfTotalPages ? 'default' : 'pointer', background: '#fff', color: perfPageSafe === perfTotalPages ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>›</button>
        <button onClick={() => setPerfPage(perfTotalPages)} disabled={perfPageSafe === perfTotalPages}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: perfPageSafe === perfTotalPages ? 'default' : 'pointer', background: '#fff', color: perfPageSafe === perfTotalPages ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>»</button>
      </div>
    );
  }

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

  return (
    <div className="rb-doctor-card">
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

      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <div className="rb-add-service-section" style={{ margin: '12px 0 0', padding: '0 16px 16px', border: 'none' }}>
          {/* Clinic tabs */}
          <div className="rb-clinic-tab-wrap" style={{ marginBottom: 12 }} ref={clinicTabRef}>
            {clinicSlider}
            <button
              className={`rb-clinic-tab${activeClinic === 'global' ? ' active' : ''}`}
              onClick={() => { setActiveClinic('global'); setPerfPage(1); }}
            >
              Общие
            </button>
            {(clinics || []).map(c => (
              <button
                key={c.id}
                className={`rb-clinic-tab${activeClinic === String(c.id) ? ' active' : ''}`}
                onClick={() => { setActiveClinic(String(c.id)); setPerfPage(1); }}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Services table */}
          {services.length === 0 ? (
            <div className="rb-alert rb-alert-warning">Услуги врача не найдены в МИС.</div>
          ) : (
            <>
              <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Поиск по коду или названию услуги..."
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setPerfPage(1); }}
                  style={{ flex: 1, padding: '7px 12px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
                <button
                  onClick={() => setPerfShowAll(v => !v)}
                  title={perfShowAll ? 'Включить пагинацию' : 'Показать все записи'}
                  style={{ padding: '6px 10px', fontSize: 12, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                  {perfShowAll ? 'По страницам' : 'Все'}
                </button>
              </div>
              <table className="rb-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center' }}>Код</th>
                    <th style={{ textAlign: 'center' }}>Услуга</th>
                    <th style={{ textAlign: 'center', width: 190 }}>Бонус</th>
                  </tr>
                </thead>
                <tbody>
                  {perfPageData.map((svc, idx) => {
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
                      />
                    );
                  })}
                </tbody>
              </table>
              <PerfPagination />
            </>
          )}
      </div>
      </fieldset>
    </div>
  );
}

// ─── Controlled service row (drives save-all) ─────────────────────────────────

function ServiceRowControlled({ svc, idx, dbClinicId, bonuses, globalCabinets, onReload, rowVal, onRowChange, misUserId, doctorName }) {
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
  const [saving, setSaving] = useState(false);

  const cabCount = cabinetBonuses.length;
  const cabBadgeColor = cabCount > 0 ? 'var(--rb-primary)' : '#94a3b8';
  const showBadge = cabCount > 0 || globalCabinets.length > 0;
  const badgeNum = cabCount > 0 ? cabCount : globalCabinets.length;

  const handleSaveCab = async (form) => {
    if (!form.name.trim()) { toast.error('Введите название кабинета'); return; }
    if (!form.val) { toast.error('Введите значение бонуса'); return; }
    const val = parseFloat(form.val);
    if (isNaN(val) || val < 0) { toast.error('Некорректное значение'); return; }
    setSaving(true);
    try {
      await performedServiceBonuses.save({
        misUserId,
        doctorName,
        clinicId: dbClinicId,
        cabinetId: form.name.trim(),
        serviceCode: code,
        serviceName: name,
        bonusPercent: form.type === 'pct' ? val : null,
        bonusRub: form.type === 'rub' ? val : null,
      });
      toast.success('Бонус для кабинета сохранён');
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

  const rowBg = '';

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
          <span style={{ fontSize: 13, color: 'var(--rb-text)' }}>{code}</span>
        </td>
        <td style={{ padding: '6px 10px' }}>
          {name}
          <span style={{ color: 'var(--rb-text-secondary)', fontSize: 11 }}>{price}</span>
          {isFallback && <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8', background: '#f1f5f9', borderRadius: 4, padding: '1px 4px' }}>общий</span>}
        </td>
        <td style={{ padding: '6px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className="rb-exec-type-toggle" style={{ height: 28 }}>
              <button className={`rb-exec-type-btn${rowVal.type === 'pct' ? ' active' : ''}`} style={{ padding: '0 10px' }} onClick={() => onRowChange(code, 'pct', '')}>%</button>
              <button className={`rb-exec-type-btn${rowVal.type === 'rub' ? ' active' : ''}`} style={{ padding: '0 10px' }} onClick={() => onRowChange(code, 'rub', '')}>₽</button>
            </div>
            <input
              type="number" min="0" step="any"
              placeholder={rowVal.type === 'pct' ? '%' : '₽'}
              value={rowVal.val}
              onChange={e => onRowChange(code, rowVal.type, e.target.value)}
              style={{ width: 80, height: 28, padding: '0 6px', border: '1px solid var(--rb-border-dark)', borderRadius: 4, textAlign: 'right', fontSize: 12, opacity: isFallback ? 0.65 : 1, boxSizing: 'border-box' }}
            />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#f0f4ff', borderBottom: '1px solid var(--rb-border)' }}>
          <td colSpan="3" style={{ padding: '4px 10px 10px 36px' }}>
            <CabinetsSection
              cabinetBonuses={cabinetBonuses}
              globalCabinets={globalCabinets}
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
