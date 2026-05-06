import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { doctorSchedules as schedulesApi, tabelRecords as tabelApi, structuralDivisions as divisionsApi, rbScheduleDicts as dictsApi, rbHolidays as holidaysApi, rbDoctorHeaders as doctorHeadersApi, roleNorms as roleNormsApi, categoryNorms as categoryNormsApi } from '../../../services/api';
import { downloadTabelExcel } from '../utils/tabelExport';
import TabelTable, { pad2, SigBlock } from './TabelTable';
import MonthYearPicker from './MonthYearPicker';

const ORGS = [
  'Общество с ограниченной ответственностью «Альфа Престиж»',
  'Общество с ограниченной ответственностью «Альфа Проф»',
  'Общество с ограниченной ответственностью «ЛАБ ГРУПП»',
];
// ── Employee multi-select dropdown ────────────────────────────────────────────
function EmpSelect({ doctors, selectedIds, onChange, clinics = [], getClinicName }) {
  const [open,          setOpen]         = useState(false);
  const [search,        setSearch]       = useState('');
  const [filterRole,    setFilterRole]   = useState('');
  const [filterClinic,  setFilterClinic] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const allRoles = useMemo(() => {
    const set = new Set();
    doctors.forEach(d => (d.roles || []).forEach(r => set.add(r)));
    return [...set].sort();
  }, [doctors]);

  const filtered = useMemo(() => doctors.filter(d => {
    if (search      && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole  && !(d.roles || []).includes(filterRole))  return false;
    if (filterClinic && !(d.clinics || []).includes(String(filterClinic))) return false;
    return true;
  }), [doctors, search, filterRole, filterClinic]);

  const toggle = id => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };

  const label = selectedIds.size === 0
    ? 'Выберите сотрудников'
    : selectedIds.size === doctors.length ? 'Все сотрудники' : `Выбрано: ${selectedIds.size}`;

  const selStyle = {
    boxSizing: 'border-box', width: '100%', padding: '4px 8px', fontSize: 12,
    border: '1px solid var(--rb-border)', borderRadius: 6, outline: 'none',
    background: '#fff', color: 'var(--rb-text)', height: 28,
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 34,
        padding: '0 10px 0 12px', borderRadius: 8, border: '1px solid var(--rb-border-dark)',
        background: '#fff', cursor: 'pointer', fontSize: 13,
        color: selectedIds.size === 0 ? 'var(--rb-text-secondary)' : 'var(--rb-text)',
        minWidth: 200, whiteSpace: 'nowrap',
      }}>
        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: '#fff', border: '1px solid var(--rb-border)', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.13)', minWidth: 300, maxWidth: 380,
          marginTop: 4, overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--rb-border)' }}>
            <input autoFocus type="text" placeholder="Поиск по ФИО..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...selStyle, height: 30, padding: '5px 10px' }} />
          </div>

          {/* Filters: role + clinic */}
          {(allRoles.length > 0 || clinics.length > 0) && (
            <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--rb-border)' }}>
              {allRoles.length > 0 && (
                <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ ...selStyle, flex: 1 }}>
                  <option value="">Все роли</option>
                  {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {clinics.length > 0 && (
                <select value={filterClinic} onChange={e => setFilterClinic(e.target.value)} style={{ ...selStyle, flex: 1 }}>
                  <option value="">Все медцентры</option>
                  {clinics.map(c => <option key={c.id} value={String(c.id)}>{getClinicName ? getClinicName(String(c.id)) : c.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, padding: '5px 10px', borderBottom: '1px solid var(--rb-border)' }}>
            {[['Выбрать всех', () => onChange(new Set(filtered.map(d => d.id)))],
              ['Сбросить',     () => onChange(new Set())]].map(([lbl, fn]) => (
              <button key={lbl} type="button" onClick={fn} style={{
                fontSize: 11, padding: '2px 8px', border: '1px solid var(--rb-border)',
                borderRadius: 5, background: 'none', cursor: 'pointer', color: 'var(--rb-text-secondary)',
              }}>{lbl}</button>
            ))}
          </div>

          {/* List */}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Не найдено</div>
              : filtered.map(d => (
                <label key={d.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 14px', cursor: 'pointer', fontSize: 13,
                  background: selectedIds.has(d.id) ? '#EFF6FF' : 'transparent',
                }}>
                  <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggle(d.id)}
                    style={{ accentColor: 'var(--rb-primary)', width: 14, height: 14, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                </label>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schedule preset helpers ───────────────────────────────────────────────────
function parseDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }

function isDayScheduled(entry, year, month, day) {
  const d    = new Date(year, month - 1, day);
  const from = parseDate(entry.dateFrom);
  const to   = parseDate(entry.dateTo);
  if (d < from || d > to) return false;
  const { pattern } = entry;
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
  switch (pattern.type) {
    case 'daily':    return true;
    case 'workdays': return dow <= 4;
    case 'two_two': {
      const diff = Math.round((d - from) / 86400000);
      return diff % 4 < 2;
    }
    case 'weekdays': return (pattern.weekdays || []).includes(dow);
    case 'even_odd': return pattern.evenOdd === 'even' ? d.getDate() % 2 === 0 : d.getDate() % 2 === 1;
    case 'custom': {
      const diff  = Math.round((d - from) / 86400000);
      const cycle = (pattern.workDays || 1) + (pattern.restDays || 1);
      return diff % cycle < (pattern.workDays || 1);
    }
    default: return false;
  }
}

function calcHoursFromTimes(timeFrom, timeTo) {
  const [fh, fm] = (timeFrom || '09:00').split(':').map(Number);
  const [th, tm] = (timeTo   || '18:00').split(':').map(Number);
  const mins = (th * 60 + tm) - (fh * 60 + fm);
  if (mins <= 0) return '';
  const h = Math.round(mins / 60 * 2) / 2; // round to nearest 0.5
  return String(h);
}

// Build { [docId]: { [day]: { code: 'Я', hours: '8' } } } from loaded schedules
// Fill absence reasons into payData rows/cols sequentially.
// Cols 6+7 handle up to 4 reasons (rows 0-3), then overflow to cols 8+9.
function fillAbsencesIntoPayData(absenceList) {
  // absenceList: [{ code, hours }, ...]  — only non-'В' reasons
  const pay = {};
  absenceList.forEach(({ code, hours }, i) => {
    if (i < 4) {
      pay[`${i}_6`] = code;
      pay[`${i}_7`] = hours;
    } else if (i < 8) {
      pay[`${i - 4}_8`] = code;
      pay[`${i - 4}_9`] = hours;
    }
    // more than 8 distinct absence reasons is not expected
  });
  return pay;
}

function computePreset(doctors, schedulesMap, year, month, holidaySet) {
  const lastDay  = new Date(year, month, 0).getDate();
  const entries  = {};
  const payData  = {};

  for (const doc of doctors) {
    const docEntries = schedulesMap[doc.id] || [];
    entries[doc.id]  = {};

    // Track absence codes → { days, hours } (preserving insertion order)
    const absenceTotals = {}; // { code: { days, hours } }

    for (let day = 1; day <= lastDay; day++) {
      const dateStr  = `${year}-${pad2(month)}-${pad2(day)}`;
      const covering = docEntries.find(e => isDayScheduled(e, year, month, day));

      if (!covering) {
        // No schedule → выходной (not recorded in Неявки)
        entries[doc.id][day] = { code: 'В', hours: '' };
      } else {
        const excEntry = (covering.exceptions || []).find(ex =>
          typeof ex === 'string' ? ex === dateStr : ex.date === dateStr
        );
        if (excEntry !== undefined) {
          // Cancelled → use the specified code (legacy string exceptions default to ОТ)
          const code = (typeof excEntry === 'object' && excEntry.code) ? excEntry.code : 'ОТ';
          entries[doc.id][day] = { code, hours: '' };
          const h = parseFloat(calcHoursFromTimes(covering.timeFrom, covering.timeTo)) || 0;
          if (!absenceTotals[code]) absenceTotals[code] = { days: 0, hours: 0 };
          absenceTotals[code].days  += 1;
          absenceTotals[code].hours += h;
        } else {
          // Normal working day — use РВ on public holidays
          entries[doc.id][day] = {
            code:  holidaySet?.has(dateStr) ? 'РВ' : 'Я',
            hours: calcHoursFromTimes(covering.timeFrom, covering.timeTo),
          };
        }
      }
    }

    // Build Неявки list (skip 'В' — it's just a normal day-off)
    const absenceList = Object.entries(absenceTotals)
      .filter(([code]) => code !== 'В')
      .map(([code, { days, hours }]) => ({
        code,
        hours: `${days} (${hours})`,
      }));

    if (absenceList.length) {
      payData[doc.id] = fillAbsencesIntoPayData(absenceList);
    }
  }

  return { entries, payData };
}

// ── Split entries by norm: returns mainEntries and combEntries ────────────────
function splitByNorm(dayEntries, normHours, lastDay) {
  const mainEntries = {};
  const combEntries = {};
  let accumulated = 0;

  for (let day = 1; day <= lastDay; day++) {
    const entry = dayEntries[day] || { code: 'В', hours: '' };
    const h = parseFloat(entry.hours) || 0;

    if (h === 0) {
      mainEntries[day] = { ...entry };
      combEntries[day] = { ...entry };
    } else if (accumulated >= normHours - 0.001) {
      mainEntries[day] = { code: 'В', hours: '' };
      combEntries[day] = { ...entry };
    } else if (accumulated + h <= normHours + 0.001) {
      mainEntries[day] = { ...entry };
      combEntries[day] = { code: 'В', hours: '' };
      accumulated += h;
    } else {
      const mainH = Math.round((normHours - accumulated) * 100) / 100;
      const combH = Math.round((h - mainH) * 100) / 100;
      mainEntries[day] = { code: entry.code, hours: mainH > 0 ? String(mainH) : '' };
      combEntries[day] = { code: entry.code, hours: combH > 0 ? String(combH) : '' };
      accumulated = normHours;
    }
  }

  return { mainEntries, combEntries };
}

// ── Detailed preset: one virtual row per doctor×category ─────────────────────
function computeDetailedPreset(doctors, schedulesMap, year, month, categoriesMap, holidaySet, roleNormsMap = {}, categoryNormsMap = {}) {
  const lastDay = new Date(year, month, 0).getDate();
  const virtualDoctors = [];
  const entries  = {};
  const payData  = {};

  for (const doc of doctors) {
    const docEntries = schedulesMap[doc.id] || [];

    // Group schedule entries by categoryId, then by roleTitle as fallback
    const groups = {};
    for (const entry of docEntries) {
      const key = entry.categoryId || entry.roleTitle || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    }

    for (const [categoryKey, groupEntries] of Object.entries(groups)) {
      // Skip uncategorized entries in detailed view
      if (categoryKey === '__none__') continue;
      const isRoleTitleKey = !categoryKey.match(/^[0-9a-f-]{36}$/i) && categoryKey !== '__none__';
      const categoryId    = (categoryKey === '__none__' || isRoleTitleKey) ? null : categoryKey;
      const category      = categoryId ? categoriesMap[categoryId] : null;
      const categoryLabel = category?.name || groupEntries[0]?.roleTitle || null;

      const vid = `${doc.id}__${categoryKey}`;
      const dayEntries  = {};
      const absenceTotals = {};

      for (let day = 1; day <= lastDay; day++) {
        const dateStr  = `${year}-${pad2(month)}-${pad2(day)}`;
        const covering = groupEntries.find(e => isDayScheduled(e, year, month, day));

        if (!covering) {
          dayEntries[day] = { code: 'В', hours: '' };
        } else {
          const excEntry = (covering.exceptions || []).find(ex =>
            typeof ex === 'string' ? ex === dateStr : ex.date === dateStr
          );
          if (excEntry !== undefined) {
            const code = (typeof excEntry === 'object' && excEntry.code) ? excEntry.code : 'ОТ';
            dayEntries[day] = { code, hours: '' };
            const h = parseFloat(calcHoursFromTimes(covering.timeFrom, covering.timeTo)) || 0;
            if (!absenceTotals[code]) absenceTotals[code] = { days: 0, hours: 0 };
            absenceTotals[code].days  += 1;
            absenceTotals[code].hours += h;
          } else {
            // Normal working day — use РВ on public holidays
            dayEntries[day] = {
              code:  holidaySet?.has(dateStr) ? 'РВ' : 'Я',
              hours: calcHoursFromTimes(covering.timeFrom, covering.timeTo),
            };
          }
        }
      }

      const absenceList = Object.entries(absenceTotals)
        .filter(([code]) => code !== 'В')
        .map(([code, { days, hours }]) => ({ code, hours: `${days} (${hours})` }));

      // Determine applicable hour norm (category norm takes priority over role norm)
      let norm = null;
      if (categoryId && categoryNormsMap[categoryId] != null) {
        norm = categoryNormsMap[categoryId];
      } else {
        for (const role of (doc.roles || [])) {
          if (roleNormsMap[role] != null) { norm = roleNormsMap[role]; break; }
        }
      }

      const totalHours = Object.values(dayEntries).reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);

      if (norm != null && totalHours > norm + 0.001) {
        const { mainEntries, combEntries } = splitByNorm(dayEntries, norm, lastDay);
        entries[vid] = mainEntries;
        if (absenceList.length) payData[vid] = fillAbsencesIntoPayData(absenceList);
        virtualDoctors.push({ ...doc, id: vid, categoryLabel });

        const combVid = `${vid}__comb`;
        entries[combVid] = combEntries;
        virtualDoctors.push({ ...doc, id: combVid, categoryLabel: `${categoryLabel} (Совмещение)` });
      } else {
        entries[vid] = dayEntries;
        if (absenceList.length) payData[vid] = fillAbsencesIntoPayData(absenceList);
        virtualDoctors.push({ ...doc, id: vid, categoryLabel });
      }
    }
  }

  return { virtualDoctors, entries, payData };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StepWorkTime({ doctors = [], readOnly, clinics = [], getClinicName }) {
  const { user } = useAuth();
  const now = new Date();

  const [divisions,       setDivisions]       = useState([]);
  const [subdivision,     setSubdivision]     = useState('');
  const [selectedIds,     setSelectedIds]     = useState(new Set());
  const [year,            setYear]            = useState(now.getFullYear());
  const [month,           setMonth]           = useState(now.getMonth() + 1);
  const [orgName,         setOrgName]         = useState('');
  const [docNumber,       setDocNumber]       = useState('1');
  const [tabelType,       setTabelType]       = useState('standard');
  const [showDoc,         setShowDoc]         = useState(false);
  const [presetEntries,   setPresetEntries]   = useState({});
  const [presetPayData,   setPresetPayData]   = useState({});
  const [virtualDoctors,  setVirtualDoctors]  = useState([]);
  const [holidays,        setHolidays]        = useState([]);
  const [tableKey,        setTableKey]        = useState(0);
  const [generating,      setGenerating]      = useState(false);
  const [saving,          setSaving]          = useState(false);
  const tabelRef = useRef(null);

  useEffect(() => {
    divisionsApi.list()
      .then(res => setDivisions(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  const applyDivision = useCallback((div) => {
    const validIds = new Set(
      (div.doctorIds || []).filter(id => doctors.some(d => d.id === id))
    );
    setSelectedIds(validIds);
    setSubdivision(div.name);
  }, [doctors]);

  const lastDay    = new Date(year, month, 0).getDate();
  const periodFrom = `01.${pad2(month)}.${year}`;
  const periodTo   = `${pad2(lastDay)}.${pad2(month)}.${year}`;
  const docDate    = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`;

  const selectedDoctors = useMemo(
    () => doctors.filter(d => selectedIds.has(d.id)),
    [doctors, selectedIds]
  );

  const userName = (() => {
    const full = user?.displayName || '';
    const parts = full.trim().split(/\s+/);
    if (parts.length >= 2) {
      const [last, ...rest] = parts;
      return last + ' ' + rest.map(p => p[0].toUpperCase() + '.').join(' ');
    }
    return full || user?.username || '';
  })();

  const handleGenerate = async () => {
    if (!subdivision.trim())    { toast.error('Укажите структурное подразделение'); return; }
    if (selectedIds.size === 0) { toast.error('Выберите сотрудников'); return; }
    if (!orgName)               { toast.error('Выберите наименование организации'); return; }

    setGenerating(true);
    try {
      const selected = doctors.filter(d => selectedIds.has(d.id));

      // Load schedules, holidays, and doctor headers in parallel
      const [schedResults, holidayRes, headerRes] = await Promise.all([
        Promise.all(
          selected.map(doc =>
            schedulesApi.list(doc.id)
              .then(res => ({ docId: doc.id, entries: res.data }))
              .catch(() => ({ docId: doc.id, entries: [] }))
          )
        ),
        holidaysApi.list().catch(() => ({ data: [] })),
        doctorHeadersApi.list().catch(() => ({ data: [] })),
      ]);

      const schedulesMap = {};
      for (const { docId, entries } of schedResults) {
        schedulesMap[docId] = entries;
      }

      // Build tabelNumber lookup: misUserId → tabelNumber
      const tabelNumMap = {};
      (headerRes.data || []).forEach(h => { tabelNumMap[h.misUserId] = h.tabelNumber || ''; });

      // Enrich doctors with tabelNumber
      const selectedWithNum = selected.map(d => ({ ...d, tabelNumber: tabelNumMap[d.id] || '' }));

      // Holidays: keep as array of date strings 'YYYY-MM-DD' and a Set for fast lookup
      const holidayDates = (holidayRes.data || []).map(h => h.date);
      const holidaySet   = new Set(holidayDates);
      setHolidays(holidayDates);

      if (tabelType === 'detailed') {
        const [catRes, roleNormRes, catNormRes] = await Promise.all([
          dictsApi.listCategories().catch(() => ({ data: [] })),
          roleNormsApi.get(year, month).catch(() => ({ data: [] })),
          categoryNormsApi.get(year, month).catch(() => ({ data: [] })),
        ]);
        const categoriesMap = {};
        (catRes.data || []).forEach(c => { categoriesMap[c.id] = c; });
        const roleNormsMap = {};
        (roleNormRes.data || []).forEach(n => { if (n.normHours != null) roleNormsMap[n.roleTitle] = parseFloat(n.normHours); });
        const categoryNormsMap = {};
        (catNormRes.data || []).forEach(n => { if (n.normHours != null && n.categoryId) categoryNormsMap[n.categoryId] = parseFloat(n.normHours); });
        const { virtualDoctors: vd, entries: preset, payData: presetPay } =
          computeDetailedPreset(selectedWithNum, schedulesMap, year, month, categoriesMap, holidaySet, roleNormsMap, categoryNormsMap);
        setVirtualDoctors(vd);
        setPresetEntries(preset);
        setPresetPayData(presetPay);
      } else {
        const { entries: preset, payData: presetPay } = computePreset(selectedWithNum, schedulesMap, year, month, holidaySet);
        setPresetEntries(preset);
        setPresetPayData(presetPay);
      }

      setTableKey(k => k + 1);
      setShowDoc(true);
    } finally {
      setGenerating(false);
    }
  };

  const tabelDoctors = tabelType === 'detailed' ? virtualDoctors : selectedDoctors;

  const handleSave = async () => {
    if (!tabelRef.current) return;
    const { entries, payData } = tabelRef.current.getSnapshot();
    setSaving(true);
    try {
      const doctorsPayload = tabelDoctors.map(d => ({
        misUserId:     d.id,
        doctorName:    d.name,
        roles:         d.roles || [],
        professions:   d.professions || [],
        categoryLabel: d.categoryLabel || null,
        entries:       entries[d.id]  || {},
        payData:       payData[d.id]  || {},
      }));
      await tabelApi.create({
        month, year, orgName, subdivision, docNumber, userName,
        doctors: doctorsPayload,
      });
      toast.success('Табель сохранён в архив');
    } catch {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!tabelRef.current) return;
    const { entries, payData } = tabelRef.current.getSnapshot();
    const isDetailed = tabelType === 'detailed';
    const record = {
      month, year, orgName, subdivision, docNumber, userName,
      doctors: tabelDoctors.map(d => ({
        misUserId:     d.id,
        doctorName:    d.name,
        roles:         d.roles || [],
        professions:   d.professions || [],
        categoryLabel: d.categoryLabel || null,
        entries:       entries[d.id] || {},
        payData:       payData[d.id] || {},
      })),
    };
    try {
      const prefix = isDetailed ? 'Табель_детализированный' : 'Табель';
      await downloadTabelExcel(record, null,
        `${prefix}_${year}_${pad2(month)}_${subdivision || 'таб'}.xlsx`);
    } catch {
      toast.error('Ошибка при генерации Excel');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* ── Settings toolbar ── */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--rb-border)',
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end',
        background: 'var(--rb-bg)',
      }}>
        {!readOnly && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Тип табеля</label>
            <div style={{ display: 'flex', gap: 0 }}>
              {[['standard', 'Стандартный'], ['detailed', 'Детализированный']].map(([val, label]) => (
                <button key={val} type="button"
                  onClick={() => { setTabelType(val); setShowDoc(false); }}
                  style={{
                    height: 34, padding: '0 14px', fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--rb-border-dark)',
                    borderRight: val === 'standard' ? 'none' : undefined,
                    borderRadius: val === 'standard' ? '6px 0 0 6px' : '0 6px 6px 0',
                    background: tabelType === val ? 'var(--rb-primary)' : '#fff',
                    color: tabelType === val ? '#fff' : 'var(--rb-text-secondary)',
                    cursor: 'pointer',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Организация</label>
          <select className="rb-select" value={orgName} onChange={e => setOrgName(e.target.value)}
            disabled={readOnly} style={{ height: 34, padding: '0 10px', width: '100%' }}>
            <option value="">Выберите организацию</option>
            {ORGS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {divisions.length > 0 && !readOnly && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Структурное подразделение</label>
            <select
              className="rb-select"
              style={{ height: 34, padding: '0 10px', width: '100%' }}
              value={divisions.find(d => d.name === subdivision)?.id || ''}
              onChange={e => {
                const div = divisions.find(d => d.id === e.target.value);
                if (div) applyDivision(div);
              }}
            >
              <option value="">Выбрать...</option>
              {divisions.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>Период</label>
          <MonthYearPicker
            year={year} month={month}
            onChange={(y, m) => { setYear(y); setMonth(m); }}
            disabled={readOnly}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--rb-text-secondary)' }}>№ документа</label>
          <input type="text" value={docNumber} onChange={e => setDocNumber(e.target.value)}
            disabled={readOnly}
            style={{
              height: 34, padding: '0 12px', borderRadius: 8, width: 70,
              border: '1px solid var(--rb-border-dark)', fontSize: 13,
              background: '#fff', color: 'var(--rb-text)', textAlign: 'center',
            }} />
        </div>

        {!readOnly && (
          <button className="rb-btn rb-btn-primary" onClick={handleGenerate}
            disabled={generating}
            style={{ height: 34, alignSelf: 'flex-end', justifyContent: 'center', opacity: generating ? 0.6 : 1 }}>
            {generating ? 'Загрузка...' : 'Расчёт'}
          </button>
        )}

        {showDoc && !readOnly && (<>
          <button className="rb-btn rb-btn-primary" onClick={handleSave}
            disabled={saving}
            style={{ height: 34, alignSelf: 'flex-end', justifyContent: 'center', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button className="rb-btn rb-btn-primary" onClick={handleDownloadExcel}
            style={{ height: 34, alignSelf: 'flex-end', justifyContent: 'center' }}>
            Скачать
          </button>
        </>)}
      </div>

      {/* ── Document view ── */}
      {showDoc ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#f1f5f9' }}>
          <div className="tabel-doc">

            {/* 0. Шапка — форма Т-13, правый угол */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 8, fontFamily: 'Times New Roman, serif', lineHeight: 1.5 }}>
                  Унифицированная форма № Т-13<br />
                  Утверждена Постановлением Госкомстата<br />
                  России от 05.01.2004 № 1
                </div>
                <table style={{ borderCollapse: 'collapse', marginTop: 6, marginLeft: 'auto', fontSize: 8, fontFamily: 'Times New Roman, serif' }}>
                  <tbody>
                    <tr>
                      <td style={{ border: 'none', padding: '1px 8px 1px 0', textAlign: 'right' }}></td>
                      <td style={{ border: '1px solid #000', padding: '2px 8px', textAlign: 'center' }}>Код</td>
                    </tr>
                    <tr>
                      <td style={{ border: 'none', padding: '1px 8px 1px 0', textAlign: 'right' }}>Форма по ОКУД</td>
                      <td style={{ border: '1px solid #000', padding: '2px 8px', textAlign: 'center' }}>0301008</td>
                    </tr>
                    <tr>
                      <td style={{ border: 'none', padding: '1px 8px 1px 0', textAlign: 'right' }}>по ОКПО</td>
                      <td style={{ border: '1px solid #000', padding: '2px 8px', textAlign: 'center' }}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 1. Наименование организации */}
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 460 }}>
                <div style={{
                  borderBottom: '1px solid #000', width: '100%',
                  minHeight: 22, paddingBottom: 2, textAlign: 'center',
                  fontSize: 13, fontFamily: 'Times New Roman, serif',
                }}>
                  {orgName}
                </div>
                <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#000', marginTop: 2 }}>
                  (наименование организации)
                </span>
              </div>
            </div>

            {/* 2. Структурное подразделение — по центру, как поле подписи */}
            <div style={{ textAlign: 'center', marginTop: 10, marginBottom: 12 }}>
              <div style={{
                display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 460,
              }}>
                <div style={{
                  borderBottom: '1px solid #000', width: '100%', minHeight: 22,
                  textAlign: 'center', fontSize: 13,
                  fontFamily: 'Times New Roman, serif', paddingBottom: 2,
                }}>
                  {subdivision}
                </div>
                <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#000', marginTop: 2 }}>
                  (структурное подразделение)
                </span>
              </div>
            </div>

            {/* 3. Мета-таблица (справа) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 12px' }}>
              <table className="tabel-meta-table">
                <thead>
                  <tr>
                    <th>Номер документа</th>
                    <th>Дата составления</th>
                    <th colSpan={2}>Отчётный период</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{docNumber}</td>
                    <td>{docDate}</td>
                    <td>{periodFrom}</td>
                    <td>{periodTo}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 4. Заголовок */}
            <div className="tabel-title">ТАБЕЛЬ УЧЁТА РАБОЧЕГО ВРЕМЕНИ</div>

            {/* 5. Таблица */}
            <TabelTable
              key={tableKey}
              ref={tabelRef}
              selectedDoctors={tabelDoctors}
              year={year}
              month={month}
              readOnly={readOnly}
              initialEntries={presetEntries}
              initialPayData={presetPayData}
            />

            {/* 6. Подписи */}
            <div style={{ marginTop: 36 }}>
              <SigBlock name={userName} />
            </div>

          </div>
        </div>
      ) : (
        <div className="rb-loading" style={{ color: 'var(--rb-text-secondary)', marginTop: 60, minHeight: 320 }}>
          Заполните параметры и нажмите «Расчёт»
        </div>
      )}
    </div>
  );
}
