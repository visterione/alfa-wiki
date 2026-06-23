import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { mis } from '../../../services/api';

// ───────────────────────────────────────
// helpers
// ───────────────────────────────────────
const svcCode = (s) => String(s?.code || s?.service_id || '');

function buildIndex(tree) {
  const byId = new Map();
  const parentOf = new Map();
  const childIds = new Map();
  const walk = (nodes, parent) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      parentOf.set(n.id, parent);
      const kids = Array.isArray(n.children) ? n.children : [];
      childIds.set(n.id, kids.map(k => k.id));
      walk(kids, n.id);
    }
  };
  walk(Array.isArray(tree) ? tree : [], null);
  return { byId, parentOf, childIds };
}

// run async tasks with limited concurrency
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

// ───────────────────────────────────────
// tri-state checkbox
// ───────────────────────────────────────
function TriCheckbox({ state, onToggle, disabled }) {
  const on = state === 'checked';
  const indet = state === 'indeterminate';
  return (
    <span
      onClick={e => { e.stopPropagation(); if (!disabled) onToggle(); }}
      style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
        border: '2px solid',
        borderColor: (on || indet) ? 'var(--rb-primary)' : 'var(--rb-border-dark)',
        background: (on || indet) ? 'var(--rb-primary)' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.12s',
      }}
    >
      {on && (
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {indet && <span style={{ width: 9, height: 2, background: '#fff', borderRadius: 1 }} />}
    </span>
  );
}

const Chevron = ({ open }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
    style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s', color: 'var(--rb-text-secondary)' }}>
    <path fillRule="evenodd" d="M7.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L10.586 10 7.293 6.707a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

// ═══════════════════════════════════════
// SERVICE TREE — multi-select categories/services → bulk bonus
// ═══════════════════════════════════════
export default function ServiceTree({ clinicId, onApplyBonus, readOnly }) {
  const [tree, setTree] = useState(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(new Set());

  // lazy-loaded direct services for leaf categories (viewing)
  const [svcByCat, setSvcByCat] = useState(new Map());
  const [svcLoading, setSvcLoading] = useState(new Set());

  // selection state
  const [checkedCats, setCheckedCats] = useState(new Set());     // explicitly fully-on categories
  const [excludedSvc, setExcludedSvc] = useState(new Map());     // code -> catId (off inside a covered cat)
  const [includedSvc, setIncludedSvc] = useState(new Map());     // code -> {code,title,catId} (on outside coverage)

  // bonus form
  const [bonusType, setBonusType] = useState('pct');
  const [bonusValue, setBonusValue] = useState('');
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(null);

  // deep services cache (catId -> services[]) used at apply time
  const deepCache = useRef(new Map());

  const { byId, parentOf, childIds } = useMemo(() => buildIndex(tree || []), [tree]);

  // ── load category tree ──
  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    mis.getServiceCategories()
      .then(res => {
        if (cancelled) return;
        const data = res.data?.data || res.data || [];
        setTree(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelled) { setTree([]); toast.error('Ошибка загрузки категорий'); } })
      .finally(() => { if (!cancelled) setTreeLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── reset selection + service caches when clinic changes ──
  const clearSelection = useCallback(() => {
    setCheckedCats(new Set());
    setExcludedSvc(new Map());
    setIncludedSvc(new Map());
  }, []);

  // bonuses are saved per-clinic, so reset the selection when switching clinic tabs.
  // the service catalog itself is clinic-independent, so cached services are kept.
  useEffect(() => {
    clearSelection();
  }, [clinicId, clearSelection]);

  // ── relationship helpers ──
  const isUnder = useCallback((child, ancestor) => {
    let c = parentOf.get(child);
    while (c != null) { if (c === ancestor) return true; c = parentOf.get(c); }
    return false;
  }, [parentOf]);

  const isCovered = useCallback((id) => {
    let c = id;
    while (c != null) { if (checkedCats.has(c)) return true; c = parentOf.get(c); }
    return false;
  }, [checkedCats, parentOf]);

  // ── tri-state for a category node ──
  const catState = useCallback((id) => {
    if (isCovered(id)) {
      for (const cid of excludedSvc.values()) if (cid === id || isUnder(cid, id)) return 'indeterminate';
      return 'checked';
    }
    for (const c of checkedCats) if (c !== id && isUnder(c, id)) return 'indeterminate';
    for (const s of includedSvc.values()) if (s.catId === id || isUnder(s.catId, id)) return 'indeterminate';
    return 'unchecked';
  }, [isCovered, excludedSvc, includedSvc, checkedCats, isUnder]);

  const svcSelected = useCallback((code, catId) => {
    if (excludedSvc.has(code)) return false;
    if (includedSvc.has(code)) return true;
    return isCovered(catId);
  }, [excludedSvc, includedSvc, isCovered]);

  // ── toggle a category checkbox ──
  const toggleCategory = useCallback((id) => {
    if (readOnly) return;
    const cc = new Set(checkedCats);
    const exc = new Map(excludedSvc);
    const inc = new Map(includedSvc);

    const clearOverridesUnder = (root) => {
      for (const code of [...exc.keys()]) { const cid = exc.get(code); if (cid === root || isUnder(cid, root)) exc.delete(code); }
      for (const code of [...inc.keys()]) { const s = inc.get(code); if (s.catId === root || isUnder(s.catId, root)) inc.delete(code); }
    };

    const state = catState(id);
    const shouldCheck = state !== 'checked'; // checked -> off, otherwise -> on

    if (shouldCheck) {
      for (const c of [...cc]) if (isUnder(c, id)) cc.delete(c);  // drop redundant descendants
      clearOverridesUnder(id);
      cc.add(id);
    } else if (cc.has(id)) {
      cc.delete(id);
      clearOverridesUnder(id);
    } else {
      // covered via an ancestor → split that ancestor down to siblings
      const path = [id];
      let anc = parentOf.get(id);
      while (anc != null && !cc.has(anc)) { path.push(anc); anc = parentOf.get(anc); }
      if (anc != null) {
        cc.delete(anc);
        let cursor = anc;
        for (let i = path.length - 1; i >= 0; i--) {
          const onPath = path[i];
          for (const sib of (childIds.get(cursor) || [])) if (sib !== onPath) cc.add(sib);
          cursor = onPath;
        }
        clearOverridesUnder(id);
      }
    }
    setCheckedCats(cc); setExcludedSvc(exc); setIncludedSvc(inc);
  }, [readOnly, checkedCats, excludedSvc, includedSvc, catState, isUnder, parentOf, childIds]);

  // ── toggle an individual service ──
  const toggleService = useCallback((svc, catId) => {
    if (readOnly) return;
    const code = svcCode(svc);
    if (!code) return;
    const exc = new Map(excludedSvc);
    const inc = new Map(includedSvc);
    if (svcSelected(code, catId)) {
      if (inc.has(code)) inc.delete(code);
      else exc.set(code, catId);
    } else {
      if (exc.has(code)) exc.delete(code);
      else inc.set(code, { code, title: svc.title, catId });
    }
    setExcludedSvc(exc); setIncludedSvc(inc);
  }, [readOnly, excludedSvc, includedSvc, svcSelected]);

  // ── expand / lazy-load services ──
  const loadServices = useCallback(async (id) => {
    setSvcLoading(prev => { const n = new Set(prev); n.add(id); return n; });
    try {
      const res = await mis.getServicesByCategory(id);
      const data = res.data?.data || res.data || [];
      setSvcByCat(prev => new Map(prev).set(id, Array.isArray(data) ? data : []));
    } catch {
      setSvcByCat(prev => new Map(prev).set(id, []));
      toast.error('Ошибка загрузки услуг категории');
    } finally {
      setSvcLoading(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  const toggleExpand = useCallback((node) => {
    const id = node.id;
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) { n.delete(id); return n; }
      n.add(id);
      return n;
    });
    const kids = childIds.get(id) || [];
    if (kids.length === 0 && !svcByCat.has(id) && !svcLoading.has(id)) loadServices(id);
  }, [childIds, svcByCat, svcLoading, loadServices]);

  // ── search filter (over categories) ──
  const q = query.trim().toLowerCase();
  const branchVisible = useCallback((node) => {
    if (!q) return true;
    if (node.title?.toLowerCase().includes(q)) return true;
    return (node.children || []).some(branchVisible);
  }, [q]);

  // ── selection summary ──
  const selectedCatCount = checkedCats.size;
  const approxServices = useMemo(() => {
    let sum = 0;
    for (const id of checkedCats) sum += (byId.get(id)?.services_count || 0);
    sum = sum - excludedSvc.size + includedSvc.size;
    return Math.max(0, sum);
  }, [checkedCats, byId, excludedSvc, includedSvc]);
  const hasSelection = selectedCatCount > 0 || includedSvc.size > 0;

  // ── apply ──
  const handleApply = useCallback(async () => {
    if (!hasSelection) { toast.error('Отметьте категории или услуги'); return; }
    const val = parseFloat(bonusValue);
    if (isNaN(val) || val < 0) { toast.error('Укажите размер бонуса'); return; }

    setApplying(true);
    const roots = [...checkedCats];
    setProgress(roots.length ? { done: 0, total: roots.length } : null);
    try {
      const collected = new Map(); // code -> {code, title}
      let done = 0;
      await mapWithConcurrency(roots, 4, async (catId) => {
        let services = deepCache.current.get(catId);
        if (!services) {
          const res = await mis.getServicesByCategory(catId);
          const data = res.data?.data || res.data || [];
          services = Array.isArray(data) ? data : [];
          deepCache.current.set(catId, services);
        }
        for (const s of services) {
          const code = svcCode(s);
          if (code) collected.set(code, { code, title: s.title });
        }
        done++;
        setProgress({ done, total: roots.length });
      });

      for (const code of excludedSvc.keys()) collected.delete(code);
      for (const s of includedSvc.values()) collected.set(s.code, { code: s.code, title: s.title });

      const services = [...collected.values()];
      if (!services.length) { toast.error('Нет услуг для применения'); return; }

      await onApplyBonus({ services, bonusType, bonusValue: val });
      clearSelection();
      setBonusValue('');
    } catch (err) {
      toast.error('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setApplying(false);
      setProgress(null);
    }
  }, [hasSelection, bonusValue, checkedCats, excludedSvc, includedSvc, bonusType, onApplyBonus, clearSelection]);

  // ── render a category node ──
  const renderNode = (node, level, ancestorMatched) => {
    if (q && !ancestorMatched && !branchVisible(node)) return null;
    const id = node.id;
    const kids = childIds.get(id) || [];
    const matched = q ? node.title?.toLowerCase().includes(q) : false;
    const showSubtree = ancestorMatched || matched;
    const isOpen = q ? (branchVisible(node) && !matched ? true : (expanded.has(id) || matched)) : expanded.has(id);
    const tri = catState(id);
    const services = svcByCat.get(id);
    const loadingSvc = svcLoading.has(id);

    return (
      <React.Fragment key={id}>
        <div
          className="rb-tree-row"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', paddingLeft: 10 + level * 16, cursor: 'pointer', borderBottom: '1px solid var(--rb-border)' }}
          onClick={() => toggleExpand(node)}
        >
          <Chevron open={isOpen} />
          <TriCheckbox state={tri} onToggle={() => toggleCategory(id)} disabled={readOnly} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.title}
            {node.services_count != null && (
              <span style={{ color: 'var(--rb-text-secondary)', fontSize: 11, marginLeft: 6 }}>({node.services_count})</span>
            )}
          </span>
        </div>

        {isOpen && (
          <>
            {kids.length > 0 && kids.map(cid => byId.get(cid)).filter(Boolean).map(child => renderNode(child, level + 1, showSubtree))}

            {kids.length === 0 && (
              <div style={{ paddingLeft: 10 + (level + 1) * 16 }}>
                {loadingSvc && <div className="rb-loading" style={{ padding: '6px 10px' }}><span className="rb-spinner" /> Загрузка услуг...</div>}
                {!loadingSvc && services && services.length === 0 && (
                  <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--rb-text-secondary)' }}>Нет услуг</div>
                )}
                {!loadingSvc && services && services.map((svc, i) => {
                  const code = svcCode(svc);
                  const sel = svcSelected(code, id);
                  return (
                    <div
                      key={code || i}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid var(--rb-border)' }}
                      onClick={() => toggleService(svc, id)}
                    >
                      <span style={{ width: 14, flexShrink: 0 }} />
                      <TriCheckbox state={sel ? 'checked' : 'unchecked'} onToggle={() => toggleService(svc, id)} disabled={readOnly} />
                      <span style={{ fontSize: 11, color: '#000', flexShrink: 0 }}>{code}</span>
                      <span className="rb-result-name" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.title}</span>
                      {svc.price != null && <span className="rb-result-price">{parseFloat(svc.price).toFixed(2)} ₽</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </React.Fragment>
    );
  };

  return (
    <div style={{ paddingBottom: 20 }}>
      {/* Bonus form + apply */}
      <div style={{ background: '#f8fafc', border: '1px solid var(--rb-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
        <div className="rb-inline-toggle-wrap">
          <div className="rb-exec-type-toggle">
            <button className={`rb-exec-type-btn${bonusType === 'pct' ? ' active' : ''}`} onClick={() => { setBonusType('pct'); setBonusValue(''); }}>%</button>
            <button className={`rb-exec-type-btn${bonusType === 'rub' ? ' active' : ''}`} onClick={() => { setBonusType('rub'); setBonusValue(''); }}>₽</button>
          </div>
          <input
            type="number"
            value={bonusValue}
            onChange={e => setBonusValue(e.target.value)}
            placeholder={bonusType === 'pct' ? 'Например: 10' : 'Например: 150'}
            min="0" step="any"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none' }}
          />
          <button className="rb-btn rb-btn-primary rb-btn-sm" onClick={handleApply} disabled={applying || !hasSelection} style={{ whiteSpace: 'nowrap' }}>
            {applying
              ? <><span className="rb-spinner" style={{ marginRight: 5 }} />{progress ? `${progress.done}/${progress.total}` : 'Сохранение...'}</>
              : 'Применить'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--rb-text-secondary)' }}>
            {hasSelection
              ? <>Выбрано категорий: <b>{selectedCatCount}</b> · услуг ≈ <b>{approxServices}</b></>
              : 'Отметьте категории или раскройте их для выбора отдельных услуг'}
          </span>
          {hasSelection && (
            <button type="button" onClick={clearSelection}
              style={{ fontSize: 11, color: 'var(--rb-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Снять всё
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск категории..."
          style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Tree */}
      <div style={{ border: '1px solid var(--rb-border)', borderRadius: 7, overflow: 'hidden' }}>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {treeLoading && <div className="rb-loading" style={{ padding: '10px 12px' }}><span className="rb-spinner" /> Загрузка категорий...</div>}
          {!treeLoading && tree && tree.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Категории не найдены</div>
          )}
          {!treeLoading && tree && tree.map(node => renderNode(node, 0, false))}
          {!treeLoading && tree && q && tree.every(n => !branchVisible(n)) && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--rb-text-secondary)' }}>Ничего не найдено</div>
          )}
        </div>
      </div>
    </div>
  );
}
