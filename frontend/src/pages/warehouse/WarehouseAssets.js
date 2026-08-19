import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, QrCode, Printer, X, Wrench, ArrowRightLeft,
  FileText, AlertTriangle, Plus, Pencil, Check,
  Wand2,
} from 'lucide-react';
import { warehouseApi, BASE_URL } from '../../services/api';
import SecureImage from '../../components/warehouse/SecureImage';
import WarehouseAssetForm from './WarehouseAssetForm';
import Pagination from './components/Pagination';

/**
 * Оборудование: список, карточка, QR и печать этикеток.
 *
 * Печать сделана через SVG в миллиметрах и window.print(), а не через генерацию
 * PDF на сервере. Причина практическая: этикетки печатают на разных принтерах и
 * на разной бумаге, и подгонять поля куда проще в диалоге печати браузера, чем
 * пересобирать PDF на каждую попытку. Для термопринтера есть отдельная выгрузка
 * ZPL — там браузер не участвует вовсе.
 */

const STATUS_LABELS = {
  in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
  storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
};

export default function WarehouseAssets({ access, tree, onOpenRoom, initialAssetId, onInitialAssetShown }) {
  const [filters, setFilters] = useState({ q: '', status: '', medCenterId: '', departmentId: '', maintenanceDue: false });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [labelSize, setLabelSize] = useState('80x24');
  // null — форма закрыта; { asset: null } — постановка на учёт; { asset } — правка.
  const [form, setForm] = useState(null);
  const [parsing, setParsing] = useState(null);
  const [bulk, setBulk] = useState(null);

  const departments = useMemo(() => {
    if (!filters.medCenterId) return tree?.departments || [];
    return (tree?.departments || []).filter(d => d.medCenterId === filters.medCenterId);
  }, [tree, filters.medCenterId]);

  const setFilter = (patch) => {
    setFilters(f => ({ ...f, ...patch }));
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (filters.q) params.q = filters.q;
      if (filters.status) params.status = filters.status;
      if (filters.medCenterId) params.medCenterId = filters.medCenterId;
      if (filters.departmentId) params.departmentId = filters.departmentId;
      if (filters.maintenanceDue) params.maintenanceDue = 'true';
      const { data: res } = await warehouseApi.assets(params);
      setData(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить список');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(data.total / pageSize));
    if (page > pages) setPage(pages);
  }, [data.total, pageSize, page]);

  useEffect(() => {
    if (looksLikeCode(filters.q)) {
      openByCode(filters.q.trim());
      return undefined;
    }
    const t = setTimeout(load, filters.q ? 350 : 0);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [load, filters.q]);

  // Приход из отчёта по ссылке на инвентарный номер: карточка открывается сразу,
  // не дожидаясь списка, и запрос на открытие сбрасывается — иначе она всплывала
  // бы снова при каждом возврате на вкладку.
  useEffect(() => {
    if (!initialAssetId) return;
    (async () => {
      try {
        const { data: res } = await warehouseApi.asset(initialAssetId);
        setSelected(res);
      } catch (e) {
        toast.error(e.response?.data?.error || 'Карточка недоступна');
      } finally {
        onInitialAssetShown?.();
      }
    })();
    /* eslint-disable-next-line */
  }, [initialAssetId]);

  const openCard = async (id) => {
    try {
      const { data: res } = await warehouseApi.asset(id);
      setSelected(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось открыть карточку');
    }
  };

  // Штрих-сканер в режиме клавиатуры набивает в поиск целиком ссылку из QR, а
  // поиск ищет по названию и номерам — по такой строке не находилось ничего.
  // Ссылку разбирает сервер тем же lookup, что и сканер в мобильном приложении:
  // здесь мы только решаем, что введённое похоже на код, а не на название.
  const looksLikeCode = v => /^https?:\/\//i.test(v) || /^[A-Za-z0-9_-]{22,}$/.test(v);
  const handledCode = useRef(null);

  const openByCode = useCallback(async (code, { quiet = false } = {}) => {
    // Enter от сканера и реакция на изменение поля приходят почти одновременно —
    // отметка не даёт уйти двум одинаковым запросам. Снимается по завершении,
    // иначе тот же прибор не отсканировать второй раз.
    if (handledCode.current === code) return;
    handledCode.current = code;
    try {
      const { data: res } = await warehouseApi.lookup(code);
      setFilters(f => ({ ...f, q: '' }));
      if (res.kind === 'asset') await openCard(res.asset.id);
      else if (res.kind === 'room') onOpenRoom?.(res.room.id);
    } catch (e) {
      // Enter в поиске нажимают и просто так, набрав кусок названия. Ругаться на
      // это нельзя: непохожий на код запрос остаётся обычным поиском по списку.
      if (!quiet) toast.error(e.response?.data?.error || 'По этому коду ничего не найдено');
    } finally {
      handledCode.current = null;
    }
    /* eslint-disable-next-line */
  }, [onOpenRoom]);

  const toggle = (id) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const printLabels = async () => {
    if (!checked.size) return toast.error('Отметьте активы для печати');
    try {
      const { data: res } = await warehouseApi.labelsBatch({ ids: [...checked], size: labelSize });
      openPrintWindow(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось подготовить этикетки');
    }
  };

  const downloadBatchZpl = async () => {
    if (!checked.size) return toast.error('Отметьте активы для печати');
    try {
      const { data: zpl } = await warehouseApi.labelsBatchZpl({ ids: [...checked] });
      downloadTextFile(zpl, `tdp-225-44x25-${checked.size}.zpl`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось подготовить ZPL для TDP-225');
    }
  };

  return (
    <div className="wh-assets">
      <div className="wh-assets__filters">
        <div className="wh-search">
          <Search size={15} />
          <input placeholder="Наименование, инв. номер, серийный номер или код из QR"
                 value={filters.q}
                 onChange={e => setFilter({ q: e.target.value })}
                 onKeyDown={e => {
                   // Ручной сканер дописывает Enter — по нему пробуем разобрать
                   // и то, что на ссылку не похоже: инвентарный номер с этикетки
                   // так открывает карточку сразу, без клика по строке списка.
                   if (e.key !== 'Enter') return;
                   const value = filters.q.trim();
                   if (value) openByCode(value, { quiet: true });
                 }} />
        </div>
        <select value={filters.medCenterId}
                onChange={e => setFilter({ medCenterId: e.target.value, departmentId: '' })}>
          <option value="">Все медцентры</option>
          {(tree?.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
        </select>
        <select value={filters.departmentId} onChange={e => setFilter({ departmentId: e.target.value })}>
          <option value="">Все отделения</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilter({ status: e.target.value })}>
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="wh-check">
          <input type="checkbox" checked={filters.maintenanceDue}
                 onChange={e => setFilter({ maintenanceDue: e.target.checked })} />
          ТО в течение 30 дней и просроченные
        </label>
        {access?.capabilities?.canManageAssets && (
          <button className="wh-btn wh-btn--primary" style={{ marginLeft: 'auto' }}
                  onClick={() => setForm({ asset: null })}>
            <Plus size={15} /> Поставить на учёт
          </button>
        )}
      </div>

      {(access?.capabilities?.canPrintLabels || access?.capabilities?.canManageAssets) && (
        <div className={`wh-assets__bulk ${checked.size ? 'is-active' : ''}`}>
          {/* Пока ничего не отмечено, полоса молчит. Здесь стояла инструкция
              «Отметьте активы — этикетки и правку полей можно сделать пачкой»:
              она занимала место постоянно, а нужна была ровно один раз, и то
              не всем. Кнопки и без неё неактивны, пока выбор пуст. */}
          {checked.size > 0 && <span>Отмечено: {checked.size}</span>}
          {access?.capabilities?.canPrintLabels && (
            <>
              <select value={labelSize} onChange={e => setLabelSize(e.target.value)}>
                <optgroup label="Brother P-touch E550W">
                  <option value="80x20">Альбомная · лента 20 мм · 80 × 20 мм</option>
                  <option value="80x24">Альбомная · лента 24 мм · 80 × 24 мм</option>
                </optgroup>
                <optgroup label="TDP-225">
                  <option value="44x25">Этикетка 44 × 25 мм</option>
                </optgroup>
              </select>
              <button className="wh-btn wh-btn--ghost" onClick={printLabels} disabled={!checked.size}>
                <Printer size={15} /> Печать этикеток
              </button>
              {labelSize === '44x25' && (
                <button className="wh-btn wh-btn--ghost" onClick={downloadBatchZpl} disabled={!checked.size}>
                  <FileText size={15} /> Скачать ZPL
                </button>
              )}
            </>
          )}
          {/* Отметить всё найденное — то, ради чего массовая правка и нужна:
              человек сужает список фильтрами до нужного класса вещей и правит
              их одним действием, а не отмечает три сотни строк по одной. */}
          {access?.capabilities?.canManageAssets && (
            <>
              <button className="wh-btn wh-btn--ghost" disabled={!data.items.length}
                      onClick={() => setChecked(new Set(data.items.map(a => a.id)))}>
                Отметить все {data.items.length}
              </button>
              <button className="wh-btn wh-btn--secondary" disabled={!checked.size}
                      onClick={() => setBulk({})}>
                <Pencil size={15} /> Изменить поля
              </button>
            </>
          )}
          {checked.size > 0 && (
            <button className="wh-btn wh-btn--link" onClick={() => setChecked(new Set())}>Снять отметки</button>
          )}
        </div>
      )}

      {/* Разбор названий стоит здесь, а не на вкладке ведомости: правит он
          карточки, и смотреть на результат надо в том же списке, где они лежат. */}
      {access?.capabilities?.canManageAssets && (
        <div className="wh-assets__bulk">
          <span>Модель и производитель написаны прямо в наименовании — их можно вытащить в поля</span>
          <button className="wh-btn wh-btn--ghost" style={{ marginLeft: 'auto' }}
                  onClick={() => setParsing({})}>
            <Wand2 size={15} /> Разобрать наименования
          </button>
        </div>
      )}

      <div className="wh-table-wrap">
        <table className="wh-table">
          <thead>
            <tr>
              {access?.capabilities?.canPrintLabels && <th style={{ width: 30 }} />}
              <th>Инв. №</th>
              <th>Наименование</th>
              <th>Серийный №</th>
              <th>Размещение</th>
              <th>МОЛ</th>
              <th>Статус</th>
              <th>След. ТО</th>
              {access?.capabilities?.canSeeCosts && <th className="wh-num">Первонач., ₽</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="wh-table__loading"><div className="loading-spinner" /></td></tr>
            )}
            {!loading && data.items.map(a => {
              const overdue = a.nextMaintenanceDate && a.nextMaintenanceDate < today();
              return (
                <tr key={a.id} onClick={() => openCard(a.id)} className="wh-table__row">
                  {access?.capabilities?.canPrintLabels && (
                    <td onClick={e => { e.stopPropagation(); toggle(a.id); }}>
                      <input type="checkbox" checked={checked.has(a.id)} onChange={() => {}} />
                    </td>
                  )}
                  <td className="wh-mono">{a.inventoryNumber}</td>
                  <td>
                    <div className="wh-cell-main">{a.name}</div>
                    {a.model && <div className="wh-cell-sub">{a.model}</div>}
                  </td>
                  <td className="wh-mono wh-cell-sub">{a.serialNumber || '—'}</td>
                  <td>
                    {a.room ? (
                      <>
                        <div className="wh-cell-main">Каб. {a.room.number}</div>
                        <div className="wh-cell-sub">{a.room.department?.name || '—'}</div>
                      </>
                    ) : <span className="wh-muted">не размещён</span>}
                  </td>
                  <td className="wh-cell-sub">{a.responsible?.displayName || '—'}</td>
                  <td><span className={`wh-status wh-status--${a.status}`}>{STATUS_LABELS[a.status]}</span></td>
                  <td className={overdue ? 'wh-danger' : ''}>
                    {a.nextMaintenanceDate ? fmt(a.nextMaintenanceDate) : '—'}
                    {overdue && <AlertTriangle size={12} />}
                  </td>
                  {access?.capabilities?.canSeeCosts && (
                    <td className="wh-num">{Number(a.initialCost).toLocaleString('ru-RU')}</td>
                  )}
                </tr>
              );
            })}
            {!loading && !data.items.length && (
              <tr><td colSpan={9} className="wh-empty">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={data.total}
                  onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }}
                  unit="единиц" />

      {selected && (
        <AssetCard data={selected}
                   access={access}
                   labelSize={labelSize}
                   onClose={() => setSelected(null)}
                   onOpenRoom={onOpenRoom}
                   onReload={() => openCard(selected.asset.id)}
                   onEdit={() => setForm({ asset: selected.asset })} />
      )}

      {/* Форма идёт после карточки намеренно. Обе модалки лежат на одном z-index,
          и при обратном порядке форма правки, открытая из карточки, оказывалась под
          ней: её было видно снизу, но добраться до неё можно было только закрыв
          карточку. Порядок в разметке плюс явный wh-modal--nested держат её сверху. */}
      {form && (
        <WarehouseAssetForm asset={form.asset} tree={tree} access={access}
                            nested={Boolean(selected)}
                            onClose={() => setForm(null)}
                            onSaved={async () => {
                              await load();
                              if (selected?.asset?.id) await openCard(selected.asset.id);
                            }} />
      )}

      {parsing && (
        <ParseNamesModal onClose={() => setParsing(null)} onApplied={load} />
      )}

      {bulk && (
        <BulkEditModal
          ids={[...checked]}
          onClose={() => setBulk(null)}
          onApplied={async () => { setBulk(null); setChecked(new Set()); await load(); }}
        />
      )}
    </div>
  );
}

/**
 * Массовая правка полей у отмеченных карточек.
 *
 * ── Почему меняется только отмеченное поле ───────────────────────────────────
 *
 * Форма отправляет на сервер лишь те поля, которые человек включил галочкой.
 * Иначе массовая правка категории заодно обнуляла бы интервал ТО у трёхсот
 * карточек — просто потому, что поле в форме осталось пустым. Такую потерю
 * замечают через месяцы, когда не приходит ни одно напоминание о ТО.
 *
 * ── Чего здесь нет ───────────────────────────────────────────────────────────
 *
 * Кабинета, места хранения и МОЛ: это размещение, и меняется оно документом
 * перемещения. Форма правки одной карточки устроена так же, и массовая операция
 * не может быть лазейкой в обход правила — иначе отчёт «Движение активов»
 * перестал бы отвечать на вопрос, как вещь оказалась там, где она есть.
 */
function BulkEditModal({ ids, onClose, onApplied }) {
  const [refs, setRefs] = useState({ categories: [], contractors: [] });
  const [enabled, setEnabled] = useState({});
  const [form, setForm] = useState({
    categoryId: '', status: '', maintenanceIntervalMonths: '',
    usefulLifeMonths: '', fundingSource: '', warrantyUntil: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cats, contractors] = await Promise.all([
          warehouseApi.categories(), warehouseApi.contractors({}),
        ]);
        setRefs({ categories: cats.data, contractors: contractors.data });
      } catch { /* без справочников остаются остальные поля */ }
    })();
  }, []);

  const FIELDS = [
    { key: 'categoryId', label: 'Категория', type: 'category' },
    { key: 'status', label: 'Статус', type: 'status' },
    { key: 'maintenanceIntervalMonths', label: 'Интервал ТО, мес.', type: 'number' },
    { key: 'usefulLifeMonths', label: 'Срок использования, мес.', type: 'number' },
    { key: 'warrantyUntil', label: 'Гарантия до', type: 'date' },
    { key: 'fundingSource', label: 'Источник финансирования', type: 'text' },
  ];

  const active = FIELDS.filter(f => enabled[f.key]);

  const submit = async () => {
    if (!active.length) return toast.error('Отметьте, какие поля менять');
    setSaving(true);
    try {
      const patch = {};
      for (const field of active) patch[field.key] = form[field.key];
      const { data } = await warehouseApi.bulkUpdateAssets({ ids, patch });
      toast.success(`Изменено карточек: ${data.updated}`);
      await onApplied();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось изменить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">Изменить поля</div>
            <div className="wh-modal__sub">Отмечено карточек: {ids.length}</div>
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-form">
            {FIELDS.map(field => (
              <div key={field.key} className="wh-bulk__row">
                <label className="wh-check">
                  <input type="checkbox" checked={Boolean(enabled[field.key])}
                         onChange={e => setEnabled(prev => ({ ...prev, [field.key]: e.target.checked }))} />
                  {field.label}
                </label>
                <div className="wh-bulk__field">
                  {field.type === 'category' && (
                    <select disabled={!enabled[field.key]} value={form.categoryId}
                            onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
                      <option value="">— очистить —</option>
                      {refs.categories.filter(c => c.kind === 'fixed').map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                  {field.type === 'status' && (
                    <select disabled={!enabled[field.key]} value={form.status}
                            onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      <option value="">—</option>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  )}
                  {['number', 'text', 'date'].includes(field.type) && (
                    <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                           disabled={!enabled[field.key]}
                           value={form[field.key]}
                           placeholder={field.type === 'number' ? 'пусто — очистить' : ''}
                           onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit}
                  disabled={saving || !active.length}>
            <Check size={15} /> {saving ? 'Меняю…' : `Изменить ${active.length} пол. у ${ids.length} карточек`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Разбор наименований: вытащить модель и производителя в отдельные поля.
 *
 * ── Почему сначала предпросмотр и только потом применение ────────────────────
 *
 * Разбор эвристический, и правил, которые верно разберут любое название из 1С,
 * не существует. На реальной выгрузке модель находится примерно у трети позиций,
 * и часть находок спорна: «Кабель USB2.0 НАМА Н-34694» даёт моделью USB2.0.
 * Применять такое к трём тысячам карточек вслепую нельзя — человек должен
 * увидеть список «было → стало» и решить сам.
 *
 * Наименование при этом не меняется вовсе: по нему сходится сверка с
 * бухгалтерией. Заполняются только пустые поля — введённое руками не
 * перезаписывается никогда.
 */
function ParseNamesModal({ onClose, onApplied }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await warehouseApi.parseAssetNames({ dryRun: true });
        setPreview(data);
      } catch (e) {
        toast.error(e.response?.data?.error || 'Не удалось разобрать наименования');
        setPreview({ scanned: 0, changed: 0, samples: [] });
      }
    })();
  }, []);

  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await warehouseApi.parseAssetNames({ dryRun: false });
      toast.success(`Заполнено карточек: ${data.changed}`);
      await onApplied?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось применить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">Разбор наименований</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          {!preview && <div className="wh-table__loading"><div className="loading-spinner" /></div>}
          {preview && (
            <>
              <div className="wh-hint">
                Просмотрено карточек: {preview.scanned}, найдено что заполнить у {preview.changed}.
              </div>
              {Boolean(preview.samples?.length) && (
                <div className="wh-table-wrap wh-table-wrap--tall">
                  <table className="wh-table wh-table--compact">
                    <thead>
                      <tr><th>Инв. №</th><th>Наименование</th><th>Модель</th><th>Производитель</th></tr>
                    </thead>
                    <tbody>
                      {preview.samples.map(s => (
                        <tr key={s.id}>
                          <td className="wh-mono wh-cell-sub">{s.inventoryNumber}</td>
                          <td>{s.name}</td>
                          <td>{s.model ? <b>{s.model}</b> : '—'}</td>
                          <td>{s.manufacturer || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.changed > preview.samples.length && (
                <div className="wh-hint">
                  Показаны первые {preview.samples.length} из {preview.changed}.
                </div>
              )}
            </>
          )}
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={apply}
                  disabled={busy || !preview?.changed}>
            <Check size={15} /> {busy ? 'Заполняю…' : `Заполнить у ${preview?.changed || 0} карточек`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Карточка актива ──────────────────────────────────────────────────────────

function AssetCard({ data, access, labelSize, onClose, onOpenRoom, onReload, onEdit }) {
  const { asset, depreciation, files, maintenance, repairs, movements } = data;
  const [tab, setTab] = useState('info');
  const [serviceModal, setServiceModal] = useState(null);

  const printOne = async () => {
    try {
      const { data: res } = await warehouseApi.labelsBatch({ ids: [asset.id], size: labelSize });
      openPrintWindow(res);
    } catch (e) {
      toast.error('Не удалось подготовить этикетку');
    }
  };

  const downloadZpl = async () => {
    try {
      const { data: zpl } = await warehouseApi.zpl(asset.id, 1);
      downloadTextFile(zpl, `${asset.inventoryNumber}-44x25.zpl`);
    } catch (e) {
      toast.error('Не удалось выгрузить ZPL для TDP-225');
    }
  };

  return (<>
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">{asset.name}</div>
            <div className="wh-modal__sub">
              {asset.model} · <span className="wh-mono">{asset.inventoryNumber}</span>
            </div>
          </div>
          <div className="wh-modal__head-actions">
            {access?.capabilities?.canManageAssets && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={onEdit}>
                <Pencil size={14} /> Редактировать
              </button>
            )}
            <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="wh-modal__tabs">
          {[
            ['info', 'Карточка'],
            ['qr', 'QR и этикетка'],
            ['maintenance', `ТО и ремонты (${maintenance.length + repairs.length})`],
            ['timeline', `История (${movements.length})`],
            ['files', `Документы (${files.length})`],
          ].map(([k, label]) => (
            <button key={k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        <div className="wh-modal__body">
          {tab === 'info' && (
            <div className="wh-grid2">
              <Field label="Производитель" value={asset.manufacturer} />
              <Field label="Серийный номер" value={asset.serialNumber} mono />
              <Field label="Статус" value={STATUS_LABELS[asset.status]} />
              <Field label="Категория" value={asset.category?.name} />
              <Field label="Размещение" value={asset.room
                ? `Каб. ${asset.room.number}${asset.room.name ? ` — ${asset.room.name}` : ''}`
                : 'не размещён'}
                action={asset.room && (
                  <button className="wh-btn wh-btn--link" onClick={() => { onClose(); onOpenRoom?.(asset.room.id); }}>
                    дашборд кабинета
                  </button>
                )} />
              <Field label="Отделение" value={asset.room?.department?.name} />
              <Field label="МОЛ" value={asset.responsible?.displayName} />
              <Field label="Дата ввода в эксплуатацию" value={fmt(asset.commissioningDate)} />
              <Field label="Гарантия до" value={fmt(asset.warrantyUntil)} />
              <Field label="Поставщик" value={asset.supplier?.name} />
              <Field label="Интервал ТО, мес." value={asset.maintenanceIntervalMonths} />
              <Field label="Следующее ТО" value={fmt(asset.nextMaintenanceDate)} />

              {access?.capabilities?.canSeeCosts && (
                <>
                  <div className="wh-grid2__full wh-subhead">
                    Стоимость и амортизация
                    <span className="wh-badge wh-badge--neutral" title="Значения внесены вручную: обмена с 1С нет">
                      источник: ручной ввод
                    </span>
                  </div>
                  <Field label="Первоначальная стоимость" value={money(depreciation.initialCost)} />
                  <Field label="Накопленная амортизация" value={money(depreciation.accumulated)} />
                  <Field label="Остаточная стоимость" value={money(depreciation.residual)} />
                  <Field label="Износ" value={`${depreciation.wearPercent} %`} />
                  <Field label="СПИ, мес." value={asset.usefulLifeMonths} />
                  <Field label="ОКОФ / аморт. группа"
                         value={[asset.okof, asset.depreciationGroup].filter(Boolean).join(' / ')} />
                  {depreciation.fullyDepreciatedInUse && (
                    <div className="wh-grid2__full wh-note wh-note--warn">
                      <AlertTriangle size={15} />
                      <div>Полностью самортизировано, но в эксплуатации — кандидат на замену.</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'qr' && (
            <div className="wh-qr">
              <div className="wh-qr__col">
                <SecureImage url={warehouseApi.assetQrUrl(asset.id)}
                             alt="QR-код актива" className="wh-qr__img" />
                <div className="wh-hint">
                  Открывается без авторизации: назначение, статус и даты ТО. Без стоимости и ФИО.
                </div>
              </div>
              <div className="wh-qr__col">
                <div className="wh-qr__label-preview">
                  <SecureImage url={warehouseApi.labelUrl(asset.id, labelSize)}
                               alt={`Этикетка ${labelSize} мм`} />
                </div>
                <div className="wh-qr__actions">
                  <button className="wh-btn wh-btn--primary" onClick={printOne}>
                    <Printer size={15} /> Печать этикетки {labelSize.replace('x', ' × ')} мм
                  </button>
                  {access?.capabilities?.canPrintLabels && labelSize === '44x25' && (
                    <button className="wh-btn wh-btn--ghost" onClick={downloadZpl}>
                      <FileText size={15} /> Скачать ZPL для TDP-225
                    </button>
                  )}
                </div>
                {asset.labelPrintedAt && (
                  <div className="wh-hint">Этикетка печаталась {fmt(asset.labelPrintedAt)}</div>
                )}
              </div>
            </div>
          )}

          {tab === 'maintenance' && (
            <>
              <div className="wh-section-head">
                <h4 className="wh-subhead">График и факт ТО</h4>
                {access?.capabilities?.canMaintenance && (
                  <button className="wh-btn wh-btn--secondary wh-btn--sm"
                          onClick={() => setServiceModal({ kind: 'maintenance-create' })}>
                    <Plus size={14} /> Запланировать ТО
                  </button>
                )}
              </div>
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr><th>Наряд</th><th>Тип</th><th>План</th><th>Факт</th><th>Статус</th><th>Результат</th><th className="wh-num">Стоимость</th><th>Подрядчик</th>{access?.capabilities?.canMaintenance && <th />}</tr>
                </thead>
                <tbody>
                  {maintenance.map(o => (
                    <tr key={o.id}>
                      <td className="wh-mono">{o.number}</td>
                      <td>{maintType(o.type)}</td>
                      <td>{fmt(o.plannedDate)}</td>
                      <td>{fmt(o.factDate)}</td>
                      <td><span className={`wh-status wh-status--${o.status}`}>{maintStatus(o.status)}</span></td>
                      <td>{maintResult(o.result)}</td>
                      <td className="wh-num">{o.cost ? money(o.cost) : '—'}</td>
                      <td>{o.contractor?.name || '—'}</td>
                      {access?.capabilities?.canMaintenance && <td>{!o.factDate && <button className="wh-btn wh-btn--link" onClick={() => setServiceModal({ kind: 'maintenance-close', row: o })}>Закрыть</button>}</td>}
                    </tr>
                  ))}
                  {!maintenance.length && <tr><td colSpan={8} className="wh-empty">Нарядов нет</td></tr>}
                </tbody>
              </table>

              <div className="wh-section-head">
                <h4 className="wh-subhead">Журнал ремонтов</h4>
                {access?.capabilities?.canMaintenance && (
                  <button className="wh-btn wh-btn--secondary wh-btn--sm"
                          onClick={() => setServiceModal({ kind: 'repair-create' })}>
                    <Plus size={14} /> Открыть ремонт
                  </button>
                )}
              </div>
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr><th>№</th><th>Начало</th><th>Окончание</th><th>Описание</th><th className="wh-num">Стоимость</th><th>Простой, ч</th><th>Результат</th>{access?.capabilities?.canMaintenance && <th />}</tr>
                </thead>
                <tbody>
                  {repairs.map(r => (
                    <tr key={r.id}>
                      <td className="wh-mono">{r.number}</td>
                      <td>{fmt(r.startedAt)}</td>
                      <td>{r.finishedAt ? fmt(r.finishedAt) : <b className="wh-danger">в ремонте</b>}</td>
                      <td>{r.description || '—'}</td>
                      <td className="wh-num">{money(r.cost)}</td>
                      <td className="wh-num">{r.downtimeHours}</td>
                      <td>{r.result === 'written_off' ? 'Списан' : r.result === 'repaired' ? 'Отремонтирован' : '—'}</td>
                      {access?.capabilities?.canMaintenance && <td>{!r.finishedAt && <button className="wh-btn wh-btn--link" onClick={() => setServiceModal({ kind: 'repair-close', row: r })}>Закрыть</button>}</td>}
                    </tr>
                  ))}
                  {!repairs.length && <tr><td colSpan={7} className="wh-empty">Ремонтов не было</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {tab === 'timeline' && (
            <ul className="wh-timeline">
              {movements.map(m => (
                <li key={m.id} className={`wh-timeline__item wh-timeline__item--${m.type}`}>
                  <div className="wh-timeline__date">{fmtDateTime(m.occurredAt)}</div>
                  <div className="wh-timeline__body">
                    <b>{moveType(m.type)}</b>
                    {(m.fromRoom || m.toRoom) && (
                      <span className="wh-timeline__path">
                        {m.fromRoom ? `Каб. ${m.fromRoom.number}` : '—'}
                        <ArrowRightLeft size={12} />
                        {m.toRoom ? `Каб. ${m.toRoom.number}` : '—'}
                      </span>
                    )}
                    {m.reasonText && <div className="wh-timeline__reason">{m.reasonText}</div>}
                    <div className="wh-timeline__who">
                      {m.fromResponsible?.displayName && `сдал: ${m.fromResponsible.displayName}`}
                      {m.toResponsible?.displayName && ` · принял: ${m.toResponsible.displayName}`}
                      {m.initiator?.displayName && ` · оформил: ${m.initiator.displayName}`}
                    </div>
                  </div>
                </li>
              ))}
              {!movements.length && <li className="wh-empty">История пуста</li>}
            </ul>
          )}

          {tab === 'files' && (
            <AssetFiles assetId={asset.id} files={files} canEdit={access?.capabilities?.canManageAssets} onReload={onReload} />
          )}
        </div>
      </div>
    </div>
    {serviceModal && (
      <ServiceModal asset={asset} action={serviceModal}
                    onClose={() => setServiceModal(null)}
                    onSaved={async () => { setServiceModal(null); await onReload(); }} />
    )}
  </>);
}

function ServiceModal({ asset, action, onClose, onSaved }) {
  const creatingMaintenance = action.kind === 'maintenance-create';
  const closingMaintenance = action.kind === 'maintenance-close';
  const creatingRepair = action.kind === 'repair-create';
  const [contractors, setContractors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: 'maintenance', plannedDate: '', factDate: new Date().toISOString().slice(0, 10),
    startedAt: new Date().toISOString().slice(0, 10), finishedAt: new Date().toISOString().slice(0, 10),
    contractorId: '', isMandatory: false, cost: '', downtimeHours: '',
    description: '', result: closingMaintenance ? 'normal' : 'repaired', resultNote: '',
  });

  useEffect(() => {
    warehouseApi.contractors({ kind: 'service' })
      .then(({ data }) => setContractors(data))
      .catch(() => {});
  }, []);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const submit = async () => {
    if (creatingMaintenance && !form.plannedDate) return toast.error('Укажите плановую дату');
    if (creatingRepair && !form.startedAt) return toast.error('Укажите дату начала ремонта');
    setSaving(true);
    try {
      if (creatingMaintenance) {
        await warehouseApi.createMaintenance({
          assetId: asset.id, type: form.type, plannedDate: form.plannedDate,
          contractorId: form.contractorId || null, isMandatory: form.isMandatory,
          cost: form.cost || 0,
        });
        toast.success('Наряд ТО создан');
      } else if (closingMaintenance) {
        await warehouseApi.closeMaintenance(action.row.id, {
          factDate: form.factDate, result: form.result, resultNote: form.resultNote,
          cost: form.cost === '' ? action.row.cost : form.cost,
          downtimeHours: form.downtimeHours === '' ? action.row.downtimeHours : form.downtimeHours,
        });
        toast.success('Наряд ТО закрыт');
      } else if (creatingRepair) {
        await warehouseApi.createRepair({
          assetId: asset.id, startedAt: form.startedAt, description: form.description,
          contractorId: form.contractorId || null, cost: form.cost || 0,
        });
        toast.success('Ремонт открыт');
      } else {
        await warehouseApi.closeRepair(action.row.id, {
          finishedAt: form.finishedAt, result: form.result, description: form.description || undefined,
          cost: form.cost === '' ? action.row.cost : form.cost,
          downtimeHours: form.downtimeHours === '' ? undefined : form.downtimeHours,
        });
        toast.success('Ремонт закрыт');
      }
      await onSaved();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const title = creatingMaintenance ? 'Новый наряд ТО'
    : closingMaintenance ? `Закрытие наряда ${action.row.number}`
    : creatingRepair ? 'Передача оборудования в ремонт'
    : `Закрытие ремонта ${action.row.number}`;

  return (
    <div className="wh-modal wh-modal--nested" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div><div className="wh-modal__title">{title}</div><div className="wh-modal__sub">{asset.inventoryNumber} · {asset.name}</div></div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body"><div className="wh-form">
          {creatingMaintenance && <>
            <label>Вид обслуживания
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="maintenance">ТО</option><option value="verification">Поверка</option>
                <option value="calibration">Калибровка</option><option value="dosimetry">Дозиметрия</option>
                <option value="inspection">Осмотр</option>
              </select>
            </label>
            <label>Плановая дата <input type="date" value={form.plannedDate} onChange={e => set('plannedDate', e.target.value)} /></label>
            <label className="wh-check"><input type="checkbox" checked={form.isMandatory} onChange={e => set('isMandatory', e.target.checked)} /> Обязательное по НПА</label>
          </>}
          {closingMaintenance && <>
            <label>Фактическая дата <input type="date" value={form.factDate} onChange={e => set('factDate', e.target.value)} /></label>
            <label>Результат
              <select value={form.result} onChange={e => set('result', e.target.value)}>
                <option value="normal">Норма</option><option value="with_remarks">С замечаниями</option><option value="failed">Не пройдено</option>
              </select>
            </label>
            <label>Заключение <textarea rows={3} value={form.resultNote} onChange={e => set('resultNote', e.target.value)} /></label>
          </>}
          {creatingRepair && <label>Дата начала <input type="date" value={form.startedAt} onChange={e => set('startedAt', e.target.value)} /></label>}
          {!creatingMaintenance && !closingMaintenance && !creatingRepair && <>
            <label>Дата окончания <input type="date" value={form.finishedAt} onChange={e => set('finishedAt', e.target.value)} /></label>
            <label>Результат
              <select value={form.result} onChange={e => set('result', e.target.value)}>
                <option value="repaired">Отремонтировано</option><option value="written_off">Не подлежит ремонту — списать</option>
              </select>
            </label>
          </>}
          {(creatingMaintenance || creatingRepair) && <label>Подрядчик
            <select value={form.contractorId} onChange={e => set('contractorId', e.target.value)}>
              <option value="">—</option>{contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>}
          {(creatingRepair || (!creatingMaintenance && !closingMaintenance)) && <label>Описание
            <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
          </label>}
          <div className="wh-form__row2">
            <label>Стоимость, ₽ <input type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} /></label>
            {!creatingMaintenance && !creatingRepair && <label>Простой, ч <input type="number" min="0" step="0.5" value={form.downtimeHours} onChange={e => set('downtimeHours', e.target.value)} /></label>}
          </div>
        </div></div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit} disabled={saving}><Check size={14} /> {saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}

function AssetFiles({ assetId, files, canEdit, onReload }) {
  const [uploading, setUploading] = useState(false);

  const upload = async (e) => {
    const list = e.target.files;
    if (!list?.length) return;
    const fd = new FormData();
    for (const f of list) fd.append('files', f);
    fd.append('kind', 'other');
    setUploading(true);
    try {
      await warehouseApi.uploadAssetFiles(assetId, fd);
      toast.success('Файлы загружены');
      onReload();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const togglePublic = async (file) => {
    try {
      await warehouseApi.patchAssetFile(file.id, { isPublic: !file.isPublic });
      onReload();
    } catch {
      toast.error('Не удалось изменить видимость');
    }
  };

  return (
    <div>
      {canEdit && (
        <label className="wh-btn wh-btn--ghost">
          <Plus size={15} /> {uploading ? 'Загрузка…' : 'Добавить файлы'}
          <input type="file" multiple hidden onChange={upload} />
        </label>
      )}
      <ul className="wh-files">
        {files.map(f => (
          <li key={f.id}>
            <a href={`${BASE_URL}/uploads/warehouse/assets/${f.storedName}`} target="_blank" rel="noreferrer">
              {f.originalName}
            </a>
            <span className="wh-cell-sub">{(f.size / 1024).toFixed(0)} КБ · {f.uploader?.displayName || '—'}</span>
            {canEdit && (
              <label className="wh-check wh-check--inline">
                <input type="checkbox" checked={f.isPublic} onChange={() => togglePublic(f)} />
                на публичной карточке
              </label>
            )}
          </li>
        ))}
        {!files.length && <li className="wh-empty">Документов нет</li>}
      </ul>
    </div>
  );
}

// ── Печать этикеток ──────────────────────────────────────────────────────────
/**
 * Открывает окно печати с уже растеризованными PNG. Сервер формирует их в DPI
 * выбранного принтера; браузер здесь только передаёт готовые пиксели драйверу.
 */
function openPrintWindow({ labels, sizeMm }) {
  const w = window.open('', '_blank');
  if (!w) return toast.error('Браузер заблокировал окно печати');
  const { w: mmW, h: mmH } = sizeMm;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Этикетки (${labels.length})</title>
    <style>
      @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .label { width: ${mmW}mm; height: ${mmH}mm; page-break-after: always; overflow: hidden; }
      .label img { display: block; width: ${mmW}mm; height: ${mmH}mm; image-rendering: pixelated; }
      .label:last-child { page-break-after: auto; }
      @media screen {
        body { background: #eef1f5; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
        .label { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
      }
    </style></head><body>
    ${labels.map(l => `<div class="label"><img src="${l.png}" alt=""></div>`).join('')}
    <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
    </body></html>`);
  w.document.close();
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
function downloadTextFile(contents, filename) {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Field({ label, value, mono, action }) {
  return (
    <div className="wh-field-ro">
      <span className="wh-field-ro__label">{label}</span>
      <span className={`wh-field-ro__value ${mono ? 'wh-mono' : ''}`}>
        {value || value === 0 ? value : '—'} {action}
      </span>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const fmtDateTime = d => (d ? new Date(d).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—');
const money = n => `${Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const maintType = t => ({ maintenance: 'ТО', verification: 'Поверка', calibration: 'Калибровка', dosimetry: 'Дозиметрия', inspection: 'Осмотр' }[t] || t);
const maintStatus = s => ({ planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен', overdue: 'Просрочен', cancelled: 'Отменён' }[s] || s);
const maintResult = r => ({ normal: 'Норма', with_remarks: 'С замечаниями', failed: 'Не пройдено' }[r] || (r ? r : '—'));
const moveType = t => ({
  receipt: 'Приём', return: 'Возврат', issue: 'Выдача', transfer: 'Перемещение', repair_out: 'В ремонт',
  repair_in: 'Из ремонта', writeoff: 'Списание', inventory: 'Инвентаризация', surplus: 'Оприходование излишков',
}[t] || t);
