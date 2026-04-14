import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { performedServiceBonuses, executorSettings, mis } from '../../../services/api';
import { useTabSlider } from '../utils/useTabSlider';

// ─── Role labels ─────────────────────────────────────────────────────────────
const ROLES = [
  { key: 'doctor',          label: 'Врач' },
  { key: 'nurse',           label: 'Медсестра' },
  { key: 'anesthesiologist',label: 'Анестезиолог' },
];

// ─── Category dropdown (shared) ──────────────────────────────────────────────
function flattenCats(cats, acc = []) {
  for (const c of cats) { acc.push(c); if (c.children?.length) flattenCats(c.children, acc); }
  return acc;
}

function CategoryDropdown({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [query, setQuery] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef();
  const dropRef = useRef();
  const inputRef = useRef();

  useEffect(() => {
    const handleClick = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target) &&
          dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadCategories = useCallback(async () => {
    if (categories !== null) return;
    setLoading(true);
    try {
      const res = await mis.getServiceCategories();
      const data = res.data?.data || res.data || [];
      setCategories(Array.isArray(data) ? data : []);
    } catch {
      setCategories([]);
      toast.error('Ошибка загрузки категорий');
    } finally {
      setLoading(false);
    }
  }, [categories]);

  const handleToggle = () => {
    const next = !open;
    if (next && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(next);
    if (next) { setQuery(''); loadCategories(); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  const handleSelect = (cat) => { setSelectedLabel(cat.title); setOpen(false); setQuery(''); onSelect(cat); };

  function renderCats(cats, level = 0) {
    return cats.map(cat => (
      <React.Fragment key={cat.id}>
        <div className="rb-cat-dropdown-item" data-level={level} style={{ paddingLeft: 12 + level * 12 }} onClick={() => handleSelect(cat)}>
          {cat.title} {cat.services_count != null ? `(${cat.services_count})` : ''}
        </div>
        {cat.children?.length > 0 && renderCats(cat.children, level + 1)}
      </React.Fragment>
    ));
  }

  const q = query.trim().toLowerCase();
  const flatMatches = q && categories ? flattenCats(categories).filter(c => c.title.toLowerCase().includes(q)) : null;

  return (
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <button ref={btnRef} type="button" className={`rb-cat-dropdown-btn${selectedLabel ? ' has-value' : ''}`} onClick={handleToggle}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left', color: selectedLabel ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}
      >
        <span>{selectedLabel || 'Выберите категорию...'}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div ref={dropRef} style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, border: '1px solid var(--rb-border-dark)', borderRadius: 8, background: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--rb-border)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск категории..."
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {loading && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Загрузка...</div>}
            {!loading && categories?.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Категории не найдены</div>}
            {!loading && flatMatches && flatMatches.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>}
            {!loading && flatMatches && flatMatches.map(cat => (
              <div key={cat.id} className="rb-cat-dropdown-item" style={{ paddingLeft: 12 }} onClick={() => handleSelect(cat)}>
                {cat.title} {cat.services_count != null ? `(${cat.services_count})` : ''}
              </div>
            ))}
            {!loading && !flatMatches && categories?.length > 0 && renderCats(categories)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Role service panel (Ассистент / Медсестра / Анестезиолог) ───────────────

function RoleServicePanel({ role, clinics, activeClinic, setActiveClinic, clinicTabRef, clinicSlider, misUserId, doctorName, execData, onExecDataChange, readOnly }) {
  const dbClinicId = activeClinic === 'global' ? '' : String(activeClinic);
  const services = execData?.roleServices?.[role]?.[dbClinicId] || [];

  const [addTab, setAddTab]               = useState('search');
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedSvc, setSelectedSvc]     = useState(null);
  const [valueType, setValueType]         = useState('percent');
  const [value, setValue]                 = useState('');
  const [saving, setSaving]               = useState(false);
  // Category
  const [catServices, setCatServices]     = useState([]);
  const [catLoading, setCatLoading]       = useState(false);
  const [catBulkType, setCatBulkType]     = useState('percent');
  const [catBulkValue, setCatBulkValue]   = useState('');
  const [catSaving, setCatSaving]         = useState(false);
  const [catExcluded, setCatExcluded]     = useState(new Set());
  const [catFilter, setCatFilter]         = useState('');
  const searchTimerRef = useRef(null);

  // Reset form when clinic or role changes
  useEffect(() => {
    setSelectedSvc(null); setSearchQuery(''); setSearchResults([]); setValue('');
    setCatServices([]); setCatBulkValue(''); setCatExcluded(new Set()); setCatFilter('');
  }, [activeClinic, role]);

  const toggleCatExclude = (code) => {
    setCatExcluded(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSearchInput = (q) => {
    setSearchQuery(q);
    clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await mis.searchServices(q.trim());
        const raw = res.data;
        setSearchResults(raw?.success && Array.isArray(raw?.data) ? raw.data : []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  };

  const svcCode = (svc) => (svc.code || svc.sub_code || String(svc.service_id || svc.id || '')).trim();

  const handleSelectSvc = (svc) => {
    setSelectedSvc(svc); setSearchQuery(''); setSearchResults([]);
    const existing = services.find(s => s.serviceCode === svcCode(svc));
    if (existing) { setValue(String(existing.value)); setValueType(existing.valueType === 'rub' ? 'rub' : 'percent'); }
    else { setValue(''); setValueType('percent'); }
  };

  const saveEntries = async (entries, successMsg) => {
    const cur = execData?.roleServices?.[role]?.[dbClinicId] || [];
    const merged = [...cur];
    for (const e of entries) {
      const idx = merged.findIndex(s => s.serviceCode === e.serviceCode);
      if (idx >= 0) merged[idx] = e; else merged.push(e);
    }
    const newRoleServices = {
      ...(execData?.roleServices || {}),
      [role]: { ...((execData?.roleServices || {})[role] || {}), [dbClinicId]: merged },
    };
    const newExecData = { ...execData, roleServices: newRoleServices };
    await executorSettings.save({ misUserId, doctorName, settings: newExecData });
    onExecDataChange(newExecData);
    toast.success(successMsg);
  };

  const handleSave = async () => {
    if (!selectedSvc || !value) return;
    const val = parseFloat(value);
    if (isNaN(val) || val <= 0) { toast.error('Введите корректное значение'); return; }
    const newEntry = { serviceCode: svcCode(selectedSvc), serviceName: selectedSvc.title || '', value: val, valueType };
    setSaving(true);
    try {
      await saveEntries([newEntry], 'Сохранено');
      setSelectedSvc(null); setValue('');
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSaving(false); }
  };

  const handleCatSelect = useCallback(async (cat) => {
    setCatServices([]); setCatBulkValue(''); setCatExcluded(new Set()); setCatFilter('');
    setCatLoading(true);
    try {
      const res = await mis.getServicesByCategory(cat.id);
      const data = res.data?.data || res.data || [];
      setCatServices(Array.isArray(data) ? data : []);
    } catch {
      setCatServices([]); toast.error('Ошибка загрузки услуг категории');
    } finally { setCatLoading(false); }
  }, []);

  const handleApplyCategoryBonus = async () => {
    const activeServices = catServices.filter(s => !catExcluded.has(s.code || String(s.service_id || '')));
    if (!activeServices.length) { toast.error('Нет выбранных услуг'); return; }
    const val = parseFloat(catBulkValue);
    if (isNaN(val) || val <= 0) { toast.error('Укажите ставку'); return; }
    setCatSaving(true);
    try {
      const entries = activeServices.map(s => ({
        serviceCode: s.code || String(s.service_id || ''),
        serviceName: s.title || '',
        value: val,
        valueType: catBulkType,
      }));
      await saveEntries(entries, `Применено к ${entries.length} услуг${entries.length === 1 ? 'е' : 'ам'}`);
      setCatBulkValue('');
    } catch { toast.error('Ошибка сохранения'); }
    finally { setCatSaving(false); }
  };

  const handleDelete = async (code) => {
    if (!window.confirm('Удалить услугу?')) return;
    const newRoleServices = {
      ...(execData?.roleServices || {}),
      [role]: {
        ...((execData?.roleServices || {})[role] || {}),
        [dbClinicId]: (execData?.roleServices?.[role]?.[dbClinicId] || []).filter(s => s.serviceCode !== code),
      },
    };
    const newExecData = { ...execData, roleServices: newRoleServices };
    try {
      await executorSettings.save({ misUserId, doctorName, settings: newExecData });
      onExecDataChange(newExecData);
      toast.success('Удалено');
    } catch { toast.error('Ошибка удаления'); }
  };

  const fmtVal = (s) => s.valueType === 'rub' ? `${s.value} ₽` : `${s.value}%`;

  return (
    <>
      {/* Clinic tabs */}
      <div className="rb-clinic-tab-wrap" style={{ marginBottom: 12 }} ref={clinicTabRef}>
        {clinicSlider}
        <button className={`rb-clinic-tab${activeClinic === 'global' ? ' active' : ''}`} onClick={() => setActiveClinic('global')}>Общие</button>
        {(clinics || []).map(c => (
          <button key={c.id} className={`rb-clinic-tab${activeClinic === String(c.id) ? ' active' : ''}`} onClick={() => setActiveClinic(String(c.id))}>{c.name}</button>
        ))}
      </div>

      {/* Add form */}
      {!readOnly && (
        <div style={{ marginBottom: 14 }}>
          {/* Mode tabs */}
          <div className="rb-tabs" style={{ marginTop: 0, marginBottom: 10 }}>
            <button className={`rb-tab-btn${addTab === 'search' ? ' active' : ''}`} onClick={() => { setAddTab('search'); setSelectedSvc(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Поиск
            </button>
            <button className={`rb-tab-btn${addTab === 'category' ? ' active' : ''}`} onClick={() => { setAddTab('category'); setSelectedSvc(null); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              По категории
            </button>
          </div>

          {/* Search pane */}
          {addTab === 'search' && !selectedSvc && (
            <div>
              <div className="rb-search-row">
                <input
                  value={searchQuery}
                  onChange={e => handleSearchInput(e.target.value)}
                  placeholder="Введите название или код услуги..."
                  onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); setSearchResults([]); } }}
                />
              </div>
              {searchLoading && <div className="rb-loading"><span className="rb-spinner" /> Поиск...</div>}
              {!searchLoading && searchResults.length > 0 && (
                <div className="rb-search-results" style={{ display: 'block' }}>
                  {searchResults.map((svc, i) => (
                    <div key={i} className="rb-search-result-item" onClick={() => handleSelectSvc(svc)}>
                      <div className="rb-result-name">{svc.title}</div>
                      <div className="rb-result-code">Код: {svcCode(svc)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Category pane */}
          {addTab === 'category' && !selectedSvc && (
            <div>
              <CategoryDropdown onSelect={handleCatSelect} />
              {catLoading && <div className="rb-loading"><span className="rb-spinner" /> Загрузка услуг...</div>}
              {!catLoading && catServices.length > 0 && (() => {
                const q = catFilter.trim().toLowerCase();
                const visibleServices = q
                  ? catServices.filter(s => s.title?.toLowerCase().includes(q) || (s.code || String(s.service_id || '')).toLowerCase().includes(q))
                  : catServices;
                const allCodes = catServices.map(s => s.code || String(s.service_id || ''));
                const selectedCount = catServices.length - catExcluded.size;
                return (
                  <>
                    {/* Bulk bonus form — ABOVE list */}
                    <div style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                      <div className="rb-inline-toggle-wrap">
                        <div className="rb-exec-type-toggle">
                          <button className={`rb-exec-type-btn${catBulkType === 'percent' ? ' active' : ''}`} onClick={() => { setCatBulkType('percent'); setCatBulkValue(''); }}>%</button>
                          <button className={`rb-exec-type-btn${catBulkType === 'rub' ? ' active' : ''}`} onClick={() => { setCatBulkType('rub'); setCatBulkValue(''); }}>₽</button>
                        </div>
                        <input
                          type="number" value={catBulkValue} onChange={e => setCatBulkValue(e.target.value)}
                          placeholder={catBulkType === 'percent' ? 'Например: 10' : 'Например: 150'}
                          min="0" step="any"
                          style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none' }}
                        />
                        <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleApplyCategoryBonus} disabled={catSaving} style={{ whiteSpace: 'nowrap' }}>
                          {catSaving ? <><span className="rb-spinner" style={{ marginRight: 5 }} />Сохранение...</> : 'Сохранить'}
                        </button>
                      </div>
                    </div>

                    {/* Services list */}
                    <div style={{ border: '1px solid var(--rb-border)', borderRadius: 7 }}>
                      {/* Header: search + select-all */}
                      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--rb-border)', background: '#f8fafc', borderRadius: '7px 7px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input
                          value={catFilter}
                          onChange={e => setCatFilter(e.target.value)}
                          placeholder="Найти услугу..."
                          style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>
                            Выбрано: <b>{selectedCount}</b> из {catServices.length}
                            {q ? ` (показано ${visibleServices.length})` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => catExcluded.size === catServices.length
                              ? setCatExcluded(new Set())
                              : setCatExcluded(new Set(allCodes))}
                            style={{ fontSize: 11, color: 'var(--rb-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            {catExcluded.size === catServices.length ? 'Выбрать все' : 'Снять все'}
                          </button>
                        </div>
                      </div>
                      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                        {visibleServices.length === 0 && (
                          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>
                        )}
                        {visibleServices.map((svc, i) => {
                          const code = svc.code || String(svc.service_id || '');
                          const excluded = catExcluded.has(code);
                          return (
                            <div
                              key={code || i}
                              className="rb-search-result-item"
                              style={{ opacity: excluded ? 0.45 : 1, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                              onClick={() => toggleCatExclude(code)}
                            >
                              {/* Blue toggle switch */}
                              <div style={{ width: 32, height: 18, borderRadius: 9, background: excluded ? '#cbd5e1' : 'var(--rb-primary)', position: 'relative', transition: 'background 0.18s', flexShrink: 0 }}>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: excluded ? 2 : 16, transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, color: '#000', flexShrink: 0 }}>{code}</span>
                                <span className="rb-result-name">{svc.title}</span>
                              </div>
                              {svc.price != null && <div className="rb-result-price">{parseFloat(svc.price).toFixed(2)} ₽</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Selected service form */}
          {selectedSvc && (
            <div style={{ border: '1px solid var(--rb-border-dark)', borderRadius: 8, padding: '10px 12px', background: '#f8fafc' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{selectedSvc.title}</div>
              <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginBottom: 10 }}>Код: {svcCode(selectedSvc)}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="rb-exec-type-toggle">
                  <button className={`rb-exec-type-btn${valueType === 'percent' ? ' active' : ''}`} onClick={() => setValueType('percent')}>%</button>
                  <button className={`rb-exec-type-btn${valueType === 'rub' ? ' active' : ''}`} onClick={() => setValueType('rub')}>₽</button>
                </div>
                <input
                  type="number" min="0" step="any"
                  placeholder={valueType === 'percent' ? '%' : '₽'}
                  value={value} onChange={e => setValue(e.target.value)}
                  style={{ width: 90, padding: '5px 8px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 13, textAlign: 'right' }}
                />
                <button onClick={handleSave} disabled={saving}
                  style={{ padding: '5px 14px', background: 'var(--rb-primary)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >{saving ? '...' : 'Сохранить'}</button>
                <button onClick={() => { setSelectedSvc(null); setValue(''); setSearchQuery(''); }}
                  style={{ padding: '5px 10px', background: '#f1f5f9', border: '1px solid var(--rb-border)', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--rb-text-secondary)' }}
                >Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved services list */}
      {services.length === 0 ? null : (
        <table className="rb-table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Услуга</th>
              <th style={{ width: 100, textAlign: 'center' }}>Ставка</th>
              {!readOnly && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {services.map(s => (
              <tr key={s.serviceCode} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, color: 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>{s.serviceCode}</td>
                <td style={{ padding: '6px 10px', fontSize: 13 }}>{s.serviceName}</td>
                <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, color: 'var(--rb-success)' }}>{fmtVal(s)}</td>
                {!readOnly && (
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <button onClick={() => handleDelete(s.serviceCode)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 3 }} title="Удалить"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

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
  const [activeRole, setActiveRole] = useState('doctor');
  const [execData, setExecData] = useState(null);
  const { wrapRef: roleTabRef, sliderEl: roleSlider } = useTabSlider(activeRole);
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
    setActiveRole('doctor');
    setRowValues({});
    setPerfPage(1);

    Promise.all([
      performedServiceBonuses.getByDoctor(selectedDoctor.id),
      executorSettings.get(selectedDoctor.id),
      mis.getDoctorInfo(selectedDoctor.id),
    ]).then(async ([bonusRes, execRes, doctorRes]) => {
      setBonuses(Array.isArray(bonusRes.data) ? bonusRes.data : []);

      // Cabinets from executor settings
      const ed = execRes.data;
      setExecData(ed || {});
      if (ed && ed.clinicSettings && ed.clinicSettings.global) {
        setGlobalCabinets(ed.clinicSettings.global.cabinets || []);
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

          {/* Role tabs */}
          <div className="rb-clinic-tab-wrap" style={{ marginBottom: 8 }} ref={roleTabRef}>
            {roleSlider}
            {ROLES.map(r => (
              <button
                key={r.key}
                className={`rb-clinic-tab${activeRole === r.key ? ' active' : ''}`}
                onClick={() => { setActiveRole(r.key); setActiveClinic('global'); setPerfPage(1); }}
              >{r.label}</button>
            ))}
          </div>

          {/* Non-doctor roles */}
          {activeRole !== 'doctor' ? (
            <RoleServicePanel
              role={activeRole}
              clinics={clinics}
              activeClinic={activeClinic}
              setActiveClinic={setActiveClinic}
              clinicTabRef={clinicTabRef}
              clinicSlider={clinicSlider}
              misUserId={selectedDoctor.id}
              doctorName={selectedDoctor.name}
              execData={execData}
              onExecDataChange={setExecData}
              readOnly={readOnly}
            />
          ) : (<>

          {/* Clinic tabs (Врач role) */}
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
          </>)}
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
