import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { referralBonuses as rbApi, mis } from '../../../services/api';
import { useTabSlider } from '../utils/useTabSlider';
import ServiceTree from './ServiceTree';
import ClinicLogo from './ClinicLogo';

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
      panelCollapsed={panelCollapsed}
      onTogglePanel={onTogglePanel}
    />
  );
}

// ═══════════════════════════════════════
// DOCTOR REFERRAL PANEL
// ═══════════════════════════════════════
function DoctorReferralPanel({ doctor, clinics, openReportForDoctor, getClinicColor, getClinicName, setBonusCounts, readOnly, panelCollapsed, onTogglePanel }) {
  const [activeClinic, setActiveClinic] = useState('global');
  const { wrapRef: clinicTabRef, sliderEl: clinicSlider } = useTabSlider(activeClinic);
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

  // Inline row editing
  const [inlineEditId, setInlineEditId] = useState(null);
  const [inlineType, setInlineType]     = useState('pct');
  const [inlineValue, setInlineValue]   = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);

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
      const res = await mis.searchServices(q.trim());
      const raw = res.data;
      setSearchResults(raw?.success && Array.isArray(raw?.data) ? raw.data : []);
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

  // ── Inline edit bonus (in the row itself) ──
  const startInlineEdit = (b) => {
    setInlineEditId(b.id);
    if (b.bonusPercent != null) {
      setInlineType('pct');
      setInlineValue(String(parseFloat(b.bonusPercent)));
    } else {
      setInlineType('rub');
      setInlineValue(b.bonusRub != null ? String(parseFloat(b.bonusRub)) : '');
    }
  };

  const cancelInlineEdit = () => { setInlineEditId(null); setInlineValue(''); };

  const saveInlineEdit = async (b) => {
    const val = parseFloat(inlineValue);
    if (isNaN(val) || val < 0) { toast.error('Укажите размер бонуса'); return; }
    setInlineSaving(true);
    try {
      await rbApi.save({
        misUserId: doctor.id,
        doctorName: doctor.name,
        serviceCode: b.serviceCode,
        serviceName: b.serviceName,
        bonusPercent: inlineType === 'pct' ? val : null,
        bonusRub: inlineType === 'rub' ? val : null,
        clinicId: b.clinicId || '',
      });
      toast.success('Бонус обновлён');
      setInlineEditId(null);
      setInlineValue('');
      await loadBonuses();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setInlineSaving(false);
    }
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

  // ── Bulk apply from service tree ──
  const handleTreeApply = useCallback(async ({ services, bonusType: bt, bonusValue: val }) => {
    const bonusPercent = bt === 'pct' ? val : null;
    const bonusRub = bt === 'rub' ? val : null;
    const payload = services.map(s => ({
      serviceCode: s.code,
      serviceName: s.title,
      bonusPercent,
      bonusRub,
    }));
    const result = await rbApi.saveBulk({
      misUserId: doctor.id,
      doctorName: doctor.name,
      services: payload,
      clinicId: dbClinicId,
    });
    const n = result.data?.upserted ?? result.data?.count ?? payload.length;
    toast.success(`Бонус применён к ${n} услуг${n === 1 ? 'е' : 'ам'}`);
    await loadBonuses();
  }, [doctor.id, doctor.name, dbClinicId, loadBonuses]);

  const specialty = doctor.professions.map(p =>
    typeof p === 'object' ? (p.title || '') : String(p || '')
  ).filter(Boolean).join(', ');

  return (
    <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      {/* Main section */}
      <div className="rb-add-service-section">

        {/* Doctor card header */}
        <div className="rb-doctor-card-header" style={{ marginBottom: 0, borderRadius: 'var(--rb-radius) var(--rb-radius) 0 0' }}>
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

        <div style={{ padding: '12px 16px 16px' }}>

        {/* Clinic tabs */}
        <div className="rb-clinic-tab-wrap" style={{ marginBottom: 12 }} ref={clinicTabRef}>
          {clinicSlider}
          <button
            className={`rb-clinic-tab${activeClinic === 'global' ? ' active' : ''}`}
            onClick={() => { setActiveClinic('global'); setRefPage(1); }}
          >
            Общие
          </button>
          {clinics.filter(c => String(c.id) !== '8').map(c => (
            <button
              key={c.id}
              className={`rb-clinic-tab${activeClinic === String(c.id) ? ' active' : ''}`}
              onClick={() => { setActiveClinic(String(c.id)); setRefPage(1); }}
            >
              <ClinicLogo clinicId={c.id} color={c.color} />
              {c.name}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          {/* Tabs */}
          <div className="rb-tabs" style={{ marginTop: 0 }}>
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
                <button
                  onClick={() => setRefShowAll(v => !v)}
                  title={refShowAll ? 'Включить пагинацию' : 'Показать все записи'}
                  style={{ padding: '4px 10px', fontSize: 12, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                  {refShowAll ? 'По страницам' : 'Все'}
                </button>
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

          {/* Category tree pane */}
          {addTab === 'category' && !selectedService && (
            <ServiceTree
              clinicId={dbClinicId}
              onApplyBonus={handleTreeApply}
              readOnly={readOnly}
            />
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

        {/* Bonuses table */}
        <div className="rb-bonuses-table-wrap">
          {loading ? (
            <div className="rb-loading"><span className="rb-spinner" /> Загрузка...</div>
          ) : (
            <>
            <table className="rb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Код услуги</th>
                  <th style={{ textAlign: 'center' }}>Название услуги</th>
                  <th style={{ textAlign: 'center' }}>Бонус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredBonuses.length === 0 ? (
                  <tr className="rb-empty-row">
                    <td colSpan="4">Нет услуг. Добавьте услуги выше.</td>
                  </tr>
                ) : (
                  refPageData.map(b => {
                    const isEditing = inlineEditId === b.id;
                    return (
                    <tr key={b.id}>
                      <td className="rb-service-code-cell">{b.serviceCode}</td>
                      <td>{b.serviceName}</td>
                      <td style={{ textAlign: 'center' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                            <div className="rb-exec-type-toggle">
                              <button className={`rb-exec-type-btn${inlineType === 'pct' ? ' active' : ''}`} onClick={() => setInlineType('pct')}>%</button>
                              <button className={`rb-exec-type-btn${inlineType === 'rub' ? ' active' : ''}`} onClick={() => setInlineType('rub')}>₽</button>
                            </div>
                            <input
                              type="number" min="0" step="any" autoFocus
                              placeholder={inlineType === 'pct' ? '%' : '₽'}
                              value={inlineValue}
                              onChange={e => setInlineValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(b); if (e.key === 'Escape') cancelInlineEdit(); }}
                              style={{ width: 70, padding: '4px 6px', border: '1px solid var(--rb-border-dark)', borderRadius: 6, fontSize: 12, textAlign: 'right' }}
                            />
                          </div>
                        ) : b.bonusPercent != null ? (
                          <span className="rb-bonus-value rb-bonus-percent">{parseFloat(b.bonusPercent)}%</span>
                        ) : b.bonusRub != null ? (
                          <span className="rb-bonus-value rb-bonus-rub">{parseFloat(b.bonusRub).toFixed(2)} ₽</span>
                        ) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <>
                            <button
                              className="rb-btn rb-btn-primary rb-btn-xs"
                              style={{ marginRight: 4 }}
                              onClick={() => saveInlineEdit(b)}
                              disabled={inlineSaving}
                              title="Сохранить"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            </button>
                            <button
                              className="rb-btn rb-btn-secondary rb-btn-xs"
                              onClick={cancelInlineEdit}
                              title="Отмена"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="rb-btn rb-btn-primary rb-btn-xs"
                              style={{ marginRight: 4 }}
                              onClick={() => startInlineEdit(b)}
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
                          </>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <RefPagination />
            </>
          )}
        </div>
        </div>
      </div>
    </fieldset>
  );
}
