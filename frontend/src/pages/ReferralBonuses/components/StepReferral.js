import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { referralBonuses as rbApi, mis } from '../../../services/api';

// ═══════════════════════════════════════
// CATEGORY DROPDOWN component
// ═══════════════════════════════════════
function CategoryDropdown({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState(null); // null = not loaded
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const ref = useRef();

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadCategories = useCallback(async () => {
    if (categories !== null) return; // already loaded
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
    setOpen(next);
    if (next) loadCategories();
  };

  const handleSelect = (cat) => {
    setSelectedLabel(cat.title);
    setOpen(false);
    onSelect(cat);
  };

  function renderCats(cats, level = 0) {
    return cats.map(cat => (
      <React.Fragment key={cat.id}>
        <div
          className="rb-cat-dropdown-item"
          data-level={level}
          style={{ paddingLeft: 12 + level * 12 }}
          onClick={() => handleSelect(cat)}
        >
          {cat.title} {cat.services_count != null ? `(${cat.services_count})` : ''}
        </div>
        {cat.children?.length > 0 && renderCats(cat.children, level + 1)}
      </React.Fragment>
    ));
  }

  return (
    <div className={`rb-cat-dropdown${open ? ' open' : ''}`} ref={ref} style={{ position: 'relative', marginBottom: 10 }}>
      <button
        type="button"
        className={`rb-cat-dropdown-btn${selectedLabel ? ' has-value' : ''}`}
        onClick={handleToggle}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--rb-border-dark)', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left', color: selectedLabel ? 'var(--rb-text)' : 'var(--rb-text-secondary)' }}
      >
        <span>{selectedLabel || 'Выберите категорию...'}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--rb-border-dark)', borderRadius: 8, background: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200 }}>
          {loading && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Загрузка...</div>}
          {!loading && categories?.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Категории не найдены</div>}
          {!loading && categories?.length > 0 && renderCats(categories)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// STEP 3: БОНУСЫ ЗА НАПРАВЛЕНИЯ
// ═══════════════════════════════════════
export default function StepReferral({
  selectedDoctor, clinics, openReportForDoctor, getClinicColor, getClinicName, setBonusCounts, readOnly, panelCollapsed, onTogglePanel,
}) {
  if (!selectedDoctor) {
    return (
      <div className="rb-placeholder">
        <p>Выберите врача из списка слева для настройки бонусов за направления</p>
      </div>
    );
  }

  return (
    <DoctorReferralPanel
      key={selectedDoctor.id}
      doctor={selectedDoctor}
      clinics={clinics}
      openReportForDoctor={openReportForDoctor}
      getClinicColor={getClinicColor}
      getClinicName={getClinicName}
      setBonusCounts={setBonusCounts}
      readOnly={readOnly}
    />
  );
}

// ═══════════════════════════════════════
// DOCTOR REFERRAL PANEL
// ═══════════════════════════════════════
function DoctorReferralPanel({ doctor, clinics, openReportForDoctor, getClinicColor, getClinicName, setBonusCounts, readOnly }) {
  const [activeClinic, setActiveClinic] = useState('global');
  const [bonuses, setBonuses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [addTab, setAddTab] = useState('search'); // 'search' | 'category'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [bonusType, setBonusType] = useState('pct'); // 'pct' | 'rub'
  const [bonusValue, setBonusValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [refPage, setRefPage] = useState(1);
  const [refShowAll, setRefShowAll] = useState(false);

  // Category tab state
  const [catServices, setCatServices] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catBulkType, setCatBulkType] = useState('pct');
  const [catBulkValue, setCatBulkValue] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [catSelectedService, setCatSelectedService] = useState(null);

  const searchTimerRef = useRef(null);

  // ── Load bonuses ──
  const loadBonuses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rbApi.getByDoctor(doctor.id);
      const data = Array.isArray(res.data) ? res.data : [];
      setBonuses(data);
      setBonusCounts(prev => ({ ...prev, [doctor.id]: data.length }));
    } catch (err) {
      console.error('Load bonuses error:', err);
      setBonuses([]);
    } finally {
      setLoading(false);
    }
  }, [doctor.id, setBonusCounts]);

  useEffect(() => { loadBonuses(); }, [loadBonuses]);

  // ── Filtered bonuses for current clinic tab ──
  const dbClinicId = activeClinic === 'global' ? '' : String(activeClinic);
  const filteredBonuses = bonuses.filter(b => (b.clinicId || '') === dbClinicId);

  const REF_PAGE_SIZE = 50;
  const refTotalPages = Math.max(1, Math.ceil(filteredBonuses.length / REF_PAGE_SIZE));
  const refPageSafe = Math.min(refPage, refTotalPages);
  const refPageData = refShowAll ? filteredBonuses : filteredBonuses.slice((refPageSafe - 1) * REF_PAGE_SIZE, refPageSafe * REF_PAGE_SIZE);

  function RefPagination() {
    if (refShowAll || refTotalPages <= 1) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 0 2px' }}>
        <button onClick={() => setRefPage(1)} disabled={refPageSafe === 1}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: refPageSafe === 1 ? 'default' : 'pointer', background: '#fff', color: refPageSafe === 1 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>«</button>
        <button onClick={() => setRefPage(p => Math.max(1, p - 1))} disabled={refPageSafe === 1}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: refPageSafe === 1 ? 'default' : 'pointer', background: '#fff', color: refPageSafe === 1 ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>‹</button>
        {Array.from({ length: refTotalPages }, (_, i) => i + 1)
          .filter(n => n === 1 || n === refTotalPages || Math.abs(n - refPageSafe) <= 2)
          .reduce((acc, n, idx, arr) => { if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…'); acc.push(n); return acc; }, [])
          .map((item, idx) => item === '…'
            ? <span key={`e${idx}`} style={{ padding: '4px 4px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>…</span>
            : <button key={item} onClick={() => setRefPage(item)}
                style={{ padding: '4px 9px', fontSize: 12, fontWeight: item === refPageSafe ? 700 : 400, border: '1px solid', borderColor: item === refPageSafe ? 'var(--rb-primary)' : 'var(--rb-border)', borderRadius: 5, cursor: item === refPageSafe ? 'default' : 'pointer', background: item === refPageSafe ? '#eff6ff' : '#fff', color: item === refPageSafe ? 'var(--rb-primary)' : 'var(--rb-text)' }}>
                {item}
              </button>
          )}
        <button onClick={() => setRefPage(p => Math.min(refTotalPages, p + 1))} disabled={refPageSafe === refTotalPages}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: refPageSafe === refTotalPages ? 'default' : 'pointer', background: '#fff', color: refPageSafe === refTotalPages ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>›</button>
        <button onClick={() => setRefPage(refTotalPages)} disabled={refPageSafe === refTotalPages}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 5, cursor: refPageSafe === refTotalPages ? 'default' : 'pointer', background: '#fff', color: refPageSafe === refTotalPages ? '#cbd5e1' : 'var(--rb-text-secondary)' }}>»</button>
      </div>
    );
  }

  // ── Service search ──
  const handleSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await mis.getServices({ q: q.trim(), limit: 20 });
      setSearchResults(Array.isArray(res.data) ? res.data : (res.data?.items || []));
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchInput = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => handleSearch(val), 400);
  };

  const handleSelectService = (svc) => {
    setSelectedService(svc);
    setSearchResults([]);
    setSearchQuery('');
    setBonusType('pct');
    setBonusValue('');
    setEditingId(null);
  };

  const handleClearService = () => {
    setSelectedService(null);
    setSearchQuery('');
    setSearchResults([]);
    setBonusValue('');
    setEditingId(null);
  };

  // ── Edit bonus ──
  const handleEditBonus = (bonus) => {
    setSelectedService({ code: bonus.serviceCode, title: bonus.serviceName });
    if (bonus.bonusPercent != null) {
      setBonusType('pct');
      setBonusValue(String(bonus.bonusPercent));
    } else {
      setBonusType('rub');
      setBonusValue(String(bonus.bonusRub));
    }
    setEditingId(bonus.id);
    setAddTab('search');
  };

  // ── Save bonus ──
  const handleSaveBonus = async () => {
    if (!selectedService) { toast.error('Выберите услугу'); return; }
    const val = parseFloat(bonusValue);
    if (isNaN(val) || val < 0) { toast.error('Укажите размер бонуса'); return; }
    const bonusPercent = bonusType === 'pct' ? val : null;
    const bonusRub = bonusType === 'rub' ? val : null;

    setSaving(true);
    try {
      await rbApi.save({
        misUserId: doctor.id,
        doctorName: doctor.name,
        serviceCode: selectedService.code || selectedService.service_id,
        serviceName: selectedService.title,
        bonusPercent,
        bonusRub,
        clinicId: dbClinicId,
      });
      toast.success('Бонус сохранён');
      handleClearService();
      await loadBonuses();
    } catch (err) {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete bonus ──
  const handleDeleteBonus = async (id) => {
    if (!window.confirm('Удалить этот бонус?')) return;
    try {
      await rbApi.delete(id);
      toast.success('Бонус удалён');
      await loadBonuses();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  // ── Category handlers ──
  const handleCatSelect = useCallback(async (cat) => {
    setCatServices([]);
    setCatSelectedService(null);
    setCatBulkValue('');
    setCatLoading(true);
    try {
      const res = await mis.getServicesByCategory(cat.id);
      const data = res.data?.data || res.data || [];
      setCatServices(Array.isArray(data) ? data : []);
    } catch {
      setCatServices([]);
      toast.error('Ошибка загрузки услуг категории');
    } finally {
      setCatLoading(false);
    }
  }, []);

  const handleCatServiceSelect = (svc) => {
    setCatSelectedService(svc);
    handleSelectService(svc);
    setAddTab('search'); // switch to search pane to show the edit form
  };

  const handleApplyCategoryBonus = async () => {
    if (!catServices.length) { toast.error('Нет услуг в категории'); return; }
    const val = parseFloat(catBulkValue);
    if (isNaN(val) || val < 0) { toast.error('Укажите размер бонуса'); return; }
    const bonusPercent = catBulkType === 'pct' ? val : null;
    const bonusRub = catBulkType === 'rub' ? val : null;

    setCatSaving(true);
    try {
      const services = catServices.map(s => ({
        serviceCode: s.code || String(s.service_id || ''),
        serviceName: s.title,
        bonusPercent,
        bonusRub,
      }));
      const result = await rbApi.saveBulk({
        misUserId: doctor.id,
        doctorName: doctor.name,
        services,
        clinicId: dbClinicId,
      });
      const n = result.data?.upserted ?? result.data?.count ?? services.length;
      toast.success(`Бонус применён к ${n} услуг${n === 1 ? 'е' : 'ам'}`);
      setCatBulkValue('');
      await loadBonuses();
    } catch (err) {
      toast.error('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setCatSaving(false);
    }
  };

  const specialty = doctor.professions.map(p =>
    typeof p === 'object' ? (p.title || '') : String(p || '')
  ).filter(Boolean).join(', ');

  return (
    <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
    <>
      {/* Doctor card header */}
      <div className="rb-doctor-card">
        <div className="rb-doctor-card-header">
          <div className="rb-doctor-card-info">
            <h2>{doctor.name}</h2>
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
      </div>

      {/* Clinic tabs */}
      <div className="rb-clinic-tab-wrap">
        <button
          className={`rb-clinic-tab${activeClinic === 'global' ? ' active' : ''}`}
          style={{ borderColor: 'var(--rb-primary)' }}
          onClick={() => { setActiveClinic('global'); setRefPage(1); }}
        >
          Общие
        </button>
        {clinics.filter(c => String(c.id) !== '8').map(c => (
          <button
            key={c.id}
            className={`rb-clinic-tab${activeClinic === String(c.id) ? ' active' : ''}`}
            style={{ borderColor: c.color || 'var(--rb-primary)' }}
            onClick={() => { setActiveClinic(String(c.id)); setRefPage(1); }}
          >
            <span className="rb-clinic-tab-dot" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      {/* Add service section */}
      <div className="rb-add-service-section">
        <div className="rb-add-service-header">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Добавить услугу с бонусом
          </h3>
        </div>
        <div className="rb-add-service-body">
          {/* Tabs */}
          <div className="rb-tabs">
            <button
              className={`rb-tab-btn${addTab === 'search' ? ' active' : ''}`}
              onClick={() => setAddTab('search')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Поиск
            </button>
            <button
              className={`rb-tab-btn${addTab === 'category' ? ' active' : ''}`}
              onClick={() => setAddTab('category')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              По категории
            </button>
          </div>

          {/* Search pane */}
          {addTab === 'search' && !selectedService && (
            <div>
              <div className="rb-search-row">
                <input
                  placeholder="Введите название или код услуги..."
                  value={searchQuery}
                  onChange={handleSearchInput}
                  onKeyDown={e => { if (e.key === 'Escape') handleClearService(); }}
                />
                <button className="rb-btn rb-btn-secondary" onClick={handleClearService}>Очистить</button>
              </div>
              {searchLoading && (
                <div className="rb-loading"><span className="rb-spinner" /> Поиск...</div>
              )}
              {!searchLoading && searchResults.length > 0 && (
                <div className="rb-search-results" style={{ display: 'block' }}>
                  {searchResults.map((svc, i) => (
                    <div key={svc.code || i} className="rb-search-result-item" onClick={() => handleSelectService(svc)}>
                      <div>
                        <div className="rb-result-name">{svc.title}</div>
                        <div className="rb-result-code">Код: {svc.code}</div>
                      </div>
                      {svc.price != null && (
                        <div className="rb-result-price">{parseFloat(svc.price).toFixed(2)} ₽</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Category pane */}
          {addTab === 'category' && !selectedService && (
            <div>
              <CategoryDropdown onSelect={handleCatSelect} />
              {catLoading && <div className="rb-loading"><span className="rb-spinner" /> Загрузка услуг...</div>}
              {!catLoading && catServices.length > 0 && (
                <>
                  {/* Services list */}
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--rb-border)', borderRadius: 7, marginBottom: 10 }}>
                    {catServices.map((svc, i) => (
                      <div
                        key={svc.code || i}
                        className="rb-search-result-item"
                        onClick={() => handleCatServiceSelect(svc)}
                      >
                        <div>
                          <div className="rb-result-name">{svc.title}</div>
                          <div className="rb-result-code">Код: {svc.code || svc.service_id}</div>
                        </div>
                        {svc.price != null && (
                          <div className="rb-result-price">{parseFloat(svc.price).toFixed(2)} ₽</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Bulk bonus form */}
                  <div style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                      Назначить бонус всем услугам категории
                      <span style={{ background: '#dbeafe', color: '#1e40af', fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600 }}>{catServices.length}</span>
                    </div>
                    <div className="rb-inline-toggle-wrap" style={{ marginBottom: 10 }}>
                      <div className="rb-exec-type-toggle">
                        <button
                          className={`rb-exec-type-btn${catBulkType === 'pct' ? ' active' : ''}`}
                          onClick={() => { setCatBulkType('pct'); setCatBulkValue(''); }}
                        >%</button>
                        <button
                          className={`rb-exec-type-btn${catBulkType === 'rub' ? ' active' : ''}`}
                          onClick={() => { setCatBulkType('rub'); setCatBulkValue(''); }}
                        >₽</button>
                      </div>
                      <input
                        type="number"
                        value={catBulkValue}
                        onChange={e => setCatBulkValue(e.target.value)}
                        placeholder={catBulkType === 'pct' ? 'Например: 10' : 'Например: 150'}
                        min="0"
                        step="any"
                        style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none' }}
                      />
                    </div>
                    <button
                      className="rb-btn rb-btn-primary rb-btn-sm"
                      onClick={handleApplyCategoryBonus}
                      disabled={catSaving}
                    >
                      {catSaving
                        ? <><span className="rb-spinner" style={{ marginRight: 5 }}></span>Сохранение...</>
                        : <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Применить ко всем
                          </>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Selected service form */}
          {selectedService && (
            <div className="rb-selected-service" style={{ display: 'block' }}>
              <div className="rb-selected-service-name">{selectedService.title}</div>
              <div className="rb-selected-service-code">
                Код: {selectedService.code || selectedService.service_id}
                {editingId && ' · редактирование'}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--rb-text-secondary)', display: 'block', marginBottom: 6 }}>
                  Бонус
                </label>
                <div className="rb-inline-toggle-wrap">
                  <div className="rb-exec-type-toggle">
                    <button
                      className={`rb-exec-type-btn${bonusType === 'pct' ? ' active' : ''}`}
                      onClick={() => { setBonusType('pct'); setBonusValue(''); }}
                    >%</button>
                    <button
                      className={`rb-exec-type-btn${bonusType === 'rub' ? ' active' : ''}`}
                      onClick={() => { setBonusType('rub'); setBonusValue(''); }}
                    >₽</button>
                  </div>
                  <input
                    type="number"
                    value={bonusValue}
                    onChange={e => setBonusValue(e.target.value)}
                    placeholder={bonusType === 'pct' ? 'Например: 10' : 'Например: 150'}
                    min="0"
                    step="any"
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none' }}
                  />
                </div>
              </div>
              <div className="rb-form-actions">
                <button className="rb-btn rb-btn-primary" onClick={handleSaveBonus} disabled={saving}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
                <button className="rb-btn rb-btn-secondary" onClick={handleClearService}>Отмена</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bonuses table */}
      <div className="rb-bonuses-section">
        <div className="rb-bonuses-header">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            Список услуг с бонусами
          </h3>
          <button
            onClick={() => setRefShowAll(v => !v)}
            title={refShowAll ? 'Включить пагинацию' : 'Показать все записи'}
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 6, cursor: 'pointer', background: refShowAll ? '#eff6ff' : '#fff', color: refShowAll ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            {refShowAll ? 'По страницам' : 'Все'}
          </button>
        </div>
        <div className="rb-bonuses-table-wrap">
          {loading ? (
            <div className="rb-loading"><span className="rb-spinner" /> Загрузка...</div>
          ) : (
            <>
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Код услуги</th>
                  <th>Название услуги</th>
                  <th>Бонус, %</th>
                  <th>Бонус, руб</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredBonuses.length === 0 ? (
                  <tr className="rb-empty-row">
                    <td colSpan="5">Нет услуг. Добавьте услуги выше.</td>
                  </tr>
                ) : (
                  refPageData.map(b => (
                    <tr key={b.id}>
                      <td className="rb-service-code-cell">{b.serviceCode}</td>
                      <td>{b.serviceName}</td>
                      <td>
                        {b.bonusPercent != null ? (
                          <span className="rb-bonus-value rb-bonus-percent">{parseFloat(b.bonusPercent)}%</span>
                        ) : '—'}
                      </td>
                      <td>
                        {b.bonusRub != null ? (
                          <span className="rb-bonus-value rb-bonus-rub">{parseFloat(b.bonusRub).toFixed(2)} ₽</span>
                        ) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="rb-btn rb-btn-secondary rb-btn-xs"
                          style={{ marginRight: 4 }}
                          onClick={() => handleEditBonus(b)}
                          title="Редактировать"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          className="rb-btn rb-btn-danger rb-btn-xs"
                          onClick={() => handleDeleteBonus(b.id)}
                          title="Удалить"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6"/><path d="M14 11v6"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <RefPagination />
            </>
          )}
        </div>
      </div>
    </>
    </fieldset>
  );
}
