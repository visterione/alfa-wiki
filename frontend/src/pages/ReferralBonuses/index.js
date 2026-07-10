import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import './ReferralBonuses.css';
import { mis, referralBonuses as rbApi, executorSettings as execSettingsApi } from '../../services/api';
import { rbClinicId, rbProfessionTitle, DEFAULT_CLINICS, rbMatchClinicId, rbGetClinicName } from './utils/clinicUtils';
import { clearExecCache } from './utils/reportEngine';
import { parseExcelFile } from './utils/excelUtils';
import { parseSalarySlipPdf, normSubdivision, toSubdivisionList } from './utils/pdfUtils';
import { getSources } from './utils/excelSources';
import { rbNamesMatch, rbNormalizeName } from './utils/nameMatching';
import SearchableSelect from './components/SearchableSelect';
import ScheduleDivisionPanel from './components/ScheduleDivisionPanel';
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
  'Учёт времени',
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

// Служебные «клиники» — это склады в МИС без названий (показываются как id).
// Не несут информативности, поэтому не рисуем их чипами.
const HIDDEN_CLINIC_IDS = ['9', '10'];

// ── Секретная клиника «АУП» ────────────────────────────────────────────────
// Виртуальная клиника (в МИС её нет). Данные и её видимость доступны только
// пользователям с флагом canAccessTopSalary — enforcement на сервере
// (см. backend/services/aupFilter.js). На фронте всё под этим же флагом.
export const AUP_CLINIC_ID = 'aup';
const AUP_CLINIC = { id: AUP_CLINIC_ID, name: 'АУП', color: '#111111' };

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

  // Доступ к секретной клинике АУП (не связан с админством).
  const canSeeAup = !!user?.canAccessTopSalary;

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
  const [doctorPanelView, setDoctorPanelView] = useState('list'); // 'list' | 'divisions'
  const [archiveTabelEdit, setArchiveTabelEdit] = useState(false);
  const [step1Dirty, setStep1Dirty] = useState(false);
  const [excelSources, setExcelSources] = useState([]);
  const reloadExcelSources = useCallback(() => {
    getSources().then(setExcelSources).catch(() => {});
  }, []);
  useEffect(() => { reloadExcelSources(); }, []); // eslint-disable-line
  const step1DirtyRef = React.useRef(false);
  // Keep ref in sync with state for use inside callbacks without stale closure
  React.useEffect(() => { step1DirtyRef.current = step1Dirty; }, [step1Dirty]);
  const [pendingNav, setPendingNav] = useState(null); // { action: fn, doctorName: string }
  const [settingsResetKey, setSettingsResetKey] = useState(0);
  const wizardNavRef = React.useRef(null);
  const [wizardSlider, setWizardSlider] = React.useState({ left: 0, width: 0, duration: 0 });
  React.useLayoutEffect(() => {
    const nav = wizardNavRef.current;
    if (!nav) return;

    const recalc = (animate) => {
      const active = nav.querySelector('.rb-wizard-step.active');
      if (!active) return;
      const newLeft = active.offsetLeft;
      setWizardSlider(prev => ({
        left: newLeft,
        width: active.offsetWidth,
        duration: animate ? Math.min(0.65, 0.3 + Math.abs(newLeft - prev.left) / 2000) : 0,
      }));
    };

    recalc(true);

    const ro = new ResizeObserver(() => recalc(false));
    ro.observe(nav);
    return () => ro.disconnect();
  }, [currentStep]);

  // ── Clinics ──
  const [clinics, setClinics] = useState(DEFAULT_CLINICS);

  // ── АУП: участники секретной клиники (Set misUserId) ──
  // Загружается только для допущенных; для остальных бэкенд возвращает [].
  const [aupMembers, setAupMembers] = useState(() => new Set());
  const reloadAupMembers = useCallback(() => {
    if (!canSeeAup) { setAupMembers(new Set()); return; }
    execSettingsApi.getAupMembers()
      .then(res => setAupMembers(new Set((res.data || []).map(m => String(m.misUserId)))))
      .catch(() => {});
  }, [canSeeAup]);
  useEffect(() => { reloadAupMembers(); }, [reloadAupMembers]);

  // ── Doctors (from MIS) ──
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorsError, setDoctorsError] = useState(null);

  // ── Filters (left panel) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterProfession, setFilterProfession] = useState('');
  const [filterNewOnly, setFilterNewOnly] = useState(false); // показывать только новых сотрудников

  // ── Selected doctor ──
  const [selectedDoctor, setSelectedDoctor] = useState(null);

  // ── Disabled clinics per doctor (doctorId → string[]) ──
  const [disabledClinicsMap, setDisabledClinicsMap] = useState({});
  const handleDisabledClinicsChange = useCallback((doctorId, disabledClinics) => {
    setDisabledClinicsMap(prev => ({ ...prev, [doctorId]: (disabledClinics || []).map(String) }));
  }, []);
  useEffect(() => {
    execSettingsApi.getAllDisabledClinics()
      .then(res => { if (res.data && Object.keys(res.data).length) setDisabledClinicsMap(res.data); })
      .catch(() => {});
  }, []); // eslint-disable-line

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
    tab1: 'edit', tabWorkTime: 'edit', tabHourNorms: 'edit', tabSchedule: 'edit',
    tab2: 'edit', tab3: 'edit', tab4: 'edit',
    tabArchiveHistory: 'edit', tabArchiveKassa: 'edit', tabArchiveTabel: 'edit',
    tabSummary: 'edit', tabKpi: 'edit', clinics: []
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
            list.push({ id: 8, name: 'Направители', color: '#00bfff' });
          }
          if (!list.find(c => String(c.id) === '11')) {
            list.push({ id: 11, name: 'Сукко', color: '#2d7055' });
          }
          if (!list.find(c => String(c.id) === 'ip')) {
            list.push({ id: 'ip', name: 'ИП Микаелян', color: '#e05252' });
          }
          setClinics(list);
        }
      })
      .catch(() => {
        // silently use DEFAULT_CLINICS
      });
  }, []);

  // Держим виртуальную клинику АУП в списке только для допущенных.
  useEffect(() => {
    setClinics(prev => {
      const hasAup = prev.some(c => String(c.id) === AUP_CLINIC_ID);
      if (canSeeAup && !hasAup) return [...prev, AUP_CLINIC];
      if (!canSeeAup && hasAup) return prev.filter(c => String(c.id) !== AUP_CLINIC_ID);
      return prev;
    });
  }, [canSeeAup, clinics.length]); // eslint-disable-line

  // ── Load permissions ──
  useEffect(() => {
    rbApi.getMyPermissions()
      .then(res => setPermissions(res.data))
      .catch(() => {});
  }, []);

  // ── Load doctors from MIS (с кешированием в sessionStorage) ──
  useEffect(() => {
    const CACHE_KEY = 'rb_doctors_v1';
    const normalizeDoctors = (rawList) => rawList.map(d => {
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
      const mappedClinics = rawClinics.map(rbClinicId);
      if (roles.includes('Сотрудник call-центра') && !mappedClinics.includes('ip')) {
        mappedClinics.push('ip');
      }
      // Exclusive 'ip' only if call-center is the sole role; with other roles — hybrid (all clinics + ip)
      const isOnlyCallCenter = roles.every(r => r === 'Сотрудник call-центра');
      if (mappedClinics.includes('ip') && isOnlyCallCenter) {
        mappedClinics.splice(0, mappedClinics.length, 'ip');
      }
      return {
        id: String(d.id),
        name: d.name || [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(' '),
        professions,
        roles,
        clinics: mappedClinics,
        // Флаги реестра сотрудников (проставляет бэкенд в /mis/doctors):
        //   _archived — уволен/давно не виден в МИС (в статистике участвует, в рабочем списке скрыт),
        //   _isNew    — появился после baseline и ещё без настроек исполнителя.
        _archived: !!d._archived,
        _isNew: !!d._isNew,
      };
    });

    // Показываем закешированные данные мгновенно
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached) && cached.length) {
          setDoctors(cached);
          setDoctorsLoading(false);
        }
      }
    } catch {}

    // Всегда подгружаем свежие данные в фоне
    setDoctorsError(null);
    mis.getDoctors({ show_all: true })
      .then(res => {
        const data = res.data;
        if (data?.error !== 0 || !Array.isArray(data?.data)) {
          setDoctorsError('Не удалось загрузить врачей');
          return;
        }
        const normalized = normalizeDoctors(data.data);
        setDoctors(normalized);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(normalized)); } catch {}
      })
      .catch(err => {
        console.error('rbLoadDoctors error:', err);
        setDoctorsError('Ошибка загрузки врачей');
      })
      .finally(() => setDoctorsLoading(false));
  }, []);

  // ── Exclude hidden roles + archived ──
  // Архивные (уволенные) остаются в полном `doctors` для Сводки/Отчёта, но из рабочего списка
  // сотрудников и из списков фильтров (роли/профессии) исключаются.
  const visibleDoctors = doctors
    .filter(d => !d.roles.includes('КабинетыИРабота') && !d._archived)
    // Допущенным добавляем чип/клинику АУП участникам (для остальных aupMembers пуст).
    .map(d => (canSeeAup && aupMembers.has(String(d.id)) && !d.clinics.includes(AUP_CLINIC_ID))
      ? { ...d, clinics: [...d.clinics, AUP_CLINIC_ID] }
      : d);

  // ── New employees within the user's clinic scope (для бейджа) ──
  // Бейдж считаем по области доступа: бухгалтеру одного медцентра не показываем новых из чужого.
  const newDoctors = visibleDoctors.filter(d =>
    d._isNew &&
    (!(permissions.clinics?.length > 0) || d.clinics.some(c => permissions.clinics.includes(String(c))))
  );
  const newCount = newDoctors.length;

  // ── Filtered doctors ──
  const filteredDoctors = visibleDoctors.filter(d => {
    if (permissions.clinics?.length > 0 && !d.clinics.some(c => permissions.clinics.includes(String(c)))) {
      // Допущенному к АУП показываем безклиничных (кандидаты в АУП) и участников АУП
      // даже при ограничении доступа по клиникам — иначе их не назначить/не увидеть.
      const aupVisible = canSeeAup && (d.clinics.length === 0 || d.clinics.includes(AUP_CLINIC_ID));
      if (!aupVisible) return false;
    }
    if (filterNewOnly && !d._isNew) return false;
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterClinic) {
      const effectiveClinics = d.clinics.filter(c => !(disabledClinicsMap[d.id] || []).includes(String(c)));
      if (!effectiveClinics.includes(String(filterClinic))) return false;
    }
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
    const doSelect = () => setSelectedDoctor(prev => {
      if (prev?.id === misUserId) return null; // toggle off
      const found = doctors.find(d => d.id === misUserId) || null;
      // Допущенным подмешиваем клинику АУП участнику, чтобы показать вкладку и учесть в отчёте.
      if (found && canSeeAup && aupMembers.has(String(found.id)) && !found.clinics.includes(AUP_CLINIC_ID)) {
        return { ...found, clinics: [...found.clinics, AUP_CLINIC_ID] };
      }
      return found;
    });
    if (step1DirtyRef.current && currentStep === 1 && selectedDoctor?.id !== misUserId && selectedDoctor !== null) {
      setPendingNav({ action: doSelect, doctorName: selectedDoctor?.name });
      return;
    }
    doSelect();
  }, [doctors, currentStep, selectedDoctor, canSeeAup, aupMembers]);

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
      setSettingsResetKey(k => k + 1);
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
      for (const { doctor, clinicId, mainPayment, advance, ndfl, vacation } of matched) {
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
              extras: [], normServices: [],
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

        let extraPayments = [...(clinicData.extraPayments || [])];
        if (vacation != null) {
          const vacIdx = extraPayments.findIndex(ep => ep.label === 'Отпускные');
          if (vacIdx !== -1) {
            if (mode === 'overwrite' || !extraPayments[vacIdx].locked)
              extraPayments[vacIdx] = { ...extraPayments[vacIdx], amount: vacation };
          } else {
            extraPayments.push({ method: 'card', label: 'Отпускные', amount: vacation, locked: false });
          }
          updates.extraPayments = extraPayments;
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

  // ── PDF расчётные листки import ───────────────────────────────────────────
  const [pdfImporting,    setPdfImporting]    = useState(false);
  const [pdfParsing,      setPdfParsing]      = useState(false);
  const [pdfPreviewModal, setPdfPreviewModal] = useState(null);
  const [splitEditValues, setSplitEditValues] = useState({}); // { [matchIdx]: { mainPayment, advance, ndfl, vacation } }
  const [pdfModalSearch,  setPdfModalSearch]  = useState('');
  const [pdfClinicFilter, setPdfClinicFilter] = useState('');
  const [pdfSelectedDoctorIds, setPdfSelectedDoctorIds] = useState(new Set());
  const [pdfUnmatchedExpanded, setPdfUnmatchedExpanded] = useState(false);
  const [pdfSubdivisionExpanded, setPdfSubdivisionExpanded] = useState(false);
  // pdfPreviewModal: { matched, settingsMap, unmatchedNames, noSubdivision }

  const handleImportPdf = useCallback(async (file) => {
    setPdfParsing(true);
    let rows;
    try {
      rows = await parseSalarySlipPdf(file);
    } catch (err) {
      console.error('PDF parse error:', err);
      toast.error('Не удалось прочитать PDF-файл');
      setPdfParsing(false);
      return;
    }
    if (!rows.length) {
      toast.error('Расчётные листки не найдены в файле');
      setPdfParsing(false);
      return;
    }

    const matched = [];
    const unmatchedNames = [];
    const noSubdivision = [];
    const settingsMap = {};

    for (const row of rows) {
      const doctor = matchDoctorByName(row.name);
      if (!doctor) {
        if (!unmatchedNames.includes(row.name)) unmatchedNames.push(row.name);
        continue;
      }
      if (!(doctor.id in settingsMap)) {
        try {
          const res = await execSettingsApi.get(doctor.id);
          settingsMap[doctor.id] = res.data && Object.keys(res.data).length ? res.data : null;
        } catch {
          settingsMap[doctor.id] = null;
        }
      }
      if (row.subdivision) {
        const cs = settingsMap[doctor.id]?.clinicSettings || {};
        const matchingClinics = Object.entries(cs).filter(([, v]) =>
          toSubdivisionList(v.pdfSubdivision).some(sd => normSubdivision(sd) === row.subdivision)
        );
        if (matchingClinics.length === 0) {
          noSubdivision.push({ name: row.name, subdivision: row.subdivision });
          matched.push({
            doctor, clinicId: null, subdivisionResolved: false, needsSplit: false,
            pdfSubdivision: row.subdivision,
            mainPayment: row.mainPayment, advance: row.advance,
            ndfl: row.ndfl, vacation: row.vacation ?? null,
          });
        } else if (matchingClinics.length === 1) {
          const cKey = matchingClinics[0][0];
          matched.push({
            doctor, clinicId: cKey === 'global' ? null : cKey,
            subdivisionResolved: true, needsSplit: false,
            pdfSubdivision: row.subdivision,
            mainPayment: row.mainPayment, advance: row.advance,
            ndfl: row.ndfl, vacation: row.vacation ?? null,
          });
        } else {
          // Multiple clinics with the same pdfSubdivision → manual split required
          for (const [cKey] of matchingClinics) {
            matched.push({
              doctor, clinicId: cKey === 'global' ? null : cKey,
              subdivisionResolved: true, needsSplit: true,
              pdfSubdivision: row.subdivision,
              mainPayment: null, advance: null, ndfl: null, vacation: null,
              refMainPayment: row.mainPayment, refAdvance: row.advance,
              refNdfl: row.ndfl, refVacation: row.vacation ?? null,
            });
          }
        }
      } else {
        matched.push({
          doctor, clinicId: null, subdivisionResolved: false, needsSplit: false,
          pdfSubdivision: row.subdivision,
          mainPayment: row.mainPayment, advance: row.advance,
          ndfl: row.ndfl, vacation: row.vacation ?? null,
        });
      }
    }

    setPdfParsing(false);

    // ── Aggregate rows that resolve to the same employee + clinic ──
    // Handles employees whose PDF contains several payslips (different 1С subdivisions)
    // that all map to one clinic: their amounts are summed instead of overwriting.
    // needsSplit entries are a separate mechanism and are left untouched.
    const sumField = (a, b) =>
      (a == null && b == null) ? null : Math.round(((a || 0) + (b || 0)) * 100) / 100;
    const aggregated = [];
    const groupIndex = {};
    for (const entry of matched) {
      if (entry.needsSplit) { aggregated.push(entry); continue; }
      const key = `${entry.doctor.id}|${entry.clinicId || 'global'}`;
      if (key in groupIndex) {
        const g = aggregated[groupIndex[key]];
        g.mainPayment = sumField(g.mainPayment, entry.mainPayment);
        g.advance     = sumField(g.advance, entry.advance);
        g.ndfl        = sumField(g.ndfl, entry.ndfl);
        g.vacation    = sumField(g.vacation, entry.vacation);
        if (entry.pdfSubdivision && !g._subdivisions.includes(entry.pdfSubdivision)) {
          g._subdivisions.push(entry.pdfSubdivision);
          g.pdfSubdivision = g._subdivisions.join(', ');
        }
        g.subdivisionResolved = g.subdivisionResolved || entry.subdivisionResolved;
      } else {
        groupIndex[key] = aggregated.length;
        aggregated.push({ ...entry, _subdivisions: entry.pdfSubdivision ? [entry.pdfSubdivision] : [] });
      }
    }
    matched.length = 0;
    matched.push(...aggregated);

    if (!matched.length) {
      const msg = unmatchedNames.length
        ? `Ни один сотрудник не найден: ${unmatchedNames.slice(0, 3).join(', ')}${unmatchedNames.length > 3 ? '...' : ''}`
        : 'Не найдено данных для импорта';
      toast.error(msg);
      return;
    }

    // Show preview modal — user confirms before anything is written
    // needsSplit entries float to the top so the user sees them first
    const sortedMatched = [
      ...matched.filter(e => e.needsSplit),
      ...matched.filter(e => !e.needsSplit),
    ];
    setSplitEditValues({});
    setPdfModalSearch('');
    setPdfClinicFilter('');
    setPdfUnmatchedExpanded(false);
    setPdfSubdivisionExpanded(false);
    setPdfSelectedDoctorIds(new Set(sortedMatched.map(entry => entry.doctor.id)));
    setPdfPreviewModal({ matched: sortedMatched, settingsMap, unmatchedNames, noSubdivision });
  }, [matchDoctorByName]);

  const confirmPdfImport = useCallback(async () => {
    if (!pdfPreviewModal) return;
    if (pdfSelectedDoctorIds.size === 0) {
      toast.error('Выберите сотрудников для импорта');
      return;
    }
    const { matched, settingsMap } = pdfPreviewModal;
    const selectedMatched = matched.filter(entry => pdfSelectedDoctorIds.has(entry.doctor.id));

    // Apply manually-entered split values to needsSplit entries
    const parseEditVal = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = parseFloat(String(v).replace(',', '.'));
      return isNaN(n) ? null : n;
    };
    const resolvedMatched = selectedMatched.map(entry => {
      if (!entry.needsSplit) return entry;
      const originalIndex = matched.indexOf(entry);
      const sv = splitEditValues[originalIndex] || {};
      return {
        ...entry,
        mainPayment: parseEditVal(sv.mainPayment),
        advance:     parseEditVal(sv.advance),
        ndfl:        parseEditVal(sv.ndfl),
        vacation:    parseEditVal(sv.vacation),
      };
    });

    // Auto-fill empty split fields with remainder: total - sum(filled) / count(empty)
    const splitGroups = {};
    resolvedMatched.forEach((entry, i) => {
      if (!entry.needsSplit) return;
      if (!splitGroups[entry.doctor.id]) splitGroups[entry.doctor.id] = [];
      splitGroups[entry.doctor.id].push(i);
    });
    for (const indices of Object.values(splitGroups)) {
      for (const field of ['mainPayment', 'advance', 'ndfl', 'vacation']) {
        const refField = 'ref' + field.charAt(0).toUpperCase() + field.slice(1);
        const refVal = resolvedMatched[indices[0]][refField];
        if (refVal == null) continue;
        const emptyIdx = indices.filter(i => resolvedMatched[i][field] == null);
        if (emptyIdx.length === 0) continue;
        const filledSum = indices
          .filter(i => resolvedMatched[i][field] != null)
          .reduce((s, i) => s + resolvedMatched[i][field], 0);
        const remainder = Math.round((refVal - filledSum) * 100) / 100;
        const perEntry  = Math.round((remainder / emptyIdx.length) * 100) / 100;
        emptyIdx.forEach(i => { resolvedMatched[i] = { ...resolvedMatched[i], [field]: perEntry }; });
      }
    }

    setPdfPreviewModal(null);

    const conflicts = resolvedMatched.filter(({ doctor, clinicId: cid, mainPayment, advance, ndfl, vacation }) => {
      const targetKey = cid || 'global';
      const clinicData = settingsMap[doctor.id]?.clinicSettings?.[targetKey] || {};
      const deductions     = clinicData.deductions     || [];
      const extraPayments  = clinicData.extraPayments  || [];
      return (mainPayment !== null && clinicData.lockedMainPayment) ||
             (advance     !== null && clinicData.lockedAdvance) ||
             (ndfl        !== null && deductions.some(d => d.name === 'НДФЛ'       && d.locked === true)) ||
             (vacation    != null  && extraPayments.some(ep => ep.label === 'Отпускные' && ep.locked === true));
    });

    if (conflicts.length > 0) {
      setNdflModal({ matched: resolvedMatched, settingsMap, conflicts });
    } else {
      setPdfImporting(true);
      await applyNdflImport('overwrite', resolvedMatched, settingsMap);
      setPdfImporting(false);
    }
  }, [pdfPreviewModal, splitEditValues, pdfSelectedDoctorIds, applyNdflImport]);

  // ── Navigate to step 5 with pre-selected doctor (from step 4 "Create report" button) ──
  const openReportForDoctor = useCallback((misUserId) => {
    setPreselectedReportDoctorId(misUserId);
    setCurrentStep(5);
  }, []);

  // ── Wizard navigation ──
  const goToStep = useCallback((step) => {
    const doNav = () => {
      setCurrentStep(step);
      if (step !== 5) setPreselectedReportDoctorId(null);
      if (step !== 6) setArchiveTabelEdit(false);
    };
    if (step1DirtyRef.current && currentStep === 1 && step !== 1) {
      setPendingNav({ action: doNav, doctorName: selectedDoctor?.name });
      return;
    }
    doNav();
  }, [currentStep, selectedDoctor]);

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
    onArchiveTabelEdit: setArchiveTabelEdit,
    excelSources,
    onSourcesChange: reloadExcelSources,
    currentUserName: user?.displayName || user?.username || '',
    onDisabledClinicsChange: handleDisabledClinicsChange,
    canSeeAup,
    onAupSaved: reloadAupMembers,
  };

  // Steps 2 and 6 use 3 sub-keys instead of a single key
  const STEP2_KEYS = ['tabWorkTime', 'tabHourNorms', 'tabSchedule'];
  const STEP6_KEYS = ['tabArchiveHistory', 'tabArchiveKassa', 'tabArchiveTabel', 'tabArchiveSources'];
  const TAB_KEYS   = ['tab1', null, 'tab2', 'tab3', 'tab4', null, 'tabSummary'];

  const canViewStep = (step) => {
    if (step === 2) return STEP2_KEYS.some(k => permissions[k] !== 'block');
    if (step === 6) return STEP6_KEYS.some(k => permissions[k] !== 'block');
    const perm = permissions[TAB_KEYS[step - 1]];
    return perm === 'edit' || perm === 'read';
  };

  const isStepReadOnly = (step) => {
    if (step === 2) return STEP2_KEYS.every(k => permissions[k] !== 'edit') && STEP2_KEYS.some(k => permissions[k] !== 'block');
    if (step === 6) return STEP6_KEYS.every(k => permissions[k] !== 'edit') && STEP6_KEYS.some(k => permissions[k] !== 'block');
    return permissions[TAB_KEYS[step - 1]] === 'read';
  };

  // Auto-navigate away from blocked step after permissions load
  useEffect(() => {
    if (permissions.tab1 === 'edit' && permissions.tab2 === 'edit') return; // default state, skip
    if (currentStep === 2 || currentStep === 6) {
      if (!canViewStep(currentStep)) {
        const first = TAB_KEYS.findIndex((k, i) => {
          if (i === 1) return canViewStep(2);
          if (i === 5) return canViewStep(6);
          return k && permissions[k] !== 'block';
        });
        if (first !== -1) setCurrentStep(first + 1);
      }
      return;
    }
    const currentPerm = permissions[TAB_KEYS[currentStep - 1]];
    if (currentPerm === 'block') {
      const first = TAB_KEYS.findIndex((k, i) => {
        if (i === 1) return canViewStep(2);
        if (i === 5) return canViewStep(6);
        return k && permissions[k] !== 'block';
      });
      if (first !== -1) setCurrentStep(first + 1);
    }
  }, [permissions]); // eslint-disable-line

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <StepExecutors {...sharedProps} readOnly={isStepReadOnly(1)} onDirtyChange={setStep1Dirty} settingsResetKey={settingsResetKey} />;
      case 2:
        return <StepHourNorms doctors={doctors} clinics={clinics} getClinicColor={getClinicColor} getClinicName={getClinicName} permissions={permissions} />;
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

      {/* Unsaved changes warning modal */}
      {pendingNav && (
        <div className="rb-modal-overlay" onClick={() => setPendingNav(null)}>
          <div className="rb-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="rb-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Несохранённые изменения
              </h3>
              <button className="rb-modal-close" onClick={() => setPendingNav(null)}>×</button>
            </div>
            <div className="rb-modal-body">
              <p style={{ fontSize: 14, color: 'var(--rb-text)', lineHeight: 1.6, margin: 0 }}>
                У врача <strong>{pendingNav.doctorName}</strong> есть несохранённые изменения.
                Если уйти сейчас — они будут потеряны.
              </p>
            </div>
            <div className="rb-modal-footer">
              <button className="rb-btn rb-btn-secondary" onClick={() => setPendingNav(null)}>
                Вернуться и сохранить
              </button>
              <button
                className="rb-btn"
                style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
                onClick={() => { setStep1Dirty(false); pendingNav.action(); setPendingNav(null); }}
              >
                Уйти без сохранения
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF parsing overlay */}
      {pdfParsing && (
        <div className="rb-modal-overlay" style={{ cursor: 'wait' }}>
          <div style={{ background: '#fff', padding: '28px 40px', borderRadius: 12, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,.15)' }}>
            <span className="rb-spinner" style={{ display: 'block', margin: '0 auto 14px' }} />
            <div style={{ fontSize: 14, color: 'var(--rb-text)' }}>Чтение PDF...</div>
          </div>
        </div>
      )}

      {/* PDF preview / confirmation modal */}
      {pdfPreviewModal && (() => {
        const m = pdfPreviewModal.matched;

        // Map: doctorId → array of indices in m (for split groups)
        const groupIdxMap = {};
        m.forEach((e, i) => {
          if (!e.needsSplit) return;
          if (!groupIdxMap[e.doctor.id]) groupIdxMap[e.doctor.id] = [];
          groupIdxMap[e.doctor.id].push(i);
        });

        // Live remainder for a field within a split group
        const calcRem = (groupIndices, field) => {
          const rf = 'ref' + field.charAt(0).toUpperCase() + field.slice(1);
          const total = m[groupIndices[0]][rf];
          if (total == null) return null;
          let filled = 0;
          for (const idx of groupIndices) {
            const v = (splitEditValues[idx] || {})[field];
            if (v !== undefined && v !== null && v !== '') {
              const n = parseFloat(String(v).replace(',', '.'));
              if (!isNaN(n)) filled += n;
            }
          }
          return Math.round((total - filled) * 100) / 100;
        };

        // Search filter
        const srch = pdfModalSearch.trim().toLowerCase();
        const matchesSrch = (e) => !srch ||
          e.doctor.name.toLowerCase().includes(srch) ||
          (e.pdfSubdivision || '').toLowerCase().includes(srch);
        const clinicFilterKey = pdfClinicFilter;
        const entryClinicKey = (e) => e.clinicId || 'global';
        const matchesClinic = (e) => !clinicFilterKey || entryClinicKey(e) === clinicFilterKey;
        const splitMatchIds = new Set(
          m.filter(e => e.needsSplit && matchesSrch(e) && matchesClinic(e)).map(e => e.doctor.id)
        );
        const visible = (e) => e.needsSplit
          ? splitMatchIds.has(e.doctor.id)
          : matchesSrch(e) && matchesClinic(e);

        const splitDoctorCount = Object.keys(groupIdxMap).length;
        const normalCount = m.filter(e => !e.needsSplit).length;
        const clinicFilterOptions = [...new Set(m.map(entryClinicKey))]
          .map(key => ({
            value: key,
            label: key === 'global' ? 'Общий / не определена' : getClinicName(key),
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
        const allDoctorIds = [...new Set(m.map(entry => entry.doctor.id))];
        const visibleDoctorIds = [...new Set(m.filter(visible).map(entry => entry.doctor.id))];
        const selectedDoctorCount = allDoctorIds.filter(id => pdfSelectedDoctorIds.has(id)).length;
        const toggleDoctorSelection = (doctorId) => {
          setPdfSelectedDoctorIds(prev => {
            const next = new Set(prev);
            if (next.has(doctorId)) next.delete(doctorId);
            else next.add(doctorId);
            return next;
          });
        };

        const fmt = (v) => v != null ? v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—';
        const COL = { border: '1px solid #e5e7eb', padding: '6px 10px', textAlign: 'left' };
        const COLR = { ...COL, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

        const tableRows = [];
        for (let i = 0; i < m.length; i++) {
          const entry = m[i];
          if (!visible(entry)) continue;
          const { doctor, clinicId, subdivisionResolved, pdfSubdivision, mainPayment, advance, vacation, ndfl,
                  needsSplit, refMainPayment, refAdvance, refNdfl, refVacation } = entry;

          if (needsSplit) {
            const gi = groupIdxMap[doctor.id];
            const isFirst = i === gi[0];
            const isLast  = i === gi[gi.length - 1];
            const doctorSelected = pdfSelectedDoctorIds.has(doctor.id);

            if (isFirst) {
              tableRows.push(
                <tr key={`sh-${i}`} style={{ background: '#f3f4f6', opacity: doctorSelected ? 1 : 0.5 }}>
                  <td style={{ ...COL, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={doctorSelected}
                      onChange={() => toggleDoctorSelection(doctor.id)}
                      style={{ accentColor: 'var(--rb-primary)', cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ ...COL, fontWeight: 700, color: '#111827' }}>{doctor.name}</td>
                  <td style={{ ...COL, color: '#374151', fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pdfSubdivision || ''}>{pdfSubdivision}</td>
                  <td style={{ ...COL, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>↕ итого</td>
                  <td style={COLR}>{fmt(refMainPayment)}</td>
                  <td style={COLR}>{fmt(refAdvance)}</td>
                  <td style={COLR}>{fmt(refVacation)}</td>
                  <td style={COLR}>{fmt(refNdfl)}</td>
                </tr>
              );
            }

            const sv = splitEditValues[i] || {};
            const cliName = clinicId ? getClinicName(clinicId) : 'Общий';
            const mkInput = (field, refVal) => (
              <input
                type="number" step="0.01" min="0"
                placeholder={refVal != null ? String(refVal.toFixed(2)) : ''}
                value={sv[field] !== undefined ? sv[field] : ''}
                disabled={!doctorSelected}
                onChange={ev => setSplitEditValues(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [field]: ev.target.value } }))}
                style={{ width: 98, padding: '3px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 3, textAlign: 'right', background: doctorSelected ? '#fff' : '#f3f4f6', color: doctorSelected ? '#111827' : '#9ca3af', outline: 'none' }}
              />
            );
            tableRows.push(
              <tr key={i} style={{ background: '#fafafa', opacity: doctorSelected ? 1 : 0.5 }}>
                <td style={COL} />
                <td style={{ ...COL, paddingLeft: 22, color: '#4b5563', fontSize: 11 }}>↳ {doctor.name}</td>
                <td style={COL} />
                <td style={COL}>
                  {clinicId
                    ? <span style={{ background: getClinicColor(clinicId), color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11 }}>{cliName}</span>
                    : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Общий</span>}
                </td>
                <td style={{ ...COL, textAlign: 'right' }}>{mkInput('mainPayment', refMainPayment)}</td>
                <td style={{ ...COL, textAlign: 'right' }}>{mkInput('advance', refAdvance)}</td>
                <td style={{ ...COL, textAlign: 'right' }}>{mkInput('vacation', refVacation)}</td>
                <td style={{ ...COL, textAlign: 'right' }}>{mkInput('ndfl', refNdfl)}</td>
              </tr>
            );

            if (isLast) {
              const remStyle = (field) => {
                const r = calcRem(gi, field);
                if (r == null) return <span style={{ opacity: 0.35 }}>—</span>;
                return <span style={{ color: r < -0.005 ? '#dc2626' : r > 0.005 ? '#374151' : '#9ca3af', fontWeight: r !== 0 ? 600 : 400 }}>{fmt(r)}</span>;
              };
              tableRows.push(
                <tr key={`rem-${i}`} style={{ background: '#f9fafb', borderBottom: '2px solid #d1d5db' }}>
                  <td style={COL} />
                  <td colSpan={2} style={{ ...COL, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>Остаток → пустые поля</td>
                  <td style={COL} />
                  <td style={{ ...COLR, fontSize: 11 }}>{remStyle('mainPayment')}</td>
                  <td style={{ ...COLR, fontSize: 11 }}>{remStyle('advance')}</td>
                  <td style={{ ...COLR, fontSize: 11 }}>{remStyle('vacation')}</td>
                  <td style={{ ...COLR, fontSize: 11 }}>{remStyle('ndfl')}</td>
                </tr>
              );
            }
          } else {
            const clinicName = clinicId ? getClinicName(clinicId) : (subdivisionResolved ? 'Общий' : '—');
            const warn = !subdivisionResolved && pdfSubdivision;
            const doctorSelected = pdfSelectedDoctorIds.has(doctor.id);
            tableRows.push(
              <tr key={i} style={{ background: warn ? '#fffbeb' : 'transparent', opacity: doctorSelected ? 1 : 0.5 }}>
                <td style={{ ...COL, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={doctorSelected}
                    onChange={() => toggleDoctorSelection(doctor.id)}
                    style={{ accentColor: 'var(--rb-primary)', cursor: 'pointer' }}
                  />
                </td>
                <td style={{ ...COL, fontWeight: 500 }}>{doctor.name}</td>
                <td style={{ ...COL, color: warn ? '#92400e' : '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pdfSubdivision || ''}>
                  {pdfSubdivision || <span style={{ opacity: 0.4 }}>—</span>}
                  {warn && <span title="Не сопоставлено с клиникой"> ⚠</span>}
                </td>
                <td style={COL}>
                  {clinicId
                    ? <span style={{ background: getClinicColor(clinicId), color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11 }}>{clinicName}</span>
                    : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>{subdivisionResolved ? 'Общий' : '—'}</span>}
                </td>
                <td style={COLR}>{mainPayment != null ? fmt(mainPayment) : <span style={{ opacity: 0.35 }}>—</span>}</td>
                <td style={COLR}>{advance    != null ? fmt(advance)    : <span style={{ opacity: 0.35 }}>—</span>}</td>
                <td style={COLR}>{vacation   != null ? fmt(vacation)   : <span style={{ opacity: 0.35 }}>—</span>}</td>
                <td style={COLR}>{ndfl       != null ? fmt(ndfl)       : <span style={{ opacity: 0.35 }}>—</span>}</td>
              </tr>
            );
          }
        }

        return (
          <div className="rb-modal-overlay" onClick={() => setPdfPreviewModal(null)}>
            <div className="rb-modal" style={{ maxWidth: 1440, width: '99vw' }} onClick={e => e.stopPropagation()}>
              <div className="rb-modal-header">
                <h3>Предпросмотр импорта расчётных листков</h3>
                <button className="rb-modal-close" onClick={() => setPdfPreviewModal(null)}>×</button>
              </div>
              <div className="rb-modal-body" style={{ padding: '12px 18px' }}>

                {/* Stats */}
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: '0 14px' }}>
                  <span>Найдено: <b style={{ color: '#111827' }}>{normalCount}</b> сотр.</span>
                  {splitDoctorCount > 0 && <span style={{ color: '#374151', fontWeight: 600 }}>Разделить вручную: <b>{splitDoctorCount}</b></span>}
                  {pdfPreviewModal.unmatchedNames.length > 0 && <span style={{ color: '#92400e' }}>Не найдено: <b>{pdfPreviewModal.unmatchedNames.length}</b></span>}
                  {pdfPreviewModal.noSubdivision.length > 0 && <span>Без Подразд.: <b>{pdfPreviewModal.noSubdivision.length}</b></span>}
                </div>

                {/* Employees selected for import */}
                <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <button
                    type="button"
                    className="rb-btn rb-btn-secondary rb-btn-sm"
                    disabled={visibleDoctorIds.length === 0}
                    onClick={() => setPdfSelectedDoctorIds(prev => new Set([...prev, ...visibleDoctorIds]))}
                  >
                    Выбрать показанных
                  </button>
                  <button
                    type="button"
                    className="rb-btn rb-btn-secondary rb-btn-sm"
                    disabled={visibleDoctorIds.length === 0}
                    onClick={() => setPdfSelectedDoctorIds(prev => {
                      const next = new Set(prev);
                      visibleDoctorIds.forEach(id => next.delete(id));
                      return next;
                    })}
                  >
                    Снять показанных
                  </button>
                  <span style={{ fontSize: 12, color: selectedDoctorCount ? '#374151' : '#92400e' }}>
                    Выбрано сотрудников: <b>{selectedDoctorCount}</b> из {allDoctorIds.length}
                  </span>
                </div>

                {/* Search and clinic filter */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    placeholder="Поиск по сотруднику или подразделению..."
                    value={pdfModalSearch}
                    onChange={e => setPdfModalSearch(e.target.value)}
                    style={{ flex: 1, minWidth: 220, padding: '6px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, outline: 'none', color: '#111827', background: '#fff', boxSizing: 'border-box' }}
                  />
                  <select
                    value={pdfClinicFilter}
                    onChange={e => {
                      const clinicKey = e.target.value;
                      setPdfClinicFilter(clinicKey);
                      if (clinicKey) {
                        setPdfSelectedDoctorIds(new Set(
                          m
                            .filter(entry => entryClinicKey(entry) === clinicKey)
                            .map(entry => entry.doctor.id)
                        ));
                      }
                    }}
                    style={{ width: 220, padding: '6px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, outline: 'none', color: '#374151', background: '#fff' }}
                    title="Фильтр по клинике"
                  >
                    <option value="">Все клиники</option>
                    {clinicFilterOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                {/* Table */}
                <div style={{ overflowX: 'auto', maxHeight: 430, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }}>
                        {[
                          ['',                34],
                          ['Сотрудник',     200],
                          ['Подразд. (1С)', 170],
                          ['Клиника',        90],
                          ['Осн. ЗП',       110],
                          ['Аванс',         110],
                          ['Отпускные',     110],
                          ['НДФЛ',          110],
                        ].map(([h, w]) => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', fontSize: 11, border: '1px solid #e5e7eb', minWidth: w }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.length > 0
                        ? tableRows
                        : <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Ничего не найдено</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* Warnings */}
                {pdfPreviewModal.unmatchedNames.length > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 3 }}>
                      Не найдено в списке сотрудников ({pdfPreviewModal.unmatchedNames.length}):
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: '#78350f',
                      lineHeight: 1.6,
                      ...(!pdfUnmatchedExpanded ? {
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      } : {}),
                    }}>
                      {pdfPreviewModal.unmatchedNames.join(', ')}
                    </div>
                    <button
                      type="button"
                      onClick={() => setPdfUnmatchedExpanded(v => !v)}
                      style={{ marginTop: 5, padding: 0, border: 'none', background: 'transparent', color: '#92400e', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {pdfUnmatchedExpanded ? 'Свернуть' : 'Показать полностью'}
                    </button>
                  </div>
                )}
                {pdfPreviewModal.noSubdivision.length > 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>
                      Подразделение (1С) не настроено ({pdfPreviewModal.noSubdivision.length}) — данные запишутся в «Общий» тариф:
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: '#6b7280',
                      lineHeight: 1.6,
                      ...(!pdfSubdivisionExpanded ? {
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      } : {}),
                    }}>
                      {pdfPreviewModal.noSubdivision.map(r => `${r.name} (${r.subdivision})`).join(', ')}
                    </div>
                    <button
                      type="button"
                      onClick={() => setPdfSubdivisionExpanded(v => !v)}
                      style={{ marginTop: 5, padding: 0, border: 'none', background: 'transparent', color: '#4b5563', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {pdfSubdivisionExpanded ? 'Свернуть' : 'Показать полностью'}
                    </button>
                  </div>
                )}

              </div>
              <div className="rb-modal-footer">
                <button className="rb-btn rb-btn-secondary" onClick={() => setPdfPreviewModal(null)}>Отмена</button>
                <button
                  className="rb-btn"
                  disabled={selectedDoctorCount === 0}
                  style={{ background: '#1f2937', color: '#fff', border: 'none', padding: '8px 22px', borderRadius: 8, fontWeight: 600, cursor: selectedDoctorCount ? 'pointer' : 'not-allowed', fontSize: 13, opacity: selectedDoctorCount ? 1 : 0.45 }}
                  onClick={confirmPdfImport}
                >
                  Применить ({selectedDoctorCount})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PDF import loading overlay */}
      {pdfImporting && (
        <div className="rb-modal-overlay" style={{ cursor: 'wait' }}>
          <div style={{ background: '#fff', padding: '28px 40px', borderRadius: 12, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,.15)' }}>
            <span className="rb-spinner" style={{ display: 'block', margin: '0 auto 14px' }} />
            <div style={{ fontSize: 14, color: 'var(--rb-text)' }}>Импорт расчётных листков...</div>
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
      <div className="rb-layout" style={currentStep === 7 || currentStep === 2 || panelCollapsed || (currentStep === 6 && archiveTabelEdit) ? { gridTemplateColumns: '1fr' } : undefined}>
        {/* Left: Doctors list (hidden on Сводка tab) */}
        {currentStep !== 7 && currentStep !== 2 && !panelCollapsed && !(currentStep === 6 && archiveTabelEdit) && (
          doctorPanelView === 'divisions' ? (
            <ScheduleDivisionPanel
              doctors={visibleDoctors}
              selectedDoctorId={selectedDoctor?.id ?? null}
              onSelectDoctor={handleSelectDoctor}
              readOnly={isStepReadOnly(currentStep)}
              getClinicColor={getClinicColor}
              getClinicName={getClinicName}
              onToggleView={() => setDoctorPanelView('list')}
              bulkMode={currentStep === 5 && (reportMode === 'bulk' || reportMode === 'bulk_interim')}
              bulkSelectedIds={bulkSelectedIds}
              setBulkSelectedIds={setBulkSelectedIds}
            />
          ) : (
            <DoctorsList
              doctors={filteredDoctors}
              allDoctors={visibleDoctors}
              clinics={clinics}
              loading={doctorsLoading}
              error={doctorsError}
              selectedDoctor={selectedDoctor}
              onSelect={handleSelectDoctor}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterNewOnly={filterNewOnly}
              setFilterNewOnly={setFilterNewOnly}
              newCount={newCount}
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
              disabledClinicsMap={disabledClinicsMap}
              currentStep={currentStep}
              bulkMode={currentStep === 5 && (reportMode === 'bulk' || reportMode === 'bulk_interim')}
              bulkSelectedIds={bulkSelectedIds}
              setBulkSelectedIds={setBulkSelectedIds}
              compareMode={currentStep === 6}
              pinnedForCompare={pinnedForCompare}
              togglePinCompare={togglePinCompare}
              onGlobalReset={currentStep === 1 && !isStepReadOnly(1) ? handleGlobalReset : null}
              onImportNdfl={currentStep === 1 && !isStepReadOnly(1) ? handleImportNdfl : null}
              onImportPdf={currentStep === 1 && !isStepReadOnly(1) ? handleImportPdf : null}
              onToggleView={() => setDoctorPanelView('divisions')}
            />
          )
        )}
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
  filterNewOnly, setFilterNewOnly, newCount,
  filterClinic, setFilterClinic,
  filterRole, setFilterRole, allRoles,
  filterProfession, setFilterProfession,
  allProfessions, bonusCounts,
  getClinicColor, getClinicName,
  disabledClinicsMap,
  currentStep,
  bulkMode, bulkSelectedIds, setBulkSelectedIds,
  compareMode, pinnedForCompare, togglePinCompare,
  onGlobalReset,
  onImportNdfl,
  onImportPdf,
  onToggleView,
}) {
  const importFileRef    = React.useRef(null);
  const importPdfFileRef = React.useRef(null);
  const toggleBulk = (id) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllBulk = () => setBulkSelectedIds(new Set(displayDoctors.map(d => d.id)));
  const clearBulk     = () => setBulkSelectedIds(new Set());

  const pinCount = pinnedForCompare.length;

  // Step 4 (Направления) shows all doctors.
  // All other steps hide employees where Направители (ID 8) is their ONLY clinic.
  // Employees who also have other clinics are shown, but their Направители chip and salary tab are hidden.
  const REFERRAL_CLINIC_ID = '8';
  const hasOnlyReferralClinic = d => {
    const otherClinics = d.clinics.filter(c => String(c) !== REFERRAL_CLINIC_ID);
    return otherClinics.length === 0 && (d.clinics.some(c => String(c) === REFERRAL_CLINIC_ID) || d.roles.includes('Направитель'));
  };
  const displayDoctors = currentStep === 4 ? doctors : doctors.filter(d => !hasOnlyReferralClinic(d));
  const displayAllDoctors = currentStep === 4 ? allDoctors : allDoctors.filter(d => !hasOnlyReferralClinic(d));

  return (
    <div className="rb-panel">
      <div className="rb-panel-header">
        <div className="rb-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Сотрудники
          {(newCount > 0 || filterNewOnly) && (
            <button
              type="button"
              onClick={() => setFilterNewOnly(v => !v)}
              title={filterNewOnly ? 'Показать всех сотрудников' : `Новых сотрудников: ${newCount} — показать только их`}
              className={'rb-new-badge' + (filterNewOnly ? ' active' : '')}
            >
              {filterNewOnly ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" width="13" height="13">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                </svg>
              )}
              <span>{newCount}</span>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {bulkMode && bulkSelectedIds.size > 0 && (
            <span style={{ fontSize: 12, color: 'var(--rb-primary)', fontWeight: 600 }}>✓ {bulkSelectedIds.size} выбрано</span>
          )}
          {compareMode && pinCount === 1 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-primary)' }}>Выберите врача Б</span>
          )}
          {onToggleView && !compareMode && (
            <button
              onClick={onToggleView}
              title="По подразделениям"
              style={{
                width: 26, height: 26, borderRadius: 6, border: 'none',
                background: '#64748b', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="rb-filters">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="rb-search-wrap" style={{ flex: 1 }}>
            <svg className="rb-search-wrap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="rb-search-input"
              placeholder="Поиск по ФИО..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
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
          <SearchableSelect
            style={{ flex: 1 }}
            value={filterClinic}
            onChange={setFilterClinic}
            options={[
              { value: '', label: 'Все медцентры' },
              ...clinics.map(c => ({ value: String(c.id), label: c.name })),
            ]}
          />
          {/* Кнопка импорта из Excel временно скрыта (логика сохранена — вернуть можно, убрав `false &&`) */}
          {false && onImportNdfl && (
            <button
              onClick={() => importFileRef.current?.click()}
              title="Импорт зарплат (Excel)"
              style={{ flexShrink: 0, padding: '7px 9px', color: '#fff', border: 'none', borderRadius: 8, background: '#16a34a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="15" height="15">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
          )}
          {onImportPdf && (
            <button
              onClick={() => importPdfFileRef.current?.click()}
              title="Импорт расчётных листков (PDF)"
              style={{ flexShrink: 0, padding: '7px 9px', color: '#fff', border: 'none', borderRadius: 8, background: '#7c3aed', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="15" height="15">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9 15 12 12 15 15"/>
              </svg>
            </button>
          )}
        </div>
        <SearchableSelect
          value={filterRole}
          onChange={setFilterRole}
          options={[
            { value: '', label: 'Все должности' },
            ...allRoles.map(r => ({ value: r, label: r })),
          ]}
        />
        <SearchableSelect
          value={filterProfession}
          onChange={setFilterProfession}
          options={[
            { value: '', label: 'Все специальности' },
            ...allProfessions.map(p => ({ value: p, label: p })),
          ]}
        />

        {bulkMode && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="rb-btn rb-btn-primary rb-btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={selectAllBulk}>
              Выбрать все ({displayDoctors.length})
            </button>
            <button
              title="Сбросить выбор"
              style={{ flexShrink: 0, width: 30, height: 30, padding: 0, border: '1px solid var(--rb-border-dark)', borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rb-text-secondary)' }}
              onClick={clearBulk}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
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
        {onImportPdf && (
          <input
            ref={importPdfFileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              await onImportPdf(file);
            }}
          />
        )}

      </div>

      <div className="rb-doctors-list">
        {loading && <div className="rb-loading"><span className="rb-spinner" />Загрузка врачей...</div>}
        {!loading && error && <div className="rb-loading" style={{ color: 'var(--rb-danger)' }}>{error}</div>}
        {!loading && !error && displayDoctors.length === 0 && <div className="rb-loading">Нет врачей по фильтру</div>}
        {!loading && !error && displayDoctors.map(d => {
          const specialty = d.professions.map(p =>
            typeof p === 'object' ? (p.title || '') : String(p || '')
          ).filter(Boolean).join(', ');
          const displaySpecialty = specialty || d.roles.join(', ');
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
                <div className="rb-doctor-badges">
                  {d.clinics
                    .filter(cId => !HIDDEN_CLINIC_IDS.includes(String(cId)))
                    .filter(cId => !(disabledClinicsMap[d.id] || []).includes(String(cId)))
                    .filter(cId => String(cId) !== REFERRAL_CLINIC_ID || !d.clinics.some(c => String(c) !== REFERRAL_CLINIC_ID))
                    .slice(0, 6)
                    .map(cId => (
                    <span key={cId} className={`rb-clinic-badge${String(cId) === AUP_CLINIC_ID ? ' rb-aup-badge' : ''}`} style={{ background: getClinicColor(cId), ...(cId === 'ip' ? { width: 'auto', padding: '2px 6px' } : {}) }}>
                      {String(cId) === AUP_CLINIC_ID ? <span className="rb-aup-text">{getClinicName(cId)}</span> : getClinicName(cId)}
                    </span>
                  ))}
                </div>
                <div className="rb-doctor-name">{d.name}</div>
                {displaySpecialty && <div className="rb-doctor-specialty">{displaySpecialty}</div>}
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
