import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, Users, ChevronDown, ChevronUp, Check, Pencil, Trash2, Plus, Calendar } from 'lucide-react';
import { referralBonusAccess, rbScheduleDicts, rbHolidays as rbHolidaysApi, doctorSchedules, BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ── Color palette: 10 rows × 10 cols, bright → lighter per row ───────────────
// Each row: darkest → dark → classic (col 4-5) → light → lightest
const COLOR_PALETTE = [
  ['#7f1d1d','#991b1b','#b91c1c','#dc2626','#ef4444','#f87171','#fca5a5','#fecaca','#fee2e2','#fef2f2'],
  ['#7c2d12','#9a3412','#c2410c','#ea580c','#f97316','#fb923c','#fdba74','#fed7aa','#ffedd5','#fff7ed'],
  ['#78350f','#92400e','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#fef3c7','#fffbeb'],
  ['#1a2e05','#3f6212','#4d7c0f','#65a30d','#84cc16','#a3e635','#bef264','#d9f99d','#ecfccb','#f7fee7'],
  ['#052e16','#166534','#15803d','#16a34a','#22c55e','#4ade80','#86efac','#bbf7d0','#dcfce7','#f0fdf4'],
  ['#022c22','#115e59','#0f766e','#0d9488','#14b8a6','#2dd4bf','#5eead4','#99f6e4','#ccfbf1','#f0fdfa'],
  ['#172554','#1e40af','#1d4ed8','#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe','#dbeafe','#eff6ff'],
  ['#1e1b4b','#3730a3','#4338ca','#4f46e5','#6366f1','#818cf8','#a5b4fc','#c7d2fe','#e0e7ff','#eef2ff'],
  ['#3b0764','#6b21a8','#7e22ce','#9333ea','#a855f7','#c084fc','#d8b4fe','#e9d5ff','#f3e8ff','#faf5ff'],
  ['#500724','#9d174d','#be185d','#db2777','#ec4899','#f472b6','#f9a8d4','#fbcfe8','#fce7f3','#fdf2f8'],
  ['#000000','#1c1c1e','#3a3a3c','#4b5563','#6b7280','#9ca3af','#d1d5db','#e5e7eb','#f3f4f6','#ffffff'],
];

function ColorPicker({ value, onChange }) {
  const isExact = COLOR_PALETTE.flat().includes(value);

  return (
    <div>
      {/* Swatch grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginBottom: 10 }}>
        {COLOR_PALETTE.map((row, ri) =>
          row.map((c, ci) => {
            const active = value === c;
            return (
              <button
                key={`${ri}-${ci}`}
                type="button"
                title={c}
                onClick={() => onChange(c)}
                style={{
                  width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: c, position: 'relative', padding: 0,
                  outline: active ? `2px solid ${c}` : 'none',
                  outlineOffset: active ? 2 : 0,
                  transform: active ? 'scale(1.2)' : 'scale(1)',
                  transition: 'transform .12s, outline-offset .12s',
                  boxShadow: active ? '0 2px 8px rgba(0,0,0,.22)' : '0 1px 2px rgba(0,0,0,.1)',
                  zIndex: active ? 1 : 0,
                }}
              >
                {active && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" width="12" height="12"
                    style={{ position: 'absolute', inset: 0, margin: 'auto', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.4))' }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Custom color row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7, background: value,
          border: '2px solid rgba(0,0,0,.12)', flexShrink: 0,
          boxShadow: '0 1px 3px rgba(0,0,0,.15)',
        }} />
        <input
          type="text"
          value={value}
          onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value); }}
          style={{
            flex: 1, padding: '5px 9px', border: '1px solid #e2e8f0', borderRadius: 7,
            fontSize: 13, fontFamily: 'monospace', background: 'white', color: '#1e293b',
            outline: 'none', letterSpacing: 1,
          }}
          maxLength={7}
          placeholder="#000000"
        />
        <label style={{ position: 'relative', display: 'flex', alignItems: 'center', cursor: 'pointer' }} title="Произвольный цвет">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#3b82f6'}
            onChange={e => onChange(e.target.value)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          />
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 7, border: '1px solid #e2e8f0',
            background: 'white', cursor: 'pointer',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" width="15" height="15">
              <path d="M12 22a8 8 0 0 1-8-8c0-4.1 6-10 8-12 2 2 8 7.9 8 12a8 8 0 0 1-8 8z"/>
            </svg>
          </span>
        </label>
      </div>
    </div>
  );
}

// ── Access tab constants ───────────────────────────────────────────────────────
const CLINICS = [
  { id: '2',  name: 'Альфа',        color: '#de64a1' },
  { id: '3',  name: 'Кидс',         color: '#ed9121' },
  { id: '1',  name: 'Проф',         color: '#9999ff' },
  { id: '6',  name: 'Линия',        color: '#e2d1bb' },
  { id: '4',  name: '3К',           color: '#800080' },
  { id: '7',  name: 'Смайл',        color: '#999999' },
  { id: '8',  name: 'Направители',  color: '#00bfff' },
  { id: '11', name: 'Сукко',        color: '#2d7055' },
  { id: 'ip', name: 'ИП Микаелян',  color: '#e05252' },
];

const TAB_DEFS = [
  { key: 'tab1',              label: 'Сотрудники' },
  { key: 'tabWorkTime',       label: 'Учёт рабочего времени', group: 'Учёт времени' },
  { key: 'tabHourNorms',      label: 'Норма часов',            group: 'Учёт времени' },
  { key: 'tabSchedule',       label: 'Расписание',             group: 'Учёт времени' },
  { key: 'tab2',              label: 'Услуги' },
  { key: 'tab3',              label: 'Направления' },
  { key: 'tab4',              label: 'Отчёт' },
  { key: 'tabArchiveHistory', label: 'Архив',                  group: 'Архив' },
  { key: 'tabArchiveKassa',   label: 'Касса',                  group: 'Архив' },
  { key: 'tabArchiveTabel',   label: 'Табели',                 group: 'Архив' },
  { key: 'tabArchiveSources', label: 'Источники',              group: 'Архив' },
  { key: 'tabSummary',        label: 'Сводка' },
  { key: 'tabKpi',            label: 'KPI' },
];

const PERM_OPTIONS = [
  { value: 'edit',  label: 'Редактирование', color: '#16a34a' },
  { value: 'read',  label: 'Чтение',         color: '#d97706' },
  { value: 'block', label: 'Заблокировать',  color: '#dc2626' },
];
const PERM_DOT_COLOR = { edit: '#16a34a', read: '#d97706', block: '#dc2626' };

function ClinicToggle({ checked, color }) {
  return (
    <div style={{
      width: 42, height: 24, borderRadius: 12,
      background: checked ? color : '#d1d5db',
      cursor: 'pointer', position: 'relative',
      transition: 'background 0.22s', flexShrink: 0,
      boxShadow: checked ? `0 0 0 2px ${color}44` : 'inset 0 1px 2px rgba(0,0,0,0.08)',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 18, height: 18, borderRadius: '50%', background: 'white',
        boxShadow: '0 1px 4px rgba(0,0,0,0.28)', transition: 'left 0.22s',
      }} />
    </div>
  );
}

function PermSummary({ perm }) {
  const clinics = (perm.clinics || []).map(id => CLINICS.find(c => c.id === id)).filter(Boolean);
  const restricted = TAB_DEFS.filter(t => perm[t.key] && perm[t.key] !== 'edit');
  if (!clinics.length && !restricted.length) return <span>Полный доступ</span>;
  const parts = [
    ...clinics.map((c, i) => <span key={`cl-${i}`} style={{ color: c.color }}>{c.name}</span>),
    ...restricted.map(t => <span key={t.key} style={{ color: PERM_DOT_COLOR[perm[t.key]] }}>{t.label}</span>),
  ];
  return (
    <>
      {parts.map((el, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: '#cbd5e1', margin: '0 4px' }}>|</span>}
          {el}
        </React.Fragment>
      ))}
    </>
  );
}

function UserRow({ user, onSaved }) {
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState({
    tabWorkTime: 'edit', tabSchedule: 'edit',
    tabArchiveHistory: 'edit', tabArchiveKassa: 'edit', tabArchiveTabel: 'edit',
    tabKpi: 'edit',
    ...user.perm,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setTab = (key, val) => setPerm(p => ({ ...p, [key]: val }));
  const toggleClinic = (clinicId) => setPerm(p => {
    const clinics = p.clinics || [];
    return { ...p, clinics: clinics.includes(clinicId) ? clinics.filter(c => c !== clinicId) : [...clinics, clinicId] };
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await referralBonusAccess.saveUserPerm(user.id, perm);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      onSaved(user.id, perm);
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: open ? '#f8fafc' : 'white', userSelect: 'none' }}>
        {user.avatar
          ? <img src={user.avatar.startsWith('http') ? user.avatar : `${BASE_URL}/${user.avatar}`} alt={user.displayName} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', flexShrink: 0 }}><User size={18} /></div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{user.displayName || user.username}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <PermSummary perm={perm} />
          </div>
        </div>
        {open ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
      </div>

      {open && (
        <div style={{ padding: '16px 20px 20px', background: '#fafafa', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Медцентры</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {CLINICS.map(c => {
                const checked = (perm.clinics || []).includes(c.id);
                return (
                  <div key={c.id} onClick={() => toggleClinic(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: `1px solid ${checked ? c.color : '#e2e8f0'}`, borderRadius: 20, cursor: 'pointer', background: checked ? `${c.color}12` : 'white', transition: 'all 0.15s', userSelect: 'none' }}>
                    <ClinicToggle checked={checked} color={c.color} />
                    <span style={{ fontSize: 12, fontWeight: checked ? 600 : 500, color: checked ? '#1e293b' : '#64748b', fontFamily: FONT }}>{c.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const rows = [];
              TAB_DEFS.forEach((tab, idx) => {
                const isGroupStart = tab.group && (idx === 0 || TAB_DEFS[idx - 1]?.group !== tab.group);
                if (isGroupStart) rows.push(<div key={`group-${tab.group}`} style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: -2 }}>{tab.group}</div>);
                rows.push(
                  <div key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 220, fontSize: tab.group ? 11 : 13, color: tab.group ? '#94a3b8' : '#475569' }}>{tab.label}</div>
                    <div style={{ display: 'flex', border: '1px solid #94a3b8', borderRadius: 7, overflow: 'hidden' }}>
                      {PERM_OPTIONS.map(opt => {
                        const active = perm[tab.key] === opt.value;
                        return (
                          <button key={opt.value} onClick={() => setTab(tab.key, opt.value)} style={{ flex: 1, width: 105, padding: '5px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, background: active ? opt.color : 'white', color: active ? 'white' : '#64748b', transition: 'all 0.15s' }}>{opt.label}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
              return rows;
            })()}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px dashed #e2e8f0' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '7px 16px', background: '#007AFF', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            {saved && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#16a34a', fontWeight: 500 }}><Check size={13} /> Сохранено</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dictionaries tab ──────────────────────────────────────────────────────────
const inputStyle = {
  padding: '7px 11px', border: '1px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, background: 'white', color: '#1e293b', outline: 'none', fontFamily: FONT,
};
const btnPrimary = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 18px', background: '#007AFF', color: 'white',
  border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: FONT, transition: 'opacity .15s',
};
const btnSecondary = {
  padding: '7px 14px', background: 'white', color: '#64748b',
  border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12,
  cursor: 'pointer', fontFamily: FONT,
};

// ── Holidays Tab ──────────────────────────────────────────────────────────────
const MONTH_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAY_RU   = ['вс','пн','вт','ср','чт','пт','сб'];

function HolidaysTab() {
  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    rbHolidaysApi.list()
      .then(r => setList(r.data))
      .catch(() => toast.error('Ошибка загрузки праздников'))
      .finally(() => setLoading(false));
  }, []);

  const add = async () => {
    if (!newDate) return;
    setSaving(true);
    try {
      const { data } = await rbHolidaysApi.create({ date: newDate, name: newName.trim() || null });
      setList(p => [...p, data].sort((a, b) => a.date.localeCompare(b.date)));
      setNewDate(''); setNewName('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id, date) => {
    if (!window.confirm(`Удалить праздник ${date}?`)) return;
    try {
      await rbHolidaysApi.delete(id);
      setList(p => p.filter(h => h.id !== id));
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  // Group by year
  const byYear = {};
  list.forEach(h => {
    const y = h.date.slice(0, 4);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(h);
  });

  const formatDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = DAY_U(new Date(y, m - 1, d));
    return `${String(d).padStart(2,'0')} ${MONTH_RU[m-1]} ${y} (${dow})`;
  };
  function DAY_U(dt) { return DAY_RU[dt.getDay()]; }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
      {/* Add form */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Plus size={14} color="#007AFF" /> Добавить праздник
          </span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Дата</div>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Название (необязательно)</div>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Например: Новый год"
              onKeyDown={e => e.key === 'Enter' && !saving && newDate && add()}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <button
            onClick={add} disabled={!newDate || saving}
            style={{ ...btnPrimary, opacity: (!newDate || saving) ? 0.45 : 1, cursor: (!newDate || saving) ? 'not-allowed' : 'pointer' }}
          >
            Добавить
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
            Праздничные дни
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{list.length}</span>
          </span>
        </div>
        {loading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Загрузка...</div>
        ) : list.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Праздники не добавлены</div>
        ) : (
          <div>
            {Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([year, items]) => (
              <div key={year}>
                <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {year} · {items.length} дн.
                </div>
                {items.map((h, i) => (
                  <div key={h.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < items.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}
                  >
                    <Calendar size={14} color="#ef4444" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{formatDate(h.date)}</div>
                      {h.name && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{h.name}</div>}
                    </div>
                    <button
                      onClick={() => del(h.id, h.date)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#94a3b8', display: 'flex', transition: 'color .15s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                      onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                      title="Удалить"
                    ><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DictsTab() {
  const [subtab,  setSubtab]  = useState('categories');
  const [catList, setCatList] = useState([]);
  const [cabList, setCabList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Category form
  const [newCatName,   setNewCatName]   = useState('');
  const [newCatColor,  setNewCatColor]  = useState('#3b82f6');
  const [editCatId,    setEditCatId]    = useState(null);
  const [editCatName,  setEditCatName]  = useState('');
  const [editCatColor, setEditCatColor] = useState('');
  const [editMisId,    setEditMisId]    = useState(''); // MIS category_id for the category being edited
  const [catMisMap,    setCatMisMap]    = useState({}); // { [rbCategoryId]: misCategoryId }
  const [catSaving,    setCatSaving]    = useState(false);

  // Cabinet form
  const [newCabName,    setNewCabName]    = useState('');
  const [newCabClinic,  setNewCabClinic]  = useState(CLINICS[0]?.id || '');
  const [editCabId,     setEditCabId]     = useState(null);
  const [editCabName,   setEditCabName]   = useState('');
  const [editCabClinic, setEditCabClinic] = useState('');
  const [cabSaving,     setCabSaving]     = useState(false);
  const [openClinics,   setOpenClinics]   = useState(new Set());

  useEffect(() => {
    Promise.all([
      rbScheduleDicts.listCategories(),
      rbScheduleDicts.listCabinets(),
      doctorSchedules.getMisCategoryMap().catch(() => ({ data: [] })),
    ])
      .then(([cats, cabs, misMap]) => {
        setCatList(cats.data);
        setCabList(cabs.data);
        const map = {};
        for (const row of misMap.data) {
          if (row.rbCategoryId) map[row.rbCategoryId] = row.misCategoryId;
        }
        setCatMisMap(map);
      })
      .catch(() => toast.error('Ошибка загрузки справочников'))
      .finally(() => setLoading(false));
  }, []);

  const clinicName  = id => CLINICS.find(c => c.id === String(id))?.name  || id;
  const clinicColor = id => CLINICS.find(c => c.id === String(id))?.color || '#94a3b8';

  // ── Category CRUD ──
  const addCat = async () => {
    if (!newCatName.trim()) return;
    setCatSaving(true);
    try {
      const { data } = await rbScheduleDicts.createCategory({ name: newCatName.trim(), color: newCatColor });
      setCatList(p => [...p, data]);
      setNewCatName(''); setNewCatColor('#3b82f6');
      toast.success('Категория добавлена');
    } catch { toast.error('Ошибка'); } finally { setCatSaving(false); }
  };
  const saveCat = async id => {
    if (!editCatName.trim()) return;
    setCatSaving(true);
    try {
      const [{ data }] = await Promise.all([
        rbScheduleDicts.updateCategory(id, { name: editCatName.trim(), color: editCatColor }),
        doctorSchedules.setMisCategoryMapForRb(id, editMisId ? parseInt(editMisId, 10) : null),
      ]);
      setCatList(p => p.map(c => c.id === id ? data : c));
      setCatMisMap(prev => {
        const next = { ...prev };
        if (editMisId) next[id] = parseInt(editMisId, 10);
        else delete next[id];
        return next;
      });
      setEditCatId(null);
      toast.success('Сохранено');
    } catch { toast.error('Ошибка'); } finally { setCatSaving(false); }
  };
  const delCat = async (id, name) => {
    if (!window.confirm(`Удалить категорию «${name}»?`)) return;
    try {
      await rbScheduleDicts.deleteCategory(id);
      setCatList(p => p.filter(c => c.id !== id)); toast.success('Удалено');
    } catch { toast.error('Ошибка'); }
  };

  // ── Cabinet CRUD ──
  const addCab = async () => {
    if (!newCabName.trim()) return;
    setCabSaving(true);
    try {
      const { data } = await rbScheduleDicts.createCabinet({ name: newCabName.trim(), clinicId: newCabClinic });
      setCabList(p => [...p, data].sort((a, b) => a.clinicId.localeCompare(b.clinicId) || a.name.localeCompare(b.name)));
      setNewCabName(''); toast.success('Кабинет добавлен');
    } catch { toast.error('Ошибка'); } finally { setCabSaving(false); }
  };
  const saveCab = async id => {
    if (!editCabName.trim()) return;
    setCabSaving(true);
    try {
      const { data } = await rbScheduleDicts.updateCabinet(id, { name: editCabName.trim(), clinicId: editCabClinic });
      setCabList(p => p.map(c => c.id === id ? data : c));
      setEditCabId(null); toast.success('Сохранено');
    } catch { toast.error('Ошибка'); } finally { setCabSaving(false); }
  };
  const delCab = async (id, name) => {
    if (!window.confirm(`Удалить кабинет «${name}»?`)) return;
    try {
      await rbScheduleDicts.deleteCabinet(id);
      setCabList(p => p.filter(c => c.id !== id)); toast.success('Удалено');
    } catch { toast.error('Ошибка'); }
  };

  if (loading) return <div className="admin-loading"><div className="loading-spinner" /></div>;

  return (
    <div>
      {/* Sub-tab bar — rb-clinic-tab-wrap style */}
      <div style={{
        position: 'relative', display: 'flex', gap: 4,
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '6px 8px', marginBottom: 24,
      }}>
        {[['categories','Категории расписания'],['cabinets','Кабинеты']].map(([key, label]) => {
          const active = subtab === key;
          return (
            <button key={key} onClick={() => setSubtab(key)} style={{
              flex: 1, padding: '7px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: FONT,
              background: active ? '#007AFF' : 'transparent',
              color: active ? 'white' : '#64748b',
              transition: 'all .2s',
            }}>{label}</button>
          );
        })}
      </div>

      {/* ── Categories ── */}
      {subtab === 'categories' && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>

          {/* Add form — left column */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Plus size={14} color="#007AFF" /> Новая категория
              </span>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Название</div>
                <input
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="Например: Приём, Консультация..."
                  onKeyDown={e => e.key === 'Enter' && !catSaving && addCat()}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>Цвет метки</div>
                <ColorPicker value={newCatColor} onChange={setNewCatColor} />
              </div>
              <button
                onClick={addCat} disabled={!newCatName.trim() || catSaving}
                style={{ ...btnPrimary, opacity: (!newCatName.trim() || catSaving) ? 0.45 : 1, cursor: (!newCatName.trim() || catSaving) ? 'not-allowed' : 'pointer' }}
              >
                Добавить
              </button>
            </div>
          </div>

          {/* List — right column */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Все категории
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{catList.length}</span>
              </span>
            </div>

            {catList.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Нет категорий</div>
            ) : (
              <div>
                {catList.map((cat, i) => (
                  <div key={cat.id} style={{ borderBottom: i < catList.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    {editCatId === cat.id ? (
                      <div style={{ padding: '14px 16px', background: '#f0f7ff', borderLeft: `3px solid #007AFF` }}>
                        <div style={{ marginBottom: 12 }}>
                          <input
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', border: '1.5px solid #007AFF' }}
                            value={editCatName}
                            onChange={e => setEditCatName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveCat(cat.id); if (e.key === 'Escape') setEditCatId(null); }}
                            autoFocus
                          />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                          <ColorPicker value={editCatColor} onChange={setEditCatColor} />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>ID категории в МИС</div>
                          <input
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                            value={editMisId}
                            onChange={e => setEditMisId(e.target.value.replace(/[^0-9]/g, ''))}
                            placeholder="Не задан"
                            inputMode="numeric"
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => saveCat(cat.id)} disabled={catSaving} style={{ ...btnPrimary, padding: '6px 16px', fontSize: 12 }}>Сохранить</button>
                          <button onClick={() => setEditCatId(null)} style={btnSecondary}>Отмена</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                      >
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: cat.color, flexShrink: 0, boxShadow: `0 0 0 3px ${cat.color}30` }} />
                        <span style={{ flex: 1, fontSize: 14, color: '#1e293b', fontWeight: 500 }}>{cat.name}</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{cat.color}</span>
                        {catMisMap[cat.id] != null && (
                          <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            МИС: {catMisMap[cat.id]}
                          </span>
                        )}
                        <button
                          onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name); setEditCatColor(cat.color); setEditMisId(catMisMap[cat.id] != null ? String(catMisMap[cat.id]) : ''); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#94a3b8', display: 'flex', transition: 'color .15s' }}
                          onMouseEnter={e => e.currentTarget.style.color = '#007AFF'}
                          onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                          title="Редактировать"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => delCat(cat.id, cat.name)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#94a3b8', display: 'flex', transition: 'color .15s' }}
                          onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                          onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                          title="Удалить"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cabinets ── */}
      {subtab === 'cabinets' && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>

          {/* Add form — left column */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Plus size={14} color="#007AFF" /> Новый кабинет
              </span>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Медцентр</div>
                <select value={newCabClinic} onChange={e => setNewCabClinic(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}>
                  {CLINICS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Название</div>
                <input
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  value={newCabName}
                  onChange={e => setNewCabName(e.target.value)}
                  placeholder=""
                  onKeyDown={e => e.key === 'Enter' && !cabSaving && addCab()}
                />
              </div>
              <button
                onClick={addCab} disabled={!newCabName.trim() || cabSaving}
                style={{ ...btnPrimary, opacity: (!newCabName.trim() || cabSaving) ? 0.45 : 1, cursor: (!newCabName.trim() || cabSaving) ? 'not-allowed' : 'pointer' }}
              >
                Добавить
              </button>
            </div>
          </div>

          {/* Accordion list — all clinics, right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CLINICS.map(cl => {
              const clCabs = cabList.filter(c => c.clinicId === cl.id);
              const isOpen = openClinics.has(cl.id);
              const toggle = () => setOpenClinics(prev => {
                const next = new Set(prev);
                next.has(cl.id) ? next.delete(cl.id) : next.add(cl.id);
                return next;
              });
              return (
                <div key={cl.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Accordion header */}
                  <button
                    onClick={toggle}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer',
                      borderLeft: `3px solid ${cl.color}`, fontFamily: FONT,
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: cl.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1e293b', textAlign: 'left' }}>{cl.name}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: 'white', background: clCabs.length ? cl.color : '#cbd5e1',
                      borderRadius: 20, padding: '1px 8px', minWidth: 20, textAlign: 'center',
                    }}>{clCabs.length}</span>
                    <ChevronDown size={15} color="#94a3b8" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />
                  </button>

                  {/* Accordion body */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid #f1f5f9' }}>
                      {clCabs.length === 0 ? (
                        <div style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>Нет кабинетов</div>
                      ) : (
                        clCabs.map((cab, i, arr) => (
                          <div key={cab.id} style={{ borderBottom: i < arr.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                            {editCabId === cab.id ? (
                              <div style={{ padding: '12px 14px', background: '#f0f7ff' }}>
                                <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                                  <select value={editCabClinic} onChange={e => setEditCabClinic(e.target.value)} style={{ ...inputStyle, flex: '0 0 auto' }}>
                                    {CLINICS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                  <input
                                    style={{ ...inputStyle, flex: 1, minWidth: 120, border: '1.5px solid #007AFF' }}
                                    value={editCabName}
                                    onChange={e => setEditCabName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveCab(cab.id); if (e.key === 'Escape') setEditCabId(null); }}
                                    autoFocus
                                  />
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button onClick={() => saveCab(cab.id)} disabled={cabSaving} style={{ ...btnPrimary, padding: '6px 16px', fontSize: 12 }}>Сохранить</button>
                                  <button onClick={() => setEditCabId(null)} style={btnSecondary}>Отмена</button>
                                </div>
                              </div>
                            ) : (
                              <div
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                onMouseLeave={e => e.currentTarget.style.background = 'white'}
                              >
                                <span style={{ flex: 1, fontSize: 14, color: '#1e293b', fontWeight: 500 }}>{cab.name}</span>
                                <button
                                  onClick={() => { setEditCabId(cab.id); setEditCabName(cab.name); setEditCabClinic(cab.clinicId); }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#94a3b8', display: 'flex', transition: 'color .15s' }}
                                  onMouseEnter={e => e.currentTarget.style.color = '#007AFF'}
                                  onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                                  title="Редактировать"
                                ><Pencil size={14} /></button>
                                <button
                                  onClick={() => delCab(cab.id, cab.name)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#94a3b8', display: 'flex', transition: 'color .15s' }}
                                  onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                                  onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                                  title="Удалить"
                                ><Trash2 size={14} /></button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminRbAccess() {
  const [activeTab, setActiveTab] = useState('access');
  const [users,  setUsers]  = useState([]);
  const [loading,setLoading]= useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    referralBonusAccess.getUsers()
      .then(({ data }) => setUsers(data))
      .catch(() => toast.error('Ошибка загрузки пользователей'))
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = useCallback((userId, newPerm) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, perm: newPerm } : u));
  }, []);

  const filtered = users.filter(u =>
    (u.displayName || u.username || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="admin-page" style={{ padding: 24 }}>
      <div className="admin-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={26} />
          Финансы: заработная плата
        </h1>
      </div>

      {/* Page-level tab bar — pill style matching rb-wizard-nav aesthetic */}
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 4,
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '8px 10px', marginBottom: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
      }}>
        {[
          { key: 'access',   label: 'Доступы пользователей',  icon: <Users size={14} /> },
          { key: 'dicts',    label: 'Справочники расписания', icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          )},
          { key: 'holidays', label: 'Праздничные дни', icon: <Calendar size={14} /> },
        ].map(({ key, label, icon }) => {
          const active = activeTab === key;
          return (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: FONT,
              background: active ? '#007AFF' : 'transparent',
              color: active ? 'white' : '#64748b',
              transition: 'all .2s',
              userSelect: 'none',
            }}>
              {icon}{label}
            </button>
          );
        })}
      </div>

      {/* ── Access tab ── */}
      {activeTab === 'access' && (
        <>
          <div className="admin-toolbar">
            <div className="search-box" style={{ width: 280 }}>
              <Users size={16} />
              <input placeholder="Поиск по имени..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <span style={{ fontSize: 13, color: '#64748b' }}>{filtered.length} пользователей</span>
          </div>
          {loading
            ? <div className="admin-loading"><div className="loading-spinner" /></div>
            : filtered.length === 0
              ? <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Нет пользователей</div>
              : filtered.map(u => <UserRow key={u.id} user={u} onSaved={handleSaved} />)
          }
        </>
      )}

      {/* ── Dicts tab ── */}
      {activeTab === 'dicts' && <DictsTab />}

      {/* ── Holidays tab ── */}
      {activeTab === 'holidays' && <HolidaysTab />}
    </div>
  );
}
