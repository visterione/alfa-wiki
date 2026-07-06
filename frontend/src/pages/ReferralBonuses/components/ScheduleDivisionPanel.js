import React, { useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import toast from 'react-hot-toast';
import { structuralDivisions as divisionsApi } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import ScheduleFillFlags from './ScheduleFillFlags';

const ScheduleDivisionPanel = React.forwardRef(function ScheduleDivisionPanel({
  doctors = [], selectedDoctorId, onSelectDoctor, readOnly,
  getClinicColor, getClinicName,
  onManageAccess, managingDivisionId, onDivisionRenamed,
  onToggleView,
  bulkMode = false, bulkSelectedIds, setBulkSelectedIds,
  scheduleFillMap = {}, onCycleFill,
}, ref) {
  const { user } = useAuth();
  const [divisions,    setDivisions]    = useState([]);
  const [openId,       setOpenId]       = useState(null);
  const [editingId,    setEditingId]    = useState(null);
  const [editName,     setEditName]     = useState('');
  const [newDivName,   setNewDivName]   = useState('');
  const [creating,     setCreating]     = useState(false);
  const [showCreate,   setShowCreate]   = useState(false);
  const editInputRef = useRef(null);
  const newInputRef  = useRef(null);

  useImperativeHandle(ref, () => ({
    updateName: (id, newName) => {
      setDivisions(prev =>
        prev.map(d => d.id === id ? { ...d, name: newName } : d)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      );
    },
    // Синхронизирует состав подразделения после правок в окне настроек
    updateDoctorIds: (id, doctorIds) => {
      setDivisions(prev => prev.map(d => d.id === id ? { ...d, doctorIds } : d));
    },
  }));

  useEffect(() => {
    divisionsApi.list()
      .then(res => setDivisions(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  useEffect(() => {
    if (showCreate && newInputRef.current) newInputRef.current.focus();
  }, [showCreate]);

  const handleCreate = async () => {
    if (!newDivName.trim()) return;
    setCreating(true);
    try {
      const res = await divisionsApi.create({ name: newDivName.trim(), doctorIds: [] });
      setDivisions(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setNewDivName('');
      setShowCreate(false);
      setOpenId(res.data.id);
    } catch {
      toast.error('Ошибка создания');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await divisionsApi.delete(id);
      setDivisions(prev => prev.filter(d => d.id !== id));
      if (openId === id) setOpenId(null);
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const startEdit = (div, e) => {
    e.stopPropagation();
    setEditingId(div.id);
    setEditName(div.name);
  };

  const commitEdit = async (id) => {
    if (!editName.trim()) { setEditingId(null); return; }
    try {
      const res = await divisionsApi.update(id, { name: editName.trim() });
      setDivisions(prev =>
        prev.map(d => d.id === id ? res.data : d)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      );
      onDivisionRenamed?.(id, editName.trim());
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setEditingId(null);
    }
  };

  const getDivDoctors = useCallback((div) => {
    const ids = new Set(div.doctorIds || []);
    return doctors.filter(d => ids.has(d.id));
  }, [doctors]);

  // ── Bulk selection (Сводный отчёт) ──
  const toggleBulk = useCallback((id) => {
    setBulkSelectedIds?.(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [setBulkSelectedIds]);

  const toggleBulkDivision = useCallback((members, allSelected) => {
    setBulkSelectedIds?.(prev => {
      const next = new Set(prev);
      members.forEach(d => { if (allSelected) next.delete(d.id); else next.add(d.id); });
      return next;
    });
  }, [setBulkSelectedIds]);

  return (
    <div className="rb-panel">
      {/* Header */}
      <div className="rb-panel-header">
        <div className="rb-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="2" y="7" width="20" height="14" rx="2"/>
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
          </svg>
          Подразделения
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {bulkMode && bulkSelectedIds?.size > 0 && (
            <span style={{ fontSize: 12, color: 'var(--rb-primary)', fontWeight: 600, marginRight: 2 }}>✓ {bulkSelectedIds.size} выбрано</span>
          )}
          {!readOnly && (
            <button
              onClick={() => { setShowCreate(v => !v); setNewDivName(''); }}
              title="Создать подразделение"
              style={{
                width: 26, height: 26, borderRadius: 6, border: 'none',
                background: showCreate ? '#1d4ed8' : 'var(--rb-primary)',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          )}
          {onToggleView && (
            <button
              onClick={onToggleView}
              title="Список сотрудников"
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

      {/* Create form */}
      {showCreate && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--rb-border)', display: 'flex', gap: 6 }}>
          <input
            ref={newInputRef}
            value={newDivName}
            onChange={e => setNewDivName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            placeholder="Название подразделения..."
            style={{
              flex: 1, height: 30, padding: '0 8px', fontSize: 12,
              border: '1px solid var(--rb-border)', borderRadius: 6,
              background: '#fff', color: 'var(--rb-text)', outline: 'none',
            }}
          />
          <button
            onClick={handleCreate}
            disabled={!newDivName.trim() || creating}
            style={{
              height: 30, padding: '0 12px', fontSize: 12, borderRadius: 6,
              border: 'none', background: 'var(--rb-primary)', color: '#fff',
              cursor: newDivName.trim() ? 'pointer' : 'not-allowed',
              opacity: newDivName.trim() ? 1 : 0.5, whiteSpace: 'nowrap',
            }}
          >
            Создать
          </button>
        </div>
      )}

      {/* Division list */}
      <div className="rb-doctors-list" style={{ flex: 1 }}>
        {divisions.length === 0 && (
          <div className="rb-loading">Нет подразделений</div>
        )}

        {divisions.map(div => {
          const isOpen    = openId === div.id;
          const isEditing = editingId === div.id;
          const isManaging = managingDivisionId === div.id;
          const members   = getDivDoctors(div);
          const myPerm    = div.myPermission; // 'owner' | 'edit' | 'read' | 'public' | null
          const isOwner   = myPerm === 'owner';
          const canAdmin  = isOwner || myPerm === 'edit' || user?.isAdmin;

          return (
            <div key={div.id}>
              {/* Division row */}
              <div
                onClick={() => setOpenId(isOpen ? null : div.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '9px 12px', cursor: 'pointer',
                  background: isOpen ? 'var(--rb-primary-light, #eff6ff)' : 'transparent',
                  borderLeft: `3px solid ${isOpen ? 'var(--rb-primary)' : 'transparent'}`,
                  transition: 'background 0.1s',
                }}
              >
                <svg
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  width="12" height="12" style={{ flexShrink: 0, color: 'var(--rb-text-secondary)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                >
                  <polyline points="9 18 15 12 9 6"/>
                </svg>

                {bulkMode && members.length > 0 && (() => {
                  const allSelected = members.every(d => bulkSelectedIds?.has(d.id));
                  return (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = !allSelected && members.some(d => bulkSelectedIds?.has(d.id)); }}
                      onChange={() => toggleBulkDivision(members, allSelected)}
                      onClick={e => e.stopPropagation()}
                      title="Выбрать всё подразделение"
                      style={{ flexShrink: 0, accentColor: 'var(--rb-primary)', cursor: 'pointer' }}
                    />
                  );
                })()}

                {isEditing ? (
                  <>
                    <input
                      ref={editInputRef}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(div.id); if (e.key === 'Escape') setEditingId(null); }}
                      onClick={e => e.stopPropagation()}
                      style={{ flex: 1, minWidth: 0, border: '1px solid var(--rb-primary)', borderRadius: 4, padding: '1px 6px', fontSize: 13, outline: 'none' }}
                    />
                    <button
                      onClick={e => { e.stopPropagation(); commitEdit(div.id); }}
                      style={{ height: 22, padding: '0 8px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none', background: 'var(--rb-primary)', color: '#fff', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                      Сохранить
                    </button>
                  </>
                ) : (
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: isOpen ? 'var(--rb-primary)' : 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {div.name}
                  </span>
                )}

                {!isEditing && (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {canAdmin && onManageAccess && (
                      <button
                        onClick={e => { e.stopPropagation(); onManageAccess(isManaging ? null : { id: div.id, name: div.name, doctorIds: div.doctorIds || [], rates: div.rates || [] }); }}
                        title="Настройки доступа"
                        style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: isManaging ? '#1d4ed8' : '#64748b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                      </button>
                    )}
                    {canAdmin && !readOnly && (
                      <button onClick={e => handleDelete(div.id, e)} title="Удалить"
                        style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ background: 'var(--rb-bg-alt, #f8fafc)' }}>

                  {members.length === 0 && (
                    <div style={{ padding: '6px 20px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>Нет сотрудников</div>
                  )}

                  {members.map(d => {
                    const specialty = (d.professions || [])
                      .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
                      .filter(Boolean).join(', ');
                    const isActive = bulkMode ? !!bulkSelectedIds?.has(d.id) : selectedDoctorId === d.id;
                    return (
                      <div
                        key={d.id}
                        className={`rb-doctor-item${isActive ? ' active' : ''}`}
                        style={{ paddingLeft: bulkMode ? 14 : 28, borderLeft: '3px solid transparent' }}
                        onClick={() => bulkMode ? toggleBulk(d.id) : onSelectDoctor(d.id === selectedDoctorId ? null : d.id)}
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
                          <div className="rb-doctor-name">{d.name}</div>
                          {specialty && <div className="rb-doctor-specialty">{specialty}</div>}
                          <div className="rb-doctor-badges">
                            {(d.clinics || []).slice(0, 3).map(cId => (
                              <span key={cId} className="rb-clinic-badge" style={{ background: getClinicColor ? getClinicColor(cId) : '#94a3b8' }}>
                                {getClinicName ? getClinicName(cId) : cId}
                              </span>
                            ))}
                          </div>
                        </div>
                        {!bulkMode && (
                          <ScheduleFillFlags
                            status={scheduleFillMap[d.misUserId || d.id] || 0}
                            onClick={onCycleFill ? () => onCycleFill(d) : undefined}
                            readOnly={!onCycleFill}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
});

export default ScheduleDivisionPanel;
