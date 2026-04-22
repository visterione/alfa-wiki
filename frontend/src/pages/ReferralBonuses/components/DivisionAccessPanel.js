import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { structuralDivisions as divisionsApi, referralBonusAccess } from '../../../services/api';
import { BASE_URL } from '../../../services/api';

const PERM_OPTIONS = [
  { value: 'edit', label: 'Редактирование', color: '#16a34a' },
  { value: 'read', label: 'Чтение',         color: '#d97706' },
];

function Avatar({ user }) {
  const src = user?.avatar
    ? (user.avatar.startsWith('http') ? user.avatar : `${BASE_URL}/${user.avatar}`)
    : null;
  return src ? (
    <img src={src} alt={user.displayName} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" width="14" height="14">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    </div>
  );
}

export default function DivisionAccessPanel({ divisionId, divisionName, onRenamed }) {
  const [accessData, setAccessData] = useState(null); // { owner, access: [] }
  const [loading, setLoading]       = useState(true);
  const [allUsers, setAllUsers]     = useState([]);
  const [search, setSearch]         = useState('');
  const [saving, setSaving]         = useState(null); // userId being saved
  const [editingName, setEditingName] = useState(false);
  const [nameValue,   setNameValue]   = useState(divisionName);
  const [nameSaving,  setNameSaving]  = useState(false);

  const nameInputRef = useRef(null);

  useEffect(() => { setNameValue(divisionName); }, [divisionName]);
  useEffect(() => { if (editingName) nameInputRef.current?.focus(); }, [editingName]);

  const commitRename = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === divisionName) { setEditingName(false); return; }
    setNameSaving(true);
    try {
      await divisionsApi.update(divisionId, { name: trimmed });
      onRenamed?.(divisionId, trimmed);
      setEditingName(false);
    } catch {
      toast.error('Ошибка переименования');
    } finally {
      setNameSaving(false);
    }
  };

  const load = useCallback(() => {
    if (!divisionId) return;
    setLoading(true);
    divisionsApi.getAccess(divisionId)
      .then(res => setAccessData(res.data))
      .catch(() => toast.error('Ошибка загрузки доступа'))
      .finally(() => setLoading(false));
  }, [divisionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    referralBonusAccess.getUsers()
      .then(res => setAllUsers(res.data || []))
      .catch(() => {});
  }, []);

  const existingIds = new Set([
    ...(accessData?.access || []).map(a => a.userId),
    accessData?.owner?.id,
  ].filter(Boolean));

  const availableUsers = allUsers.filter(u =>
    !existingIds.has(u.id) &&
    (u.displayName || u.username || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleChangePerm = async (userId, perm) => {
    setSaving(userId);
    try {
      await divisionsApi.addAccess(divisionId, userId, perm);
      setAccessData(prev => ({
        ...prev,
        access: prev.access.map(a => a.userId === userId ? { ...a, permission: perm } : a),
      }));
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(null);
    }
  };

  const handleRemove = async (userId) => {
    setSaving(userId);
    try {
      await divisionsApi.removeAccess(divisionId, userId);
      setAccessData(prev => ({
        ...prev,
        owner:  prev.owner?.id === userId ? null : prev.owner,
        access: prev.access.filter(a => a.userId !== userId),
      }));
    } catch {
      toast.error('Ошибка удаления');
    } finally {
      setSaving(null);
    }
  };

  const handleAdd = async (user) => {
    setSaving(user.id);
    try {
      await divisionsApi.addAccess(divisionId, user.id, 'read');
      setAccessData(prev => ({
        ...prev,
        access: [...prev.access, {
          userId: user.id,
          displayName: user.displayName || user.username,
          avatar: user.avatar,
          permission: 'read',
        }],
      }));
      setSearch('');
    } catch {
      toast.error('Ошибка добавления');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="rb-placeholder">
        <div className="rb-spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div className="rb-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="rb-panel-header" style={{ gap: 8 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0, color: 'var(--rb-text-secondary)' }}>
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        </svg>
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setNameValue(divisionName); setEditingName(false); } }}
            onBlur={commitRename}
            disabled={nameSaving}
            style={{ flex: 1, minWidth: 0, height: 26, padding: '0 6px', fontSize: 13, fontWeight: 600, border: '1px solid var(--rb-primary)', borderRadius: 5, outline: 'none', background: '#f0f7ff' }}
          />
        ) : (
          <span
            onClick={() => setEditingName(true)}
            title="Нажмите для переименования"
            style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', padding: '2px 4px', borderRadius: 4 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {nameValue || divisionName}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', fontWeight: 500, flexShrink: 0 }}>Доступ</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Add user */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Добавить пользователя</div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени..."
            style={{ width: '100%', height: 30, padding: '0 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 6, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
          />
          {search.trim() && (
            <div style={{ marginTop: 4, border: '1px solid var(--rb-border)', borderRadius: 6, background: '#fff', maxHeight: 180, overflowY: 'auto' }}>
              {availableUsers.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>Нет результатов</div>
              )}
              {availableUsers.slice(0, 20).map(u => (
                <div
                  key={u.id}
                  onClick={() => handleAdd(u)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--rb-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--rb-hover, #f1f5f9)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Avatar user={u} />
                  <span style={{ fontSize: 12, color: 'var(--rb-text)' }}>{u.displayName || u.username}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Access list */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Доступ</div>
          {!accessData?.owner && (accessData?.access || []).length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', padding: '6px 0' }}>Нет пользователей</div>
          )}

          {/* Owner row */}
          {accessData?.owner && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--rb-border)' }}>
              <Avatar user={accessData.owner} />
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--rb-text)' }}>
                {accessData.owner.displayName}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0, marginRight: 4 }}>Создатель</span>
              <button
                onClick={() => handleRemove(accessData.owner.id)}
                disabled={saving === accessData.owner.id}
                title="Исключить создателя"
                style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: saving === accessData.owner.id ? 0.6 : 1 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          )}

          {(accessData?.access || []).map(a => (
            <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--rb-border)' }}>
              <Avatar user={a} />
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--rb-text)' }}>
                {a.displayName}
              </span>
              {/* Permission toggle */}
              <div style={{ display: 'flex', border: '1px solid var(--rb-border)', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                {PERM_OPTIONS.map(opt => {
                  const active = a.permission === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleChangePerm(a.userId, opt.value)}
                      disabled={saving === a.userId}
                      style={{
                        width: 108, padding: '3px 0', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                        background: active ? opt.color : 'white',
                        color: active ? 'white' : '#64748b',
                        transition: 'all 0.15s',
                        opacity: saving === a.userId ? 0.6 : 1,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {/* Remove */}
              <button
                onClick={() => handleRemove(a.userId)}
                disabled={saving === a.userId}
                title="Убрать доступ"
                style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: saving === a.userId ? 0.6 : 1 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
