import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { structuralDivisions as divisionsApi } from '../../../services/api';

export default function StepDivisions({ doctors = [], readOnly }) {
  const [divisions,    setDivisions]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selectedId,   setSelectedId]   = useState(null);
  const [editName,     setEditName]     = useState('');
  const [search,       setSearch]       = useState('');
  const [saving,       setSaving]       = useState(false);
  const [newDivName,   setNewDivName]   = useState('');
  const [creating,     setCreating]     = useState(false);

  useEffect(() => {
    divisionsApi.list()
      .then(res => setDivisions(Array.isArray(res.data) ? res.data : []))
      .catch(() => toast.error('Ошибка загрузки подразделений'))
      .finally(() => setLoading(false));
  }, []);

  const selected = divisions.find(d => d.id === selectedId) || null;

  const handleSelect = useCallback((div) => {
    setSelectedId(div.id);
    setEditName(div.name);
    setSearch('');
  }, []);

  const handleCreate = async () => {
    if (!newDivName.trim()) return;
    setCreating(true);
    try {
      const res = await divisionsApi.create({ name: newDivName.trim(), doctorIds: [] });
      setDivisions(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setNewDivName('');
      handleSelect(res.data);
      toast.success('Подразделение создано');
    } catch {
      toast.error('Ошибка создания подразделения');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await divisionsApi.delete(id);
      setDivisions(prev => prev.filter(d => d.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast.success('Подразделение удалено');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleSaveName = async () => {
    if (!selected || !editName.trim() || editName.trim() === selected.name) return;
    setSaving(true);
    try {
      const res = await divisionsApi.update(selected.id, { name: editName.trim() });
      setDivisions(prev =>
        prev.map(d => d.id === selected.id ? res.data : d)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      );
      toast.success('Название сохранено');
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const toggleDoctor = async (doctorId) => {
    if (!selected) return;
    const currentIds = selected.doctorIds || [];
    const next = currentIds.includes(doctorId)
      ? currentIds.filter(id => id !== doctorId)
      : [...currentIds, doctorId];
    try {
      const res = await divisionsApi.update(selected.id, { doctorIds: next });
      setDivisions(prev => prev.map(d => d.id === selected.id ? res.data : d));
    } catch {
      toast.error('Ошибка сохранения');
    }
  };

  const memberIds = new Set(selected?.doctorIds || []);
  const filteredDoctors = doctors.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  );

  const members    = filteredDoctors.filter(d => memberIds.has(d.id));
  const nonMembers = filteredDoctors.filter(d => !memberIds.has(d.id));

  return (
    <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 12, border: '1px solid var(--rb-border)' }}>

      {/* ── Left: division list ── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--rb-border)', display: 'flex', flexDirection: 'column', background: 'var(--rb-bg)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--rb-border)', fontWeight: 600, fontSize: 13, color: 'var(--rb-text)' }}>
          Структурные подразделения
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--rb-text-secondary)' }}>Загрузка...</div>
          ) : divisions.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--rb-text-secondary)' }}>Нет подразделений</div>
          ) : divisions.map(div => (
            <div
              key={div.id}
              onClick={() => handleSelect(div)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                background: selectedId === div.id ? 'var(--rb-primary-light, #eff6ff)' : 'transparent',
                color: selectedId === div.id ? 'var(--rb-primary)' : 'var(--rb-text)',
                borderLeft: `3px solid ${selectedId === div.id ? 'var(--rb-primary)' : 'transparent'}`,
                transition: 'background 0.12s',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{div.name}</span>
              <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)', flexShrink: 0 }}>{(div.doctorIds || []).length}</span>
              {!readOnly && (
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(div.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--red-600)', opacity: 0.6, flexShrink: 0 }}
                  title="Удалить"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        {!readOnly && (
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--rb-border)', display: 'flex', gap: 6 }}>
            <input
              value={newDivName}
              onChange={e => setNewDivName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Новое подразделение..."
              style={{
                flex: 1, height: 30, padding: '0 8px', fontSize: 12,
                border: '1px solid var(--rb-border)', borderRadius: 6,
                background: 'var(--n-0)', color: 'var(--rb-text)', outline: 'none',
              }}
            />
            <button
              onClick={handleCreate}
              disabled={!newDivName.trim() || creating}
              style={{
                height: 30, padding: '0 10px', fontSize: 12, borderRadius: 6,
                border: 'none', background: 'var(--rb-primary)', color: '#fff',
                cursor: newDivName.trim() ? 'pointer' : 'not-allowed',
                opacity: newDivName.trim() ? 1 : 0.5,
              }}
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* ── Right: division editor ── */}
      {!selected ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rb-text-secondary)', fontSize: 13 }}>
          Выберите подразделение слева
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* Name editor */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rb-border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              disabled={readOnly}
              style={{
                flex: 1, height: 34, padding: '0 12px', fontSize: 14, fontWeight: 600,
                border: '1px solid var(--rb-border)', borderRadius: 8,
                background: readOnly ? 'var(--rb-bg)' : '#fff', color: 'var(--rb-text)', outline: 'none',
              }}
            />
            {!readOnly && editName.trim() !== selected.name && (
              <button
                onClick={handleSaveName}
                disabled={saving}
                style={{ height: 34, padding: '0 14px', fontSize: 13, borderRadius: 8, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer' }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            )}
          </div>

          {/* Doctor search */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--rb-border)' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск сотрудника..."
              style={{
                width: '100%', boxSizing: 'border-box', height: 32, padding: '0 10px', fontSize: 13,
                border: '1px solid var(--rb-border)', borderRadius: 7,
                background: 'var(--n-0)', color: 'var(--rb-text)', outline: 'none',
              }}
            />
          </div>

          {/* Doctor list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {members.length > 0 && (
              <>
                <div style={{ padding: '6px 16px 4px', fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  В подразделении · {members.length}
                </div>
                {members.map(d => (
                  <DoctorRow key={d.id} doctor={d} inDivision readOnly={readOnly} onToggle={() => toggleDoctor(d.id)} />
                ))}
              </>
            )}
            {nonMembers.length > 0 && (
              <>
                <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Добавить
                </div>
                {nonMembers.map(d => (
                  <DoctorRow key={d.id} doctor={d} inDivision={false} readOnly={readOnly} onToggle={() => toggleDoctor(d.id)} />
                ))}
              </>
            )}
            {filteredDoctors.length === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--rb-text-secondary)' }}>Нет сотрудников по поиску</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DoctorRow({ doctor, inDivision, readOnly, onToggle }) {
  const specialty = (doctor.professions || [])
    .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
    .filter(Boolean).join(', ');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px', borderBottom: '1px solid var(--rb-border)',
      background: inDivision ? '#f0fdf4' : 'transparent',
      transition: 'background 0.1s',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doctor.name}
        </div>
        {specialty && (
          <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {specialty}
          </div>
        )}
      </div>
      {!readOnly && (
        <button
          onClick={onToggle}
          title={inDivision ? 'Убрать из подразделения' : 'Добавить в подразделение'}
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: inDivision ? '#dcfce7' : 'var(--rb-bg)',
            color: inDivision ? '#16a34a' : 'var(--rb-text-secondary)',
          }}
        >
          {inDivision
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          }
        </button>
      )}
    </div>
  );
}
