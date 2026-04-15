import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { hourNorms as hourNormsApi, roleNorms as roleNormsApi, mis } from '../../../services/api';
import { rbProfessionTitle } from '../utils/clinicUtils';
import { useTabSlider } from '../utils/useTabSlider';
import StepWorkTime from './StepWorkTime';
import StepSchedule from './StepSchedule';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const currentDate = new Date();

export default function StepHourNorms({ readOnly, doctors = [], clinics = [], getClinicColor, getClinicName }) {
  const [activeTab, setActiveTab] = useState('work_time'); // 'work_time' | 'hour_norms' | 'schedule'
  const { wrapRef, sliderEl } = useTabSlider(activeTab);
  const [mode, setMode] = useState('professions'); // 'professions' | 'roles'

  const [year, setYear]   = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  const [professions, setProfessions] = useState([]);
  const [roles, setRoles]             = useState([]);
  const [listLoading, setListLoading] = useState(true);

  const [values, setValues]   = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [periods, setPeriods] = useState([]);

  const [selectedScheduleDoctor, setSelectedScheduleDoctor] = useState(null);
  const [scheduleSearch,      setScheduleSearch]      = useState('');
  const [scheduleFilterClinic,setScheduleFilterClinic] = useState('');
  const [scheduleFilterRole,  setScheduleFilterRole]   = useState('');
  const [scheduleFilterProf,  setScheduleFilterProf]   = useState('');

  // Загрузить специальности и роли из МИС
  useEffect(() => {
    mis.getDoctors({ show_all: true })
      .then(res => {
        const data = res.data;
        if (data?.error !== 0 || !Array.isArray(data?.data)) return;

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
      })
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, []);

  // Загрузить список периодов при смене режима
  useEffect(() => {
    const api = mode === 'professions' ? hourNormsApi : roleNormsApi;
    api.getPeriods()
      .then(res => setPeriods(res.data || []))
      .catch(() => {});
  }, [mode]);

  // Загрузить нормы при смене периода или режима
  useEffect(() => {
    setLoading(true);
    setValues({});
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
  const currentList = mode === 'professions' ? professions : roles;

  const years = [];
  for (let y = currentDate.getFullYear() + 1; y >= 2024; y--) years.push(y);

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
      <button
        className={`rb-clinic-tab${activeTab === 'work_time' ? ' active' : ''}`}
        onClick={() => setActiveTab('work_time')}
      >
        Учёт рабочего времени
      </button>
      <button
        className={`rb-clinic-tab${activeTab === 'hour_norms' ? ' active' : ''}`}
        onClick={() => setActiveTab('hour_norms')}
      >
        Норма часов
      </button>
      <button
        className={`rb-clinic-tab${activeTab === 'schedule' ? ' active' : ''}`}
        onClick={() => setActiveTab('schedule')}
      >
        Расписание
      </button>
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
          {/* Левая панель — список сотрудников */}
          <div className="rb-panel">
            <div className="rb-panel-header">
              <div className="rb-panel-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Сотрудники
              </div>
              <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
                {filteredScheduleDoctors.length} из {visibleDoctors.length}
              </span>
            </div>

            <div className="rb-filters">
              <input
                className="rb-search-input"
                placeholder="Поиск по ФИО..."
                value={scheduleSearch}
                onChange={e => setScheduleSearch(e.target.value)}
              />
              <select className="rb-select" value={scheduleFilterClinic} onChange={e => setScheduleFilterClinic(e.target.value)}>
                <option value="">Все медцентры</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="rb-select" value={scheduleFilterRole} onChange={e => setScheduleFilterRole(e.target.value)}>
                <option value="">Все должности</option>
                {allScheduleRoles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select className="rb-select" value={scheduleFilterProf} onChange={e => setScheduleFilterProf(e.target.value)}>
                <option value="">Все специальности</option>
                {allScheduleProfs.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="rb-doctors-list">
              {filteredScheduleDoctors.length === 0 ? (
                <div className="rb-loading">Нет врачей по фильтру</div>
              ) : (
                filteredScheduleDoctors.map(d => {
                  const specialty = (d.professions || [])
                    .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
                    .filter(Boolean).join(', ');
                  return (
                    <div
                      key={d.id}
                      className={`rb-doctor-item${selectedScheduleDoctor === d.id ? ' active' : ''}`}
                      onClick={() => setSelectedScheduleDoctor(d.id === selectedScheduleDoctor ? null : d.id)}
                    >
                      <div className="rb-doctor-info">
                        <div className="rb-doctor-name">{d.name}</div>
                        {specialty && <div className="rb-doctor-specialty">{specialty}</div>}
                        <div className="rb-doctor-badges">
                          {(d.clinics || []).slice(0, 4).map(cId => (
                            <span key={cId} className="rb-clinic-badge" style={{ background: getClinicColor ? getClinicColor(cId) : '#94a3b8' }}>
                              {getClinicName ? getClinicName(cId) : cId}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Правая панель — календарь расписания */}
          <StepSchedule
            selectedDoctorId={selectedScheduleDoctor}
            doctors={visibleDoctors}
            clinics={clinics}
            getClinicColor={getClinicColor}
            getClinicName={getClinicName}
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
        <StepWorkTime doctors={doctors} readOnly={readOnly} clinics={clinics} getClinicName={getClinicName} />
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
          <select className="rb-select" style={{ width: 130, height: 32, padding: '0 10px' }} value={month} onChange={e => setMonth(parseInt(e.target.value))}>
            {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
          </select>
          <select className="rb-select" style={{ width: 80, height: 32, padding: '0 10px' }} value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {hasPeriod && <span style={{ fontSize: 12, color: 'var(--rb-success, #16a34a)', fontWeight: 500 }}>✓</span>}
          <div style={{ display: 'flex', height: 32, background: 'var(--rb-border)', borderRadius: 8, padding: 2, gap: 2, boxSizing: 'border-box' }}>
            {[
              { value: 'professions', label: 'По специальностям' },
              { value: 'roles',       label: 'По ролям' },
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
            {mode === 'professions' ? 'Нет данных о специальностях' : 'Нет данных о ролях'}
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
                            disabled={readOnly}
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
                              background: readOnly ? 'var(--rb-bg-secondary)' : 'var(--rb-bg)',
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

      {!readOnly && currentList.length > 0 && !loading && !listLoading && (
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
