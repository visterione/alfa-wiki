import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowRightLeft, Check, ChevronRight, Copy, FilePlus2, Plus,
  Search, Trash2, X,
} from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';
import Combobox from './components/Combobox';
import Pagination from './components/Pagination';

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // Документ, который повторяем. Ежедневная выдача в один и тот же кабинет —
  // самая частая операция модуля, и каждый раз собирать её заново значит
  // повторять руками то, что уже сделано вчера.
  const [repeat, setRepeat] = useState(null);

  const setFilter = (patch) => {
    setFilters(f => ({ ...f, ...patch }));
    setPage(1);
  };

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await warehouseApi.documents({
        type: filters.type || undefined,
        q: filters.q.trim() || undefined,
        page, limit: pageSize,
      });
      setDocuments(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить документы');
    } finally {
      setLoading(false);
    }
  }, [filters.type, filters.q, page, pageSize]);

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

  useEffect(() => {
    const t = setTimeout(loadDocuments, filters.q ? 350 : 0);
    return () => clearTimeout(t);
  }, [loadDocuments, filters.q]);

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(documents.total / pageSize));
    if (page > pages) setPage(pages);
  }, [documents.total, pageSize, page]);
  useEffect(() => { loadRefs(); }, [loadRefs]);

  const openDocument = async id => {
    try {
      const { data } = await warehouseApi.document(id);
      setSelected(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось открыть документ');
    }
  };


  return (
    <div className="wh-operations">
      {/* Переключатель вида и фильтры журнала живут в одной полосе. Раздельно
          они занимали две строки над таблицей, и во второй сидели три контрола
          на всю ширину экрана. Переключатель рисуется всегда, фильтры — только
          в журнале: в редакторе документа фильтровать нечего, но вернуться к
          списку надо уметь, поэтому вынести всю полосу внутрь ветки нельзя. */}
      <div className="wh-assets__filters">
        <div className="wh-subtabs">
          <button className={view === 'journal' ? 'is-active' : ''} onClick={() => setView('journal')}>
            <ArrowRightLeft size={14} /> Журнал документов
          </button>
          {access?.capabilities?.canIssue && (
            <button className={view === 'new' ? 'is-active' : ''}
                    onClick={() => { setRepeat(null); setView('new'); }}>
              <FilePlus2 size={14} /> Новый документ
            </button>
          )}
        </div>

        {view === 'journal' && (
          <>
            <span className="wh-filters__sep" />
            <div className="wh-search">
              <Search size={15} />
              <input value={filters.q} placeholder="Номер, причина, автор…"
                     onChange={e => setFilter({ q: e.target.value })} />
            </div>
            <select value={filters.type} onChange={e => setFilter({ type: e.target.value })}>
              <option value="">Все операции</option>
              {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </>
        )}
      </div>

      {view === 'new' ? (
        <DocumentEditor
          // key заставляет редактор пересобраться, когда меняется источник
          // повтора: без него состояние формы осталось бы от прошлого документа.
          key={repeat?.id || 'blank'}
          refs={refs} tree={tree} initial={repeat}
          onCreated={async id => {
            setView('journal');
            setRepeat(null);
            await Promise.all([loadDocuments(), loadRefs()]);
            if (id) await openDocument(id);
          }}
        />
      ) : (
        <>
          <div className="wh-table-wrap">
            <table className="wh-table">
              <thead><tr>
                <th>Дата</th><th>Документ</th><th>Операция</th><th>Откуда</th><th>Куда</th>
                <th>Причина</th><th>Автор</th><th>Подпись</th><th />
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="wh-table__loading"><div className="loading-spinner" /></td></tr>}
                {!loading && documents.items.map(d => (
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
                {!loading && !documents.items.length && <tr><td colSpan={9} className="wh-empty">Документов нет</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={documents.total}
                      onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }}
                      unit="документов" />
        </>
      )}

      {selected && (
        <DocumentCard
          document={selected}
          canRepeat={Boolean(access?.capabilities?.canIssue)}
          onRepeat={() => { setRepeat(selected); setSelected(null); setView('new'); }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/**
 * @param {object|null} initial документ, который повторяем: тип и строки берутся
 *   из него, а дата, причина и подпись заполняются заново — повтор это новое
 *   событие, а не копия старого.
 */
function DocumentEditor({ refs, tree, onCreated, initial }) {
  const [type, setType] = useState(initial?.type || 'receipt');
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

  // Смена типа документа сбрасывает набранные строки: у приёма и списания разные
  // обязательные реквизиты, и строка, собранная для одного, для другого неверна.
  //
  // Сравнение с предыдущим типом через ref, а не просто зависимость эффекта, по
  // двум причинам. Во-первых, на первом рендере сбрасывать нечего — а именно так
  // терялись строки повторяемого документа. Во-вторых, раньше в зависимостях
  // стоял ещё и kind, и переключение «материал ↔ оборудование» стирало уже
  // добавленные строки, хотя документ законно содержит и те, и другие.
  const previousType = useRef(type);
  useEffect(() => {
    if (!canMaterial && kind === 'material') setKind('asset');
    if (!canAsset && kind === 'asset') setKind('material');
    if (previousType.current !== type) {
      previousType.current = type;
      setLine(EMPTY_LINE);
      setLines([]);
    }
  }, [type, canMaterial, canAsset, kind]);

  // Повтор документа: строки восстанавливаются из его движений. Заново
  // указываются только дата, причина и подпись — повтор это новое событие,
  // и подписывать его надо отдельно.
  useEffect(() => {
    if (!initial?.movements?.length) return;
    setLines(initial.movements.map((movement) => {
      const isAsset = Boolean(movement.asset);
      return {
        kind: isAsset ? 'asset' : 'material',
        assetId: movement.asset?.id || '',
        nomenclatureId: movement.nomenclature?.id || '',
        batchId: movement.batch?.id || '',
        quantity: Number(movement.quantity) || 1,
        unitCost: Number(movement.unitCost) || '',
        fromStorageId: movement.fromStorage?.id || '',
        toStorageId: movement.toStorage?.id || '',
        toRoomId: movement.toRoom?.id || '',
        toResponsibleId: movement.toResponsible?.id || '',
        doctorUserId: movement.doctor?.id || '',
        serviceCode: movement.serviceCode || '',
        reasonText: '',
        label: isAsset
          ? `${movement.asset.inventoryNumber} · ${movement.asset.name}`
          : `${movement.nomenclature?.code || ''} · ${movement.nomenclature?.name || ''}`,
      };
    }));
  }, [initial]);

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
  // Позиции для автодополнения: код нужен отдельным полем, чтобы поиск по нему
  // поднимался выше поиска по названию.
  const nomenclatureOptions = nomenclature.map(n => ({
    id: n.id, code: n.code, label: `${n.name} (${n.unit})`, name: n.name, unit: n.unit,
  }));
  const storageOptions = storages.map(s => ({ id: s.id, label: s.label }));

  return (
    <div className="wh-form wh-operation-line__fields">
      <label className="wh-operation-line__wide">Материал
        {/* Выпадающий список на пятьсот позиций заменён автодополнением: выдача
            делается по нескольку раз в день, и поиск прокруткой был самым
            медленным местом модуля. */}
        <Combobox
          value={line.nomenclatureId}
          options={nomenclatureOptions}
          placeholder="Начните вводить название или код"
          onChange={(id) => {
            setValue('nomenclatureId', id); setValue('batchId', ''); setValue('fromStorageId', '');
          }}
          renderOption={option => (
            <>
              <span className="wh-mono wh-cell-sub">{option.code}</span>{' '}
              {option.label}
            </>
          )}
        />
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
        <Combobox
          value={line.fromStorageId}
          options={selectableFrom.map(s => ({ id: s.id, label: s.label }))}
          placeholder="Место хранения"
          onChange={(id) => { setValue('fromStorageId', id); setValue('batchId', ''); }}
        />
        {selectedStock && <span className="wh-hint">Доступно: {selectedStock.quantity}</span>}
      </label>}
      {needTo && <label>Куда
        <Combobox
          value={line.toStorageId}
          options={storageOptions.filter(s => s.id !== line.fromStorageId)}
          placeholder="Место хранения"
          onChange={id => setValue('toStorageId', id)}
        />
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
        <Combobox
          value={line.assetId}
          options={assets.map(a => ({
            id: a.id, code: a.inventoryNumber,
            label: `${a.name} · ${roomLabel(a.room)}`,
          }))}
          placeholder="Инвентарный номер или название"
          onChange={id => setValue('assetId', id)}
          renderOption={option => (
            <>
              <span className="wh-mono wh-cell-sub">{option.code}</span> {option.label}
            </>
          )}
        />
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

function DocumentCard({ document: d, onClose, onRepeat, canRepeat }) {
  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div><div className="wh-modal__title">{d.number} · {TYPE_LABELS[d.type] || d.type}</div>
            <div className="wh-modal__sub">{fmtDateTime(d.date)} · {d.status === 'signed' ? 'подписан' : d.status}</div></div>
          <div className="wh-panel__actions">
            {/* Повтор собирает новый документ с теми же строками. Причина и
                подпись заполняются заново — это новое событие, а не копия. */}
            {canRepeat && Boolean(d.movements?.length) && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={onRepeat}>
                <Copy size={13} /> Повторить
              </button>
            )}
            <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
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
  const addRoom = (mc, r, place = '') => {
      const label = `${mc.name}${place} · Каб. ${r.number}${r.name && r.name !== r.number ? ` — ${r.name}` : ''}`;
      rows.push({
        ...r, label,
        storages: (r.storages || []).map(s => ({ ...s, roomId: r.id, label: `${label} · ${s.name}` })),
      });
  };
  for (const mc of tree?.medCenters || []) {
    for (const r of mc.rooms || []) addRoom(mc, r);
    for (const b of mc.buildings || []) for (const f of b.floors || []) {
      for (const r of f.rooms || []) addRoom(mc, r, ` · ${b.name} · ${f.number} эт.`);
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
