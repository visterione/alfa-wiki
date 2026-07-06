import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import toast from 'react-hot-toast';
import { structuralDivisions as divisionsApi, referralBonusAccess, executorSettings as execSettingsApi } from '../../../services/api';
import { BASE_URL } from '../../../services/api';

const execClinicDefault = () => ({
  payType: 'salary', fixedSalary: 0, hourlyRate: 0, hoursWorked: 0,
  executorPercent: 0, plusPercent: false, paymentMethod: 'card',
  mainPaymentMethod: 'card', advance: 0, mainPayment: 0,
  extraPayments: [], includeReferralBonuses: true, includeReferralDeductions: true,
  includeCorpInvoices: true, assistancePercent: 0, cabinets: [],
  deductions: [], materials: [], serviceMaterials: [], extras: [],
  normServices: [], roleRates: [],
});

const PERM_OPTIONS = [
  { value: 'edit', label: 'Редактирование', color: '#16a34a' },
  { value: 'read', label: 'Чтение',         color: '#d97706' },
];

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function SearchableSelect({ value, onChange, options, placeholder = '— выберите —' }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [rect,   setRect]   = useState(null);
  const btnRef              = useRef(null);
  const dropRef             = useRef(null);

  const openDropdown = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setSearch('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (btnRef.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = e => {
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const filtered = options.filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()));
  const selected = options.find(o => o.value === value);
  const rowStyle = { width: '100%', padding: '0 10px', height: 28, fontSize: 11, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };

  const dropdown = open && rect ? ReactDOM.createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: rect.bottom + 2, left: rect.left,
      width: Math.max(rect.width, 220), zIndex: 9999,
      background: '#fff', border: '1px solid var(--rb-border)',
      borderRadius: 7, boxShadow: '0 6px 20px rgba(0,0,0,.13)', overflow: 'hidden',
    }}>
      <div style={{ padding: '5px 6px', borderBottom: '1px solid var(--rb-border)' }}>
        <input autoFocus type="text" placeholder="Поиск..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', height: 24, padding: '0 8px', fontSize: 11,
            border: '1px solid var(--rb-border)', borderRadius: 4, outline: 'none',
            boxSizing: 'border-box', fontFamily: 'inherit' }} />
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        <button type="button" onClick={() => { onChange(''); setOpen(false); }}
          style={{ ...rowStyle, color: 'var(--rb-text-secondary)', background: !value ? '#EFF6FF' : 'transparent' }}>
          {placeholder}
        </button>
        {filtered.length === 0
          ? <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--rb-text-secondary)' }}>Не найдено</div>
          : filtered.map(o => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); setSearch(''); }}
              style={{ ...rowStyle, color: 'var(--rb-text)', background: o.value === value ? '#EFF6FF' : 'transparent' }}>
              {o.label}
            </button>
          ))
        }
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{ boxSizing: 'border-box', width: '100%' }}>
      <button ref={btnRef} type="button" onClick={open ? () => setOpen(false) : openDropdown}
        style={{ width: '100%', height: 28, padding: '0 8px', fontSize: 11,
          border: '1px solid var(--rb-border)', borderRadius: 5, background: '#fff',
          color: value ? 'var(--rb-text)' : 'var(--rb-text-secondary)',
          cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}>
        {selected ? selected.label : placeholder}
      </button>
      {dropdown}
    </div>
  );
}

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

export default function DivisionAccessPanel({
  divisionId, divisionName, divisionDoctorIds = [], divisionRates = [],
  onRenamed, onMembersChanged, doctors = [], getClinicName, getClinicColor,
  scheduleCategories = [], allRoles = [], allProfessions = [],
}) {
  const [accessData, setAccessData] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [allUsers, setAllUsers]     = useState([]);
  const [search, setSearch]         = useState('');
  const [saving, setSaving]         = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue,   setNameValue]   = useState(divisionName);
  const [nameSaving,  setNameSaving]  = useState(false);

  const nameInputRef = useRef(null);

  // ── Saved division rates ──────────────────────────────────────────────────
  const [savedRates,    setSavedRates]    = useState(divisionRates);
  const [editingRateId, setEditingRateId] = useState(null); // id of rate being edited
  const [rateRemoving,  setRateRemoving]  = useState(null); // id of rate being removed

  // ── Rate form ─────────────────────────────────────────────────────────────
  const [showRateForm,  setShowRateForm]  = useState(false);
  const [rateType,      setRateType]      = useState('category');
  const [rateValue,     setRateValue]     = useState('');
  const [rateClinic,    setRateClinic]    = useState('global');
  const [rateAmount,    setRateAmount]    = useState('');
  const [rateOverwrite, setRateOverwrite] = useState(false);
  const [rateSaving,    setRateSaving]    = useState(false);

  useEffect(() => { setSavedRates(divisionRates); }, [divisionRates]);

  // ── Состав подразделения ──────────────────────────────────────────────────
  const [memberIds,     setMemberIds]     = useState(divisionDoctorIds);
  const [memberSearch,  setMemberSearch]  = useState('');
  const [memberFilterClinic, setMemberFilterClinic] = useState('');
  const [memberSaving,  setMemberSaving]  = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  useEffect(() => { setMemberIds(divisionDoctorIds); }, [divisionDoctorIds]);

  const memberSet = new Set(memberIds);
  const members = doctors.filter(d => memberSet.has(d.id));

  const memberClinicIds = [...new Set(doctors.flatMap(d => d.clinics || []))]
    .sort((a, b) => (getClinicName ? getClinicName(a) : a).localeCompare(getClinicName ? getClinicName(b) : b, 'ru'));

  const memberCandidates = doctors.filter(d => {
    if (memberSet.has(d.id)) return false;
    if (memberSearch.trim() && !d.name.toLowerCase().includes(memberSearch.trim().toLowerCase())) return false;
    if (memberFilterClinic && !(d.clinics || []).map(String).includes(String(memberFilterClinic))) return false;
    return true;
  });

  const toggleMember = async (doctorId) => {
    const next = memberSet.has(doctorId)
      ? memberIds.filter(id => id !== doctorId)
      : [...memberIds, doctorId];
    setMemberIds(next); // оптимистично
    setMemberSaving(true);
    try {
      const res = await divisionsApi.update(divisionId, { doctorIds: next });
      const saved = res.data?.doctorIds ?? next;
      setMemberIds(saved);
      onMembersChanged?.(divisionId, saved);
    } catch {
      toast.error('Ошибка сохранения состава');
      setMemberIds(memberIds); // откат
    } finally {
      setMemberSaving(false);
    }
  };

  const actualDoctorIds = memberIds.filter(id => doctors.some(d => d.id === id));

  const divClinicIds = [...new Set(
    actualDoctorIds.flatMap(id => doctors.find(d => d.id === id)?.clinics || [])
  )];

  const getLabel = (type, value) => {
    if (type === 'category') return scheduleCategories.find(c => c.id === value)?.name || value;
    return value;
  };

  // ── Apply rates to all doctors in division ────────────────────────────────
  const applyRates = async () => {
    if (!rateValue || !rateAmount) return;
    const rate = parseFloat(rateAmount);
    if (isNaN(rate) || rate < 0) return;
    if (!actualDoctorIds.length) { toast.error('В подразделении нет сотрудников'); return; }

    setRateSaving(true);
    let ok = 0, fail = 0;
    for (const doctorId of actualDoctorIds) {
      try {
        const doctor = doctors.find(d => d.id === doctorId);
        if (rateClinic !== 'global' && !(doctor?.clinics || []).map(String).includes(String(rateClinic))) {
          continue;
        }
        const res = await execSettingsApi.get(doctorId);
        const raw = res.data;
        const settings = (raw && Object.keys(raw).length && raw.clinicSettings)
          ? { ...raw, clinicSettings: { ...raw.clinicSettings } }
          : { assistants: [], clinicSettings: { global: execClinicDefault() } };

        const ck = rateClinic;
        if (!settings.clinicSettings[ck]) {
          const g = settings.clinicSettings['global'] || execClinicDefault();
          settings.clinicSettings[ck] = { ...g };
        }
        const cs = settings.clinicSettings[ck];
        const roleRates = [...(cs.roleRates || [])];
        const existingIdx = roleRates.findIndex(r => r.roleTitle === rateValue);
        if (existingIdx >= 0) {
          if (rateOverwrite) roleRates[existingIdx] = { ...roleRates[existingIdx], rate };
        } else {
          roleRates.push({ roleTitle: rateValue, rate });
        }
        settings.clinicSettings[ck] = { ...cs, roleRates };
        await execSettingsApi.save({ misUserId: doctorId, doctorName: doctor?.name, settings });
        ok++;
      } catch {
        fail++;
      }
    }

    // Save rate entry to division
    const entry = {
      id:        editingRateId || genId(),
      type:      rateType,
      value:     rateValue,
      label:     getLabel(rateType, rateValue),
      rate,
      clinic:    rateClinic,
      overwrite: rateOverwrite,
    };
    const newSaved = editingRateId
      ? savedRates.map(r => r.id === editingRateId ? entry : r)
      : [...savedRates, entry];

    try {
      await divisionsApi.update(divisionId, { rates: newSaved });
      setSavedRates(newSaved);
    } catch {
      toast.error('Ставка применена, но не сохранена в подразделении');
    }

    setRateSaving(false);
    if (fail > 0) toast.error(`Ошибок: ${fail}, успешно: ${ok}`);
    else toast.success(`Ставка применена для ${ok} сотрудников`);

    // Reset form
    setEditingRateId(null);
    setRateValue('');
    setRateAmount('');
    setShowRateForm(false);
  };

  const startEditRate = (entry) => {
    setEditingRateId(entry.id);
    setRateType(entry.type);
    setRateValue(entry.value);
    setRateClinic(entry.clinic);
    setRateAmount(String(entry.rate));
    setRateOverwrite(entry.overwrite ?? true);
    setShowRateForm(true);
  };

  const cancelEdit = () => {
    setEditingRateId(null);
    setRateValue('');
    setRateAmount('');
    setRateType('category');
    setRateClinic('global');
    setRateOverwrite(false);
    setShowRateForm(false);
  };

  // ── Remove rate from division and all doctors ─────────────────────────────
  const removeRate = async (entry) => {
    setRateRemoving(entry.id);
    let ok = 0, fail = 0;
    for (const doctorId of actualDoctorIds) {
      try {
        const doctor = doctors.find(d => d.id === doctorId);
        const res = await execSettingsApi.get(doctorId);
        const raw = res.data;
        if (!raw || !raw.clinicSettings) { ok++; continue; }
        const settings = { ...raw, clinicSettings: { ...raw.clinicSettings } };
        const ck = entry.clinic;
        if (settings.clinicSettings[ck]) {
          const cs = settings.clinicSettings[ck];
          const roleRates = (cs.roleRates || []).filter(r => r.roleTitle !== entry.value);
          settings.clinicSettings[ck] = { ...cs, roleRates };
          await execSettingsApi.save({ misUserId: doctorId, doctorName: doctor?.name, settings });
        }
        ok++;
      } catch {
        fail++;
      }
    }

    const newSaved = savedRates.filter(r => r.id !== entry.id);
    try {
      await divisionsApi.update(divisionId, { rates: newSaved });
      setSavedRates(newSaved);
    } catch {
      toast.error('Ставка удалена у сотрудников, но не обновлена в подразделении');
    }

    setRateRemoving(null);
    if (fail > 0) toast.error(`Удалено с ошибками: ${fail}`);
    else toast.success(`Ставка удалена у ${ok} сотрудников`);
  };

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

  const hasRateSection = scheduleCategories.length > 0 || allRoles.length > 0 || allProfessions.length > 0;

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

        {/* Bulk rate assignment */}
        {hasRateSection && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: (savedRates.length > 0 || showRateForm) ? 8 : 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, flex: 1 }}>Ставки</span>
              {!showRateForm && (
                <button
                  onClick={() => setShowRateForm(true)}
                  title="Добавить ставку"
                  style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: 'var(--rb-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16, lineHeight: 1 }}
                >
                  +
                </button>
              )}
            </div>

            {/* Saved rates list */}
            {savedRates.length > 0 && (
              <div style={{ marginBottom: showRateForm ? 10 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {savedRates.map(entry => {
                  const clinicLabel = entry.clinic === 'global' ? 'Общие' : (getClinicName ? getClinicName(entry.clinic) : entry.clinic);
                  const isRemoving = rateRemoving === entry.id;
                  const isEditing  = editingRateId === entry.id;
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                        borderRadius: 6, border: `1px solid ${isEditing ? 'var(--rb-primary)' : 'var(--rb-border)'}`,
                        background: isEditing ? '#f0f7ff' : '#fafafa',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.label}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--rb-text-secondary)', marginTop: 1 }}>
                          {entry.rate} ₽/ч · {clinicLabel}
                        </div>
                      </div>
                      <button
                        onClick={() => startEditRate(entry)}
                        disabled={isRemoving}
                        title="Редактировать"
                        style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--rb-border)', cursor: 'pointer', background: '#fff', color: 'var(--rb-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isRemoving ? 0.4 : 1 }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => removeRate(entry)}
                        disabled={isRemoving}
                        title="Удалить ставку у всех сотрудников"
                        style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isRemoving ? 0.5 : 1 }}
                      >
                        {isRemoving
                          ? <div style={{ width: 8, height: 8, border: '1.5px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                            </svg>
                        }
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add / edit form */}
            {showRateForm && (() => {
              const fldLabel = txt => (
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--rb-text-secondary)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>{txt}</div>
              );
              const selStyle = { width: '100%', height: 28, padding: '0 5px', fontSize: 11, border: '1px solid var(--rb-border)', borderRadius: 5, background: '#fff', color: 'var(--rb-text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
              const opts = rateType === 'category'
                ? scheduleCategories.map(c => ({ value: c.id, label: c.name }))
                : rateType === 'role'
                ? allRoles.map(r => ({ value: r, label: r }))
                : allProfessions.map(p => ({ value: p, label: p }));
              return (
                <div style={{ padding: '8px', borderRadius: 6, border: '1px solid var(--rb-border)', background: '#f8fafc' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text)', marginBottom: 8 }}>
                    {editingRateId ? 'Редактировать ставку' : 'Новая ставка'}
                  </div>
                  {/* Row 1: Тип | Значение */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, marginBottom: 6 }}>
                    <div>
                      {fldLabel('Тип')}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
                        {[['category', 'Категория'], ['role', 'Роль'], ['profession', 'Специальность']].map(([val, lbl]) => (
                          <button key={val} onClick={() => { setRateType(val); setRateValue(''); }}
                            style={{ height: 28, padding: '0 4px', fontSize: 11, fontWeight: 500, border: '1px solid', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              borderColor: rateType === val ? 'var(--rb-primary)' : 'var(--rb-border)',
                              background: rateType === val ? 'var(--rb-primary)' : '#fff',
                              color: rateType === val ? '#fff' : 'var(--rb-text-secondary)' }}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      {fldLabel('Значение')}
                      <SearchableSelect
                        value={rateValue}
                        onChange={setRateValue}
                        options={opts}
                        placeholder="— выберите —"
                      />
                    </div>
                  </div>
                  {/* Row 2: Клиника | Ставка | Перезаписать */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 6, marginBottom: 8, alignItems: 'end' }}>
                    <div>
                      {fldLabel('Медцентр')}
                      <select value={rateClinic} onChange={e => setRateClinic(e.target.value)} style={selStyle}>
                        <option value="global">Общие</option>
                        {divClinicIds.map(cId => (
                          <option key={cId} value={cId}>{getClinicName ? getClinicName(cId) : cId}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      {fldLabel('Ставка, ₽/ч')}
                      <input type="number" min="0" step="any" placeholder="0"
                        value={rateAmount} onChange={e => setRateAmount(e.target.value)}
                        style={{ ...selStyle, padding: '0 6px' }}
                      />
                    </div>
                    <div style={{ paddingBottom: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--rb-text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={rateOverwrite} onChange={e => setRateOverwrite(e.target.checked)} style={{ margin: 0 }} />
                        Перезаписать
                      </label>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={cancelEdit}
                      style={{ flex: '0 0 auto', height: 28, padding: '0 12px', fontSize: 12, fontWeight: 500, border: '1px solid var(--rb-border)', borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--rb-text-secondary)', boxSizing: 'border-box' }}>
                      Отмена
                    </button>
                    <button
                      disabled={!rateValue || !rateAmount || rateSaving}
                      onClick={applyRates}
                      style={{ flex: 1, height: 28, fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6,
                        cursor: (rateValue && rateAmount && !rateSaving) ? 'pointer' : 'not-allowed',
                        background: (rateValue && rateAmount && !rateSaving) ? 'var(--rb-primary)' : 'var(--rb-primary-light, #bfdbfe)', color: '#fff', boxSizing: 'border-box' }}>
                      {rateSaving ? 'Применяется...' : (editingRateId ? 'Сохранить и применить' : 'Применить')}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Состав подразделения — внизу, т.к. самая объёмная секция */}
        <div>
          {/* Заголовок + кнопка добавления */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, flex: 1 }}>
              Сотрудники
            </span>
            <button
              onClick={() => setShowAddMember(v => !v)}
              title={showAddMember ? 'Скрыть добавление' : 'Добавить сотрудника'}
              style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: showAddMember ? '#1d4ed8' : 'var(--rb-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" style={{ transform: showAddMember ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s' }}>
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          {/* Меню добавления — над списком */}
          {showAddMember && (
            <div style={{ marginBottom: 8, padding: '8px', borderRadius: 6, border: '1px solid var(--rb-border)', background: '#f0f6ff' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  autoFocus
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Поиск по ФИО..."
                  style={{ flex: 1, minWidth: 0, height: 30, padding: '0 8px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 6, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                />
                <select
                  value={memberFilterClinic}
                  onChange={e => setMemberFilterClinic(e.target.value)}
                  style={{ width: 120, flexShrink: 0, height: 30, padding: '0 6px', fontSize: 12, border: '1px solid var(--rb-border)', borderRadius: 6, background: '#fff', color: 'var(--rb-text)', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <option value="">Все МЦ</option>
                  {memberClinicIds.map(cId => (
                    <option key={cId} value={cId}>{getClinicName ? getClinicName(cId) : cId}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: 6, border: '1px solid var(--rb-border)', borderRadius: 6, background: '#fff', maxHeight: 200, overflowY: 'auto' }}>
                {memberCandidates.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>Нет результатов</div>
                )}
                {memberCandidates.slice(0, 30).map(d => {
                  const specialty = (d.professions || [])
                    .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
                    .filter(Boolean).join(', ');
                  return (
                    <div
                      key={d.id}
                      onClick={() => { if (!memberSaving) toggleMember(d.id); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: memberSaving ? 'default' : 'pointer', borderBottom: '1px solid var(--rb-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--rb-hover, #f1f5f9)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                        {specialty && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{specialty}</div>}
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="var(--rb-primary)" strokeWidth="2.5" width="14" height="14" style={{ flexShrink: 0 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Список добавленных */}
          {members.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', padding: '2px 0 6px' }}>Нет сотрудников</div>
          )}
          {members.map(d => {
            const specialty = (d.professions || [])
              .map(p => typeof p === 'object' ? (p.title || '') : String(p || ''))
              .filter(Boolean).join(', ');
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--rb-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--rb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                  {specialty && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{specialty}</div>}
                  {(d.clinics || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                      {(d.clinics || []).slice(0, 3).map(cId => (
                        <span key={cId} className="rb-clinic-badge" style={{ background: getClinicColor ? getClinicColor(cId) : '#94a3b8', fontSize: 10 }}>
                          {getClinicName ? getClinicName(cId) : cId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggleMember(d.id)}
                  disabled={memberSaving}
                  title="Убрать из подразделения"
                  style={{ width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: memberSaving ? 0.6 : 1 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
