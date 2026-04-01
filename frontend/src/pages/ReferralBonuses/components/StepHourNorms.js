import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { hourNorms as hourNormsApi, roleNorms as roleNormsApi, mis } from '../../../services/api';
import { rbProfessionTitle } from '../utils/clinicUtils';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const currentDate = new Date();

export default function StepHourNorms({ readOnly }) {
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
          map[n[key]] = n.normHours != null ? String(n.normHours) : '';
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

  return (
    <div className="rb-panel" style={{ flex: 1 }}>
      <div className="rb-panel-header">
        <div className="rb-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          Норма часов
        </div>
      </div>

      {/* Период + переключатель режима */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--rb-text-secondary)', minWidth: 60 }}>Период:</label>
        <select
          className="rb-select"
          style={{ width: 140 }}
          value={month}
          onChange={e => setMonth(parseInt(e.target.value))}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={i + 1} value={i + 1}>{name}</option>
          ))}
        </select>
        <select
          className="rb-select"
          style={{ width: 90 }}
          value={year}
          onChange={e => setYear(parseInt(e.target.value))}
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {hasPeriod && (
          <span style={{ fontSize: 12, color: 'var(--rb-success, #16a34a)', fontWeight: 500 }}>
            ✓ есть данные
          </span>
        )}

        {/* Переключатель */}
        <div style={{ marginLeft: 'auto', display: 'flex', background: 'var(--rb-border)', borderRadius: 8, padding: 2, gap: 2 }}>
          {[
            { value: 'professions', label: 'По специальностям' },
            { value: 'roles',       label: 'По ролям' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                background: mode === opt.value ? 'var(--rb-bg)' : 'transparent',
                color: mode === opt.value ? 'var(--rb-text)' : 'var(--rb-text-secondary)',
                boxShadow: mode === opt.value ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
              <tr style={{ borderBottom: '2px solid var(--rb-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px 8px 16px', color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                  {mode === 'professions' ? 'Специальность' : 'Роль'}
                </th>
                <th style={{ textAlign: 'right', padding: '8px 16px 8px 12px', color: 'var(--rb-text-secondary)', fontWeight: 600, width: 150 }}>
                  Норма часов
                </th>
              </tr>
            </thead>
            <tbody>
              {currentList.map(title => (
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
        )}
      </div>

      {!readOnly && currentList.length > 0 && !loading && !listLoading && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--rb-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="rb-btn rb-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Сохранение...' : `Сохранить за ${MONTH_NAMES[month - 1]} ${year}`}
          </button>
        </div>
      )}
    </div>
  );
}
