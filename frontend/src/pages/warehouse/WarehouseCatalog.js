import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Plus, X, Check, Search, Package, Truck,
  Layers, Gauge, ShieldAlert, Pencil,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import Pagination from './components/Pagination';

/**
 * Справочники материалов: номенклатура, контрагенты, партии, минимальные остатки.
 *
 * Здесь заводятся данные, которые в рабочей системе приезжали бы из 1С. Пока
 * обмена нет, это единственный способ наполнить модуль — и первое, обо что
 * спотыкается человек, открывший пустой склад.
 *
 * Формы описаны декларативно (FIELDS), а не написаны четыре раза: у всех четырёх
 * справочников одна и та же механика «список → модалка → сохранить», и
 * расхождение между ними было бы только источником ошибок.
 */

const UNITS = ['шт', 'уп', 'фл', 'мл', 'л', 'г', 'кг', 'м', 'пар', 'набор', 'кан'];

const TABS = [
  { key: 'nomenclature', label: 'Номенклатура', icon: Package },
  { key: 'contractors',  label: 'Контрагенты',  icon: Truck },
  { key: 'batches',      label: 'Партии',       icon: Layers },
  { key: 'reorder',      label: 'Минимумы',     icon: Gauge },
];

export default function WarehouseCatalog({ access }) {
  const [tab, setTab] = useState('nomenclature');
  const [rows, setRows] = useState([]);
  // Постраничная навигация нужна только номенклатуре: контрагенты, партии и
  // минимумы приходят одним списком целиком. total хранится отдельно, потому что
  // у остальных справочников его в ответе нет.
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [refs, setRefs] = useState({ nomenclature: [], contractors: [], categories: [], rooms: [] });
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [bulkMin, setBulkMin] = useState(null);
  const [saving, setSaving] = useState(false);

  const canEdit = access?.capabilities?.canManageCatalog;

  const loadRefs = useCallback(async () => {
    try {
      const [nom, con, cat] = await Promise.all([
        warehouseApi.nomenclature({ limit: 500 }),
        warehouseApi.contractors({}),
        warehouseApi.categories(),
      ]);
      setRefs({ nomenclature: nom.data.items, contractors: con.data, categories: cat.data, rooms: [] });
    } catch { /* справочники не критичны для отображения списка */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'nomenclature') {
        const { data } = await warehouseApi.nomenclature({ q: q || undefined, page, limit: pageSize });
        setRows(data.items);
        setTotal(data.total);
      } else if (tab === 'contractors') {
        const { data } = await warehouseApi.contractors({ q: q || undefined });
        setRows(data);
        setTotal(data.length);
      } else if (tab === 'batches') {
        const { data } = await warehouseApi.batches({});
        setRows(data);
        setTotal(data.length);
      } else {
        const { data } = await warehouseApi.reorderRules();
        setRows(data);
        setTotal(data.length);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить справочник');
    } finally {
      setLoading(false);
    }
  }, [tab, q, page, pageSize]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  // Смена справочника или запроса возвращает на первую страницу: иначе, перейдя
  // с пятой страницы номенклатуры на контрагентов и обратно, попадаешь в пустоту.
  useEffect(() => { setPage(1); }, [tab, q]);
  useEffect(() => {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) setPage(pages);
  }, [total, pageSize, page]);
  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const submit = async (form) => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
      );
      if (tab === 'nomenclature') {
        if (modal.id) await warehouseApi.updateNomenclature(modal.id, payload);
        else await warehouseApi.createNomenclature(payload);
      } else if (tab === 'contractors') {
        if (modal.id) await warehouseApi.updateContractor(modal.id, payload);
        else await warehouseApi.createContractor(payload);
      } else if (tab === 'batches') {
        await warehouseApi.createBatch(payload);
      } else {
        await warehouseApi.createReorderRule(payload);
      }
      toast.success('Сохранено');
      setModal(null);
      await load();
      await loadRefs();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id) => {
    try {
      await warehouseApi.deleteReorderRule(id);
      toast.success('Правило удалено');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось удалить');
    }
  };

  const blockBatch = async (batch) => {
    const next = !batch.isBlocked;
    const reason = next ? window.prompt('Причина блокировки (отзыв производителем и т. п.):') : null;
    if (next && !reason) return;
    try {
      await warehouseApi.blockBatch(batch.id, { isBlocked: next, reason });
      toast.success(next ? 'Партия заблокирована к выдаче' : 'Блокировка снята');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось изменить');
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="wh-catalog">
      {/* Переключатель справочника и его фильтры — одна полоса: раздельно они
          занимали две строки, во второй чаще всего стояла одна кнопка. */}
      <div className="wh-assets__filters">
        <div className="wh-subtabs">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} className={tab === t.key ? 'is-active' : ''}
                      onClick={() => { setTab(t.key); setQ(''); }}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
        {(tab === 'nomenclature' || tab === 'contractors') && (
          <>
            <span className="wh-filters__sep" />
            <div className="wh-search">
              <Search size={15} />
              <input placeholder="Поиск по названию или коду" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </>
        )}
        {/* Минимумы — единственный справочник, который заводят не по одной
            записи: позиций 1785, и модалка на каждую означает, что минимумов не
            будет вовсе. Поэтому рядом с обычным добавлением стоит пакетное. */}
        {canEdit && tab === 'reorder' && (
          <button className="wh-btn wh-btn--secondary" style={{ marginLeft: 'auto' }}
                  onClick={() => setBulkMin({})}>
            <Layers size={15} /> Задать пачкой
          </button>
        )}
        {canEdit && (
          <button className="wh-btn wh-btn--primary"
                  style={tab === 'reorder' ? undefined : { marginLeft: 'auto' }}
                  onClick={() => setModal({ id: null, form: defaultsFor(tab) })}>
            <Plus size={15} /> {addLabel(tab)}
          </button>
        )}
        {/* Плашка «Только просмотр — правка доступна зав. складом…» убрана:
            у того, кто не может править, просто нет кнопки добавления, и это
            уже ответ. Постоянная строка про чужие права занимала место в полосе
            у всех рядовых пользователей. */}
      </div>


      <div className="wh-table-wrap">
        <table className="wh-table wh-table--compact">
          <thead><tr>{columnsFor(tab, canEdit).map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="wh-table__loading"><div className="loading-spinner" /></td></tr>
            )}

            {!loading && tab === 'nomenclature' && rows.map(n => (
              <tr key={n.id}>
                <td className="wh-mono">{n.code}</td>
                <td>
                  <div className="wh-cell-main">{n.name}</div>
                  <div className="wh-cell-sub">
                    {[n.isMedicine && 'ЛП', n.isSterile && 'стерильное',
                      n.tracksBatch ? 'партионный учёт' : 'без партий'].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>{n.unit}{n.packUnit && n.packSize ? ` (${n.packUnit} по ${n.packSize})` : ''}</td>
                <td className="wh-cell-sub">{n.category?.name || '—'}</td>
                <td className="wh-num">{n.lastPrice ? Number(n.lastPrice).toLocaleString('ru-RU') : '—'}</td>
                <td className="wh-cell-sub">{n.defaultSupplier?.name || '—'}</td>
                <td className="wh-cell-sub">
                  {n.storageTempMinC !== null && n.storageTempMinC !== undefined
                    ? `${n.storageTempMinC}…${n.storageTempMaxC} °C` : '—'}
                </td>
                {canEdit && (
                  <td>
                    <button className="wh-icon-btn" title="Изменить"
                            onClick={() => setModal({ id: n.id, form: pick(n, FIELDS.nomenclature) })}>
                      <Pencil size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {!loading && tab === 'contractors' && rows.map(c => (
              <tr key={c.id}>
                <td>
                  <div className="wh-cell-main">{c.name}</div>
                  {c.inn && <div className="wh-cell-sub">ИНН {c.inn}</div>}
                </td>
                <td>{{ supplier: 'Поставщик', service: 'Сервис', both: 'Оба' }[c.kind] || c.kind}</td>
                <td className="wh-num">{c.rating ?? '—'}</td>
                <td className="wh-num">{c.avgDeliveryDays ?? '—'}</td>
                <td className="wh-num">{c.deliveryFailures}</td>
                <td className={c.accreditationUntil && c.accreditationUntil < today ? 'wh-danger' : ''}>
                  {c.accreditationUntil ? fmt(c.accreditationUntil) : '—'}
                </td>
                <td className="wh-cell-sub">{c.phone || c.email || '—'}</td>
                {canEdit && (
                  <td>
                    <button className="wh-icon-btn" title="Изменить"
                            onClick={() => setModal({ id: c.id, form: pick(c, FIELDS.contractors) })}>
                      <Pencil size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {!loading && tab === 'batches' && rows.map(b => {
              const expired = b.expiryDate && b.expiryDate < today;
              return (
                <tr key={b.id} className={expired ? 'wh-row--expired' : ''}>
                  <td className="wh-mono">{b.batchNumber}</td>
                  <td>{b.nomenclature?.name}</td>
                  <td className={expired ? 'wh-danger' : ''}>{fmt(b.expiryDate)}</td>
                  <td className="wh-num">{b.unitCost ? Number(b.unitCost).toLocaleString('ru-RU') : '—'}</td>
                  <td className="wh-cell-sub">{b.supplier?.name || '—'}</td>
                  <td className="wh-cell-sub">{b.certificateNumber || '—'}</td>
                  <td>
                    {b.isBlocked
                      ? <span className="wh-status wh-status--repair" title={b.blockReason || ''}>заблокирована</span>
                      : expired
                        ? <span className="wh-status wh-status--overdue">просрочена</span>
                        : <span className="wh-status wh-status--in_use">годна</span>}
                  </td>
                  {canEdit && (
                    <td>
                      <button className="wh-icon-btn" title={b.isBlocked ? 'Снять блокировку' : 'Заблокировать к выдаче'}
                              onClick={() => blockBatch(b)}>
                        <ShieldAlert size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}

            {!loading && tab === 'reorder' && rows.map(r => (
              <tr key={r.id}>
                <td>{r.nomenclature?.name}</td>
                <td className="wh-mono wh-cell-sub">{r.nomenclature?.code}</td>
                <td className="wh-num"><b>{Number(r.minQty)}</b> {r.nomenclature?.unit}</td>
                <td className="wh-num wh-cell-sub">{r.maxQty ? Number(r.maxQty) : '—'}</td>
                <td className="wh-cell-sub">
                  {r.room ? `Каб. ${r.room.number}` : r.storage ? r.storage.name : 'везде'}
                </td>
                <td>{r.autoRfq ? 'да' : 'нет'}</td>
                {canEdit && (
                  <td>
                    <button className="wh-icon-btn wh-icon-btn--danger" title="Удалить правило"
                            onClick={() => removeRule(r.id)}>
                      <X size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {!loading && !rows.length && (
              <tr><td colSpan={9} className="wh-empty">
                Записей нет.{canEdit ? ` Нажмите «${addLabel(tab)}».` : ''}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total}
                  onPage={setPage}
                  onPageSize={tab === 'nomenclature' ? (size => { setPageSize(size); setPage(1); }) : undefined}
                  unit="записей" />

      {modal && (
        <CatalogModal tab={tab} modal={modal} refs={refs} saving={saving}
                      onClose={() => setModal(null)} onSubmit={submit} />
      )}

      {bulkMin && (
        <BulkMinimumsModal
          refs={refs}
          onClose={() => setBulkMin(null)}
          onApplied={async () => { setBulkMin(null); await load(); }}
        />
      )}
    </div>
  );
}

/**
 * Минимумы пачкой.
 *
 * ── Почему по категории, а не только списком ─────────────────────────────────
 *
 * Минимум по своей природе задаётся не позиции, а классу вещей: «перчаток всегда
 * держим коробку», «шприцев — две». Позиций же 1785, и перечислять их руками —
 * та же работа по одной, только в другом окне. Категория закрывает класс целиком
 * и остаётся верной, когда в него добавят новую позицию.
 *
 * ── Почему есть «не трогать уже настроенные» ─────────────────────────────────
 *
 * Пачкой обычно закрывают хвост, а не переписывают всё: часть минимумов уже
 * выставлена точечно и осмысленно, и затирать их общим значением — потеря
 * работы, которую делали вдумчиво.
 */
function BulkMinimumsModal({ refs, onClose, onApplied }) {
  const [form, setForm] = useState({
    mode: 'category', categoryId: '', nomenclatureIds: [],
    minQty: '', maxQty: '', autoRfq: false, skipExisting: true,
  });
  const [saving, setSaving] = useState(false);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const target = form.mode === 'category'
    ? refs.nomenclature.filter(n => n.categoryId === form.categoryId)
    : refs.nomenclature.filter(n => form.nomenclatureIds.includes(n.id));

  const submit = async () => {
    if (!(Number(form.minQty) >= 0) || form.minQty === '') {
      return toast.error('Укажите минимальный остаток');
    }
    setSaving(true);
    try {
      const { data } = await warehouseApi.bulkReorderRules({
        categoryId: form.mode === 'category' ? form.categoryId : null,
        nomenclatureIds: form.mode === 'list' ? form.nomenclatureIds : null,
        minQty: Number(form.minQty),
        maxQty: form.maxQty === '' ? null : Number(form.maxQty),
        autoRfq: form.autoRfq,
        skipExisting: form.skipExisting,
      });
      toast.success(
        `Создано ${data.created}, обновлено ${data.updated}`
        + (data.skipped ? `, пропущено ${data.skipped}` : ''),
      );
      await onApplied();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось задать минимумы');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">Минимумы пачкой</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-form">
            <label>На что распространить
              <select value={form.mode} onChange={e => set('mode', e.target.value)}>
                <option value="category">На всю категорию</option>
                <option value="list">На выбранные позиции</option>
              </select>
            </label>

            {form.mode === 'category' ? (
              <label>Категория
                <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
                  <option value="">Выберите…</option>
                  {refs.categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>Позиции
                <select multiple size={8} value={form.nomenclatureIds}
                        onChange={(e) => set('nomenclatureIds',
                          [...e.target.selectedOptions].map(o => o.value))}>
                  {refs.nomenclature.map(n => (
                    <option key={n.id} value={n.id}>{n.code} · {n.name}</option>
                  ))}
                </select>
                <span className="wh-hint">Ctrl или ⌘ — отметить несколько</span>
              </label>
            )}

            <div className="wh-form__row2">
              <label>
                <span className="wh-form__cap">Минимальный остаток <b className="wh-req">*</b></span>
                <input type="number" min="0" step="any" value={form.minQty}
                       onChange={e => set('minQty', e.target.value)} />
              </label>
              <label>Максимальный
                <input type="number" min="0" step="any" value={form.maxQty}
                       onChange={e => set('maxQty', e.target.value)} />
              </label>
            </div>

            <label className="wh-check">
              <input type="checkbox" checked={form.skipExisting}
                     onChange={e => set('skipExisting', e.target.checked)} />
              Не трогать позиции, у которых минимум уже задан
            </label>
            <label className="wh-check">
              <input type="checkbox" checked={form.autoRfq}
                     onChange={e => set('autoRfq', e.target.checked)} />
              Создавать запрос котировок автоматически
            </label>

            <div className="wh-hint">
              Правило подействует на {target.length} позиций
              {form.mode === 'category' && !form.categoryId ? ' — выберите категорию' : ''}.
            </div>
          </div>
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit}
                  disabled={saving || !target.length || form.minQty === ''}>
            <Check size={15} /> {saving ? 'Применяю…' : `Задать для ${target.length} позиций`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Описание форм ────────────────────────────────────────────────────────────
const FIELDS = {
  nomenclature: [
    { key: 'code', label: 'Код', required: true, hint: 'Уникален; в 1С это артикул' },
    { key: 'name', label: 'Наименование', required: true, wide: true },
    { key: 'unit', label: 'Единица измерения', type: 'select', options: UNITS, required: true },
    { key: 'packUnit', label: 'Единица упаковки', type: 'select', options: ['', ...UNITS] },
    { key: 'packSize', label: 'Штук в упаковке', type: 'number' },
    { key: 'categoryId', label: 'Категория', type: 'ref', ref: 'categories' },
    { key: 'lastPrice', label: 'Цена за единицу, ₽', type: 'number' },
    { key: 'defaultSupplierId', label: 'Поставщик по умолчанию', type: 'ref', ref: 'contractors' },
    { key: 'vatPercent', label: 'НДС, %', type: 'number' },
    { key: 'storageTempMinC', label: 'Температура хранения от, °C', type: 'number' },
    { key: 'storageTempMaxC', label: 'до, °C', type: 'number' },
    { key: 'isMedicine', label: 'Лекарственный препарат', type: 'bool' },
    { key: 'isSterile', label: 'Стерильное', type: 'bool' },
    { key: 'tracksBatch', label: 'Партионный учёт (срок годности)', type: 'bool' },
  ],
  contractors: [
    { key: 'name', label: 'Наименование', required: true, wide: true },
    { key: 'kind', label: 'Тип', type: 'select',
      options: [['supplier', 'Поставщик'], ['service', 'Сервисный подрядчик'], ['both', 'Оба']] },
    { key: 'inn', label: 'ИНН' },
    { key: 'phone', label: 'Телефон' },
    { key: 'email', label: 'Электронная почта' },
    { key: 'contactPerson', label: 'Контактное лицо' },
    { key: 'rating', label: 'Рейтинг (0–5)', type: 'number', hint: 'Участвует в оценке котировок' },
    { key: 'avgDeliveryDays', label: 'Срок поставки, дней', type: 'number' },
    { key: 'deliveryFailures', label: 'Срывов поставок за год', type: 'number' },
    { key: 'paymentTerms', label: 'Условия оплаты' },
    { key: 'accreditationUntil', label: 'Аккредитация действует до', type: 'date' },
    { key: 'comment', label: 'Примечание', wide: true },
  ],
  batches: [
    { key: 'nomenclatureId', label: 'Номенклатура', type: 'ref', ref: 'nomenclature', required: true, wide: true },
    { key: 'batchNumber', label: 'Номер серии или партии', required: true },
    { key: 'expiryDate', label: 'Годен до', type: 'date',
      hint: 'После этой даты партия не берётся в выдачу' },
    { key: 'productionDate', label: 'Дата производства', type: 'date' },
    { key: 'unitCost', label: 'Цена за единицу, ₽', type: 'number' },
    { key: 'supplierId', label: 'Поставщик', type: 'ref', ref: 'contractors' },
    { key: 'certificateNumber', label: 'Номер сертификата' },
  ],
  reorder: [
    { key: 'nomenclatureId', label: 'Номенклатура', type: 'ref', ref: 'nomenclature', required: true, wide: true },
    { key: 'minQty', label: 'Минимальный остаток', type: 'number', required: true,
      hint: 'Ниже него позиция подсвечивается красным и попадает в дефицит' },
    { key: 'maxQty', label: 'Максимальный остаток', type: 'number' },
    { key: 'autoRfq', label: 'Создавать запрос котировок автоматически', type: 'bool' },
  ],
};

function CatalogModal({ tab, modal, refs, saving, onClose, onSubmit }) {
  const [form, setForm] = useState(modal.form);
  const fields = FIELDS[tab];
  const valid = fields.filter(f => f.required)
    .every(f => String(form[f.key] ?? '').trim() !== '');

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">
            {modal.id ? 'Изменение записи' : addLabel(tab)}
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-catalog__form">
            {fields.map(f => {
              const value = form[f.key];
              const onChange = v => setForm(prev => ({ ...prev, [f.key]: v }));

              if (f.type === 'bool') {
                return (
                  <label key={f.key} className="wh-check wh-catalog__check">
                    <input type="checkbox" checked={Boolean(value)}
                           onChange={e => onChange(e.target.checked)} />
                    {f.label}
                  </label>
                );
              }
              return (
                <label key={f.key} className={f.wide ? 'wh-catalog__wide' : ''}>
                  {/* Подпись и звёздочка одним элементом: иначе <b> вставал
                      отдельной строкой колоночного флекса и поле оказывалось
                      выше соседнего в том же ряду. */}
                  <span className="wh-form__cap">{f.label}{f.required && <b className="wh-req">*</b>}</span>
                  {f.type === 'ref' ? (
                    <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
                      <option value="">—</option>
                      {(refs[f.ref] || []).map(o => (
                        <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ''}</option>
                      ))}
                    </select>
                  ) : f.type === 'select' ? (
                    <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
                      {f.options.map(o => {
                        const [v, l] = Array.isArray(o) ? o : [o, o || '—'];
                        return <option key={v} value={v}>{l}</option>;
                      })}
                    </select>
                  ) : (
                    <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                           step={f.type === 'number' ? 'any' : undefined}
                           value={value ?? ''}
                           onChange={e => onChange(f.type === 'number'
                             ? (e.target.value === '' ? '' : Number(e.target.value))
                             : e.target.value)} />
                  )}
                  {f.hint && <span className="wh-hint">{f.hint}</span>}
                </label>
              );
            })}
          </div>
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" disabled={!valid || saving}
                  onClick={() => onSubmit(form)}>
            <Check size={15} /> {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
function defaultsFor(tab) {
  const base = Object.fromEntries(FIELDS[tab].map(f => [f.key, f.type === 'bool' ? false : '']));
  if (tab === 'nomenclature') return { ...base, unit: 'шт', vatPercent: 20, tracksBatch: true };
  if (tab === 'contractors') return { ...base, kind: 'supplier', deliveryFailures: 0 };
  return base;
}

function pick(row, fields) {
  return Object.fromEntries(fields.map(f => [f.key, row[f.key] ?? (f.type === 'bool' ? false : '')]));
}

function addLabel(tab) {
  return {
    nomenclature: 'Добавить позицию',
    contractors: 'Добавить контрагента',
    batches: 'Добавить партию',
    reorder: 'Добавить минимум',
  }[tab];
}

function columnsFor(tab, canEdit) {
  const cols = {
    nomenclature: ['Код', 'Наименование', 'Ед.', 'Категория', 'Цена, ₽', 'Поставщик', 'Хранение'],
    contractors: ['Наименование', 'Тип', 'Рейтинг', 'Срок, дн.', 'Срывов', 'Аккредитация', 'Контакты'],
    batches: ['Серия', 'Номенклатура', 'Годен до', 'Цена, ₽', 'Поставщик', 'Сертификат', 'Состояние'],
    reorder: ['Номенклатура', 'Код', 'Минимум', 'Максимум', 'Где действует', 'Автозаказ'],
  }[tab];
  return canEdit ? [...cols, ''] : cols;
}

const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
