import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ClipboardCheck, Plus, RefreshCw, ScanLine, Search, X } from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';

export default function WarehouseInventory({ access, tree }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await warehouseApi.inventorySessions();
      setSessions(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить инвентаризации');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = async id => {
    try {
      const { data } = await warehouseApi.inventory(id);
      setSelected(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось открыть опись');
    }
  };

  return (
    <div className="wh-inventory-workspace">
      <div className="wh-assets__filters">
        <div className="wh-bar__title">Инвентаризация</div>
        <button className="wh-btn wh-btn--ghost" onClick={load} disabled={loading}><RefreshCw size={14} /> Обновить</button>
        {access?.capabilities?.canIssue && <button className="wh-btn wh-btn--primary" onClick={() => setCreating(true)}><Plus size={14} /> Новая опись</button>}
      </div>
      <div className="wh-table-wrap"><table className="wh-table">
        <thead><tr><th>Номер</th><th>Статус</th><th>Область</th><th>Основание</th><th>Начало</th><th>Окончание</th><th>Председатель</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={7} className="wh-table__loading"><div className="loading-spinner" /></td></tr>}
          {!loading && sessions.map(s => <tr key={s.id} className="wh-table__row" onClick={() => open(s.id)}>
            <td className="wh-mono"><b>{s.number}</b></td><td>{inventoryStatus(s.status)}</td>
            <td>{s.room ? `Каб. ${s.room.number}` : s.department?.name || '—'}</td><td>{s.basis || '—'}</td>
            <td>{fmtDateTime(s.startedAt)}</td><td>{fmtDateTime(s.finishedAt)}</td><td>{s.chairman?.displayName || '—'}</td>
          </tr>)}
          {!loading && !sessions.length && <tr><td colSpan={7} className="wh-empty">Инвентаризаций ещё нет</td></tr>}
        </tbody>
      </table></div>

      {creating && <CreateInventory tree={tree} onClose={() => setCreating(false)} onCreated={async id => { setCreating(false); await load(); await open(id); }} />}
      {selected && <InventoryCounting data={selected} canEdit={access?.capabilities?.canIssue}
                                      onClose={() => setSelected(null)} onReload={() => open(selected.session.id)} />}
    </div>
  );
}

function CreateInventory({ tree, onClose, onCreated }) {
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ scope: 'room', roomId: '', departmentId: '', basis: '', chairmanUserId: '', responsibleUserId: '' });
  const rooms = useMemo(() => flattenRooms(tree), [tree]);
  useEffect(() => { usersApi.listBasic().then(({ data }) => setUsers(data)).catch(() => {}); }, []);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (form.scope === 'room' ? !form.roomId : !form.departmentId) return toast.error('Выберите область инвентаризации');
    setSaving(true);
    try {
      const { data } = await warehouseApi.createInventory({
        roomId: form.scope === 'room' ? form.roomId : null,
        departmentId: form.scope === 'department' ? form.departmentId : null,
        basis: form.basis || null, chairmanUserId: form.chairmanUserId || null,
        responsibleUserId: form.responsibleUserId || null,
      });
      toast.success(`Опись ${data.session.number} открыта`);
      onCreated(data.session.id);
    } catch (e) { toast.error(e.response?.data?.error || 'Не удалось открыть опись'); }
    finally { setSaving(false); }
  };
  return <div className="wh-modal" onClick={onClose}><div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
    <div className="wh-modal__head"><div className="wh-modal__title">Новая инвентаризация</div><button className="wh-icon-btn" onClick={onClose}><X size={18} /></button></div>
    <div className="wh-modal__body"><div className="wh-form">
      <label>Область
        <select value={form.scope} onChange={e => set('scope', e.target.value)}><option value="room">Один кабинет</option><option value="department">Всё отделение</option></select>
      </label>
      {form.scope === 'room' ? <label>Кабинет
        <select value={form.roomId} onChange={e => set('roomId', e.target.value)}><option value="">Выберите…</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      </label> : <label>Отделение
        <select value={form.departmentId} onChange={e => set('departmentId', e.target.value)}><option value="">Выберите…</option>{(tree?.departments || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </label>}
      <label>Основание <input value={form.basis} placeholder="Приказ №…, плановая проверка…" onChange={e => set('basis', e.target.value)} /></label>
      <label>Председатель комиссии <select value={form.chairmanUserId} onChange={e => set('chairmanUserId', e.target.value)}><option value="">Текущий пользователь</option>{users.map(userOption)}</select></label>
      <label>МОЛ <select value={form.responsibleUserId} onChange={e => set('responsibleUserId', e.target.value)}><option value="">—</option>{users.map(userOption)}</select></label>
    </div></div>
    <div className="wh-modal__foot"><button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button><button className="wh-btn wh-btn--primary" onClick={submit} disabled={saving}><Check size={14} /> {saving ? 'Открываю…' : 'Открыть опись'}</button></div>
  </div></div>;
}

function InventoryCounting({ data, canEdit, onClose, onReload }) {
  const { session, stats } = data;
  const items = session.items || [];
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [closing, setClosing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);

  const stopScan = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setScanning(false);
  }, []);
  useEffect(() => stopScan, [stopScan]);

  const countCode = useCallback(async (value, method = 'manual') => {
    const clean = String(value || '').trim();
    if (!clean) return;
    try {
      await warehouseApi.countInventory(session.id, { code: clean, scanMethod: method, actualQty: 1 });
      toast.success('Оборудование отмечено'); setCode(''); await onReload();
    } catch (e) { toast.error(e.response?.data?.error || 'Не удалось отметить позицию'); }
  }, [session.id, onReload]);

  const startScan = async () => {
    if (!('BarcodeDetector' in window)) return toast.error('Камера QR не поддерживается этим браузером — используйте ручной ввод');
    try {
      detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      setScanning(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = streamRef.current; videoRef.current.play(); scanFrame(); } }, 0);
    } catch { toast.error('Не удалось получить доступ к камере'); stopScan(); }
  };
  const scanFrame = async () => {
    if (!videoRef.current || !detectorRef.current || !streamRef.current) return;
    try {
      const codes = await detectorRef.current.detect(videoRef.current);
      if (codes[0]?.rawValue) { const value = codes[0].rawValue; stopScan(); await countCode(value, 'qr'); return; }
    } catch { /* следующий кадр */ }
    rafRef.current = requestAnimationFrame(scanFrame);
  };

  const countItem = async (item, actualQty, note = item.note) => {
    setSavingId(item.id);
    try {
      await warehouseApi.countInventory(session.id, { itemId: item.id, actualQty, note, scanMethod: 'manual' });
      await onReload();
    } catch (e) { toast.error(e.response?.data?.error || 'Не удалось сохранить факт'); }
    finally { setSavingId(null); }
  };

  const close = async () => {
    const uncounted = items.filter(i => i.actualQty === null).length;
    const text = uncounted ? `Не пересчитано строк: ${uncounted}. При закрытии они станут недостачей (факт 0). Продолжить?` : 'Закрыть инвентаризацию?';
    if (!window.confirm(text)) return;
    setClosing(true);
    try { await warehouseApi.closeInventory(session.id, {}); toast.success('Инвентаризация закрыта'); await onReload(); }
    catch (e) { toast.error(e.response?.data?.error || 'Не удалось закрыть опись'); }
    finally { setClosing(false); }
  };

  const postDifferences = async () => {
    if (!window.confirm('Создать и провести документы оприходования излишков и списания недостач материалов?')) return;
    setPosting(true);
    try {
      const { data: result } = await warehouseApi.postInventoryDifferences(session.id, {});
      const numbers = (result.documents || []).map(d => d.number).join(', ');
      toast.success(numbers ? `Проведены документы: ${numbers}` : 'Материальных расхождений нет');
      if (result.assetDifferences?.length) {
        toast(`Расхождения по оборудованию: ${result.assetDifferences.length}. Для них оформите отдельное решение комиссии.`, { icon: '⚠️', duration: 8000 });
      }
      await onReload();
    } catch (e) { toast.error(e.response?.data?.error || 'Не удалось оформить расхождения'); }
    finally { setPosting(false); }
  };

  const visible = items.filter(i => !q || itemName(i).toLowerCase().includes(q.toLowerCase()));
  const closed = session.status === 'closed';
  const left = Math.max(0, stats.total - stats.counted);
  return <div className="wh-modal" onClick={onClose}><div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
    <div className="wh-modal__head"><div><div className="wh-modal__title">{session.number}</div><div className="wh-modal__sub">{stats.locationPath || session.department?.name || '—'} · {inventoryStatus(session.status)}</div></div><button className="wh-icon-btn" onClick={onClose}><X size={18} /></button></div>
    <div className="wh-modal__body">
      {/* Пять чисел, по которым читается ход пересчёта. Подписи под каждым
          отвечают на «из скольких» и «сколько осталось» — иначе «Пересчитано 75»
          требует найти глазами «Всего» и вычесть одно из другого. */}
      <div className="wh-summary wh-summary--strip wh-inventory-stats">
        <Stat title="Всего позиций" value={stats.total}
              sub={stats.total ? `${percent(stats.counted, stats.total)} пересчитано` : 'опись пуста'} />
        <Stat title="Пересчитано" value={stats.counted}
              tone={stats.counted >= stats.total && stats.total ? 'green' : undefined}
              sub={left > 0 ? `осталось ${left}` : 'все отмечены'} />
        <Stat title="По QR" value={stats.byQr}
              sub={stats.counted ? `${percent(stats.byQr, stats.counted)} отметок` : 'сканирований нет'} />
        <Stat title="Недостачи" value={stats.shortage} tone={stats.shortage ? 'red' : undefined}
              sub={stats.shortage ? 'меньше учёта' : 'нет'} />
        <Stat title="Излишки" value={stats.surplus} tone={stats.surplus ? 'yellow' : undefined}
              sub={stats.surplus ? 'больше учёта' : 'нет'} />
      </div>

      {/* Полоса хода: одно движение вместо сравнения двух чисел. Она же
          показывает, из чего набран пересчёт — сканером или руками, — а доля
          ручного ввода потом читается как качество маркировки. */}
      {stats.total > 0 && (
        <div className="wh-invprogress">
          <div className="wh-invprogress__bar">
            <i className="wh-invprogress__qr" style={{ width: `${(stats.byQr / stats.total) * 100}%` }} />
            <i className="wh-invprogress__manual"
               style={{ width: `${((stats.counted - stats.byQr) / stats.total) * 100}%` }} />
          </div>
          <div className="wh-invprogress__legend">
            <span><i className="wh-invprogress__key wh-invprogress__key--qr" /> сканером {stats.byQr}</span>
            <span><i className="wh-invprogress__key wh-invprogress__key--manual" /> вручную {stats.counted - stats.byQr}</span>
            <span><i className="wh-invprogress__key wh-invprogress__key--left" /> не отмечено {left}</span>
          </div>
        </div>
      )}
      {!closed && canEdit && <div className="wh-inventory-scan">
        <div className="wh-search"><Search size={15} /><input value={code} placeholder="Инвентарный номер или URL из QR" onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') countCode(code); }} /></div>
        <button className="wh-btn wh-btn--secondary" onClick={() => countCode(code)}>Отметить</button>
        <button className="wh-btn wh-btn--ghost" onClick={scanning ? stopScan : startScan}><ScanLine size={14} /> {scanning ? 'Остановить камеру' : 'Сканировать QR'}</button>
        {scanning && <video ref={videoRef} className="wh-inventory-scan__video" muted playsInline />}
      </div>}
      <div className="wh-assets__filters"><div className="wh-search"><Search size={15} /><input value={q} placeholder="Поиск по описи" onChange={e => setQ(e.target.value)} /></div></div>
      <div className="wh-table-wrap wh-table-wrap--tall"><table className="wh-table wh-table--compact">
        <thead><tr><th>Объект</th><th>Партия / место</th><th className="wh-num">По учёту</th><th className="wh-num">Факт</th><th className="wh-num">Разница</th><th>Способ</th><th>Примечание</th></tr></thead>
        <tbody>{visible.map(i => <InventoryRow key={i.id} item={i} editable={!closed && canEdit} saving={savingId === i.id} onSave={countItem} />)}</tbody>
      </table></div>
    </div>
    <div className="wh-modal__foot">
      <button className="wh-btn wh-btn--secondary" onClick={onClose}>Закрыть окно</button>
      {closed && canEdit && !session.differencesPostedAt && (stats.shortage > 0 || stats.surplus > 0) && (
        <button className="wh-btn wh-btn--primary" onClick={postDifferences} disabled={posting}>
          <ClipboardCheck size={14} /> {posting ? 'Оформляю…' : 'Оформить расхождения'}
        </button>
      )}
      {session.differencesPostedAt && <span className="wh-ok">✓ Расхождения оформлены {fmtDateTime(session.differencesPostedAt)}</span>}
      {!closed && canEdit && <button className="wh-btn wh-btn--primary" onClick={close} disabled={closing}><Check size={14} /> {closing ? 'Закрываю…' : 'Завершить инвентаризацию'}</button>}
    </div>
  </div></div>;
}

function InventoryRow({ item, editable, saving, onSave }) {
  const [actual, setActual] = useState(item.actualQty ?? '');
  const [note, setNote] = useState(item.note || '');
  useEffect(() => { setActual(item.actualQty ?? ''); setNote(item.note || ''); }, [item.actualQty, item.note]);
  const diff = actual === '' ? null : Number(actual) - Number(item.expectedQty);
  return <tr className={diff < 0 ? 'wh-row--shortage' : diff > 0 ? 'wh-row--surplus' : ''}>
    <td><div className="wh-cell-main">{itemName(item)}</div>{item.asset?.model && <div className="wh-cell-sub">{item.asset.model}</div>}</td>
    <td className="wh-cell-sub">{item.batch?.batchNumber || '—'}{item.storage?.name && <div>{item.storage.name}</div>}</td>
    <td className="wh-num">{Number(item.expectedQty)}</td>
    <td className="wh-num">{editable ? <input className="wh-input--qty" type="number" min="0" step="0.001" value={actual} onChange={e => setActual(e.target.value)} onBlur={() => actual !== '' && onSave(item, Number(actual), note)} /> : Number(item.actualQty || 0)}</td>
    <td className="wh-num">{diff === null ? '—' : diff > 0 ? `+${diff}` : diff}</td><td>{item.scanMethod === 'qr' ? 'QR' : item.scanMethod === 'manual' ? 'вручную' : '—'}</td>
    <td>{editable ? <input value={note} placeholder="Комментарий" onChange={e => setNote(e.target.value)} onBlur={() => actual !== '' && onSave(item, Number(actual), note)} disabled={saving} /> : note || '—'}</td>
  </tr>;
}

const userOption = u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>;
const itemName = i => i.asset ? `${i.asset.inventoryNumber} · ${i.asset.name}` : `${i.nomenclature?.code || ''} · ${i.nomenclature?.name || ''}`;
const inventoryStatus = s => ({ open: 'Открыта', counting: 'Идёт пересчёт', closed: 'Закрыта', cancelled: 'Отменена' }[s] || s);
const fmtDateTime = d => d ? new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
/**
 * Плитка сводки. Раньше здесь стоял класс wh-summary__card, который не был описан
 * в CSS ни разу: подпись и число выводились соседними инлайновыми элементами и
 * слипались в «Всего75». Класс был сиротой — им пользовался только этот экран,
 * тогда как в отчётах и остатках ту же плитку рисует wh-sumcard. Теперь и здесь
 * он же: три экрана показывают сводку одинаково.
 */
function Stat({ title, value, sub, tone }) {
  return (
    <div className={`wh-sumcard ${tone ? `wh-sumcard--${tone}` : ''}`}>
      <div className="wh-sumcard__title">{title}</div>
      <div className="wh-sumcard__value">{value}</div>
      {sub && <div className="wh-sumcard__sub">{sub}</div>}
    </div>
  );
}

const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)} %` : '—');
function flattenRooms(tree) {
  const out = [];
  for (const mc of tree?.medCenters || []) {
    for (const r of mc.rooms || []) out.push({ ...r, label: `${mc.name} · Каб. ${r.number}` });
    for (const b of mc.buildings || []) for (const f of b.floors || []) for (const r of f.rooms || []) {
      out.push({ ...r, label: `${mc.name} · ${b.name} · ${f.number} эт. · Каб. ${r.number}` });
    }
  }
  return out;
}
