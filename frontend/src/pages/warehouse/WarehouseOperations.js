import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowRightLeft, Check, ChevronRight, FilePlus2, Plus, RefreshCw,
  Search, Trash2, X,
} from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';

const TYPES = [
  ['receipt', 'Приём'],
  ['issue', 'Выдача'],
  ['transfer', 'Перемещение'],
  ['return', 'Возврат'],
  ['writeoff', 'Списание'],
  ['repair_out', 'В ремонт'],
  ['repair_in', 'Из ремонта'],
  ['surplus', 'Оприходование излишков'],
];

const TYPE_LABELS = Object.fromEntries(TYPES);
const MATERIAL_TYPES = new Set(['receipt', 'issue', 'transfer', 'return', 'writeoff', 'surplus']);
const ASSET_TYPES = new Set(['transfer', 'repair_out', 'repair_in', 'writeoff']);

const EMPTY_LINE = {
  assetId: '', nomenclatureId: '', batchId: '', quantity: 1, unitCost: '',
  fromStorageId: '', toStorageId: '', toRoomId: '', toResponsibleId: '',
  doctorUserId: '', serviceCode: '', reasonText: '',
};

/**
 * Единое рабочее место складских документов. Один экран соответствует одному
 * backend-сервису проводок: пользователь не выбирает между разными формами с
 * разными правилами, а тип документа определяет обязательные реквизиты.
 */
export default function WarehouseOperations({ access, tree }) {
  const [view, setView] = useState('journal');
  const [documents, setDocuments] = useState({ total: 0, items: [] });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refs, setRefs] = useState({
    nomenclature: [], batches: [], stock: [], assets: [], contractors: [], users: [],
  });
  const [filters, setFilters] = useState({ q: '', type: '' });

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await warehouseApi.documents({
        type: filters.type || undefined, limit: 100,
      });
      setDocuments(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить документы');
    } finally {
      setLoading(false);
    }
  }, [filters.type]);

  const loadRefs = useCallback(async () => {
    try {
      const [nom, batches, stock, assets, contractors, users] = await Promise.all([
        warehouseApi.nomenclature({ limit: 500 }),
        warehouseApi.batches({}),
        warehouseApi.stock({ includeZero: 'false' }),
        warehouseApi.assets({ limit: 500 }),
        warehouseApi.contractors({}),
        usersApi.listBasic(),
      ]);
      setRefs({
        nomenclature: nom.data.items || [], batches: batches.data || [],
        stock: stock.data.items || [], assets: assets.data.items || [],
        contractors: contractors.data || [], users: users.data || [],
      });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить справочники операции');
    }
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);
  useEffect(() => { loadRefs(); }, [loadRefs]);

  const openDocument = async id => {
    try {
      const { data } = await warehouseApi.document(id);
      setSelected(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось открыть документ');
    }
  };

  const visible = documents.items.filter(d => {
    const q = filters.q.trim().toLowerCase();
    if (!q) return true;
    return [d.number, d.reasonText, d.comment, d.author?.displayName]
      .some(v => String(v || '').toLowerCase().includes(q));
  });

  return (
    <div className="wh-operations">
      <div className="wh-subtabs">
        <button className={view === 'journal' ? 'is-active' : ''} onClick={() => setView('journal')}>
          <ArrowRightLeft size={14} /> Журнал документов
        </button>
        {access?.capabilities?.canIssue && (
          <button className={view === 'new' ? 'is-active' : ''} onClick={() => setView('new')}>
            <FilePlus2 size={14} /> Новый документ
          </button>
        )}
      </div>

      {view === 'new' ? (
        <DocumentEditor
          refs={refs} tree={tree}
          onCreated={async id => {
            setView('journal');
            await Promise.all([loadDocuments(), loadRefs()]);
            if (id) await openDocument(id);
          }}
        />
      ) : (
        <>
          <div className="wh-assets__filters">
            <div className="wh-search">
              <Search size={15} />
              <input value={filters.q} placeholder="Номер, причина, автор…"
                     onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
            </div>
            <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
              <option value="">Все операции</option>
              {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button className="wh-btn wh-btn--ghost" onClick={loadDocuments} disabled={loading}>
              <RefreshCw size={14} /> Обновить
            </button>
          </div>
          <div className="wh-table-wrap">
            <table className="wh-table">
              <thead><tr>
                <th>Дата</th><th>Документ</th><th>Операция</th><th>Откуда</th><th>Куда</th>
                <th>Причина</th><th>Автор</th><th>Подпись</th><th />
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="wh-table__loading"><div className="loading-spinner" /></td></tr>}
                {!loading && visible.map(d => (
                  <tr key={d.id} className="wh-table__row" onClick={() => openDocument(d.id)}>
                    <td>{fmtDateTime(d.date)}</td>
                    <td className="wh-mono"><b>{d.number}</b></td>
                    <td>{TYPE_LABELS[d.type] || d.type}</td>
                    <td>{roomLabel(d.fromRoom)}</td><td>{roomLabel(d.toRoom)}</td>
                    <td className="wh-cell-sub">{d.reasonText || d.comment || '—'}</td>
                    <td>{d.author?.displayName || '—'}</td>
                    <td>{d.status === 'signed' ? <span className="wh-ok">✓ подписан</span> : 'черновик'}</td>
                    <td><ChevronRight size={15} /></td>
                  </tr>
                ))}
                {!loading && !visible.length && <tr><td colSpan={9} className="wh-empty">Документов нет</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="wh-assets__count">Показано {visible.length} из {documents.total}</div>
        </>
      )}

      {selected && <DocumentCard document={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DocumentEditor({ refs, tree, onCreated }) {
  const [type, setType] = useState('receipt');
  const [kind, setKind] = useState('material');
  const [line, setLine] = useState(EMPTY_LINE);
  const [lines, setLines] = useState([]);
  const [meta, setMeta] = useState({
    occurredAt: new Date().toISOString().slice(0, 16), reasonCode: '', reasonText: '',
    comment: '', contractorId: '', confirmed: false,
  });
  const [saving, setSaving] = useState(false);

  const locations = useMemo(() => flattenLocations(tree), [tree]);
  const storages = locations.flatMap(r => r.storages);
  const canMaterial = MATERIAL_TYPES.has(type);
  const canAsset = ASSET_TYPES.has(type);

  useEffect(() => {
    if (!canMaterial && kind === 'material') setKind('asset');
    if (!canAsset && kind === 'asset') setKind('material');
    setLine(EMPTY_LINE);
    setLines([]);
  }, [type, canMaterial, canAsset, kind]);

  const batches = refs.batches.filter(b => !line.nomenclatureId || b.nomenclatureId === line.nomenclatureId);
  const selectedStock = refs.stock.find(s =>
    s.nomenclature?.id === line.nomenclatureId && s.storage?.id === line.fromStorageId &&
    (!line.batchId || s.batch?.id === line.batchId)
  );

  const needFrom = ['issue', 'transfer', 'writeoff'].includes(type) && kind === 'material';
  const needTo = ['receipt', 'return', 'transfer', 'surplus'].includes(type) && kind === 'material';
  const needAssetDestination = kind === 'asset' && type === 'transfer';

  const setLineValue = (key, value) => setLine(l => ({ ...l, [key]: value }));

  const addLine = () => {
    if (kind === 'asset') {
      if (!line.assetId) return toast.error('Выберите оборудование');
      if (needAssetDestination && (!line.toRoomId || !line.toStorageId)) {
        return toast.error('Для перемещения укажите кабинет и место хранения назначения');
      }
      const asset = refs.assets.find(a => a.id === line.assetId);
      setLines(prev => [...prev, { ...line, kind, label: `${asset?.inventoryNumber} · ${asset?.name}` }]);
    } else {
      if (!line.nomenclatureId) return toast.error('Выберите материал');
      if (!(Number(line.quantity) > 0)) return toast.error('Количество должно быть больше нуля');
      if (needFrom && !line.fromStorageId) return toast.error('Укажите место хранения «откуда»');
      if (needTo && !line.toStorageId) return toast.error('Укажите место хранения «куда»');
      const nom = refs.nomenclature.find(n => n.id === line.nomenclatureId);
      setLines(prev => [...prev, {
        ...line, kind, quantity: Number(line.quantity),
        unitCost: line.unitCost === '' ? Number(selectedStock?.unitCost || nom?.lastPrice || 0) : Number(line.unitCost),
        label: `${nom?.code} · ${nom?.name}`,
      }]);
    }
    setLine(EMPTY_LINE);
  };

  const submit = async () => {
    if (!lines.length) return toast.error('Добавьте хотя бы одну строку');
    if (!meta.reasonText.trim()) return toast.error('Укажите причину операции');
    if (!meta.confirmed) return toast.error('Подтвердите подпись документа');
    setSaving(true);
    try {
      const payloadLines = lines.map(({ kind: _kind, label: _label, ...row }) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '' ? null : v]))
      );
      const { data } = await warehouseApi.createDocument({
        type, lines: payloadLines, occurredAt: meta.occurredAt || null,
        reasonCode: meta.reasonCode || null, reasonText: meta.reasonText.trim(),
        comment: meta.comment || null, contractorId: meta.contractorId || null,
        sign: true,
      });
      toast.success(`Документ ${data.number} проведён и подписан`);
      onCreated(data.id);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось провести документ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wh-panel wh-operation-editor">
      <div className="wh-panel__title"><FilePlus2 size={16} /> Новый складской документ</div>
      <div className="wh-form wh-operation-editor__meta">
        <div className="wh-form__row2">
          <label>Операция
            <select value={type} onChange={e => setType(e.target.value)}>
              {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Дата и время
            <input type="datetime-local" value={meta.occurredAt}
                   onChange={e => setMeta(m => ({ ...m, occurredAt: e.target.value }))} />
          </label>
        </div>
        <div className="wh-form__row2">
          <label>Причина <b className="wh-req">*</b>
            <input value={meta.reasonText} placeholder="Для чего выполняется операция"
                   onChange={e => setMeta(m => ({ ...m, reasonText: e.target.value }))} />
          </label>
          <label>Код основания
            <input value={meta.reasonCode} placeholder="заявка, возврат, брак…"
                   onChange={e => setMeta(m => ({ ...m, reasonCode: e.target.value }))} />
          </label>
        </div>
        {(type === 'receipt' || type === 'repair_out' || type === 'repair_in') && (
          <label>Контрагент
            <select value={meta.contractorId} onChange={e => setMeta(m => ({ ...m, contractorId: e.target.value }))}>
              <option value="">—</option>
              {refs.contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {canMaterial && canAsset && (
        <div className="wh-subtabs wh-operation-kind">
          <button className={kind === 'material' ? 'is-active' : ''} onClick={() => setKind('material')}>Материал</button>
          <button className={kind === 'asset' ? 'is-active' : ''} onClick={() => setKind('asset')}>Оборудование</button>
        </div>
      )}

      <div className="wh-operation-line">
        {kind === 'asset' ? (
          <AssetLineEditor
            line={line} setValue={setLineValue} assets={refs.assets} locations={locations}
            users={refs.users} needDestination={needAssetDestination}
          />
        ) : (
          <MaterialLineEditor
            type={type} line={line} setValue={setLineValue} nomenclature={refs.nomenclature}
            batches={batches} storages={storages} users={refs.users} stock={refs.stock}
            needFrom={needFrom} needTo={needTo} selectedStock={selectedStock}
          />
        )}
        <button className="wh-btn wh-btn--secondary" onClick={addLine}><Plus size={14} /> Добавить строку</button>
      </div>

      <div className="wh-table-wrap">
        <table className="wh-table wh-table--compact">
          <thead><tr><th>Объект</th><th>Кол-во</th><th>Откуда</th><th>Куда</th><th>Врач / МОЛ</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.assetId || l.nomenclatureId}-${i}`}>
                <td>{l.label}{l.batchId && <div className="wh-cell-sub">Партия: {batchLabel(refs.batches, l.batchId)}</div>}</td>
                <td>{l.kind === 'asset' ? 1 : l.quantity}</td>
                <td>{storageLabel(storages, l.fromStorageId)}</td><td>{storageLabel(storages, l.toStorageId)}</td>
                <td>{userLabel(refs.users, l.doctorUserId || l.toResponsibleId)}</td>
                <td><button className="wh-icon-btn wh-icon-btn--danger" onClick={() => setLines(v => v.filter((_, x) => x !== i))}><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={6} className="wh-empty">Добавьте оборудование или материалы</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="wh-form wh-operation-editor__footer">
        <label>Комментарий
          <textarea rows={2} value={meta.comment} onChange={e => setMeta(m => ({ ...m, comment: e.target.value }))} />
        </label>
        <label className="wh-check wh-sign-check">
          <input type="checkbox" checked={meta.confirmed}
                 onChange={e => setMeta(m => ({ ...m, confirmed: e.target.checked }))} />
          Подтверждаю правильность данных и подписываю документ простой электронной подписью
        </label>
        <button className="wh-btn wh-btn--primary" onClick={submit} disabled={saving || !lines.length || !meta.confirmed}>
          <Check size={15} /> {saving ? 'Провожу…' : 'Провести и подписать'}
        </button>
      </div>
    </div>
  );
}

function MaterialLineEditor({
  type, line, setValue, nomenclature, batches, storages, users, stock,
  needFrom, needTo, selectedStock,
}) {
  const availableStocks = stock.filter(s => !line.nomenclatureId || s.nomenclature?.id === line.nomenclatureId);
  const selectableFrom = line.nomenclatureId
    ? storages.filter(s => availableStocks.some(x => x.storage?.id === s.id))
    : storages;
  const showDoctor = type === 'issue';
  return (
    <div className="wh-form wh-operation-line__fields">
      <label className="wh-operation-line__wide">Материал
        <select value={line.nomenclatureId} onChange={e => {
          setValue('nomenclatureId', e.target.value); setValue('batchId', ''); setValue('fromStorageId', '');
        }}>
          <option value="">Выберите позицию…</option>
          {nomenclature.map(n => <option key={n.id} value={n.id}>{n.code} · {n.name} ({n.unit})</option>)}
        </select>
      </label>
      <label>Партия
        <select value={line.batchId} onChange={e => setValue('batchId', e.target.value)}>
          <option value="">Автовыбор FEFO / без партии</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.batchNumber}{b.expiryDate ? ` · до ${fmtDate(b.expiryDate)}` : ''}</option>)}
        </select>
      </label>
      <label>Количество
        <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => setValue('quantity', e.target.value)} />
      </label>
      {needFrom && <label>Откуда
        <select value={line.fromStorageId} onChange={e => { setValue('fromStorageId', e.target.value); setValue('batchId', ''); }}>
          <option value="">Выберите место…</option>
          {selectableFrom.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {selectedStock && <span className="wh-hint">Доступно: {selectedStock.quantity}</span>}
      </label>}
      {needTo && <label>Куда
        <select value={line.toStorageId} onChange={e => setValue('toStorageId', e.target.value)}>
          <option value="">Выберите место…</option>
          {storages.filter(s => s.id !== line.fromStorageId).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>}
      {['receipt', 'return', 'surplus'].includes(type) && <label>Цена за единицу, ₽
        <input type="number" min="0" step="0.01" value={line.unitCost} onChange={e => setValue('unitCost', e.target.value)} />
      </label>}
      {showDoctor && <>
        <label>Врач
          <select value={line.doctorUserId} onChange={e => setValue('doctorUserId', e.target.value)}>
            <option value="">Не указан</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
          </select>
        </label>
        <label>Код услуги
          <input value={line.serviceCode} onChange={e => setValue('serviceCode', e.target.value)} />
        </label>
      </>}
    </div>
  );
}

function AssetLineEditor({ line, setValue, assets, locations, users, needDestination }) {
  const room = locations.find(r => r.id === line.toRoomId);
  return (
    <div className="wh-form wh-operation-line__fields">
      <label className="wh-operation-line__wide">Оборудование
        <select value={line.assetId} onChange={e => setValue('assetId', e.target.value)}>
          <option value="">Выберите актив…</option>
          {assets.map(a => <option key={a.id} value={a.id}>{a.inventoryNumber} · {a.name} · {roomLabel(a.room)}</option>)}
        </select>
      </label>
      {needDestination && <>
        <label>Кабинет назначения
          <select value={line.toRoomId} onChange={e => { setValue('toRoomId', e.target.value); setValue('toStorageId', ''); }}>
            <option value="">Выберите кабинет…</option>
            {locations.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <label>Место хранения
          <select value={line.toStorageId} disabled={!room} onChange={e => setValue('toStorageId', e.target.value)}>
            <option value="">Выберите место…</option>
            {(room?.storages || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Новый МОЛ
          <select value={line.toResponsibleId} onChange={e => setValue('toResponsibleId', e.target.value)}>
            <option value="">Оставить текущего</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
          </select>
        </label>
      </>}
    </div>
  );
}

function DocumentCard({ document: d, onClose }) {
  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div><div className="wh-modal__title">{d.number} · {TYPE_LABELS[d.type] || d.type}</div>
            <div className="wh-modal__sub">{fmtDateTime(d.date)} · {d.status === 'signed' ? 'подписан' : d.status}</div></div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-grid2">
            <Field label="Причина" value={d.reasonText} /><Field label="Код основания" value={d.reasonCode} />
            <Field label="Откуда" value={roomLabel(d.fromRoom)} /><Field label="Куда" value={roomLabel(d.toRoom)} />
            <Field label="Автор" value={d.author?.displayName} /><Field label="Подписал" value={d.signer?.displayName} />
            <Field label="Контрагент" value={d.contractor?.name} /><Field label="Комментарий" value={d.comment} />
          </div>
          <h4 className="wh-subhead">Строки документа</h4>
          <div className="wh-table-wrap"><table className="wh-table wh-table--compact">
            <thead><tr><th>Объект</th><th>Партия</th><th>Кол-во</th><th>Откуда</th><th>Куда</th><th>Врач</th></tr></thead>
            <tbody>{(d.movements || []).map(m => <tr key={m.id}>
              <td>{m.asset ? `${m.asset.inventoryNumber} · ${m.asset.name}` : `${m.nomenclature?.code || ''} · ${m.nomenclature?.name || ''}`}</td>
              <td>{m.batch?.batchNumber || '—'}</td><td>{Number(m.quantity)}</td>
              <td>{m.fromStorage?.name || '—'}</td><td>{m.toStorage?.name || '—'}</td>
              <td>{m.doctor?.displayName || '—'}</td>
            </tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return <div><div className="wh-field-ro__label">{label}</div><div>{value || '—'}</div></div>;
}

function flattenLocations(tree) {
  const rows = [];
  for (const mc of tree?.medCenters || []) for (const b of mc.buildings || []) for (const f of b.floors || []) {
    for (const r of f.rooms || []) {
      const label = `${mc.name} · ${b.name} · ${f.number} эт. · Каб. ${r.number}${r.name && r.name !== r.number ? ` — ${r.name}` : ''}`;
      rows.push({
        ...r, label,
        storages: (r.storages || []).map(s => ({ ...s, roomId: r.id, label: `${label} · ${s.name}` })),
      });
    }
  }
  return rows;
}

const roomLabel = room => room ? `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}` : '—';
const storageLabel = (items, id) => items.find(x => x.id === id)?.label || '—';
const userLabel = (items, id) => { const u = items.find(x => x.id === id); return u?.displayName || u?.username || '—'; };
const batchLabel = (items, id) => items.find(x => x.id === id)?.batchNumber || '—';
const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
