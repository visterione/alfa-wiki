import React, { useState, useEffect, useCallback } from 'react';
import { Users, Save, ChevronDown, ChevronUp, Check } from 'lucide-react';
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
  { id: '2', name: 'Альфа',      color: '#FF80AB' },
  { id: '3', name: 'Кидс',       color: '#FFA726' },
  { id: '1', name: 'Проф',       color: '#7E57C2' },
  { id: '6', name: 'Линия',      color: '#C5E1A5' },
  { id: '4', name: '3К',         color: '#BA68C8' },
  { id: '7', name: 'Смайл',      color: '#555555' },
  { id: '8', name: 'Направители',color: '#0EA5E9' },
];

const TAB_DEFS = [
  { key: 'tab1',       label: 'Врачи' },
  { key: 'tab2',       label: 'Выполненные услуги' },
  { key: 'tab3',       label: 'Бонусы за направления' },
  { key: 'tab4',       label: 'Отчёт' },
  { key: 'tabArchive', label: 'Архив' },
];

const PERM_OPTIONS = [
  { value: 'edit',  label: 'Редактирование', color: '#16a34a' },
  { value: 'read',  label: 'Чтение',         color: '#d97706' },
  { value: 'block', label: 'Заблокировать',  color: '#dc2626' },
];

function permSummary(perm) {
  const restricted = TAB_DEFS.filter(t => perm[t.key] !== 'edit').map(t => {
    return `${t.label}: ${perm[t.key] === 'read' ? 'чтение' : 'блок'}`;
  });
  const clinicCount = perm.clinics?.length || 0;
  const parts = [];
  if (clinicCount > 0) parts.push(`МЦ: ${clinicCount}`);
  parts.push(...restricted);
  return parts.length ? parts.join(' · ') : 'Полный доступ';
}

function UserRow({ user, onSaved }) {
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState({ ...user.perm });
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

  const initials = (user.displayName || user.username || '?')
    .split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

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
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#2563eb', flexShrink: 0 }}>
            {initials}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{user.displayName || user.username}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{permSummary(perm)}</div>
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
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
              Если ничего не включено — пользователь видит все медцентры
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
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
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
            {TAB_DEFS.map(tab => (
              <div key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 220, fontSize: 13, color: '#475569' }}>{tab.label}</div>
                <div style={{ display: 'flex', border: '1px solid #94a3b8', borderRadius: 7, overflow: 'hidden' }}>
                  {PERM_OPTIONS.map(opt => {
                    const active = perm[tab.key] === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setTab(tab.key, opt.value)}
                        style={{
                          padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
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
            ))}
          </div>

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px dashed #e2e8f0' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              <Save size={14} />
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
          Доступ к «Бонусам за направления»
        </h1>
      </div>

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1e40af', marginBottom: 20 }}>
        Настройка прав доступа для пользователей, имеющих доступ к странице. По умолчанию все вкладки открыты на редактирование.
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
