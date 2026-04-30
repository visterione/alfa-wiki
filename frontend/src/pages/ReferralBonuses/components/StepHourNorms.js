import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { hourNorms as hourNormsApi, roleNorms as roleNormsApi, categoryNorms as categoryNormsApi, rbScheduleDicts, mis } from '../../../services/api';
import { rbProfessionTitle } from '../utils/clinicUtils';
import { useTabSlider } from '../utils/useTabSlider';
import StepWorkTime from './StepWorkTime';
import StepSchedule from './StepSchedule';
import ScheduleDivisionPanel from './ScheduleDivisionPanel';
import MonthYearPicker from './MonthYearPicker';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const currentDate = new Date();

export default function StepHourNorms({ doctors = [], clinics = [], getClinicColor, getClinicName, permissions = {} }) {
  const permWorkTime  = permissions.tabWorkTime  ?? 'edit';
  const permHourNorms = permissions.tabHourNorms ?? 'edit';
  const permSchedule  = permissions.tabSchedule  ?? 'edit';

  const getInitialTab = () => {
    if (permWorkTime  !== 'block') return 'work_time';
    if (permHourNorms !== 'block') return 'hour_norms';
    if (permSchedule  !== 'block') return 'schedule';
    return 'work_time';
  };
  const [activeTab, setActiveTab] = useState(getInitialTab); // 'work_time' | 'hour_norms' | 'schedule'
  const { wrapRef, sliderEl } = useTabSlider(activeTab);
  const [mode, setMode] = useState('professions'); // 'professions' | 'roles' | 'categories'

  const [year, setYear]   = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  const [professions, setProfessions] = useState([]);
  const [roles, setRoles]             = useState([]);
  const [categories, setCategories]   = useState([]); // { id, name, color }[]
  const [listLoading, setListLoading] = useState(true);

  const [values, setValues]   = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [periods, setPeriods] = useState([]);

  const [selectedScheduleDoctor, setSelectedScheduleDoctor] = useState(null);
  const [managingDivision,       setManagingDivision]       = useState(null); // { id, name } | null
  const divisionPanelRef = useRef(null);

  const handleSelectDoctor = (id) => {
    setSelectedScheduleDoctor(id);
    if (id) setManagingDivision(null);
  };

  const handleManageAccess = (div) => {
    setManagingDivision(div); // { id, name } or null
    if (div) setSelectedScheduleDoctor(null);
  };

  const handleDivisionRenamed = (id, newName) => {
    setManagingDivision(prev => prev?.id === id ? { ...prev, name: newName } : prev);
    divisionPanelRef.current?.updateName(id, newName);
  };
  const [managingDivisionId, setManagingDivisionId] = useState(null);
  const [scheduleSearch,      setScheduleSearch]      = useState('');
  const [scheduleFilterClinic,setScheduleFilterClinic] = useState('');
  const [scheduleFilterRole,  setScheduleFilterRole]   = useState('');
  const [scheduleFilterProf,  setScheduleFilterProf]   = useState('');

  // Загрузить специальности, роли из МИС и категории расписания
  useEffect(() => {
    Promise.all([
      mis.getDoctors({ show_all: true }),
      rbScheduleDicts.listCategories(),
    ]).then(([misRes, catsRes]) => {
      const data = misRes.data;
      if (data?.error === 0 && Array.isArray(data?.data)) {
        const profTitles = [...new Set(
          data.data.flatMap(d => {
            if (d.profession_titles)
              return String(d.profession_titles).split(',').map(s => s.trim()).filter(Boolean);
            if (Array.isArray(d.professions) && d.professions.length > 0)
              return d.professions.map(p => rbProfessionTitle(p)).filter(Boolean);
            return [];
          })
        )].sort();
        setProfessions(profTitles);

        const roleTitles = [...new Set(
          data.data.flatMap(d => {
            if (d.role_titles)
              return String(d.role_titles).split(',').map(s => s.trim()).filter(Boolean);
            if (Array.isArray(d.role_names) && d.role_names.length > 0)
              return d.role_names;
            if (d.role)
              return [d.role];
            return [];
          }).filter(r => r && r !== 'КабинетыИРабота')
        )].sort();
        setRoles(roleTitles);
      }
      setCategories((catsRes.data || []).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {}).finally(() => setListLoading(false));
  }, []);

  // Загрузить список периодов при смене режима
  useEffect(() => {
    const api = mode === 'professions' ? hourNormsApi : mode === 'roles' ? roleNormsApi : categoryNormsApi;
    api.getPeriods()
      .then(res => setPeriods(res.data || []))
      .catch(() => {});
  }, [mode]);

  // Загрузить нормы при смене периода или режима
  useEffect(() => {
    setLoading(true);
    setValues({});
    if (mode === 'categories') {
      categoryNormsApi.get(year, month)
        .then(res => {
          const map = {};
          (res.data || []).forEach(n => {
            if (n.categoryId) map[n.categoryId] = n.normHours != null ? String(parseFloat(n.normHours)) : '';
          });
          setValues(map);
        })
        .catch(() => toast.error('Не удалось загрузить нормы по категориям'))
        .finally(() => setLoading(false));
      return;
    }
    const api = mode === 'professions' ? hourNormsApi : roleNormsApi;
    const key = mode === 'professions' ? 'professionTitle' : 'roleTitle';
    api.get(year, month)
      .then(res => {
        const map = {};
        (res.data || []).forEach(n => {
          map[n[key]] = n.normHours != null ? String(parseFloat(n.normHours)) : '';
        });
        setValues(map);
      })
      .catch(() => toast.error('Не удалось загрузить нормы часов'))
      .finally(() => setLoading(false));
  }, [year, month, mode]);

  const handleChange = useCallback((title, val) => {
    setValues(prev => ({ ...prev, [title]: val }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'categories') {
        const norms = categories.map(cat => ({
          categoryId: cat.id,
          normHours: values[cat.id] !== '' && values[cat.id] != null
            ? parseFloat(values[cat.id])
            : null
        }));
        await categoryNormsApi.saveBulk(year, month, norms);
        toast.success(`Нормы по категориям за ${MONTH_NAMES[month - 1]} ${year} сохранены`);
        categoryNormsApi.getPeriods().then(res => setPeriods(res.data || [])).catch(() => {});
        return;
      }
      const api  = mode === 'professions' ? hourNormsApi : roleNormsApi;
      const key  = mode === 'professions' ? 'professionTitle' : 'roleTitle';
      const list = mode === 'professions' ? professions : roles;

      const norms = list.map(title => ({
        [key]: title,
        normHours: values[title] !== '' && values[title] != null
          ? parseFloat(values[title])
          : null
      }));
      await api.saveBulk(year, month, norms);
      toast.success(`Нормы за ${MONTH_NAMES[month - 1]} ${year} сохранены`);
      api.getPeriods().then(res => setPeriods(res.data || [])).catch(() => {});
    } catch {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const hasPeriod = periods.some(p => p.year === year && p.month === month);
  const currentList = mode === 'professions' ? professions : mode === 'roles' ? roles : categories;

  const visibleDoctors = doctors.filter(d => !d.roles?.includes('КабинетыИРабота'));

  const allScheduleRoles = [...new Set(visibleDoctors.flatMap(d => d.roles || []))].sort();
  const allScheduleProfs = [...new Set(visibleDoctors.flatMap(d =>
    (d.professions || []).map(p => typeof p === 'object' ? (p.title || '') : String(p || '')).filter(Boolean)
  ))].sort();

  const filteredScheduleDoctors = visibleDoctors.filter(d => {
    if (scheduleSearch && !d.name.toLowerCase().includes(scheduleSearch.toLowerCase())) return false;
    if (scheduleFilterClinic && !d.clinics.includes(String(scheduleFilterClinic))) return false;
    if (scheduleFilterRole && !d.roles?.includes(scheduleFilterRole)) return false;
    if (scheduleFilterProf && !(d.professions || []).some(p => {
      const t = typeof p === 'object' ? (p.title || '') : String(p || '');
      return t === scheduleFilterProf;
    })) return false;
    return true;
  });

  const tabButtons = (
    <>
      {permWorkTime !== 'block' && (
        <button
          className={`rb-clinic-tab${activeTab === 'work_time' ? ' active' : ''}`}
          onClick={() => setActiveTab('work_time')}
        >
          Учёт рабочего времени
        </button>
      )}
      {permHourNorms !== 'block' && (
        <button
          className={`rb-clinic-tab${activeTab === 'hour_norms' ? ' active' : ''}`}
          onClick={() => setActiveTab('hour_norms')}
        >
          Норма часов
        </button>
      )}
      {permSchedule !== 'block' && (
        <button
          className={`rb-clinic-tab${activeTab === 'schedule' ? ' active' : ''}`}
          onClick={() => setActiveTab('schedule')}
        >
          Расписание
        </button>
      )}
    </>
  );

  // ── Расписание: отдельный двухколоночный layout ──────────────────────────────
  if (activeTab === 'schedule') {
    return (
      <>
        <div className="rb-clinic-tab-wrap" ref={wrapRef} style={{ marginBottom: 16 }}>
          {sliderEl}
          {tabButtons}
        </div>

        <div className="rb-layout">
          {/* Левая панель — подразделения */}
          <ScheduleDivisionPanel
            ref={divisionPanelRef}
            doctors={visibleDoctors}
            selectedDoctorId={selectedScheduleDoctor}
            onSelectDoctor={handleSelectDoctor}
            readOnly={permSchedule === 'read'}
            getClinicColor={getClinicColor}
            getClinicName={getClinicName}
            onManageAccess={handleManageAccess}
            managingDivisionId={managingDivision?.id ?? null}
            onDivisionRenamed={handleDivisionRenamed}
          />

          {/* Правая панель — календарь расписания */}
          <StepSchedule
            selectedDoctorId={selectedScheduleDoctor}
            doctors={visibleDoctors}
            clinics={clinics}
            getClinicColor={getClinicColor}
            getClinicName={getClinicName}
            readOnly={permSchedule === 'read'}
            managingDivision={managingDivision}
            onDivisionRenamed={handleDivisionRenamed}
            scheduleCategories={categories}
            allRoles={allScheduleRoles}
            allProfessions={allScheduleProfs}
          />
        </div>
      </>
    );
  }

  // ── Учёт времени и Норма часов: один rb-panel ─────────────────────────────────
  return (
    <div className="rb-panel" style={{ flex: 1 }}>
      <div className="rb-clinic-tab-wrap" ref={wrapRef} style={{ marginBottom: 0, borderBottom: 'none', borderRadius: 'var(--rb-radius) var(--rb-radius) 0 0' }}>
        {sliderEl}
        {tabButtons}
      </div>

      {activeTab === 'work_time' && (
        <StepWorkTime doctors={doctors} readOnly={permWorkTime === 'read'} clinics={clinics} getClinicName={getClinicName} />
      )}

      {activeTab === 'hour_norms' && (<>
      <div className="rb-panel-header">
        <div className="rb-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          Норма часов
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <MonthYearPicker
            year={year} month={month}
            onChange={(y, m) => { setYear(y); setMonth(m); }}
          />
          {hasPeriod && <span style={{ fontSize: 12, color: 'var(--rb-success, #16a34a)', fontWeight: 500 }}>✓</span>}
          <div style={{ display: 'flex', height: 32, background: 'var(--rb-border)', borderRadius: 8, padding: 2, gap: 2, boxSizing: 'border-box' }}>
            {[
              { value: 'professions', label: 'По специальностям' },
              { value: 'roles',       label: 'По ролям' },
              { value: 'categories',  label: 'По категориям' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setMode(opt.value)} style={{ height: '100%', padding: '0 12px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer', background: mode === opt.value ? 'var(--rb-bg)' : 'transparent', color: mode === opt.value ? 'var(--rb-text)' : 'var(--rb-text-secondary)', boxShadow: mode === opt.value ? '0 1px 3px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.15s' }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Таблица */}
      <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
        {(loading || listLoading) ? (
          <div className="rb-loading"><span className="rb-spinner" />Загрузка...</div>
        ) : currentList.length === 0 ? (
          <div className="rb-loading" style={{ color: 'var(--rb-text-secondary)' }}>
            {mode === 'professions' ? 'Нет данных о специальностях' : mode === 'roles' ? 'Нет данных о ролях' : 'Нет категорий расписания'}
          </div>
        ) : mode === 'categories' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            {[0, 1, 2].map(col => {
              const third = Math.ceil(categories.length / 3);
              const slice = categories.slice(col * third, (col + 1) * third);
              return (
                <table key={col} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, borderLeft: col > 0 ? '2px solid var(--rb-border)' : 'none' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                    <tr style={{ borderBottom: '2px solid var(--rb-border)' }}>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                        Категория
                      </th>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--rb-text-secondary)', fontWeight: 600, width: 110 }}>
                        Норма часов
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map(cat => (
                      <tr key={cat.id} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                        <td style={{ padding: '7px 12px 7px 16px', color: 'var(--rb-text)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, flexShrink: 0, display: 'inline-block' }} />
                            {cat.name}
                          </span>
                        </td>
                        <td style={{ padding: '5px 16px 5px 12px', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            disabled={permHourNorms === 'read'}
                            value={values[cat.id] ?? ''}
                            onChange={e => handleChange(cat.id, e.target.value)}
                            placeholder="—"
                            style={{
                              width: 90,
                              textAlign: 'right',
                              padding: '4px 8px',
                              border: '1px solid var(--rb-border)',
                              borderRadius: 6,
                              fontSize: 13,
                              background: permHourNorms === 'read' ? 'var(--rb-bg-secondary)' : 'var(--rb-bg)',
                              color: 'var(--rb-text)',
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            {[0, 1, 2].map(col => {
              const third = Math.ceil(currentList.length / 3);
              const slice = currentList.slice(col * third, (col + 1) * third);
              return (
                <table key={col} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, borderLeft: col > 0 ? '2px solid var(--rb-border)' : 'none' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                    <tr style={{ borderBottom: '2px solid var(--rb-border)' }}>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                        {mode === 'professions' ? 'Специальность' : 'Роль'}
                      </th>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--rb-text-secondary)', fontWeight: 600, width: 110 }}>
                        Норма часов
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map(title => (
                      <tr key={title} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                        <td style={{ padding: '7px 12px 7px 16px', color: 'var(--rb-text)' }}>{title}</td>
                        <td style={{ padding: '5px 16px 5px 12px', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            disabled={permHourNorms === 'read'}
                            value={values[title] ?? ''}
                            onChange={e => handleChange(title, e.target.value)}
                            placeholder="—"
                            style={{
                              width: 90,
                              textAlign: 'right',
                              padding: '4px 8px',
                              border: '1px solid var(--rb-border)',
                              borderRadius: 6,
                              fontSize: 13,
                              background: permHourNorms === 'read' ? 'var(--rb-bg-secondary)' : 'var(--rb-bg)',
                              color: 'var(--rb-text)',
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })}
          </div>
        )}
      </div>

      {permHourNorms !== 'read' && currentList.length > 0 && !loading && !listLoading && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--rb-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="rb-btn rb-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      )}
      </>)}
    </div>
  );
}
