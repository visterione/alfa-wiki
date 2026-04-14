import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import './ReferralBonuses.css';
import { mis, referralBonuses as rbApi, executorSettings as execSettingsApi } from '../../services/api';
import { rbClinicId, rbProfessionTitle, DEFAULT_CLINICS, rbMatchClinicId, rbGetClinicName } from './utils/clinicUtils';
import { clearExecCache } from './utils/reportEngine';
import { parseExcelFile } from './utils/excelUtils';
import { rbNamesMatch, rbNormalizeName } from './utils/nameMatching';
import StepExecutors from './components/StepExecutors';
import StepHourNorms from './components/StepHourNorms';
import StepPerformed from './components/StepPerformed';
import StepReferral from './components/StepReferral';
import StepReport from './components/StepReport';
import StepSalaryHistory from './components/StepSalaryHistory';
import StepSummary from './components/StepSummary';

// ═══════════════════════════════════════
// WIZARD STEP ICONS
// ═══════════════════════════════════════
const STEP_ICONS = [
  // Step 1: Сотрудники
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  // Step 2: Норма часов
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  // Step 3: Услуги — чекбокс со списком (выполненные процедуры)
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  // Step 4: Направления — стрелка-перенаправление (пациент → врач)
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 8l4 4-4 4"/><path d="M3 12h18"/><path d="M3 6h7"/><path d="M3 18h7"/></svg>,
  // Step 5: Отчёт
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  // Step 6: Архив — коробка с крышкой
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  // Step 7: Сводка — диаграмма-пирог / итоговый дашборд
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>,
];

const STEP_LABELS = [
  'Сотрудники',
  'Норма часов',
  'Услуги',
  'Направления',
  'Отчёт',
  'Архив',
  'Сводка',
];

// ── Clinic group mapping for payroll import ───────────────────────────────────
// "Престиж" = Альфа(2) + Кидс(3) + Линия(6)
// "Проф"    = Проф(1)
// "Лабгрупп"= 3К(4) + Смайл(7)
const IMPORT_GROUP_CLINIC_IDS = {
  'престиж':  ['2', '3', '6'],
  'проф':     ['1'],
  'лабгрупп': ['4', '7'],
};

// ── Payroll Excel parser ──────────────────────────────────────────────────────
function parsePayrollImportRows(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const parseNum = v => parseFloat(String(v || '').replace(/[\s\u00A0]/g, '').replace(',', '.')) || 0;
  // Strip everything that is not a Cyrillic or Latin letter before matching
  const norm = k => k.toLowerCase().replace(/[^а-яёa-z]/g, '');

  const nameKey = keys.find(k => {
    const kl = norm(k);
    return kl === 'фио' || kl.startsWith('фамили') || kl.includes('фио');
  }) || keys[0];

  // "Клиника" — столбик после ФИО
  const clinicKey = keys.find(k => norm(k).includes('клиник')) || null;

  // "Тело ЗП", "Тело з/п", "Тело зарп", "Тело зарплата", "Оклад" …
  const salaryKey = keys.find(k => {
    const kl = norm(k);
    return (kl.includes('тело') && (kl.includes('зп') || kl.includes('жп') || kl.includes('зарп'))) ||
           kl === 'оклад' || kl === 'телозп';
  }) || (keys.length >= 2 ? keys.find(k => k !== nameKey && k !== clinicKey) : null);

  // "Аванс"
  const advanceKey = keys.find(k => norm(k).includes('аванс'))
    || (keys.length >= 3 ? keys.filter(k => k !== nameKey && k !== clinicKey && k !== salaryKey)[0] : null);

  // "НДФЛ", "Налог", "Подоходный"
  const ndflKey = keys.find(k => {
    const kl = norm(k);
    return kl.includes('ндфл') || kl === 'налог' || kl.includes('подоходн');
  }) || (keys.length >= 4 ? keys.filter(k => k !== nameKey && k !== clinicKey && k !== salaryKey && k !== advanceKey)[0] : null);

  return rows
    .map(row => {
      const clinicRaw = clinicKey ? String(row[clinicKey] || '').trim().toLowerCase() : '';
      const clinicGroup = clinicRaw && IMPORT_GROUP_CLINIC_IDS[clinicRaw] ? clinicRaw : null;
      return {
        name:        String(row[nameKey] || '').trim(),
        clinicGroup, // 'престиж' | 'проф' | 'лабгрупп' | null
        mainPayment: salaryKey  ? parseNum(row[salaryKey])  : null,
        advance:     advanceKey ? parseNum(row[advanceKey]) : null,
        ndfl:        ndflKey    ? parseNum(row[ndflKey])    : null,
      };
    })
    .filter(r => r.name && (r.mainPayment !== null || r.advance !== null || r.ndfl !== null));
}

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
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const wizardNavRef = React.useRef(null);
  const [wizardSlider, setWizardSlider] = React.useState({ left: 0, width: 0, duration: 0 });
  React.useLayoutEffect(() => {
    const nav = wizardNavRef.current;
    if (!nav) return;
    const active = nav.querySelector('.rb-wizard-step.active');
    if (!active) return;
    const newLeft = active.offsetLeft;
    const distance = Math.abs(newLeft - wizardSlider.left);
    const duration = Math.min(0.65, 0.3 + distance / 2000);
    setWizardSlider({ left: newLeft, width: active.offsetWidth, duration });
  }, [currentStep]);

  // ── Clinics ──
  const [clinics, setClinics] = useState(DEFAULT_CLINICS);

  // ── Doctors (from MIS) ──
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorsError, setDoctorsError] = useState(null);

  // ── Filters (left panel) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [filterRole, setFilterRole] = useState('');
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
    tab1: 'edit', tabHourNorms: 'edit', tab2: 'edit', tab3: 'edit', tab4: 'edit', tabArchive: 'edit', clinics: []
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
    mis.getDoctors({ show_all: true })
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
          let roles = [];
          if (d.role_titles) {
            roles = String(d.role_titles).split(',').map(s => s.trim()).filter(Boolean);
          } else if (Array.isArray(d.role_names) && d.role_names.length > 0) {
            roles = d.role_names;
          } else if (d.role) {
            roles = [d.role];
          }
          return {
            id: String(d.id),
            name: d.name || [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(' '),
            professions,
            roles,
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

  // ── Exclude hidden roles ──
  const visibleDoctors = doctors.filter(d => !d.roles.includes('КабинетыИРабота'));

  // ── Filtered doctors ──
  const filteredDoctors = visibleDoctors.filter(d => {
    if (permissions.clinics?.length > 0 && !d.clinics.some(c => permissions.clinics.includes(String(c)))) return false;
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterClinic && !d.clinics.includes(String(filterClinic))) return false;
    if (filterRole && !d.roles.includes(filterRole)) return false;
    if (filterProfession && !d.professions.some(p => rbProfessionTitle(p) === filterProfession)) return false;
    return true;
  });

  // ── All unique roles ──
  const allRoles = [...new Set(
    visibleDoctors.flatMap(d => d.roles)
  )].sort();

  // ── All unique professions ──
  const allProfessions = [...new Set(
    visibleDoctors.flatMap(d => d.professions.map(p => rbProfessionTitle(p)).filter(Boolean))
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

  // ── НДФЛ import ──
  const [ndflModal, setNdflModal] = useState(null);
  const [ndflImporting, setNdflImporting] = useState(false);
  const [disambigModal, setDisambigModal] = useState(null); // clinic disambiguation
  // selections for disambiguation modal: { [caseIdx]: clinicId }
  const [disambigSelections, setDisambigSelections] = useState({});

  // ── Global reset all unlocked items ──
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleGlobalReset = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const handleConfirmReset = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      await execSettingsApi.resetAll();
      clearExecCache();
      toast.success('Незафиксированные записи сброшены у всех врачей');
    } catch {
      toast.error('Ошибка глобального сброса');
    }
  }, []);

  const matchDoctorByName = useCallback((excelName) => {
    const normalized = rbNormalizeName(excelName);
    return doctors.find(d => rbNormalizeName(d.name) === normalized)
      || doctors.find(d => rbNamesMatch(d.name, excelName))
      || null;
  }, [doctors]);

  const applyNdflImport = useCallback(async (mode, matched, settingsMap) => {
    setNdflImporting(true);
    setNdflModal(null);
    let count = 0;
    try {
      for (const { doctor, clinicId, mainPayment, advance, ndfl } of matched) {
        const raw = settingsMap[doctor.id];
        const settings = raw || {
          assistants: [],
          clinicSettings: {
            global: {
              payType: 'salary', fixedSalary: 0, hourlyRate: 0, hoursWorked: 0,
              executorPercent: 0, plusPercent: false, paymentMethod: 'card',
              mainPaymentMethod: 'card', advance: 0, mainPayment: 0,
              includeReferralBonuses: true, includeReferralDeductions: true,
              includeCorpInvoices: true, assistancePercent: 0, cabinets: [],
              deductions: [], materials: [], serviceMaterials: [],
              extras: [], normServices: [], harmfulness: false,
            },
          },
        };
        const targetKey = clinicId || 'global';
        const clinicData = settings.clinicSettings?.[targetKey] || {};
        const updates = {};

        if (mainPayment !== null) {
          if (mode === 'overwrite' || !clinicData.lockedMainPayment)
            updates.mainPayment = mainPayment;
        }
        if (advance !== null) {
          if (mode === 'overwrite' || !clinicData.lockedAdvance)
            updates.advance = advance;
        }

        let deductions = [...(clinicData.deductions || [])];
        if (ndfl !== null) {
          const ndflIdx = deductions.findIndex(d => d.name === 'НДФЛ');
          if (ndflIdx !== -1) {
            if (mode === 'overwrite' || !deductions[ndflIdx].locked)
              deductions[ndflIdx] = { ...deductions[ndflIdx], value: ndfl, valueType: 'rub', deductionType: 'turnover' };
          } else {
            deductions.push({ name: 'НДФЛ', value: ndfl, valueType: 'rub', deductionType: 'turnover', locked: false });
          }
          updates.deductions = deductions;
        }

        if (!Object.keys(updates).length) continue;

        const newSettings = {
          ...settings,
          clinicSettings: { ...settings.clinicSettings, [targetKey]: { ...clinicData, ...updates } },
        };
        await execSettingsApi.save({ misUserId: doctor.id, doctorName: doctor.name, settings: newSettings });
        settingsMap[doctor.id] = newSettings;
        clearExecCache(doctor.id);
        count++;
      }
      toast.success(`Импорт завершён: ${count} сотр. обновлено`);
      if (selectedDoctor && matched.some(m => m.doctor.id === selectedDoctor.id)) {
        setSelectedDoctor(d => d ? { ...d } : null);
      }
    } catch {
      toast.error('Ошибка при импорте');
    } finally {
      setNdflImporting(false);
    }
  }, [selectedDoctor]);

  const handleImportNdfl = useCallback(async (file) => {
    let rows;
    try {
      const rawRows = await parseExcelFile(file);
      rows = parsePayrollImportRows(rawRows);
    } catch {
      toast.error('Не удалось прочитать Excel-файл');
      return;
    }
    if (!rows.length) {
      toast.error('Не найдено данных для импорта в файле');
      return;
    }
    const matched = [];
    const unmatchedNames = [];
    rows.forEach(row => {
      const doctor = matchDoctorByName(row.name);
      if (doctor) {
        matched.push({ doctor, clinicGroup: row.clinicGroup, clinicId: null, mainPayment: row.mainPayment, advance: row.advance, ndfl: row.ndfl });
      } else {
        if (!unmatchedNames.includes(row.name)) unmatchedNames.push(row.name);
      }
    });
    if (!matched.length) {
      toast.error('Ни один сотрудник из файла не найден в списке сотрудников');
      return;
    }
    if (unmatchedNames.length > 0) {
      toast(`Пропущено ${unmatchedNames.length} записей — сотрудники не найдены: ${unmatchedNames.slice(0, 3).join(', ')}${unmatchedNames.length > 3 ? '...' : ''}`, { duration: 5000 });
    }
    const settingsMap = {};
    await Promise.all(matched.map(async ({ doctor }) => {
      try {
        const res = await execSettingsApi.get(doctor.id);
        settingsMap[doctor.id] = res.data && Object.keys(res.data).length ? res.data : null;
      } catch {
        settingsMap[doctor.id] = null;
      }
    }));
    // ── Resolve clinic groups → clinicId ──
    // For each matched entry with a clinicGroup, determine which specific clinic to target
    // based on the clinics the doctor is registered in (from MIS doctor data).
    const ambiguousCases = []; // { idx, doctor, clinicGroup, options: [{id, name}] }
    matched.forEach((entry, idx) => {
      if (!entry.clinicGroup) {
        entry.clinicId = null; // → 'global'
        return;
      }
      const groupIds = IMPORT_GROUP_CLINIC_IDS[entry.clinicGroup] || [];
      if (groupIds.length === 1) {
        entry.clinicId = groupIds[0];
        return;
      }
      // Find which of the group's clinics this doctor actually belongs to
      const doctorClinics = entry.doctor.clinics.map(String);
      const matches = groupIds.filter(id => doctorClinics.includes(id));
      if (matches.length === 1) {
        entry.clinicId = matches[0];
      } else {
        // Ambiguous: doctor works in multiple clinics of this group (or none — show all options)
        const optionIds = matches.length > 1 ? matches : groupIds;
        const options = optionIds.map(id => ({ id, name: rbGetClinicName(id) }));
        ambiguousCases.push({ idx, doctor: entry.doctor, clinicGroup: entry.clinicGroup, options, mainPayment: entry.mainPayment, advance: entry.advance, ndfl: entry.ndfl });
        entry.clinicId = null; // will be set after disambiguation
      }
    });

    if (ambiguousCases.length > 0) {
      setDisambigModal({ cases: ambiguousCases, matched, settingsMap });
      return;
    }

    const conflicts = matched.filter(({ doctor, clinicId, mainPayment, advance, ndfl }) => {
      const targetKey = clinicId || 'global';
      const clinicData = settingsMap[doctor.id]?.clinicSettings?.[targetKey] || {};
      const deductions = clinicData.deductions || [];
      return (mainPayment !== null && clinicData.lockedMainPayment) ||
             (advance     !== null && clinicData.lockedAdvance) ||
             (ndfl        !== null && deductions.some(d => d.name === 'НДФЛ' && d.locked === true));
    });
    if (conflicts.length > 0) {
      setNdflModal({ matched, settingsMap, conflicts });
    } else {
      await applyNdflImport('overwrite', matched, settingsMap);
    }
  }, [applyNdflImport, matchDoctorByName]);

  const applyDisambig = useCallback(async (selections) => {
    if (!disambigModal) return;
    const { cases, matched, settingsMap } = disambigModal;
    // Apply selections to matched entries
    cases.forEach(({ idx }) => {
      if (selections[idx]) matched[idx].clinicId = selections[idx];
    });
    setDisambigModal(null);
    setDisambigSelections({});
    // Continue with conflict check
    const conflicts = matched.filter(({ doctor, clinicId, mainPayment, advance, ndfl }) => {
      const targetKey = clinicId || 'global';
      const clinicData = settingsMap[doctor.id]?.clinicSettings?.[targetKey] || {};
      const deductions = clinicData.deductions || [];
      return (mainPayment !== null && clinicData.lockedMainPayment) ||
             (advance     !== null && clinicData.lockedAdvance) ||
             (ndfl        !== null && deductions.some(d => d.name === 'НДФЛ' && d.locked === true));
    });
    if (conflicts.length > 0) {
      setNdflModal({ matched, settingsMap, conflicts });
    } else {
      await applyNdflImport('overwrite', matched, settingsMap);
    }
  }, [disambigModal, applyNdflImport]);

  // ── Navigate to step 5 with pre-selected doctor (from step 4 "Create report" button) ──
  const openReportForDoctor = useCallback((misUserId) => {
    setPreselectedReportDoctorId(misUserId);
    setCurrentStep(5);
  }, []);

  // ── Wizard navigation ──
  const goToStep = useCallback((step) => {
    setCurrentStep(step);
    if (step !== 5) setPreselectedReportDoctorId(null);
  }, []);

  // ── Rendered step ──
  const sharedProps = {
    doctors,
    filteredDoctors,
    allProfessions,
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
    panelCollapsed,
    onTogglePanel: () => setPanelCollapsed(v => !v),
  };

  const TAB_KEYS = ['tab1', 'tabHourNorms', 'tab2', 'tab3', 'tab4', 'tabArchive', 'tabSummary'];

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
        return <StepHourNorms readOnly={isStepReadOnly(2)} />;
      case 3:
        return <StepPerformed {...sharedProps} readOnly={isStepReadOnly(3)} />;
      case 4:
        return <StepReferral {...sharedProps} readOnly={isStepReadOnly(4)} />;
      case 5:
        return null; // StepReport is always mounted above to preserve state
      case 6:
        return <StepSalaryHistory {...sharedProps} readOnly={isStepReadOnly(6)} />;
      case 7:
        return <StepSummary doctors={doctors} clinics={clinics} getClinicColor={getClinicColor} permissions={permissions} />;
      default:
        return null;
    }
  };

  return (
    <div className="rb-app">

      {/* Wizard Navigation */}
      <div className="rb-wizard-nav" ref={wizardNavRef}>
        <div className="rb-wizard-nav-slider" style={{ left: wizardSlider.left, width: wizardSlider.width, '--slider-duration': `${wizardSlider.duration}s` }} />
        {STEP_LABELS.map((label, i) => {
          const step = i + 1;
          const active = currentStep === step;
          const accessible = canViewStep(step);
          const readonly = isStepReadOnly(step);
          return (
            <React.Fragment key={step}>
              <div
                className={`rb-wizard-step${active ? ' active' : ''}${!accessible ? ' blocked' : ''}`}
                onClick={() => accessible && goToStep(step)}
                title={!accessible ? 'Нет доступа' : readonly ? `${label} (только просмотр)` : label}
              >
                {accessible ? STEP_ICONS[i] : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
                <span className="rb-wizard-step-label">
                  {label}
                  {readonly && accessible && <span style={{ fontSize: 10, marginLeft: 3, opacity: 0.6 }}>👁</span>}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Global reset confirm modal */}
      {showResetConfirm && (
        <div className="rb-modal-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="rb-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 .49-4.02"/>
                </svg>
                Сбросить всех врачей
              </h3>
              <button className="rb-modal-close" onClick={() => setShowResetConfirm(false)}>×</button>
            </div>
            <div className="rb-modal-body">
              <p style={{ fontSize: 14, color: 'var(--rb-text)', lineHeight: 1.6, margin: '0 0 10px' }}>
                Будут удалены все <strong>незафиксированные</strong> записи (расходники, штрафы, материалы, дополнительно) у всех врачей.
              </p>
            </div>
            <div className="rb-modal-footer">
              <button className="rb-btn rb-btn-secondary" onClick={() => setShowResetConfirm(false)}>Отмена</button>
              <button
                className="rb-btn"
                style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
                onClick={handleConfirmReset}
              >
                Сбросить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disambiguation modal — выбор конкретного медцентра при неоднозначности группы */}
      {disambigModal && (
        <div className="rb-modal-overlay" onClick={() => setDisambigModal(null)}>
          <div className="rb-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Уточните медцентр
              </h3>
              <button className="rb-modal-close" onClick={() => setDisambigModal(null)}>×</button>
            </div>
            <div className="rb-modal-body">
              <p style={{ fontSize: 13, color: 'var(--rb-text-secondary)', marginBottom: 14 }}>
                Врач(и) ниже работают в нескольких медцентрах одной группы. Укажите, в какой именно вкладке сохранить данные.
              </p>
              {(() => {
                // Group cases by doctor to detect duplicate clinic selections within same doctor
                const usedByDoctor = {}; // doctorId → Set of selected clinicIds
                disambigModal.cases.forEach(({ idx, doctor }) => {
                  if (!usedByDoctor[doctor.id]) usedByDoctor[doctor.id] = {};
                  if (disambigSelections[idx]) {
                    if (!usedByDoctor[doctor.id].counts) usedByDoctor[doctor.id].counts = {};
                    const cid = disambigSelections[idx];
                    usedByDoctor[doctor.id].counts[cid] = (usedByDoctor[doctor.id].counts[cid] || 0) + 1;
                  }
                });
                const isDuplicate = (doctorId, clinicId, idx) => {
                  const counts = usedByDoctor[doctorId]?.counts || {};
                  return disambigSelections[idx] === clinicId && counts[clinicId] > 1;
                };

                return disambigModal.cases.map(({ idx, doctor, clinicGroup, options, mainPayment, advance, ndfl }) => {
                  const groupLabel = { престиж: 'Престиж', проф: 'Проф', лабгрупп: 'Лабгрупп' }[clinicGroup] || clinicGroup;
                  const valueParts = [];
                  if (mainPayment) valueParts.push(`Основная ЗП: ${mainPayment.toLocaleString('ru-RU')} ₽`);
                  if (advance)     valueParts.push(`Аванс: ${advance.toLocaleString('ru-RU')} ₽`);
                  if (ndfl)        valueParts.push(`НДФЛ: ${ndfl.toLocaleString('ru-RU')} ₽`);
                  const hasDup = options.some(opt => isDuplicate(doctor.id, opt.id, idx));
                  return (
                    <div key={idx} style={{ marginBottom: 12, padding: '12px 14px', border: `1px solid ${hasDup ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 8, background: hasDup ? '#fff7f7' : '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>{doctor.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>Группа: <b>{groupLabel}</b></div>
                      </div>
                      <div style={{ fontSize: 12, color: '#0369a1', background: '#f0f9ff', borderRadius: 5, padding: '4px 8px', marginBottom: 10, display: 'inline-block' }}>
                        {valueParts.join(' · ') || '—'}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {options.map(opt => {
                          const dup = isDuplicate(doctor.id, opt.id, idx);
                          const selected = disambigSelections[idx] === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDisambigSelections(prev => ({ ...prev, [idx]: opt.id }))}
                              style={{
                                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500,
                                border: selected ? `2px solid ${dup ? '#ef4444' : 'var(--rb-primary)'}` : '1px solid #cbd5e1',
                                background: selected ? (dup ? '#fef2f2' : '#eff6ff') : '#fff',
                                color: selected ? (dup ? '#dc2626' : 'var(--rb-primary)') : '#374151',
                              }}
                            >
                              {opt.name}
                            </button>
                          );
                        })}
                      </div>
                      {hasDup && <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>Этот медцентр уже выбран для другой записи этого врача</div>}
                    </div>
                  );
                });
              })()}
            </div>
            <div className="rb-modal-footer">
              <button className="rb-btn rb-btn-secondary" onClick={() => { setDisambigModal(null); setDisambigSelections({}); }}>Отмена</button>
              <button
                className="rb-btn"
                style={{ background: 'var(--rb-primary)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, opacity: (() => { const allSelected = disambigModal.cases.every(c => disambigSelections[c.idx]); const hasDups = disambigModal.cases.some(({ idx, doctor }) => { const sel = disambigSelections[idx]; return sel && disambigModal.cases.some(c2 => c2.idx !== idx && c2.doctor.id === doctor.id && disambigSelections[c2.idx] === sel); }); return allSelected && !hasDups ? 1 : 0.5; })() }}
                disabled={!disambigModal.cases.every(c => disambigSelections[c.idx]) || disambigModal.cases.some(({ idx, doctor }) => { const sel = disambigSelections[idx]; return sel && disambigModal.cases.some(c2 => c2.idx !== idx && c2.doctor.id === doctor.id && disambigSelections[c2.idx] === sel); })}
                onClick={() => applyDisambig(disambigSelections)}
              >
                Продолжить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* НДФЛ import conflict modal */}
      {ndflModal && (
        <div className="rb-modal-overlay" onClick={() => setNdflModal(null)}>
          <div className="rb-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Конфликт при импорте НДФЛ
              </h3>
              <button className="rb-modal-close" onClick={() => setNdflModal(null)}>×</button>
            </div>
            <div className="rb-modal-body">
              <p style={{ fontSize: 14, color: 'var(--rb-text)', marginBottom: 10 }}>
                У следующих сотрудников уже есть <strong>заблокированные</strong> записи:
              </p>
              <div style={{ maxHeight: 200, overflowY: 'auto', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
                {ndflModal.conflicts.map(({ doctor, clinicId, mainPayment, advance, ndfl }, idx) => {
                  const targetKey = clinicId || 'global';
                  const clinicData = ndflModal.settingsMap[doctor.id]?.clinicSettings?.[targetKey] || {};
                  const deductions = clinicData.deductions || [];
                  const locked = [];
                  if (mainPayment !== null && clinicData.lockedMainPayment) locked.push('Основная ЗП');
                  if (advance     !== null && clinicData.lockedAdvance)     locked.push('Аванс');
                  if (ndfl        !== null && deductions.some(d => d.name === 'НДФЛ' && d.locked)) locked.push('НДФЛ');
                  const clinicLabel = clinicId ? rbGetClinicName(clinicId) : null;
                  return (
                    <div key={`${doctor.id}_${idx}`} style={{ fontSize: 13, padding: '3px 0', color: 'var(--rb-text)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>🔒 {doctor.name}{clinicLabel && <span style={{ color: '#64748b', marginLeft: 5 }}>({clinicLabel})</span>}</span>
                      <span style={{ color: '#92400e', fontWeight: 500 }}>{locked.join(', ')}</span>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 13, color: 'var(--rb-text-secondary)', margin: 0 }}>
                Что сделать с заблокированными записями?
              </p>
            </div>
            <div className="rb-modal-footer">
              <button className="rb-btn rb-btn-secondary" onClick={() => setNdflModal(null)}>Отменить</button>
              <button
                className="rb-btn rb-btn-secondary"
                onClick={() => applyNdflImport('skip_locked', ndflModal.matched, ndflModal.settingsMap)}
              >
                Игнорировать заблокированных
              </button>
              <button
                className="rb-btn"
                style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
                onClick={() => applyNdflImport('overwrite', ndflModal.matched, ndflModal.settingsMap)}
              >
                Перезаписать всех
              </button>
            </div>
          </div>
        </div>
      )}

      {/* НДФЛ import loading overlay */}
      {ndflImporting && (
        <div className="rb-modal-overlay" style={{ cursor: 'wait' }}>
          <div style={{ background: '#fff', padding: '28px 40px', borderRadius: 12, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,.15)' }}>
            <span className="rb-spinner" style={{ display: 'block', margin: '0 auto 14px' }} />
            <div style={{ fontSize: 14, color: 'var(--rb-text)' }}>Импорт НДФЛ...</div>
          </div>
        </div>
      )}

      {/* Step Content */}
      <div className="rb-layout" style={currentStep === 7 || currentStep === 2 || panelCollapsed ? { gridTemplateColumns: '1fr' } : undefined}>
        {/* Left: Doctors list (hidden on Сводка tab) */}
        {currentStep !== 7 && currentStep !== 2 && !panelCollapsed && <DoctorsList
          doctors={filteredDoctors}
          allDoctors={visibleDoctors}
          clinics={clinics}
          loading={doctorsLoading}
          error={doctorsError}
          selectedDoctor={selectedDoctor}
          onSelect={handleSelectDoctor}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterClinic={filterClinic}
          setFilterClinic={setFilterClinic}
          filterRole={filterRole}
          setFilterRole={setFilterRole}
          allRoles={allRoles}
          filterProfession={filterProfession}
          setFilterProfession={setFilterProfession}
          allProfessions={allProfessions}
          bonusCounts={bonusCounts}
          getClinicColor={getClinicColor}
          getClinicName={getClinicName}
          currentStep={currentStep}
          bulkMode={currentStep === 5 && (reportMode === 'bulk' || reportMode === 'bulk_interim')}
          bulkSelectedIds={bulkSelectedIds}
          setBulkSelectedIds={setBulkSelectedIds}
          compareMode={currentStep === 6}
          pinnedForCompare={pinnedForCompare}
          togglePinCompare={togglePinCompare}
          onGlobalReset={currentStep === 1 && !isStepReadOnly(1) ? handleGlobalReset : null}
          onImportNdfl={currentStep === 1 && !isStepReadOnly(1) ? handleImportNdfl : null}
        />}
        {/* Right: Step content */}
        <div className="rb-detail-panel">
          <div style={{ display: currentStep === 5 ? 'contents' : 'none' }}>
            <StepReport {...sharedProps} preselectedDoctorId={preselectedReportDoctorId} readOnly={isStepReadOnly(5)} />
          </div>
          {currentStep !== 5 && renderStep()}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// DOCTORS LIST (left panel — steps 1-3)
// ═══════════════════════════════════════
const PIN_COLORS = ['#007AFF', '#dc2626'];
const PIN_LABELS = ['А', 'Б'];

function DoctorsList({
  doctors, allDoctors, clinics, loading, error,
  selectedDoctor, onSelect,
  searchQuery, setSearchQuery,
  filterClinic, setFilterClinic,
  filterRole, setFilterRole, allRoles,
  filterProfession, setFilterProfession,
  allProfessions, bonusCounts,
  getClinicColor, getClinicName,
  currentStep,
  bulkMode, bulkSelectedIds, setBulkSelectedIds,
  compareMode, pinnedForCompare, togglePinCompare,
  onGlobalReset,
  onImportNdfl,
}) {
  const importFileRef = React.useRef(null);
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
          Сотрудники
        </div>
        <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
          {bulkMode && bulkSelectedIds.size > 0
            ? <span style={{ color: 'var(--rb-primary)', fontWeight: 600 }}>✓ {bulkSelectedIds.size} выбрано</span>
            : compareMode && pinCount === 1
              ? <span style={{ fontWeight: 600, color: 'var(--rb-primary)' }}>Выберите врача Б</span>
              : <>{doctors.length} из {allDoctors.length}</>
          }
        </span>
      </div>

      <div className="rb-filters">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="rb-search-input"
            placeholder="Поиск по ФИО..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          {onGlobalReset && (
            <button
              onClick={onGlobalReset}
              title="Сбросить"
              style={{ flexShrink: 0, padding: '7px 9px', color: '#fff', border: 'none', borderRadius: 8, background: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="15" height="15">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-4.02"/>
              </svg>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="rb-select" style={{ flex: 1 }} value={filterClinic} onChange={e => setFilterClinic(e.target.value)}>
            <option value="">Все медцентры</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {onImportNdfl && (
            <button
              onClick={() => importFileRef.current?.click()}
              title="Импорт"
              style={{ flexShrink: 0, padding: '7px 9px', color: '#fff', border: 'none', borderRadius: 8, background: '#16a34a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="15" height="15">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
          )}
        </div>
        <select className="rb-select" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">Все должности</option>
          {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
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

        {onImportNdfl && (
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              await onImportNdfl(file);
            }}
          />
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
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
