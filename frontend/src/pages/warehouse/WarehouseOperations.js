import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowLeft, Boxes, Check, ChevronRight, Copy, FilePlus2, Package,
  Plus, Search, Trash2, X,
} from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';
import Combobox from './components/Combobox';
import LocationPicker from './components/LocationPicker';
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

/**
 * Операции, в которых сначала выбирается место, а уже потом объект.
 *
 * Списание, ремонт и перемещение — это всегда работа с тем, что где-то УЖЕ
 * лежит. Человек стоит в кабинете (или разбирает заявку по конкретному складу) и
 * решает судьбу его содержимого. Общий справочник на пятьсот позиций в такой
 * работе — помеха: из него ещё надо угадать то, что здесь действительно есть, и
 * ошибка вскрывалась только на проведении, отказом «нет остатка».
 *
 * Поэтому здесь порядок обратный: сначала место, потом список того, что в нём
 * фактически лежит, — с количествами. Приём, выдача, возврат и оприходование
 * идут прежним порядком: там объект известен заранее (его привезли, его просят),
 * а место — это ответ, а не вопрос.
 */
const SOURCE_FIRST = new Set(['writeoff', 'transfer', 'repair_out', 'repair_in']);

// Подпись у выбора места своя на каждую операцию: «откуда» ничего не говорит о
// том, что сейчас произойдёт, а на этом шаге человек как раз выбирает область
// ответственности.
const SOURCE_LABELS = {
  writeoff: 'Откуда списываем',
  transfer: 'Откуда перемещаем',
  repair_out: 'Откуда забираем в ремонт',
  // Из ремонта: сервер размещение не меняет, он только снимает статус «в
  // ремонте». Значит выбирается не «куда вернуть», а кабинет, за которым
  // оборудование числится всё это время.
  repair_in: 'Кабинет оборудования',
};

// Один и тот же пустой массив, а не новый литерал на каждый рендер: он стоит в
// зависимостях useMemo, и свежая ссылка пересобирала бы список содержимого
// вхолостую при каждом нажатии клавиши в форме.
const NO_ROWS = [];

const EMPTY_LINE = {
  // kind и objectId — служебные: первое решает, какие поля показывать, второе
  // держит выбор в объединённом списке материалов и оборудования.
  kind: '', objectId: '',
  assetId: '', nomenclatureId: '', batchId: '', quantity: 1, unitCost: '',
  fromStorageId: '', fromRoomId: '', toStorageId: '', toRoomId: '', toResponsibleId: '',
  doctorUserId: '', serviceCode: '', reasonText: '',
};

/**
 * Поля строки, которые уходят на сервер. Перечислены явно, а не вычитаются из
 * строки исключением служебных: строка обросла подписями для таблицы и
 * признаком вида, и список «что НЕ отправлять» пришлось бы дополнять при каждом
 * новом поле — молча отправив лишнее, если забыть.
 */
const PAYLOAD_KEYS = [
  'assetId', 'nomenclatureId', 'batchId', 'quantity', 'unitCost',
  'fromStorageId', 'toStorageId', 'toRoomId', 'toResponsibleId',
  'doctorUserId', 'serviceCode', 'reasonText',
];

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
      {/* Журнал — сама вкладка, а не одна из двух её половин. Тумблер
          «Журнал / Новый документ» уравнивал в правах список, который открыт всё
          время, и форму, которую заполняют раз в день, — и заодно занимал место
          слева, где взгляд ищет фильтры. Теперь фильтры стоят первыми, а
          создание документа — обычное действие кнопкой справа. */}
      {view === 'journal' && (
        <div className="wh-assets__filters">
          <div className="wh-search">
            <Search size={15} />
            <input value={filters.q} placeholder="Номер, причина, автор…"
                   onChange={e => setFilter({ q: e.target.value })} />
          </div>
          <select value={filters.type} onChange={e => setFilter({ type: e.target.value })}>
            <option value="">Все операции</option>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {access?.capabilities?.canIssue && (
            <button className="wh-btn wh-btn--primary" style={{ marginLeft: 'auto' }}
                    onClick={() => { setRepeat(null); setView('new'); }}>
              <FilePlus2 size={15} /> Новый документ
            </button>
          )}
        </div>
      )}

      {view === 'new' ? (
        <DocumentEditor
          // key заставляет редактор пересобраться, когда меняется источник
          // повтора: без него состояние формы осталось бы от прошлого документа.
          key={repeat?.id || 'blank'}
          refs={refs} tree={tree} initial={repeat}
          onCancel={() => { setRepeat(null); setView('journal'); }}
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
function DocumentEditor({ refs, tree, onCreated, onCancel, initial }) {
  const [type, setType] = useState(initial?.type || 'receipt');
  const [line, setLine] = useState(EMPTY_LINE);
  const [lines, setLines] = useState([]);
  const [meta, setMeta] = useState({
    occurredAt: localNow(), reasonCode: '', reasonText: '',
    comment: '', contractorId: '',
  });
  const [saving, setSaving] = useState(false);
  // Место, из которого набираем строки в операциях «сначала место». Отдельным
  // состоянием, а не полем строки: из одного кабинета списывают пачку позиций
  // подряд, и переживать добавление строки оно должно само собой.
  const [source, setSource] = useState({ roomId: '', storageId: '' });

  // Плоский список мест хранения нужен только для подписей: сам выбор идёт по
  // дереву внутри LocationPicker.
  const storages = useMemo(() => flattenStorages(tree), [tree]);
  const canMaterial = MATERIAL_TYPES.has(type);
  const canAsset = ASSET_TYPES.has(type);
  const sourceFirst = SOURCE_FIRST.has(type);

  /**
   * Содержимое выбранного места — отдельным запросом, а не выборкой из общих
   * справочников.
   *
   * Справочники в refs грузятся срезом: остатки с потолком в 2000 строк, активы
   * первой пятисоткой. Пока они были нужны только чтобы отфильтровать список
   * мест хранения, потолок ничего не решал. Теперь из них собирается сам список
   * того, что можно списать, — и на сети, где в одной ведомости три тысячи
   * позиций, часть кабинетов молча оказалась бы пустой. Запрос по конкретному
   * кабинету всегда точен и невелик.
   */
  /**
   * Кабинеты, закрытые сейчас инвентаризацией.
   *
   * Пока по кабинету идут пересчёт, остаток в нём двигать нельзя: опись сняла
   * ожидаемые количества при открытии и проведёт разницу поверх них. Сервер это
   * и так не пропустит, но узнать об отказе на кнопке «Провести» — значит узнать
   * после того, как документ уже собран. Предупреждение стоит там, где выбирают
   * место.
   */
  const [frozen, setFrozen] = useState(new Map());
  useEffect(() => {
    let cancelled = false;
    warehouseApi.frozenRooms()
      .then(({ data }) => {
        if (cancelled) return;
        setFrozen(new Map((data.items || []).map(i => [i.roomId, i.number])));
      })
      .catch(() => { /* предупреждение необязательное: отказ всё равно придёт с сервера */ });
    return () => { cancelled = true; };
  }, []);

  // Кабинеты документа — те же, что проверяет сервер: и «откуда», и «куда».
  const frozenInDocument = useMemo(() => {
    const rooms = new Set();
    if (source.roomId) rooms.add(source.roomId);
    for (const row of lines) {
      if (row.fromRoomId) rooms.add(row.fromRoomId);
      if (row.toRoomId) rooms.add(row.toRoomId);
    }
    if (line.toRoomId) rooms.add(line.toRoomId);
    return [...rooms].filter(id => frozen.has(id)).map(id => frozen.get(id));
  }, [frozen, source.roomId, lines, line.toRoomId]);

  const [contents, setContents] = useState({ loading: false, stock: [], assets: [] });
  useEffect(() => {
    if (!sourceFirst || !source.roomId) { setContents({ loading: false, stock: [], assets: [] }); return undefined; }
    let cancelled = false;
    setContents({ loading: true, stock: [], assets: [] });
    const nothing = Promise.resolve({ data: { items: [] } });
    Promise.all([
      canMaterial ? warehouseApi.stock({ roomId: source.roomId, includeZero: 'false' }) : nothing,
      canAsset ? warehouseApi.assets({ roomId: source.roomId, limit: 500 }) : nothing,
    ])
      .then(([stockRes, assetRes]) => {
        if (cancelled) return;
        // Отбор по кабинету повторяем на клиенте: сервер к запрошенному кабинету
        // подмешивает всю зону ответственности человека, и без этого в списке
        // содержимого 305-го оказалось бы содержимое всех его кабинетов сразу.
        const inPlace = (roomId, storageId) => roomId === source.roomId
          && (!source.storageId || storageId === source.storageId);
        setContents({
          loading: false,
          stock: (stockRes.data.items || []).filter(row => inPlace(row.room?.id, row.storage?.id)),
          assets: (assetRes.data.items || []).filter(a => inPlace(a.room?.id, a.storage?.id)),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setContents({ loading: false, stock: [], assets: [] });
        toast.error('Не удалось загрузить содержимое места');
      });
    return () => { cancelled = true; };
  }, [sourceFirst, source.roomId, source.storageId, canMaterial, canAsset]);

  // Смена типа документа сбрасывает набранные строки: у приёма и списания разные
  // обязательные реквизиты, и строка, собранная для одного, для другого неверна.
  //
  // Сравнение с предыдущим типом через ref, а не просто зависимость эффекта:
  // на первом рендере сбрасывать нечего — а именно так терялись строки
  // повторяемого документа.
  const previousType = useRef(type);
  useEffect(() => {
    if (previousType.current === type) return;
    previousType.current = type;
    setLine(EMPTY_LINE);
    setLines([]);
    setSource({ roomId: '', storageId: '' });
  }, [type]);

  // Повтор документа: строки восстанавливаются из его движений. Заново
  // указываются только дата, причина и подпись — повтор это новое событие,
  // и подписывать его надо отдельно.
  useEffect(() => {
    if (!initial?.movements?.length) return;
    // Кабинет берём из места хранения по дереву: движения документа приходят со
    // storage, но без room, и без этого шага повтор перемещения оборудования
    // упирался в проверку «укажите, куда именно» — кабинет назначения оказывался
    // пустым при заполненном месте хранения.
    const roomOf = storageId => storages.find(x => x.id === storageId)?.roomId || '';
    setLines(initial.movements.map((movement) => {
      const isAsset = Boolean(movement.asset);
      const fromStorageId = movement.fromStorage?.id || '';
      const toStorageId = movement.toStorage?.id || '';
      return {
        ...EMPTY_LINE,
        kind: isAsset ? 'asset' : 'material',
        assetId: movement.asset?.id || '',
        nomenclatureId: movement.nomenclature?.id || '',
        batchId: movement.batch?.id || '',
        quantity: Number(movement.quantity) || 1,
        unitCost: Number(movement.unitCost) || '',
        fromStorageId,
        fromRoomId: movement.fromRoom?.id || roomOf(fromStorageId),
        toStorageId,
        toRoomId: movement.toRoom?.id || roomOf(toStorageId),
        toResponsibleId: movement.toResponsible?.id || '',
        doctorUserId: movement.doctor?.id || '',
        serviceCode: movement.serviceCode || '',
        reasonText: '',
        label: isAsset
          ? `${movement.asset.inventoryNumber} · ${movement.asset.name}`
          : `${movement.nomenclature?.code || ''} · ${movement.nomenclature?.name || ''}`,
        fromLabel: fromStorageId ? storageLabel(storages, fromStorageId) : '—',
        toLabel: toStorageId ? storageLabel(storages, toStorageId) : '—',
      };
    }));
  }, [initial, storages]);

  /**
   * Единый список того, что можно поставить в строку: материалы и оборудование
   * вперемешку.
   *
   * Раньше это были две вкладки, «Материал» и «Оборудование». Документ и тогда
   * законно содержал и то, и другое, но чтобы списать из кабинета шкаф и
   * оставшийся в нём бинт, надо было вспомнить про вторую вкладку — а не
   * вспомнив, провести две операции вместо одной. Вид объекта — свойство самой
   * строки, а не режим экрана, поэтому он и определяется выбором в списке.
   */
  const objectOptions = useMemo(() => {
    const materials = [];
    const assets = [];

    if (sourceFirst) {
      // Остаток группируется по паре «номенклатура + место хранения»: партии
      // складываются (партию выбирают отдельным полем), а вот одна и та же
      // позиция в двух шкафах кабинета — это два разных ответа на вопрос
      // «откуда списываем», и склеивать их нельзя.
      const byPlace = new Map();
      for (const row of contents.stock) {
        const n = row.nomenclature;
        if (!n) continue;
        const key = `${n.id}@${row.storage?.id}`;
        const acc = byPlace.get(key) || {
          kind: 'material', id: `m:${key}`,
          nomenclatureId: n.id, storageId: row.storage?.id, roomId: row.room?.id,
          code: n.code, label: `${n.name} (${n.unit})`, unit: n.unit,
          place: source.storageId ? '' : row.storage?.name, qty: 0,
        };
        acc.qty += Number(row.quantity) || 0;
        byPlace.set(key, acc);
      }
      materials.push(...byPlace.values());

      for (const a of contents.assets) {
        assets.push({
          kind: 'asset', id: `a:${a.id}`,
          assetId: a.id, storageId: a.storage?.id, roomId: a.room?.id,
          code: a.inventoryNumber,
          label: [a.name, a.model].filter(Boolean).join(' · '),
          place: source.storageId ? '' : a.storage?.name,
          note: ASSET_STATUS[a.status] || '',
        });
      }
    } else {
      if (canMaterial) {
        materials.push(...refs.nomenclature.map(n => ({
          kind: 'material', id: `m:${n.id}`, nomenclatureId: n.id,
          code: n.code, label: `${n.name} (${n.unit})`, unit: n.unit,
        })));
      }
      if (canAsset) {
        assets.push(...refs.assets.map(a => ({
          kind: 'asset', id: `a:${a.id}`, assetId: a.id,
          storageId: a.storage?.id, roomId: a.room?.id,
          code: a.inventoryNumber,
          label: [a.name, a.model].filter(Boolean).join(' · '),
          note: roomLabel(a.room),
        })));
      }
    }

    const byName = (x, y) => x.label.localeCompare(y.label, 'ru');
    // Материалы идут первыми целиком, а не вперемешку по алфавиту: это разные
    // сущности с разными полями, и список, в котором они чередуются, читается
    // как ошибка сортировки.
    return [...materials.sort(byName), ...assets.sort(byName)];
  }, [sourceFirst, contents, source.storageId, canMaterial, canAsset, refs.nomenclature, refs.assets]);

  const isMaterial = line.kind === 'material';
  const isAsset = line.kind === 'asset';

  const batches = useMemo(() => {
    if (!isMaterial) return [];
    // В операциях «сначала место» партии — только те, что лежат здесь: общий
    // справочник предлагал серии, которых в этом кабинете нет, и подбор FEFO их
    // всё равно не находил.
    if (sourceFirst) {
      const seen = new Map();
      for (const row of contents.stock) {
        if (row.nomenclature?.id !== line.nomenclatureId) continue;
        if (row.storage?.id !== line.fromStorageId || !row.batch) continue;
        seen.set(row.batch.id, row.batch);
      }
      return [...seen.values()];
    }
    return refs.batches.filter(b => !line.nomenclatureId || b.nomenclatureId === line.nomenclatureId);
  }, [isMaterial, sourceFirst, contents.stock, line.nomenclatureId, line.fromStorageId, refs.batches]);

  /**
   * Сколько этой позиции лежит в этом месте — по остаткам, а не по справочнику.
   *
   * null означает «не знаем»: общий срез остатков приходит с потолком, и принять
   * его отсутствие за ноль значит запретить законную операцию. Запрещаем только
   * когда точно видим, что столько не лежит.
   */
  const stockAtPlace = useCallback((nomenclatureId, storageId, batchId) => {
    if (!nomenclatureId || !storageId) return null;
    const rows = (sourceFirst ? contents.stock : refs.stock).filter(row =>
      row.nomenclature?.id === nomenclatureId
      && row.storage?.id === storageId
      && (!batchId || row.batch?.id === batchId));
    if (!rows.length) return null;
    return rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  }, [sourceFirst, contents.stock, refs.stock]);

  /** Сколько этой же позиции из этого же места уже стоит в набранных строках. */
  const committed = useMemo(() => {
    const map = new Map();
    for (const row of lines) {
      if (row.kind !== 'material' || !row.fromStorageId) continue;
      const key = `${row.nomenclatureId}@${row.fromStorageId}@${row.batchId || ''}`;
      map.set(key, (map.get(key) || 0) + (Number(row.quantity) || 0));
    }
    return map;
  }, [lines]);

  /**
   * Предел количества для текущей строки: остаток минус то, что уже разобрано
   * строками этого же документа.
   *
   * Сервер такую строку и так не пропустит — pickBatchesFefo отвечает
   * «Недостаточно годного остатка». Но узнать об этом на кнопке «Провести»,
   * собрав весь документ и заполнив причину, — это узнать слишком поздно.
   * Ограничение стоит там, где число вводят.
   *
   * Строки документа считаются вместе: две строки по две штуки поодиночке
   * проходят проверку, а вместе просят четыре из двух имеющихся.
   */
  const outgoing = ['issue', 'transfer', 'writeoff'].includes(type);
  const limit = useMemo(() => {
    if (line.kind !== 'material' || !outgoing) return null;
    const total = stockAtPlace(line.nomenclatureId, line.fromStorageId, line.batchId);
    if (total === null) return null;
    const key = `${line.nomenclatureId}@${line.fromStorageId}@${line.batchId || ''}`;
    return Math.max(0, total - (committed.get(key) || 0));
  }, [line.kind, line.nomenclatureId, line.fromStorageId, line.batchId, outgoing, stockAtPlace, committed]);

  const selectedStock = refs.stock.find(s =>
    s.nomenclature?.id === line.nomenclatureId && s.storage?.id === line.fromStorageId &&
    (!line.batchId || s.batch?.id === line.batchId)
  );

  const needFrom = isMaterial && !sourceFirst && ['issue', 'transfer', 'writeoff'].includes(type);
  const needTo = (isMaterial && ['receipt', 'return', 'transfer', 'surplus'].includes(type))
    || (isAsset && type === 'transfer');

  const setLineValue = (key, value) => setLine(l => ({ ...l, [key]: value }));

  // Выбор объекта задаёт и вид строки, и — в операциях «сначала место» — то
  // место, откуда она берётся: в списке уже стоит конкретный шкаф.
  const pickObject = (optionId) => {
    const option = objectOptions.find(o => o.id === optionId);
    if (!option) return setLine(l => ({ ...EMPTY_LINE, toStorageId: l.toStorageId, toRoomId: l.toRoomId }));
    setLine(l => ({
      ...l,
      kind: option.kind, objectId: option.id,
      assetId: option.assetId || '',
      nomenclatureId: option.nomenclatureId || '',
      batchId: '',
      quantity: option.kind === 'asset' ? 1 : l.quantity || 1,
      fromStorageId: sourceFirst ? (option.storageId || '') : l.fromStorageId,
      fromRoomId: sourceFirst ? (option.roomId || '') : l.fromRoomId,
    }));
  };

  const addLine = () => {
    if (sourceFirst && !source.roomId) {
      return toast.error(`Сначала укажите: ${SOURCE_LABELS[type].toLowerCase()}`);
    }
    if (!line.kind) return toast.error('Выберите материал или оборудование');

    if (isAsset) {
      if (type === 'transfer' && (!line.toRoomId || !line.toStorageId)) {
        return toast.error('Для перемещения укажите, куда именно');
      }
      const asset = (sourceFirst ? contents.assets : refs.assets).find(a => a.id === line.assetId);
      setLines(prev => [...prev, {
        ...line,
        // Откуда оборудование уезжает, сервер берёт из карточки актива — но в
        // таблице строк это место всё равно надо показать, иначе колонка
        // «Откуда» у оборудования всегда пустая.
        fromStorageId: '', fromRoomId: asset?.room?.id || '',
        label: `${asset?.inventoryNumber} · ${asset?.name}`,
        fromLabel: placeLabel(asset?.room, asset?.storage),
        toLabel: line.toStorageId ? storageLabel(storages, line.toStorageId) : '—',
      }]);
    } else {
      if (!sourceFirst && needFrom && !line.fromStorageId) {
        return toast.error('Укажите место хранения «откуда»');
      }
      if (!(Number(line.quantity) > 0)) return toast.error('Количество должно быть больше нуля');
      // Дробные количества сравниваем с допуском: в остатках лежат миллилитры и
      // метры, и 0.1 + 0.2 в двоичной дроби даёт чуть больше 0.3.
      if (limit !== null && Number(line.quantity) > limit + 1e-9) {
        return toast.error(limit > 0
          ? `Доступно только ${qtyText(limit)} — уменьшите количество`
          : 'Весь остаток этой позиции уже разобран строками документа');
      }
      if (needTo && !line.toStorageId) return toast.error('Укажите место хранения «куда»');
      const nom = refs.nomenclature.find(n => n.id === line.nomenclatureId)
        || objectOptions.find(o => o.id === line.objectId);
      const from = storages.find(s => s.id === line.fromStorageId);
      setLines(prev => [...prev, {
        ...line, quantity: Number(line.quantity),
        fromRoomId: line.fromRoomId || from?.roomId || '',
        unitCost: line.unitCost === '' ? Number(selectedStock?.unitCost || nom?.lastPrice || 0) : Number(line.unitCost),
        label: `${nom?.code || ''} · ${nom?.name || nom?.label || ''}`,
        fromLabel: line.fromStorageId ? storageLabel(storages, line.fromStorageId) : '—',
        toLabel: line.toStorageId ? storageLabel(storages, line.toStorageId) : '—',
      }]);
    }

    // Назначение переживает добавление строки: в перемещении пачку позиций
    // отправляют в одно и то же место, и выбирать его заново на каждую строку
    // значит повторять руками то, что не менялось.
    setLine({ ...EMPTY_LINE, toStorageId: line.toStorageId, toRoomId: line.toRoomId });
  };

  const submit = async () => {
    if (!lines.length) return toast.error('Добавьте хотя бы одну строку');
    if (!meta.reasonText.trim()) return toast.error('Укажите причину операции');
    setSaving(true);
    try {
      const payloadLines = lines.map(row => Object.fromEntries(
        PAYLOAD_KEYS.map(key => [key, row[key] === '' || row[key] === undefined ? null : row[key]])
      ));
      // Кабинеты документа целиком — из строк, и только когда они у всех строк
      // одни. Раньше они не передавались вовсе, и в журнале колонки «Откуда» и
      // «Куда» стояли пустыми у каждого документа, созданного здесь. Ставить их
      // по первой строке нельзя: документ, собранный из двух кабинетов, врал бы
      // о себе в списке.
      const single = (values) => {
        const unique = [...new Set(values.filter(Boolean))];
        return unique.length === 1 ? unique[0] : null;
      };
      const { data } = await warehouseApi.createDocument({
        type, lines: payloadLines, occurredAt: meta.occurredAt || null,
        fromRoomId: single(lines.map(l => l.fromRoomId)),
        toRoomId: single(lines.map(l => l.toRoomId)),
        reasonCode: meta.reasonCode || null, reasonText: meta.reasonText.trim(),
        comment: meta.comment || null, contractorId: meta.contractorId || null,
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
    <div className="wh-opdoc">
      {/* Полоса документа: возврат к журналу и два реквизита, без которых
          документа не существует. Заголовка «Новый складской документ» здесь
          нет намеренно — человек только что нажал кнопку с этим текстом, и
          строка, повторяющая её, занимала место, но ничего не сообщала. */}
      <div className="wh-opdoc__bar">
        <button className="wh-btn wh-btn--ghost" onClick={onCancel}>
          <ArrowLeft size={15} /> К журналу
        </button>
        <span className="wh-filters__sep" />
        <label className="wh-opdoc__bar-field">
          <span className="wh-form__cap">Операция</span>
          <select value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="wh-opdoc__bar-field">
          <span className="wh-form__cap">Дата и время</span>
          {/* max — задним числом документ оформить можно, будущим нельзя: остаток
              меняется сейчас, и движение, датированное следующим месяцем, выпало
              бы из отчёта за текущий. Сервер это проверяет отдельно. */}
          <input type="datetime-local" value={meta.occurredAt}
                 max={localNow()}
                 onChange={e => setMeta(m => ({ ...m, occurredAt: e.target.value }))} />
        </label>
      </div>

      {/* Две колонки: слева содержимое документа, справа его реквизиты и
          проведение. Раньше всё шло одной лентой сверху вниз — причина и
          комментарий оказывались по разные стороны от таблицы строк, а кнопка
          «Провести» уезжала за нижний край, и до неё надо было доскроллить
          мимо только что набранных строк. */}
      <div className="wh-opdoc__cols">
        <section className="wh-opdoc__main">
          <div className="wh-opdoc__block">
            <div className="wh-opdoc__head">
              <h3>Что проводим</h3>
            </div>

            <LineEditor
              type={type} line={line} setValue={setLineValue} pickObject={pickObject}
              options={objectOptions} batches={batches} tree={tree} users={refs.users}
              stock={refs.stock} selectedStock={selectedStock}
              needFrom={needFrom} needTo={needTo} limit={limit}
              sourceFirst={sourceFirst} source={source} contents={contents}
              setSource={(next) => { setSource(next); setLine(l => ({ ...EMPTY_LINE, toStorageId: l.toStorageId, toRoomId: l.toRoomId })); }}
            />

            <div className="wh-opdoc__add">
              <button className="wh-btn wh-btn--secondary" onClick={addLine}>
                <Plus size={14} /> Добавить строку
              </button>
            </div>
          </div>

          <div className="wh-opdoc__block wh-opdoc__block--flush">
            <div className="wh-opdoc__head">
              <h3>Строки документа</h3>
              {Boolean(lines.length) && <span className="wh-opdoc__count">{lines.length}</span>}
            </div>
            <div className="wh-table-wrap">
              <table className="wh-table wh-table--compact">
                <thead><tr><th>Объект</th><th>Кол-во</th><th>Откуда</th><th>Куда</th><th>Врач / МОЛ</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.assetId || l.nomenclatureId}-${i}`}>
                      <td>{l.label}{l.batchId && <div className="wh-cell-sub">Партия: {batchLabel(refs.batches, l.batchId)}</div>}</td>
                      <td>{l.kind === 'asset' ? 1 : l.quantity}</td>
                      <td title={storageTitle(storages, l.fromStorageId)}>{l.fromLabel || '—'}</td>
                      <td title={storageTitle(storages, l.toStorageId)}>{l.toLabel || '—'}</td>
                      <td>{userLabel(refs.users, l.doctorUserId || l.toResponsibleId)}</td>
                      <td><button className="wh-icon-btn wh-icon-btn--danger" onClick={() => setLines(v => v.filter((_, x) => x !== i))}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                  {!lines.length && <tr><td colSpan={6} className="wh-empty">Пока пусто — добавьте оборудование или материалы сверху</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="wh-opdoc__side">
          <div className="wh-opdoc__block">
            <div className="wh-opdoc__head"><h3>Реквизиты</h3></div>
            <div className="wh-form">
              <label>
                {/* Подпись и звёздочка — один флекс-элемент: в колоночном
                    флексе <b> со звёздочкой вставал отдельной строкой, поле
                    становилось выше соседнего, и ряд формы разъезжался. */}
                <span className="wh-form__cap">Причина <b className="wh-req">*</b></span>
                <input value={meta.reasonText} placeholder="Для чего выполняется операция"
                       onChange={e => setMeta(m => ({ ...m, reasonText: e.target.value }))} />
              </label>
              <label>
                <span className="wh-form__cap">Код основания</span>
                <input value={meta.reasonCode} placeholder="заявка, возврат, брак…"
                       onChange={e => setMeta(m => ({ ...m, reasonCode: e.target.value }))} />
              </label>
              {(type === 'receipt' || type === 'repair_out' || type === 'repair_in') && (
                <label>
                  <span className="wh-form__cap">Контрагент</span>
                  <select value={meta.contractorId} onChange={e => setMeta(m => ({ ...m, contractorId: e.target.value }))}>
                    <option value="">—</option>
                    {refs.contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
              <label>
                <span className="wh-form__cap">Комментарий</span>
                <textarea rows={3} value={meta.comment}
                          onChange={e => setMeta(m => ({ ...m, comment: e.target.value }))} />
              </label>
            </div>
          </div>

          {frozenInDocument.length > 0 && (
            <div className="wh-note wh-note--warn">
              <AlertTriangle size={15} />
              <div>
                По кабинету документа идёт инвентаризация {frozenInDocument.join(', ')}.
                Пока опись не закрыта, остаток в нём не двигается: комиссия считает
                полку по количествам, снятым при открытии описи, и движение под
                руками у неё превратится в недостачу или излишек.
              </div>
            </div>
          )}

          {/* Подпись фиксируется самим нажатием кнопки: отдельная галочка
              «подтверждаю подлинность» была вторым замком на той же двери — её
              ставили не читая, чтобы разблокировать кнопку. */}
          <div className="wh-opdoc__submit">
            <button className="wh-btn wh-btn--primary" onClick={submit}
                    disabled={saving || !lines.length || frozenInDocument.length > 0}>
              <Check size={15} /> {saving ? 'Провожу…' : 'Провести и подписать'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Строка документа: что именно и откуда/куда.
 *
 * Редактор один на материалы и оборудование. Вид объекта — свойство строки, а не
 * режим экрана: он определяется тем, что выбрали в общем списке, и от него
 * зависит только набор оставшихся полей (количество и партия у материала, новый
 * МОЛ у оборудования).
 */
function LineEditor({
  type, line, setValue, pickObject, options, batches, tree, users, stock,
  needFrom, needTo, selectedStock, limit, sourceFirst, source, setSource, contents,
}) {
  const isMaterial = line.kind === 'material';
  const isAsset = line.kind === 'asset';
  const showDoctor = type === 'issue' && isMaterial;
  const showPrice = isMaterial && ['receipt', 'return', 'surplus'].includes(type);

  // Откуда можно взять в обычном порядке (объект выбран первым): только места,
  // где выбранный материал действительно лежит.
  //
  // Предикаты собраны через useMemo, потому что дерево локаций внутри
  // LocationPicker пересобирается при смене фильтра: без стабильной ссылки оно
  // пересобиралось бы на каждый набранный в поиске символ.
  const stockStorageIds = useMemo(() => {
    if (!line.nomenclatureId) return null;
    return new Set(stock
      .filter(s => s.nomenclature?.id === line.nomenclatureId)
      .map(s => s.storage?.id));
  }, [stock, line.nomenclatureId]);
  const filterFrom = useMemo(
    () => (stockStorageIds ? storage => stockStorageIds.has(storage.id) : undefined),
    [stockStorageIds]
  );
  const filterTo = useMemo(
    () => storage => storage.id !== line.fromStorageId,
    [line.fromStorageId]
  );

  // Перебор количества показываем сразу, а не при попытке добавить строку:
  // цифру исправляют там же, где набрали.
  const over = limit !== null && Number(line.quantity) > limit + 1e-9;

  const counts = useMemo(() => ({
    materials: options.filter(o => o.kind === 'material').length,
    assets: options.filter(o => o.kind === 'asset').length,
  }), [options]);

  return (
    <div className="wh-form wh-opdoc__fields">
      {/* Порядок полей — это и есть порядок работы. В списании, перемещении и
          ремонте сначала идёт место, и всё остальное показывается уже как его
          содержимое; в приёме и выдаче первым идёт объект. */}
      {sourceFirst && (
        <label className="wh-opdoc__wide">
          <span className="wh-form__cap">{SOURCE_LABELS[type]} <b className="wh-req">*</b></span>
          <LocationPicker
            tree={tree} mode="storage" allowRoom
            roomId={source.roomId} storageId={source.storageId}
            placeholder="Кабинет или место хранения"
            onPick={({ roomId, storageId }) => setSource({ roomId, storageId })}
          />
        </label>
      )}

      <label className="wh-opdoc__wide">
        <span className="wh-form__cap">Что именно <b className="wh-req">*</b></span>
        {/* Один список на материалы и оборудование: списание шкафа и остатка
            бинтов из того же кабинета — одна операция, и делить её на две
            вкладки значило заставлять вспоминать про вторую. */}
        <Combobox
          value={line.objectId}
          options={options}
          disabled={sourceFirst && (!source.roomId || contents.loading)}
          placeholder={sourceFirst
            ? (!source.roomId ? 'Сначала выберите кабинет или склад'
              : contents.loading ? 'Смотрю, что здесь есть…' : contentsHint(counts))
            : 'Начните вводить название или код'}
          emptyText={sourceFirst ? 'Здесь ничего не числится' : 'Ничего не нашлось'}
          onChange={pickObject}
          renderOption={option => (
            <>
              <span className={`wh-opdoc__opt-kind wh-opdoc__opt-kind--${option.kind}`}>
                {option.kind === 'asset' ? <Package size={13} /> : <Boxes size={13} />}
              </span>
              <span className="wh-mono wh-cell-sub">{option.code}</span>{' '}
              {option.label}
              {option.place && <span className="wh-opdoc__opt-note">{option.place}</span>}
              {option.qty !== undefined && (
                <span className="wh-opdoc__opt-qty">{qtyText(option.qty)} {option.unit}</span>
              )}
              {option.note && <span className="wh-opdoc__opt-qty">{option.note}</span>}
            </>
          )}
        />
      </label>

      {isMaterial && <>
        <label>
          {/* Остаток стоит в подписи поля, а не подсказкой под ним: подписи под
              полями в модуле скрыты общим правилом (.wh-hint), и предупреждение
              «доступно 2» было бы честно написано в невидимую строку. */}
          <span className="wh-form__cap">
            Количество
            {limit !== null && (
              <span className={`wh-form__note ${over ? 'is-error' : ''}`}>
                доступно {qtyText(limit)}
              </span>
            )}
          </span>
          {/* max — подсказка браузеру для стрелок; настоящая проверка стоит в
              «Добавить строку»: набрать больше руками max не мешает. */}
          <input type="number" min="0.001" step="0.001"
                 max={limit !== null ? limit : undefined}
                 className={over ? 'wh-input--over' : ''}
                 value={line.quantity}
                 onChange={e => setValue('quantity', e.target.value)} />
          {over && (
            <span className="wh-field-error">
              {limit > 0
                ? `Столько не лежит — списать можно не больше ${qtyText(limit)}`
                : 'Весь остаток этой позиции уже разобран строками документа'}
            </span>
          )}
        </label>
        <label>
          <span className="wh-form__cap">Партия</span>
          <select value={line.batchId} onChange={e => setValue('batchId', e.target.value)}>
            <option value="">Автовыбор FEFO / без партии</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.batchNumber}{b.expiryDate ? ` · до ${fmtDate(b.expiryDate)}` : ''}</option>)}
          </select>
        </label>
      </>}

      {needFrom && (
        <label>
          <span className="wh-form__cap">Откуда <b className="wh-req">*</b></span>
          <LocationPicker
            tree={tree} mode="storage"
            roomId="" storageId={line.fromStorageId}
            filterStorage={filterFrom}
            placeholder="Место хранения"
            emptyText={line.nomenclatureId ? 'Этого материала нигде нет в остатках' : 'Мест хранения нет'}
            onPick={({ storageId, roomId }) => {
              setValue('fromStorageId', storageId);
              setValue('fromRoomId', roomId);
              setValue('batchId', '');
            }}
          />
        </label>
      )}

      {needTo && (
        <label className={isAsset ? 'wh-opdoc__wide' : ''}>
          <span className="wh-form__cap">Куда <b className="wh-req">*</b></span>
          <LocationPicker
            tree={tree} mode="storage"
            roomId={line.toRoomId} storageId={line.toStorageId}
            filterStorage={filterTo}
            placeholder={isAsset ? 'Кабинет и место хранения' : 'Место хранения'}
            onPick={({ roomId, storageId }) => {
              setValue('toRoomId', roomId); setValue('toStorageId', storageId);
            }}
          />
        </label>
      )}

      {showPrice && (
        <label>
          <span className="wh-form__cap">Цена за единицу, ₽</span>
          <input type="number" min="0" step="0.01" value={line.unitCost}
                 onChange={e => setValue('unitCost', e.target.value)} />
        </label>
      )}

      {isAsset && type === 'transfer' && (
        <label>
          <span className="wh-form__cap">Новый МОЛ</span>
          <select value={line.toResponsibleId} onChange={e => setValue('toResponsibleId', e.target.value)}>
            <option value="">Оставить текущего</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
          </select>
        </label>
      )}

      {showDoctor && <>
        <label>
          <span className="wh-form__cap">Врач</span>
          <select value={line.doctorUserId} onChange={e => setValue('doctorUserId', e.target.value)}>
            <option value="">Не указан</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
          </select>
        </label>
        <label>
          <span className="wh-form__cap">Код услуги</span>
          <input value={line.serviceCode} onChange={e => setValue('serviceCode', e.target.value)} />
        </label>
      </>}
    </div>
  );
}

/**
 * Что лежит в выбранном месте — текстом внутри самого поля выбора.
 *
 * Под полем этой строке места нет: подписи под полями в модуле скрыты общим
 * правилом (.wh-hint {display:none}), и любое пояснение там оказывается написано
 * в пустоту. В плейсхолдере оно и заметнее — стоит ровно там, куда смотрят перед
 * тем, как открыть список.
 */
function contentsHint({ materials, assets }) {
  const parts = [];
  if (materials) parts.push(`${materials} ${plural(materials, 'позиция', 'позиции', 'позиций')}`);
  if (assets) parts.push(`${assets} ${plural(assets, 'единица', 'единицы', 'единиц')} оборудования`);
  return parts.length ? `Здесь ${parts.join(' и ')}` : 'Здесь ничего нет — выберите другое место';
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

/**
 * Места хранения одним списком — для подписей «откуда/куда» в таблице строк.
 *
 * Коротких подписи две: в ячейку идёт «Каб. 12 · Шкаф А1», а полный путь висит
 * подсказкой. Полный путь в самой ячейке растягивал колонку на пол-экрана и
 * повторял в каждой строке одно и то же название медцентра.
 */
function flattenStorages(tree) {
  const rows = [];
  const addRoom = (mc, room, place = '') => {
    const short = `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`;
    const full = `${mc.name}${place} · ${short}`;
    for (const s of room.storages || []) {
      rows.push({ ...s, roomId: room.id, label: `${short} · ${s.name}`, fullLabel: `${full} · ${s.name}` });
    }
  };
  for (const mc of tree?.medCenters || []) {
    for (const r of mc.rooms || []) addRoom(mc, r);
    for (const b of mc.buildings || []) for (const f of b.floors || []) {
      for (const r of f.rooms || []) addRoom(mc, r, ` · ${b.name} · ${f.number} эт.`);
    }
  }
  return rows;
}

const ASSET_STATUS = {
  in_use: 'в работе', maintenance: 'на ТО', repair: 'в ремонте',
  storage: 'на хранении', written_off: 'списано', reserved: 'зарезервировано',
};

const roomLabel = room => room ? `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}` : '—';

/**
 * Подпись места для таблицы строк: «Каб. 12 — Перевязочная · Шкаф А1».
 * У оборудования место хранения бывает не заполнено — тогда остаётся кабинет.
 */
const placeLabel = (room, storage) => {
  const parts = [];
  if (room) parts.push(roomLabel(room));
  if (storage?.name) parts.push(storage.name);
  return parts.join(' · ') || '—';
};

// Количество бывает дробным — в остатках лежат метры и миллилитры, — но хвост из
// нулей у штук мешает читать подсказку «доступно».
const qtyText = value => {
  const number = Number(value || 0);
  return number % 1 === 0
    ? number.toLocaleString('ru-RU')
    : number.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

/** Русское склонение после числа: 1 позиция, 2 позиции, 5 позиций. */
const plural = (count, one, few, many) => {
  const n = Math.abs(count) % 100;
  if (n > 10 && n < 20) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
};
const storageLabel = (items, id) => items.find(x => x.id === id)?.label || '—';
const storageTitle = (items, id) => items.find(x => x.id === id)?.fullLabel || undefined;
const userLabel = (items, id) => { const u = items.find(x => x.id === id); return u?.displayName || u?.username || '—'; };
const batchLabel = (items, id) => items.find(x => x.id === id)?.batchNumber || '—';
const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/**
 * «Сейчас» в том виде, в каком его понимает <input type="datetime-local">.
 *
 * Поле работает в местном времени и часового пояса не несёт; сервер разбирает
 * присланную строку тоже как местную. А toISOString отдаёт UTC — и подставленное
 * по умолчанию время оказывалось на три часа в прошлом, то есть каждый документ
 * по умолчанию оформлялся задним числом.
 */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
