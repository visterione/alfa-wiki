import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import './ReferralBonuses.css';
import { mis, referralBonuses as rbApi } from '../../services/api';
import { rbClinicId, rbProfessionTitle, DEFAULT_CLINICS } from './utils/clinicUtils';
import StepExecutors from './components/StepExecutors';
import StepPerformed from './components/StepPerformed';
import StepReferral from './components/StepReferral';
import StepReport from './components/StepReport';
import StepSalaryHistory from './components/StepSalaryHistory';

// ═══════════════════════════════════════
// WIZARD STEP ICONS
// ═══════════════════════════════════════
const STEP_ICONS = [
  // Step 1: Врачи
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  // Step 2: Выполненные услуги
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4.5 8-11.8A8 8 0 0 0 12 2a8 8 0 0 0-8 8.2c0 7.3 8 11.8 8 11.8z"/></svg>,
  // Step 3: Бонусы за направления
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  // Step 4: Отчёт
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  // Step 5: История зарплат
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
];

const STEP_LABELS = [
  'Врачи',
  'Выполненные услуги',
  'Бонусы за направления',
  'Отчёт',
  'История зарплат',
];

// ═══════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════
export default function ReferralBonusesPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  // ── Access guard ──
  useEffect(() => {
    if (user && !isAdmin && !user.canAccessSalary) {
      toast.error('Нет доступа к разделу «Зарплата»');
      navigate('/', { replace: true });
    }
  }, [user, isAdmin, navigate]);

  // ── Wizard navigation ──
  const [currentStep, setCurrentStep] = useState(1);

  // ── Clinics ──
  const [clinics, setClinics] = useState(DEFAULT_CLINICS);

  // ── Doctors (from MIS) ──
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorsError, setDoctorsError] = useState(null);

  // ── Filters (left panel) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [filterProfession, setFilterProfession] = useState('');

  // ── Selected doctor ──
  const [selectedDoctor, setSelectedDoctor] = useState(null);

  // ── Report mode (step 4) ──
  const [reportMode, setReportMode] = useState('individual'); // 'individual' | 'bulk'
  const [bulkSelectedIds, setBulkSelectedIds] = useState(new Set());

  // ── Compare mode (step 5) ──
  const [pinnedForCompare, setPinnedForCompare] = useState([]); // array of up to 2 doctor IDs

  const togglePinCompare = useCallback((doctorId) => {
    setPinnedForCompare(prev => {
      if (prev.includes(doctorId)) return prev.filter(id => id !== doctorId);
      if (prev.length >= 2) return prev; // max 2
      return [...prev, doctorId];
    });
  }, []);

  // ── Bonus counts (misUserId -> count) ──
  const [bonusCounts, setBonusCounts] = useState({});

  // ── Permissions ──
  const [permissions, setPermissions] = useState({
    tab1: 'edit', tab2: 'edit', tab3: 'edit', tab4: 'edit', tabArchive: 'edit', clinics: []
  });

  // ── Step 4: for jumping from step 3 to step 4 with a pre-selected doctor ──
  const [preselectedReportDoctorId, setPreselectedReportDoctorId] = useState(null);

  // ── Load clinics ──
  useEffect(() => {
    mis.getClinics()
      .then(res => {
        if (res.data?.success && Array.isArray(res.data?.data)) {
          const list = res.data.data;
          if (!list.find(c => String(c.id) === '8')) {
            list.push({ id: 8, name: 'Направители', color: '#0EA5E9' });
          }
          setClinics(list);
        }
      })
      .catch(() => {
        // silently use DEFAULT_CLINICS
      });
  }, []);

  // ── Load permissions ──
  useEffect(() => {
    rbApi.getMyPermissions()
      .then(res => setPermissions(res.data))
      .catch(() => {});
  }, []);

  // ── Load doctors from MIS ──
  useEffect(() => {
    setDoctorsLoading(true);
    setDoctorsError(null);
    mis.getDoctors({ show_all: true, roles: ['doctor', 'sender', 'assistant'] })
      .then(res => {
        const data = res.data;
        if (data?.error !== 0 || !Array.isArray(data?.data)) {
          setDoctorsError('Не удалось загрузить врачей');
          return;
        }
        const normalized = data.data.map(d => {
          let professions = [];
          if (Array.isArray(d.professions) && d.professions.length > 0) {
            professions = d.professions;
          } else if (d.profession_titles) {
            professions = String(d.profession_titles).split(',').map(s => s.trim()).filter(Boolean);
          } else if (d.profession) {
            professions = [d.profession];
          }
          let rawClinics = d.clinics || d.clinic || d.clinic_ids || [];
          if (!Array.isArray(rawClinics)) {
            rawClinics = String(rawClinics).split(',').map(x => x.trim()).filter(Boolean);
          }
          return {
            id: String(d.id),
            name: d.name || [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(' '),
            professions,
            clinics: rawClinics.map(rbClinicId),
          };
        });
        setDoctors(normalized);
      })
      .catch(err => {
        console.error('rbLoadDoctors error:', err);
        setDoctorsError('Ошибка загрузки врачей');
      })
      .finally(() => setDoctorsLoading(false));
  }, []);

  // ── Filtered doctors ──
  const filteredDoctors = doctors.filter(d => {
    if (permissions.clinics?.length > 0 && !d.clinics.some(c => permissions.clinics.includes(String(c)))) return false;
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterClinic && !d.clinics.includes(String(filterClinic))) return false;
    if (filterProfession && !d.professions.some(p => rbProfessionTitle(p) === filterProfession)) return false;
    return true;
  });

  // ── All unique professions ──
  const allProfessions = [...new Set(
    doctors.flatMap(d => d.professions.map(p => rbProfessionTitle(p)).filter(Boolean))
  )].sort();

  // ── Clinic helpers ──
  const getClinicColor = useCallback((clinicId) => {
    const c = clinics.find(x => String(x.id) === String(clinicId) || x.name === clinicId);
    return c?.color || '#94a3b8';
  }, [clinics]);

  const getClinicName = useCallback((clinicId) => {
    const c = clinics.find(x => String(x.id) === String(clinicId) || x.name === clinicId);
    return c?.name || String(clinicId);
  }, [clinics]);

  // ── Select doctor ──
  const handleSelectDoctor = useCallback((misUserId) => {
    const doctor = doctors.find(d => d.id === misUserId);
    setSelectedDoctor(doctor || null);
  }, [doctors]);

  // ── Navigate to step 4 with pre-selected doctor (from step 3 "Create report" button) ──
  const openReportForDoctor = useCallback((misUserId) => {
    setPreselectedReportDoctorId(misUserId);
    setCurrentStep(4);
  }, []);

  // ── Wizard navigation ──
  const goToStep = useCallback((step) => {
    setCurrentStep(step);
    if (step !== 4) setPreselectedReportDoctorId(null);
  }, []);

  // ── Rendered step ──
  const sharedProps = {
    doctors,
    filteredDoctors,
    clinics,
    selectedDoctor,
    onSelectDoctor: handleSelectDoctor,
    bonusCounts,
    setBonusCounts,
    permissions,
    getClinicColor,
    getClinicName,
    goToStep,
    openReportForDoctor,
    reportMode,
    setReportMode,
    bulkSelectedIds,
    setBulkSelectedIds,
    pinnedForCompare,
  };

  const TAB_KEYS = ['tab1', 'tab2', 'tab3', 'tab4', 'tabArchive'];

  const canViewStep = (step) => {
    const perm = permissions[TAB_KEYS[step - 1]];
    return perm === 'edit' || perm === 'read';
  };

  const isStepReadOnly = (step) => permissions[TAB_KEYS[step - 1]] === 'read';

  // Auto-navigate away from blocked step after permissions load
  useEffect(() => {
    if (permissions.tab1 === 'edit' && permissions.tab2 === 'edit') return; // default state, skip
    const currentPerm = permissions[TAB_KEYS[currentStep - 1]];
    if (currentPerm === 'block') {
      const first = TAB_KEYS.findIndex(k => permissions[k] !== 'block');
      if (first !== -1) setCurrentStep(first + 1);
    }
  }, [permissions]); // eslint-disable-line

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <StepExecutors {...sharedProps} readOnly={isStepReadOnly(1)} />;
      case 2:
        return <StepPerformed {...sharedProps} readOnly={isStepReadOnly(2)} />;
      case 3:
        return <StepReferral {...sharedProps} readOnly={isStepReadOnly(3)} />;
      case 4:
        return <StepReport {...sharedProps} preselectedDoctorId={preselectedReportDoctorId} readOnly={isStepReadOnly(4)} />;
      case 5:
        return <StepSalaryHistory {...sharedProps} readOnly={isStepReadOnly(5)} />;
      default:
        return null;
    }
  };

  return (
    <div className="rb-app">
      {/* Header */}
      <div className="rb-header">
        <h1>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Бонусы за направления
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
            {user?.displayName || user?.username}
          </span>
        </div>
      </div>

      {/* Wizard Navigation */}
      <div className="rb-wizard-nav">
        {STEP_LABELS.map((label, i) => {
          const step = i + 1;
          const active = currentStep === step;
          const accessible = canViewStep(step);
          const readonly = isStepReadOnly(step);
          return (
            <React.Fragment key={step}>
              {i > 0 && <div className="rb-wizard-connector" />}
              <div
                className={`rb-wizard-step${active ? ' active' : ''}${!accessible ? ' blocked' : ''}`}
                onClick={() => accessible && goToStep(step)}
                title={!accessible ? 'Нет доступа' : readonly ? `${label} (только просмотр)` : label}
              >
                <div className="rb-wizard-step-circle">
                  {accessible ? STEP_ICONS[i] : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  )}
                </div>
                <div className="rb-wizard-step-label">
                  {label}
                  {readonly && accessible && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>👁</span>}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="rb-layout">
        {/* Left: Doctors list (shared across all steps) */}
        <DoctorsList
          doctors={filteredDoctors}
          allDoctors={doctors}
          clinics={clinics}
          loading={doctorsLoading}
          error={doctorsError}
          selectedDoctor={selectedDoctor}
          onSelect={handleSelectDoctor}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterClinic={filterClinic}
          setFilterClinic={setFilterClinic}
          filterProfession={filterProfession}
          setFilterProfession={setFilterProfession}
          allProfessions={allProfessions}
          bonusCounts={bonusCounts}
          getClinicColor={getClinicColor}
          getClinicName={getClinicName}
          currentStep={currentStep}
          bulkMode={currentStep === 4 && reportMode === 'bulk'}
          bulkSelectedIds={bulkSelectedIds}
          setBulkSelectedIds={setBulkSelectedIds}
          compareMode={currentStep === 5}
          pinnedForCompare={pinnedForCompare}
          togglePinCompare={togglePinCompare}
        />
        {/* Right: Step content */}
        <div className="rb-detail-panel">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// DOCTORS LIST (left panel — steps 1-3)
// ═══════════════════════════════════════
const PIN_COLORS = ['#2563eb', '#ea580c'];
const PIN_LABELS = ['А', 'Б'];

function DoctorsList({
  doctors, allDoctors, clinics, loading, error,
  selectedDoctor, onSelect,
  searchQuery, setSearchQuery,
  filterClinic, setFilterClinic,
  filterProfession, setFilterProfession,
  allProfessions, bonusCounts,
  getClinicColor, getClinicName,
  currentStep,
  bulkMode, bulkSelectedIds, setBulkSelectedIds,
  compareMode, pinnedForCompare, togglePinCompare,
}) {
  const toggleBulk = (id) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllBulk = () => setBulkSelectedIds(new Set(doctors.map(d => d.id)));
  const clearBulk     = () => setBulkSelectedIds(new Set());

  const pinCount = pinnedForCompare.length;

  return (
    <div className="rb-panel">
      <div className="rb-panel-header">
        <div className="rb-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Врачи
        </div>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
          {bulkMode && bulkSelectedIds.size > 0
            ? <span style={{ color: 'var(--rb-primary)', fontWeight: 600 }}>✓ {bulkSelectedIds.size} выбрано</span>
            : compareMode && pinCount > 0
              ? <span style={{ fontWeight: 600, color: pinCount === 2 ? '#ea580c' : 'var(--rb-primary)' }}>
                  {pinCount === 2 ? 'Сравниваем А и Б' : 'Выберите врача Б'}
                </span>
              : <>{doctors.length} из {allDoctors.length}</>
          }
        </span>
      </div>

      <div className="rb-filters">
        <input
          className="rb-search-input"
          placeholder="Поиск по ФИО..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <select className="rb-select" value={filterClinic} onChange={e => setFilterClinic(e.target.value)}>
          <option value="">Все медцентры</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="rb-select" value={filterProfession} onChange={e => setFilterProfession(e.target.value)}>
          <option value="">Все специальности</option>
          {allProfessions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {bulkMode && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="rb-btn rb-btn-secondary rb-btn-xs" style={{ flex: 1 }} onClick={selectAllBulk}>
              Выбрать все ({doctors.length})
            </button>
            <button className="rb-btn rb-btn-secondary rb-btn-xs" onClick={clearBulk}>Сбросить</button>
          </div>
        )}

        {compareMode && (
          <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="4" y1="4" x2="4" y2="20"/><line x1="20" y1="4" x2="20" y2="20"/><path d="M4 12h16"/></svg>
            {pinCount === 0 ? 'Закрепите двух врачей для сравнения' : pinCount === 1 ? 'Выберите второго врача' : 'Нажмите на метку, чтобы снять'}
          </div>
        )}
      </div>

      <div className="rb-doctors-list">
        {loading && <div className="rb-loading"><span className="rb-spinner" />Загрузка врачей...</div>}
        {!loading && error && <div className="rb-loading" style={{ color: 'var(--rb-danger)' }}>{error}</div>}
        {!loading && !error && doctors.length === 0 && <div className="rb-loading">Нет врачей по фильтру</div>}
        {!loading && !error && doctors.map(d => {
          const specialty = d.professions.map(p =>
            typeof p === 'object' ? (p.title || '') : String(p || '')
          ).filter(Boolean).join(', ');
          const count     = bonusCounts[d.id];
          const isActive  = bulkMode ? bulkSelectedIds.has(d.id) : selectedDoctor?.id === d.id;
          const pinIdx    = pinnedForCompare.indexOf(d.id);
          const isPinned  = pinIdx !== -1;
          const canPin    = compareMode && (isPinned || pinCount < 2);

          return (
            <div
              key={d.id}
              className={`rb-doctor-item${isActive ? ' active' : ''}`}
              style={compareMode && isPinned ? { background: PIN_COLORS[pinIdx] + '15', borderLeft: `3px solid ${PIN_COLORS[pinIdx]}` } : {}}
              onClick={() => bulkMode ? toggleBulk(d.id) : onSelect(d.id)}
            >
              {bulkMode && (
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleBulk(d.id)}
                  onClick={e => e.stopPropagation()}
                  style={{ flexShrink: 0, accentColor: 'var(--rb-primary)', cursor: 'pointer' }}
                />
              )}
              <div className="rb-doctor-info">
                <div className="rb-doctor-name">{d.name}</div>
                {specialty && <div className="rb-doctor-specialty">{specialty}</div>}
                <div className="rb-doctor-badges">
                  {d.clinics.slice(0, 4).map(cId => (
                    <span key={cId} className="rb-clinic-badge" style={{ background: getClinicColor(cId) }}>
                      {getClinicName(cId)}
                    </span>
                  ))}
                </div>
              </div>
              {compareMode ? (
                <button
                  onClick={e => { e.stopPropagation(); canPin && togglePinCompare(d.id); }}
                  title={isPinned ? 'Снять метку' : pinCount < 2 ? 'Закрепить для сравнения' : 'Уже выбрано 2 врача'}
                  style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', border: isPinned ? 'none' : '1.5px solid #cbd5e1', background: isPinned ? PIN_COLORS[pinIdx] : 'transparent', color: isPinned ? '#fff' : '#94a3b8', fontSize: 10, fontWeight: 700, cursor: canPin ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: canPin ? 1 : 0.3 }}
                >
                  {isPinned ? PIN_LABELS[pinIdx] : '⊕'}
                </button>
              ) : !bulkMode && count != null ? (
                <span className="rb-bonus-count">{count} бонусов</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
