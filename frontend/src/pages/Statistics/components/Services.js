import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TabServices } from './Directories';
import { useTabSlider } from '../../ReferralBonuses/utils/useTabSlider';
import { BASE_URL } from '../../../services/api';

const PS_API = BASE_URL + '/api/partner-services';

function psApi(path, opts = {}, ms = 15000) {
  const token = localStorage.getItem('token');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(PS_API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body,
    signal: ctrl.signal,
  }).then(r => { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(e => { clearTimeout(t); if (e.name === 'AbortError') throw new Error(`Таймаут (${Math.round(ms/1000)} сек)`); throw e; });
}

function fmtPrice(p) {
  return parseFloat(p).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽';
}

function filterTree(nodes, search) {
  if (!search) return nodes.filter(n => n.totalCount > 0);
  return nodes.reduce((acc, n) => {
    const match = n.name.toLowerCase().includes(search);
    const children = filterTree(n.children || [], search);
    if (match || children.length > 0) acc.push({ ...n, children });
    return acc;
  }, []);
}

function escWithMarkers(val) {
  if (val == null || val === '') return '—';
  const s = String(val);
  const e = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let r = e(s);
  r = r.replace(/ /g, '<mark class="ps-nbspm" title="Неразрывный пробел (NBSP)">NBSP</mark>');
  r = r.replace(/​/g, '<mark class="ps-nbspm" title="Zero-width space">ZWS</mark>');
  r = r.replace(/﻿/g,  '<mark class="ps-nbspm" title="BOM">BOM</mark>');
  r = r.replace(/‌/g,  '<mark class="ps-nbspm" title="Zero-width non-joiner">ZWNJ</mark>');
  r = r.replace(/‍/g,  '<mark class="ps-nbspm" title="Zero-width joiner">ZWJ</mark>');
  r = r.replace(/^( +)/, m => `<mark class="ps-spm" title="Пробел в начале строки">${m}</mark>`);
  r = r.replace(/( +)$/, m => `<mark class="ps-spm" title="Пробел в конце строки">${m}</mark>`);
  r = r.replace(/( {2,})/g, m => `<mark class="ps-spm" title="Лишние пробелы">${m}</mark>`);
  return r;
}

function highlightHtml(text, search) {
  const e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!search) return e(text);
  const idx = text.toLowerCase().indexOf(search);
  if (idx === -1) return e(text);
  return e(text.slice(0, idx)) + '<em>' + e(text.slice(idx, idx + search.length)) + '</em>' + e(text.slice(idx + search.length));
}

function PsTreeNode({ node, level, search, clinicId }) {
  const [open, setOpen] = useState(!!search);
  const [services, setServices] = useState(null);
  const [svcLoading, setSvcLoading] = useState(false);

  const hasChildren = (node.children || []).filter(c => c.totalCount > 0).length > 0;
  const needsSvcs = node.selfCount > 0 || !hasChildren;

  function loadSvcs() {
    setSvcLoading(true);
    const p = new URLSearchParams({ clinic_id: clinicId, limit: 500, page: 1 });
    if (node.categoryId) p.set('category_id', node.categoryId);
    else p.set('category', node.categoryTitle);
    psApi('/?' + p, {}, 30000)
      .then(r => setServices(r.success ? r.data : []))
      .catch(() => setServices([]))
      .finally(() => setSvcLoading(false));
  }

  useEffect(() => {
    if (open && needsSvcs && services === null) loadSvcs();
  }, [open]); // eslint-disable-line

  const hasLab = services?.some(s => !!s.lab);

  return (
    <div className="ps-tree-node">
      <div className={`ps-tree-header level-${level}`} onClick={() => setOpen(v => !v)}>
        <svg className={`ps-tree-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        {level === 0
          ? <svg className="ps-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          : <svg className="ps-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/></svg>
        }
        <span className="ps-tree-name" dangerouslySetInnerHTML={{ __html: highlightHtml(node.name, search) }} />
        <span className="ps-tree-count">{node.totalCount}</span>
      </div>
      {open && (
        <div className="ps-tree-children open">
          {hasChildren && filterTree(node.children || [], search).map(child => (
            <PsTreeNode key={child.categoryId || child.name} node={child} level={level + 1} search={search} clinicId={clinicId} />
          ))}
          {needsSvcs && (svcLoading
            ? <div style={{ padding: '8px 16px 8px 60px', fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="ps-spinner" style={{ width: 14, height: 14, borderWidth: 2, flexShrink: 0 }} />Загрузка услуг...
              </div>
            : services?.length > 0 && (
              <div className="ps-tree-services">
                <table className="ps-tree-services-table">
                  <thead><tr>
                    <th>Артикул</th><th>Код 804н</th>
                    <th className="col-name" style={{ minWidth: 220 }}>Название</th>
                    <th>Стоимость</th><th>Длит.</th>
                    {hasLab && <th>Лаборатория</th>}
                  </tr></thead>
                  <tbody>
                    {services.map((s, i) => (
                      <tr key={s.id || i}>
                        <td>{s.code || '—'}</td>
                        <td>{s.subCode || '—'}</td>
                        <td className="col-name">{s.title}</td>
                        <td className="col-price">{s.price ? fmtPrice(s.price) : '—'}</td>
                        <td>{s.duration ? s.duration + ' мин' : '—'}</td>
                        {hasLab && <td>{s.lab || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {services.length >= 500 && (
                  <div style={{ padding: '4px 10px 8px', fontSize: 12, color: '#9ca3af' }}>Показано первые 500</div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function TabPartnerServices() {
  const [clinics, setClinics] = useState([]);
  const [clinicId, setClinicId] = useState(null);
  const [clinicDdOpen, setClinicDdOpen] = useState(false);
  const [view, setView] = useState('table');
  const [isAdmin, setIsAdmin] = useState(false);

  // Table
  const [tableData, setTableData] = useState([]);
  const [tablePag, setTablePag] = useState(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState({ field: 'title', dir: 'asc' });
  const [filters, setFilters] = useState({ code: '', subCode: '', title: '', category: '', lab: '' });
  const [filterLists, setFilterLists] = useState({ category: [], lab: [] });
  const [openDd, setOpenDd] = useState(null);
  const [ddPos, setDdPos] = useState({});
  const catBtnRef = useRef();
  const labBtnRef = useRef();
  const fiTimerRef = useRef();

  // Tree
  const [treeData, setTreeData] = useState(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeSearch, setTreeSearch] = useState('');

  // Checks
  const [checks, setChecks] = useState(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksError, setChecksError] = useState(null);

  // Price errors
  const [priceErr, setPriceErr] = useState(null);
  const [priceErrLoading, setPriceErrLoading] = useState(false);
  const [priceErrError, setPriceErrError] = useState(null);

  // ── Init ──
  useEffect(() => {
    fetch(BASE_URL + '/api/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.json()).then(me => setIsAdmin(!!me?.isAdmin)).catch(() => {});
    psApi('/clinics').then(res => {
      if (!res.success) return;
      setClinics(res.data);
      if (res.data.length > 0) setClinicId(res.data[0].id);
    }).catch(() => {});
  }, []);

  // ── Filter lists ──
  useEffect(() => {
    if (!clinicId) return;
    psApi(`/categories?clinic_id=${clinicId}`)
      .then(r => setFilterLists(prev => ({ ...prev, category: r.success ? r.data.map(c => c.title) : [] })))
      .catch(() => {});
    psApi(`/labs?clinic_id=${clinicId}`)
      .then(r => setFilterLists(prev => ({ ...prev, lab: r.success ? r.data : [] })))
      .catch(() => {});
  }, [clinicId]);

  // ── Table load ──
  useEffect(() => {
    if (!clinicId || view !== 'table') return;
    setTableLoading(true);
    setTableError(null);
    const p = new URLSearchParams({ clinic_id: clinicId, page, limit });
    if (filters.code)     p.set('filter_code', filters.code);
    if (filters.subCode)  p.set('filter_subcode', filters.subCode);
    if (filters.title)    p.set('filter_title', filters.title);
    if (filters.category) p.set('category', filters.category);
    if (filters.lab)      p.set('lab', filters.lab);
    psApi('/?' + p)
      .then(r => { if (!r.success) { setTableError(r.error || 'Ошибка'); setTableData([]); return; } setTableData(r.data); setTablePag(r.pagination); })
      .catch(e => setTableError(e.message))
      .finally(() => setTableLoading(false));
  }, [clinicId, view, page, limit, filters]);

  // ── Tree load ──
  useEffect(() => {
    if (!clinicId || view !== 'tree') return;
    setTreeData(null);
    setTreeLoading(true);
    psApi(`/tree-structure?clinic_id=${clinicId}`)
      .then(r => setTreeData(r.success ? (r.data || []) : []))
      .catch(() => setTreeData([]))
      .finally(() => setTreeLoading(false));
  }, [clinicId, view]);

  // ── Checks load ──
  useEffect(() => {
    if (!clinicId || view !== 'checks' || !isAdmin) return;
    setChecksLoading(true); setChecksError(null); setChecks(null);
    psApi(`/?clinic_id=${clinicId}&limit=9999&page=1`, {}, 60000).then(r => {
      if (!r.success) { setChecksError(r.error || 'Ошибка'); return; }
      const INVIS = /[\u00a0\u200b\u200c\u200d\u2060\ufeff\u2000-\u200a\u202f\u205f\u3000]/;
      function hasExtra(v) {
        if (!v) return false;
        const s = String(v);
        return /^\s/.test(s) || /\s$/.test(s) || INVIS.test(s) || /  /.test(s);
      }
      // \u041a\u043e\u0434 804\u043d: \u043b\u0430\u0442\u0438\u043d\u0441\u043a\u0430\u044f A/B + 2 \u0446\u0438\u0444\u0440\u044b, \u0434\u0430\u043b\u0435\u0435 \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u044b \u0438\u0437 \u0446\u0438\u0444\u0440 \u0447\u0435\u0440\u0435\u0437 \u0442\u043e\u0447\u043a\u0443 (A21.01.010)
      const SUBCODE_804N = /^[AB]\d{2}(\.\d+)+$/;
      function bad804n(v) {
        if (!v) return false;
        const s = String(v).trim();
        if (!s) return false;
        return !SUBCODE_804N.test(s);
      }
      const problems = r.data.reduce((acc, s) => {
        const fields = [];
        if (hasExtra(s.code))    fields.push('code');
        if (hasExtra(s.subCode)) fields.push('subCode');
        if (hasExtra(s.title))   fields.push('title');
        if (bad804n(s.subCode))  fields.push('subCodeFormat');
        if (fields.length) acc.push({ service: s, fields });
        return acc;
      }, []);
      setChecks({ problems, total: r.pagination?.total ?? r.data.length });
    }).catch(e => setChecksError(e.message)).finally(() => setChecksLoading(false));
  }, [clinicId, view, isAdmin]);

  // ── Price errors load ──
  useEffect(() => {
    if (!clinicId || view !== 'price-err' || !isAdmin) return;
    setPriceErrLoading(true); setPriceErrError(null); setPriceErr(null);
    psApi(`/price-errors?clinic_id=${clinicId}`, {}, 30000)
      .then(r => { if (!r.success) { setPriceErrError(r.error || 'Ошибка'); return; } setPriceErr({ data: r.data, total: r.total || 0 }); })
      .catch(e => setPriceErrError(e.message))
      .finally(() => setPriceErrLoading(false));
  }, [clinicId, view, isAdmin]);

  // ── Close dropdowns on outside click ──
  useEffect(() => {
    if (!clinicDdOpen) return;
    const h = e => { if (!e.target.closest('.ps-clinic-dd')) setClinicDdOpen(false); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [clinicDdOpen]);

  useEffect(() => {
    if (!openDd) return;
    const h = e => { if (!e.target.closest('.ps-fi-cell')) setOpenDd(null); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [openDd]);

  // ── Sort ──
  function toggleSort(field) {
    setSort(prev => ({ field, dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  }

  const sortedData = useMemo(() => {
    const { field, dir } = sort;
    return [...tableData].sort((a, b) => {
      const av = a[field] ?? '', bv = b[field] ?? '';
      const cmp = (field === 'price' || field === 'duration')
        ? (parseFloat(av) || 0) - (parseFloat(bv) || 0)
        : String(av).localeCompare(String(bv), 'ru');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [tableData, sort]);

  // ── Filters ──
  function onFilterChange(col, val) {
    clearTimeout(fiTimerRef.current);
    setFilters(prev => ({ ...prev, [col]: val }));
    fiTimerRef.current = setTimeout(() => setPage(1), 350);
  }

  function clearAllFilters() {
    setFilters({ code: '', subCode: '', title: '', category: '', lab: '' });
    setPage(1);
  }

  const hasActiveFilters = Object.values(filters).some(Boolean);

  // ── Filter dropdowns ──
  function openFilterDd(col) {
    const btn = col === 'category' ? catBtnRef.current : labBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setDdPos(prev => ({ ...prev, [col]: { top: r.bottom + 3, left: r.left } }));
    setOpenDd(col);
  }

  // ── Clinic ──
  function selectClinic(id) {
    setClinicId(id); setClinicDdOpen(false); setPage(1);
    setTableData([]); setTreeData(null); setChecks(null); setPriceErr(null);
  }

  function switchView(v) { setView(v); if (v === 'tree') setTreeSearch(''); }

  const currentClinic = clinics.find(c => c.id === clinicId);

  // ── Sort icon ──
  function SortIcon({ field }) {
    if (sort.field !== field) return <i className="sort-icon">↕</i>;
    return <i className="sort-icon" style={{ opacity: 1, color: '#3b82f6' }}>{sort.dir === 'asc' ? '↑' : '↓'}</i>;
  }

  // ── Pagination ──
  function Pagination() {
    if (!tablePag || tablePag.pages <= 1) return null;
    const { page: p, pages: tot, total: cnt, limit: lim } = tablePag;
    const from = (p - 1) * lim + 1, to = Math.min(p * lim, cnt);
    const pages = [1];
    if (p > 3) pages.push('…');
    for (let i = Math.max(2, p - 1); i <= Math.min(tot - 1, p + 1); i++) pages.push(i);
    if (p < tot - 2) pages.push('…');
    if (tot > 1) pages.push(tot);
    return (
      <div className="ps-pagination">
        <div className="ps-pagination-left">
          <span className="ps-pagination-info">{from}–{to} из {cnt.toLocaleString('ru-RU')}</span>
          {hasActiveFilters && (
            <button className="ps-clear-btn" onClick={clearAllFilters}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 12, height: 12, verticalAlign: 'middle', marginRight: 3 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Сбросить фильтры
            </button>
          )}
          <div className="ps-limit-toggle">
            {[25, 50, 100].map(n => (
              <button key={n} className={`ps-limit-btn${limit === n ? ' active' : ''}`} onClick={() => { setLimit(n); setPage(1); }}>{n}</button>
            ))}
          </div>
        </div>
        <div className="ps-pagination-btns">
          <button className="ps-page-btn" disabled={p <= 1} onClick={() => setPage(p - 1)}>‹</button>
          {pages.map((pg, i) => pg === '…'
            ? <span key={i} className="ps-page-dots">…</span>
            : <button key={pg} className={`ps-page-btn${pg === p ? ' active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>
          )}
          <button className="ps-page-btn" disabled={p >= tot} onClick={() => setPage(p + 1)}>›</button>
        </div>
      </div>
    );
  }

  const treeSearchLC = treeSearch.toLowerCase();

  return (
    <>
      <style>{PS_CSS}</style>

      {/* Top bar */}
      <div className="ps-topbar">
        <div className="ps-clinic-dd">
          <button className={`ps-clinic-trigger${clinicDdOpen ? ' open' : ''}`} onClick={() => setClinicDdOpen(v => !v)}>
            <span className="ps-clinic-dot" style={{ background: currentClinic?.color || '#9ca3af' }} />
            <span>{currentClinic?.name || 'Загрузка...'}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {clinicDdOpen && (
            <div className="ps-clinic-list open">
              {clinics.map(c => (
                <div key={c.id} className={`ps-clinic-option${c.id === clinicId ? ' selected' : ''}`} onClick={() => selectClinic(c.id)}>
                  <span className="ps-clinic-dot" style={{ background: c.color || '#9ca3af' }} />
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ps-view-toggle">
          <button className={`ps-view-btn${view === 'table' ? ' active' : ''}`} onClick={() => switchView('table')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            Таблица
          </button>
          <button className={`ps-view-btn${view === 'tree' ? ' active' : ''}`} onClick={() => switchView('tree')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            Дерево услуг
          </button>
          {isAdmin
            ? <button className={`ps-view-btn btn-checks${view === 'checks' ? ' active' : ''}`} onClick={() => switchView('checks')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Проверки
              </button>
            : <button className="ps-view-btn btn-checks locked" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Проверки
              </button>
          }
          {isAdmin
            ? <button className={`ps-view-btn btn-price-err${view === 'price-err' ? ' active' : ''}`} onClick={() => switchView('price-err')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Ошибки цен
              </button>
            : <button className="ps-view-btn btn-price-err locked" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Ошибки цен
              </button>
          }
        </div>
      </div>

      {/* ── Table view ── */}
      {view === 'table' && (
        <div className="ps-table-container">
          <Pagination />
          <div className="ps-table-scroll">
            <table className="ps-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('code')}>Артикул <SortIcon field="code" /></th>
                  <th onClick={() => toggleSort('subCode')}>Код 804н <SortIcon field="subCode" /></th>
                  <th className="col-name" onClick={() => toggleSort('title')} style={{ minWidth: 260 }}>Название <SortIcon field="title" /></th>
                  <th className={`col-name${filters.category ? ' has-filter' : ''}`} onClick={() => toggleSort('categoryTitle')}>Категория <SortIcon field="categoryTitle" /></th>
                  <th onClick={() => toggleSort('price')}>Стоимость <SortIcon field="price" /></th>
                  <th onClick={() => toggleSort('duration')}>Длит. <SortIcon field="duration" /></th>
                  <th className={filters.lab ? 'has-filter' : ''} onClick={() => toggleSort('lab')}>Лаборатория <SortIcon field="lab" /></th>
                </tr>
                <tr className="ps-filter-row" onClick={e => e.stopPropagation()}>
                  <th><div className="ps-fi-cell"><input className={`ps-fi${filters.code ? ' active' : ''}`} placeholder="Поиск..." value={filters.code} onChange={e => onFilterChange('code', e.target.value)} /></div></th>
                  <th><div className="ps-fi-cell"><input className={`ps-fi${filters.subCode ? ' active' : ''}`} placeholder="Поиск..." value={filters.subCode} onChange={e => onFilterChange('subCode', e.target.value)} /></div></th>
                  <th className="col-name"><div className="ps-fi-cell"><input className={`ps-fi${filters.title ? ' active' : ''}`} placeholder="Поиск..." value={filters.title} onChange={e => onFilterChange('title', e.target.value)} /></div></th>
                  <th className="col-name">
                    <div className="ps-fi-cell">
                      <input className={`ps-fi${filters.category ? ' active' : ''}`} placeholder="Поиск..." value={filters.category} onChange={e => onFilterChange('category', e.target.value)} />
                      <button ref={catBtnRef} className={`ps-fi-dd-btn${openDd === 'category' ? ' open' : ''}`} onClick={() => openDd === 'category' ? setOpenDd(null) : openFilterDd('category')}>▾</button>
                      {openDd === 'category' && (
                        <div className="ps-fi-dropdown open" style={{ position: 'fixed', top: ddPos.category?.top, left: ddPos.category?.left }}>
                          {filterLists.category.filter(v => !filters.category || v.toLowerCase().includes(filters.category.toLowerCase()))
                            .map(v => <div key={v} className={`ps-fi-dd-item${filters.category === v ? ' selected' : ''}`} onClick={() => { setFilters(f => ({ ...f, category: v })); setOpenDd(null); setPage(1); }}>{v}</div>)
                          }
                          {filterLists.category.filter(v => !filters.category || v.toLowerCase().includes(filters.category.toLowerCase())).length === 0 && <div className="ps-fi-dd-empty">Нет значений</div>}
                        </div>
                      )}
                    </div>
                  </th>
                  <th />
                  <th />
                  <th>
                    <div className="ps-fi-cell">
                      <input className={`ps-fi${filters.lab ? ' active' : ''}`} placeholder="Поиск..." value={filters.lab} onChange={e => onFilterChange('lab', e.target.value)} />
                      <button ref={labBtnRef} className={`ps-fi-dd-btn${openDd === 'lab' ? ' open' : ''}`} onClick={() => openDd === 'lab' ? setOpenDd(null) : openFilterDd('lab')}>▾</button>
                      {openDd === 'lab' && (
                        <div className="ps-fi-dropdown open" style={{ position: 'fixed', top: ddPos.lab?.top, left: ddPos.lab?.left }}>
                          {filterLists.lab.filter(v => !filters.lab || v.toLowerCase().includes(filters.lab.toLowerCase()))
                            .map(v => <div key={v} className={`ps-fi-dd-item${filters.lab === v ? ' selected' : ''}`} onClick={() => { setFilters(f => ({ ...f, lab: v })); setOpenDd(null); setPage(1); }}>{v}</div>)
                          }
                          {filterLists.lab.filter(v => !filters.lab || v.toLowerCase().includes(filters.lab.toLowerCase())).length === 0 && <div className="ps-fi-dd-empty">Нет значений</div>}
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableLoading ? (
                  <tr><td colSpan={7} className="ps-loading"><div className="ps-spinner" />Загрузка...</td></tr>
                ) : tableError ? (
                  <tr><td colSpan={7} className="ps-empty" style={{ color: '#ef4444' }}>Ошибка: {tableError}</td></tr>
                ) : sortedData.length === 0 ? (
                  <tr><td colSpan={7} className="ps-empty">
                    {!hasActiveFilters && (!tablePag || tablePag.total === 0)
                      ? <div className="ps-no-cache"><p>Кэш услуг пуст</p><p className="hint">Данные загружаются ночью автоматически</p></div>
                      : 'Ничего не найдено по заданным фильтрам'}
                  </td></tr>
                ) : sortedData.map((s, i) => (
                  <tr key={s.id || i}>
                    <td>{s.code || '—'}</td>
                    <td>{s.subCode || '—'}</td>
                    <td className="col-name">{s.title}</td>
                    <td className="col-name">{s.categoryTitle || '—'}</td>
                    <td className="col-price">{s.price ? fmtPrice(s.price) : '—'}</td>
                    <td>{s.duration ? s.duration + ' мин' : '—'}</td>
                    <td>{s.lab || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tree view ── */}
      {view === 'tree' && (
        <div>
          <div className="ps-tree-search-wrap">
            <svg className="ps-tree-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" className="ps-tree-search" placeholder="Поиск по категориям..." value={treeSearch} onChange={e => setTreeSearch(e.target.value)} />
          </div>
          <div className="ps-tree" key={treeSearchLC}>
            {treeLoading
              ? <div className="ps-loading"><div className="ps-spinner" />Загрузка дерева...</div>
              : !treeData || treeData.length === 0
              ? <div className="ps-empty">Данных нет</div>
              : filterTree(treeData, treeSearchLC).map(node => (
                <PsTreeNode key={node.categoryId || node.name} node={node} level={0} search={treeSearchLC} clinicId={clinicId} />
              ))
            }
          </div>
        </div>
      )}

      {/* ── Checks view ── */}
      {view === 'checks' && (
        <div>
          {checksLoading && <div className="ps-table-container"><div className="ps-loading"><div className="ps-spinner" />Загрузка всех услуг для проверки...</div></div>}
          {checksError && <div className="ps-table-container"><div className="ps-empty" style={{ color: '#ef4444' }}>Ошибка: {checksError}</div></div>}
          {checks?.problems.length === 0 && (
            <div className="ps-checks-summary ps-checks-ok">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 4 }}><polyline points="20 6 9 17 4 12"/></svg>
              Ошибок не обнаружено в <strong>{checks.total.toLocaleString('ru-RU')}</strong> записях
            </div>
          )}
          {checks?.problems.length > 0 && (
            <>
              <div className="ps-checks-summary">
                Обнаружено <strong>{checks.problems.length}</strong> записей с ошибками из {checks.total.toLocaleString('ru-RU')}
              </div>
              <div className="ps-table-container"><div className="ps-table-scroll">
                <table className="ps-table">
                  <thead><tr>
                    <th>Артикул</th><th>Код 804н</th>
                    <th className="col-name" style={{ minWidth: 260 }}>Название</th>
                    <th className="col-name">Категория</th>
                    <th>Поля с ошибками</th>
                  </tr></thead>
                  <tbody>
                    {checks.problems.map(({ service: s, fields }, i) => {
                      const FIELD_NAMES = { code: 'Артикул', subCode: 'Код804н', title: 'Название', subCodeFormat: 'Код804н: формат' };
                      return (
                        <tr key={i}>
                          <td className={fields.includes('code') ? 'ps-check-cell' : ''} dangerouslySetInnerHTML={{ __html: escWithMarkers(s.code) }} />
                          <td className={fields.includes('subCode') || fields.includes('subCodeFormat') ? 'ps-check-cell' : ''} dangerouslySetInnerHTML={{ __html: escWithMarkers(s.subCode) }} />
                          <td className={`col-name${fields.includes('title') ? ' ps-check-cell' : ''}`} dangerouslySetInnerHTML={{ __html: escWithMarkers(s.title) }} />
                          <td className="col-name">{s.categoryTitle || '—'}</td>
                          <td className="ps-check-badge-cell">{fields.map(f => <span key={f} className="ps-check-badge">{FIELD_NAMES[f]}</span>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div></div>
            </>
          )}
        </div>
      )}

      {/* ── Price errors view ── */}
      {view === 'price-err' && (
        <div>
          {priceErrLoading && <div className="ps-table-container"><div className="ps-loading"><div className="ps-spinner" />Загрузка данных для проверки цен...</div></div>}
          {priceErrError && <div className="ps-table-container"><div className="ps-empty" style={{ color: '#ef4444' }}>Ошибка: {priceErrError}</div></div>}
          {priceErr?.data.length === 0 && (
            <div className="ps-perr-summary ps-perr-ok">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 4 }}><polyline points="20 6 9 17 4 12"/></svg>
              Ошибок ценообразования не обнаружено в <strong>{priceErr.total.toLocaleString('ru-RU')}</strong> записях
            </div>
          )}
          {priceErr?.data.length > 0 && (
            <>
              <div className="ps-perr-summary">
                Обнаружено <strong>{priceErr.data.length}</strong> услуг, где себестоимость превышает стоимость, из {priceErr.total.toLocaleString('ru-RU')}
              </div>
              <div className="ps-table-container"><div className="ps-table-scroll">
                <table className="ps-table">
                  <thead><tr>
                    <th>Артикул</th><th>Код 804н</th>
                    <th className="col-name" style={{ minWidth: 260 }}>Название</th>
                    <th className="col-name">Категория</th>
                    <th>Стоимость</th><th>Себестоимость</th>
                  </tr></thead>
                  <tbody>
                    {priceErr.data.map((s, i) => (
                      <tr key={i}>
                        <td>{s.code || '—'}</td>
                        <td>{s.subCode || '—'}</td>
                        <td className="col-name">{s.title}</td>
                        <td className="col-name">{s.categoryTitle || '—'}</td>
                        <td className="col-price">{fmtPrice(s.price)}</td>
                        <td className="ps-perr-cell" style={{ fontWeight: 600, color: '#b91c1c' }}>{fmtPrice(s.costPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </>
          )}
        </div>
      )}
    </>
  );
}

const PS_CSS = `
.ps-topbar { display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
.ps-clinic-dd { position:relative; }
.ps-clinic-trigger { display:inline-flex; align-items:center; gap:8px; padding:7px 10px 7px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:13px; font-weight:600; font-family:inherit; background:#fff; color:#111827; cursor:pointer; min-width:140px; white-space:nowrap; transition:border-color 0.15s; }
.ps-clinic-trigger:hover { border-color:#9ca3af; }
.ps-clinic-trigger.open { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.1); }
.ps-clinic-trigger svg { width:14px; height:14px; color:#9ca3af; margin-left:auto; flex-shrink:0; transition:transform 0.2s; }
.ps-clinic-trigger.open svg { transform:rotate(180deg); }
.ps-clinic-dot { width:10px; height:10px; border-radius:50%; background:#9ca3af; flex-shrink:0; }
.ps-clinic-list { position:absolute; top:calc(100% + 4px); left:0; min-width:100%; background:#fff; border:1px solid #e5e7eb; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.12); z-index:600; overflow:hidden; }
.ps-clinic-option { display:flex; align-items:center; gap:8px; padding:8px 14px; font-size:13px; font-weight:500; color:#374151; cursor:pointer; white-space:nowrap; }
.ps-clinic-option:hover { background:#f3f4f6; }
.ps-clinic-option.selected { background:#eff6ff; color:#1d4ed8; }
.ps-view-toggle { display:flex; background:#f3f4f6; border-radius:8px; padding:3px; gap:2px; margin-left:auto; }
.ps-view-btn { padding:6px 14px; border:none; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; background:transparent; color:#6b7280; display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; font-family:inherit; }
.ps-view-btn.active { background:#fff; color:#111827; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
.ps-view-btn svg { width:15px; height:15px; }
.ps-view-btn.btn-checks { color:#d97706; }
.ps-view-btn.btn-checks.active { background:#fff; color:#b45309; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
.ps-view-btn.btn-price-err { color:#dc2626; }
.ps-view-btn.btn-price-err.active { background:#fff; color:#b91c1c; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
.ps-view-btn.locked { color:#d1d5db; cursor:not-allowed; opacity:0.7; }
.ps-clear-btn { padding:4px 10px; font-size:12px; border:1px solid #d1d5db; border-radius:6px; background:#fff; cursor:pointer; color:#6b7280; font-family:inherit; }
.ps-clear-btn:hover { background:#f3f4f6; color:#374151; }
.ps-limit-toggle { display:flex; background:#f3f4f6; border-radius:7px; padding:2px; gap:2px; }
.ps-limit-btn { padding:4px 10px; border:none; border-radius:5px; font-size:12px; font-weight:500; cursor:pointer; background:transparent; color:#6b7280; font-family:inherit; }
.ps-limit-btn.active { background:#fff; color:#111827; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
.ps-table-container { background:#fff; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06); border:1px solid #e5e7eb; overflow:hidden; }
.ps-table-scroll { overflow-x:auto; }
.ps-table { width:100%; border-collapse:collapse; min-width:700px; }
.ps-table th { padding:10px 12px; background:#f8fafc; font-weight:600; font-size:11px; color:#4b5563; border-bottom:1px solid #e5e7eb; text-transform:uppercase; letter-spacing:0.4px; white-space:nowrap; text-align:center; cursor:pointer; user-select:none; }
.ps-table th:hover { background:#f1f5f9; }
.ps-table th .sort-icon { display:inline-block; margin-left:4px; opacity:0.4; font-style:normal; }
.ps-table th.has-filter { background:#eff6ff !important; color:#1d4ed8; }
.ps-table td { padding:9px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; color:#374151; vertical-align:middle; text-align:center; }
.ps-table td.col-name { text-align:left; }
.ps-table tr:hover td { background:#f8fafc; }
.ps-table tr:last-child td { border-bottom:none; }
.ps-table td.col-price { font-weight:600; color:#16a34a; }
.ps-filter-row th { padding:4px 6px; background:#fafafa; border-bottom:2px solid #e5e7eb; cursor:default; }
.ps-filter-row th:hover { background:#fafafa; }
.ps-fi-cell { position:relative; display:flex; align-items:center; gap:2px; }
.ps-fi { width:100%; padding:4px 7px; border:1px solid #d1d5db; border-radius:5px; font-size:12px; font-family:inherit; color:#374151; background:#fff; min-width:0; }
.ps-fi::placeholder { color:#9ca3af; }
.ps-fi:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,0.15); }
.ps-fi.active { border-color:#3b82f6; background:#eff6ff; }
.ps-fi-dd-btn { flex-shrink:0; padding:4px 5px; border:1px solid #d1d5db; border-radius:5px; background:#f9fafb; cursor:pointer; color:#6b7280; font-size:10px; line-height:1; }
.ps-fi-dd-btn:hover { background:#f3f4f6; color:#374151; border-color:#9ca3af; }
.ps-fi-dd-btn.open { background:#eff6ff; color:#3b82f6; border-color:#93c5fd; }
.ps-fi-dropdown { min-width:180px; background:#fff; border:1px solid #e5e7eb; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.12); z-index:1000; max-height:220px; overflow-y:auto; }
.ps-fi-dd-item { padding:7px 12px; font-size:12px; color:#374151; cursor:pointer; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ps-fi-dd-item:hover { background:#f3f4f6; }
.ps-fi-dd-item.selected { color:#3b82f6; background:#eff6ff; font-weight:500; }
.ps-fi-dd-empty { padding:8px 12px; font-size:12px; color:#9ca3af; }
.ps-pagination { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-wrap:wrap; gap:8px; }
.ps-pagination-left { display:flex; align-items:center; gap:10px; }
.ps-pagination-info { font-size:13px; color:#6b7280; }
.ps-pagination-btns { display:flex; gap:4px; align-items:center; }
.ps-page-btn { padding:5px 10px; border:1px solid #d1d5db; border-radius:6px; background:#fff; font-size:13px; cursor:pointer; color:#374151; min-width:32px; text-align:center; }
.ps-page-btn:hover:not(:disabled) { background:#f3f4f6; }
.ps-page-btn.active { background:#3b82f6; color:#fff; border-color:#3b82f6; }
.ps-page-btn:disabled { opacity:0.4; cursor:not-allowed; }
.ps-page-dots { padding:5px 4px; color:#9ca3af; font-size:13px; }
.ps-empty, .ps-loading, .ps-no-cache { text-align:center; padding:60px 20px; color:#9ca3af; }
.ps-no-cache p { margin:8px 0 0; font-size:14px; }
.ps-no-cache .hint { font-size:13px; color:#d1d5db; margin-top:4px; }
.ps-spinner { width:28px; height:28px; border:3px solid #e5e7eb; border-top-color:#3b82f6; border-radius:50%; animation:ps-spin 0.8s linear infinite; margin:0 auto 10px; }
@keyframes ps-spin { to { transform:rotate(360deg); } }
.ps-perr-summary { padding:10px 14px; font-size:13px; color:#374151; background:#fef2f2; border:1px solid #fca5a5; border-radius:10px; margin-bottom:10px; }
.ps-perr-ok { background:#f0fdf4; border-color:#86efac; color:#166534; }
.ps-perr-cell { background:#fee2e2 !important; }
.ps-checks-summary { padding:10px 14px; font-size:13px; color:#374151; background:#fffbeb; border:1px solid #fcd34d; border-radius:10px; margin-bottom:10px; }
.ps-checks-ok { background:#f0fdf4; border-color:#86efac; color:#166534; }
.ps-check-cell { background:#fef9c3 !important; }
.ps-check-badge-cell { white-space:nowrap; }
.ps-check-badge { display:inline-block; padding:2px 7px; font-size:11px; font-weight:600; background:#fef3c7; color:#92400e; border:1px solid #fcd34d; border-radius:10px; margin:1px 2px; }
mark.ps-spm { background:#fbbf24; color:#451a03; border-radius:2px; font-family:monospace; padding:0 1px; outline:1px solid #f59e0b; }
mark.ps-nbspm { background:#f87171; color:#fff; border-radius:3px; font-family:monospace; font-size:10px; font-weight:700; padding:0 3px; outline:1px solid #ef4444; }
.ps-tree-search-wrap { margin-bottom:10px; position:relative; }
.ps-tree-search { width:100%; padding:8px 14px 8px 36px; border:1px solid #d1d5db; border-radius:8px; font-size:13px; font-family:inherit; background:#fff; color:#374151; box-sizing:border-box; }
.ps-tree-search:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.1); }
.ps-tree-search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#9ca3af; pointer-events:none; }
.ps-tree { background:#fff; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06); border:1px solid #e5e7eb; overflow:hidden; }
.ps-tree-node { border-bottom:1px solid #f1f5f9; }
.ps-tree-node:last-child { border-bottom:none; }
.ps-tree-header { display:flex; align-items:center; gap:8px; padding:10px 16px; cursor:pointer; user-select:none; background:#fff; }
.ps-tree-header:hover { background:#f8fafc; }
.ps-tree-header.level-0 { background:#f8fafc; font-weight:600; }
.ps-tree-header.level-0:hover { background:#f1f5f9; }
.ps-tree-header.level-1 { padding-left:36px; }
.ps-tree-header.level-2 { padding-left:60px; background:#fdfdfd; }
.ps-tree-chevron { width:16px; height:16px; color:#9ca3af; transition:transform 0.2s; flex-shrink:0; }
.ps-tree-chevron.open { transform:rotate(90deg); }
.ps-tree-icon { width:16px; height:16px; color:#6b7280; flex-shrink:0; }
.ps-tree-name { font-size:14px; color:#111827; flex:1; }
.ps-tree-name em { font-style:normal; background:#fef08a; border-radius:2px; padding:0 1px; }
.ps-tree-count { font-size:11px; color:#9ca3af; background:#f3f4f6; padding:2px 7px; border-radius:10px; flex-shrink:0; }
.ps-tree-children { display:none; }
.ps-tree-children.open { display:block; }
.ps-tree-services { padding:0 16px 10px 60px; }
.ps-tree-services-table { width:100%; border-collapse:collapse; font-size:13px; }
.ps-tree-services-table th { padding:6px 10px; font-size:11px; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:0.4px; text-align:center; border-bottom:1px solid #f1f5f9; }
.ps-tree-services-table th.col-name { text-align:left; }
.ps-tree-services-table td { padding:7px 10px; border-bottom:1px solid #f9fafb; color:#374151; vertical-align:middle; text-align:center; }
.ps-tree-services-table td.col-name { text-align:left; }
.ps-tree-services-table tr:last-child td { border-bottom:none; }
.ps-tree-services-table tr:hover td { background:#f8fafc; }
.ps-tree-services-table td.col-price { font-weight:600; color:#16a34a; }
`;

const SERVICES_TABS = [
  { key: 'services',         label: 'Услуги' },
  { key: 'partner-services', label: 'Услуги партнёров' },
  { key: '804n',             label: '804н' },
];

export default function ServicesPage() {
  const [activeTab, setActiveTab] = useState('services');
  const { wrapRef, sliderEl } = useTabSlider(activeTab);

  return (
    <div style={{ padding: '16px 20px', height: '100%', overflowY: 'auto' }}>
      <div className="rb-clinic-tab-wrap" ref={wrapRef} style={{ marginBottom: 20 }}>
        {sliderEl}
        {SERVICES_TABS.map(t => (
          <button
            key={t.key}
            className={`rb-clinic-tab${activeTab === t.key ? ' active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >{t.label}</button>
        ))}
      </div>
      {activeTab === 'services'         && <TabServices />}
      {activeTab === 'partner-services' && <TabPartnerServices />}
      {activeTab === '804n'             && <Tab804n />}
    </div>
  );
}

function Tab804n() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }} />
  );
}
