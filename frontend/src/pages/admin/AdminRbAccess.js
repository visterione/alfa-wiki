import React, { useState, useEffect, useCallback } from 'react';
import { User, Users, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { referralBonusAccess, BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function ClinicToggle({ checked, color }) {
  return (
    <div
      style={{
        width: 42, height: 24, borderRadius: 12,
        background: checked ? color : '#d1d5db',
        cursor: 'pointer', position: 'relative',
        transition: 'background 0.22s ease',
        flexShrink: 0, boxShadow: checked ? `0 0 0 2px ${color}44` : 'inset 0 1px 2px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{
        position: 'absolute', top: 3,
        left: checked ? 21 : 3,
        width: 18, height: 18, borderRadius: '50%',
        background: 'white',
        boxShadow: '0 1px 4px rgba(0,0,0,0.28)',
        transition: 'left 0.22s ease',
      }} />
    </div>
  );
}

const CLINICS = [
  { id: '2', name: 'Альфа',      color: '#de64a1' },
  { id: '3', name: 'Кидс',       color: '#ed9121' },
  { id: '1', name: 'Проф',       color: '#9999ff' },
  { id: '6', name: 'Линия',      color: '#e2d1bb' },
  { id: '4', name: '3К',         color: '#800080' },
  { id: '7', name: 'Смайл',      color: '#999999' },
  { id: '8', name: 'Направители',color: '#00bfff' },
];

const TAB_DEFS = [
  { key: 'tab1',               label: 'Сотрудники' },
  { key: 'tabWorkTime',        label: 'Учёт рабочего времени', group: 'Учёт времени' },
  { key: 'tabHourNorms',       label: 'Норма часов',            group: 'Учёт времени' },
  { key: 'tabSchedule',        label: 'Расписание',             group: 'Учёт времени' },
  { key: 'tab2',               label: 'Услуги' },
  { key: 'tab3',               label: 'Направления' },
  { key: 'tab4',               label: 'Отчёт' },
  { key: 'tabArchiveHistory',  label: 'Архив',                  group: 'Архив' },
  { key: 'tabArchiveKassa',    label: 'Касса',                  group: 'Архив' },
  { key: 'tabArchiveTabel',    label: 'Табели',                 group: 'Архив' },
  { key: 'tabSummary',         label: 'Сводка' },
];

const SUMMARY_TAB_DEFS = TAB_DEFS;

const PERM_OPTIONS = [
  { value: 'edit',  label: 'Редактирование', color: '#16a34a' },
  { value: 'read',  label: 'Чтение',         color: '#d97706' },
  { value: 'block', label: 'Заблокировать',  color: '#dc2626' },
];

const PERM_DOT_COLOR = { edit: '#16a34a', read: '#d97706', block: '#dc2626' };


function PermSummary({ perm }) {
  const clinics = (perm.clinics || [])
    .map(id => CLINICS.find(c => c.id === id))
    .filter(Boolean);

  const restricted = SUMMARY_TAB_DEFS.filter(t => perm[t.key] && perm[t.key] !== 'edit');

  if (!clinics.length && !restricted.length) {
    return <span>Полный доступ</span>;
  }

  const parts = [
    ...clinics.map((c, i) => <span key={`cl-${i}`} style={{ color: c.color }}>{c.name}</span>),
    ...restricted.map(t => (
      <span key={t.key} style={{ color: PERM_DOT_COLOR[perm[t.key]] || '#94a3b8' }}>
        {t.label}
      </span>
    )),
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
    ...user.perm,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setTab = (key, val) => setPerm(p => ({ ...p, [key]: val }));

  const toggleClinic = (clinicId) => {
    setPerm(p => {
      const clinics = p.clinics || [];
      return {
        ...p,
        clinics: clinics.includes(clinicId)
          ? clinics.filter(c => c !== clinicId)
          : [...clinics, clinicId],
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await referralBonusAccess.saveUserPerm(user.id, perm);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved(user.id, perm);
    } catch (e) {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
      {/* Header row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: open ? '#f8fafc' : 'white', userSelect: 'none' }}
      >
        {user.avatar ? (
          <img src={user.avatar.startsWith('http') ? user.avatar : `${BASE_URL}/${user.avatar}`} alt={user.displayName} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', flexShrink: 0 }}>
            <User size={18} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{user.displayName || user.username}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0 }}>
            <PermSummary perm={perm} />
          </div>
        </div>
        {open ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: '16px 20px 20px', background: '#fafafa', borderTop: '1px solid #e2e8f0' }}>
          {/* Clinics */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
              Медцентры
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {CLINICS.map(c => {
                const checked = (perm.clinics || []).includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggleClinic(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 12px',
                      border: `1px solid ${checked ? c.color : '#e2e8f0'}`,
                      borderRadius: 20, cursor: 'pointer',
                      background: checked ? `${c.color}12` : 'white',
                      transition: 'all 0.15s',
                      userSelect: 'none',
                    }}
                  >
                    <ClinicToggle checked={checked} color={c.color} />
                    <span style={{ fontSize: 12, fontWeight: checked ? 600 : 500, color: checked ? '#1e293b' : '#64748b', fontFamily: FONT }}>
                      {c.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tab permissions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const rows = [];
              TAB_DEFS.forEach((tab, idx) => {
                const isGroupStart = tab.group && (idx === 0 || TAB_DEFS[idx - 1]?.group !== tab.group);
                if (isGroupStart) {
                  rows.push(
                    <div key={`group-${tab.group}`} style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: -2 }}>
                      {tab.group}
                    </div>
                  );
                }
                rows.push(
                  <div key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 220, fontSize: tab.group ? 11 : 13, color: tab.group ? '#94a3b8' : '#475569' }}>{tab.label}</div>
                    <div style={{ display: 'flex', border: '1px solid #94a3b8', borderRadius: 7, overflow: 'hidden' }}>
                      {PERM_OPTIONS.map(opt => {
                        const active = perm[tab.key] === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setTab(tab.key, opt.value)}
                            style={{
                              flex: 1, width: 105, padding: '5px 0', textAlign: 'center',
                              fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                              fontFamily: FONT,
                              background: active ? opt.color : 'white',
                              color: active ? 'white' : '#64748b',
                              transition: 'all 0.15s',
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
              return rows;
            })()}
          </div>

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px dashed #e2e8f0' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            {saved && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#16a34a', fontWeight: 500 }}>
                <Check size={13} /> Сохранено
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminRbAccess() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
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

      <div className="admin-toolbar">
        <div className="search-box" style={{ width: 280 }}>
          <Users size={16} />
          <input
            placeholder="Поиск по имени..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span style={{ fontSize: 13, color: '#64748b' }}>{filtered.length} пользователей</span>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Нет пользователей</div>
      ) : (
        filtered.map(u => (
          <UserRow key={u.id} user={u} onSaved={handleSaved} />
        ))
      )}
    </div>
  );
}
