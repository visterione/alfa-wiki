import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { roleNorms as roleNormsApi } from '../../../services/api';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const DEFAULT_ROLES = [
  'Врач',
  'Медицинская сестра',
  'Санитар',
  'Фельдшер',
  'Лаборант',
  'Рентгенолаборант',
  'Администратор',
  'Старшая медицинская сестра',
];

const currentDate = new Date();

export default function StepRoleNorms({ readOnly }) {
  const [year, setYear]   = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  // roleTitle -> normHours (string for input)
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [periods, setPeriods] = useState([]);

  useEffect(() => {
    roleNormsApi.getPeriods()
      .then(res => setPeriods(res.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    roleNormsApi.get(year, month)
      .then(res => {
        const map = {};
        (res.data || []).forEach(n => {
          map[n.roleTitle] = n.normHours != null ? String(n.normHours) : '';
        });
        setValues(map);
      })
      .catch(() => toast.error('Не удалось загрузить нормы по ролям'))
      .finally(() => setLoading(false));
  }, [year, month]);

  const handleChange = useCallback((role, val) => {
    setValues(prev => ({ ...prev, [role]: val }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const norms = DEFAULT_ROLES.map(role => ({
        roleTitle: role,
        normHours: values[role] !== '' && values[role] != null
          ? parseFloat(values[role])
          : null
      }));
      await roleNormsApi.saveBulk(year, month, norms);
      toast.success(`Нормы по ролям за ${MONTH_NAMES[month - 1]} ${year} сохранены`);
      roleNormsApi.getPeriods().then(res => setPeriods(res.data || [])).catch(() => {});
    } catch {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const hasPeriod = periods.some(p => p.year === year && p.month === month);

  const years = [];
  for (let y = currentDate.getFullYear() + 1; y >= 2024; y--) years.push(y);

  return (
    <div className="rb-panel" style={{ flex: 1 }}>
      <div className="rb-panel-header">
        <div className="rb-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Норма часов по ролям
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rb-border)', display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc' }}>
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
      </div>

      <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
        {loading ? (
          <div className="rb-loading"><span className="rb-spinner" />Загрузка...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
              <tr style={{ borderBottom: '2px solid var(--rb-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px 8px 16px', color: 'var(--rb-text-secondary)', fontWeight: 600 }}>
                  Роль
                </th>
                <th style={{ textAlign: 'right', padding: '8px 16px 8px 12px', color: 'var(--rb-text-secondary)', fontWeight: 600, width: 150 }}>
                  Норма часов
                </th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_ROLES.map(role => (
                <tr key={role} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                  <td style={{ padding: '7px 12px 7px 16px', color: 'var(--rb-text)' }}>{role}</td>
                  <td style={{ padding: '5px 16px 5px 12px', textAlign: 'right' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      disabled={readOnly}
                      value={values[role] ?? ''}
                      onChange={e => handleChange(role, e.target.value)}
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

      {!readOnly && !loading && (
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
