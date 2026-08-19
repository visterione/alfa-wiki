import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Check, AlertTriangle } from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Форма постановки на учёт и правки карточки оборудования.
 *
 * Три вещи, о которых стоит знать заранее:
 *
 *   • **Инвентарный номер не вводится и не правится.** Он присваивается сервером
 *     по маске из Приложения А ТЗ и не меняется никогда — даже при переводе
 *     актива в другое отделение, потому что отражает специальность на момент
 *     постановки на учёт. Дать его править значило бы позволить дубли и разрыв
 *     истории. В форме он показывается, но только для чтения.
 *
 *   • **Размещение и МОЛ правятся только при создании.** Дальше переезд актива
 *     оформляется документом перемещения: иначе актив менял бы кабинет без следа
 *     в журнале, и отчёт «Движение активов» перестал бы быть аудиторским.
 *
 *   • **Амортизация вводится руками и помечена как ручной ввод.** Владелец этих
 *     чисел — бухгалтерия; когда появится обмен с 1С, поле будет перезаписываться
 *     оттуда. Пока обмена нет, вводить их здесь — единственный способ, но человек
 *     должен понимать, что это не выгрузка из учётной системы.
 */

const STATUSES = [
  { value: 'in_use', label: 'В работе' },
  { value: 'maintenance', label: 'На техобслуживании' },
  { value: 'repair', label: 'В ремонте' },
  { value: 'storage', label: 'На хранении' },
  { value: 'reserved', label: 'Зарезервировано' },
  { value: 'written_off', label: 'Списано' },
];

const DEPRECIATION_METHODS = [
  { value: 'linear', label: 'Линейный' },
  { value: 'reducing', label: 'Уменьшаемого остатка' },
];

const EMPTY = {
  name: '', model: '', serialNumber: '', manufacturer: '',
  categoryId: '', roomId: '', storageId: '', responsibleUserId: '',
  status: 'in_use', purchaseDate: '', commissioningDate: '',
  initialCost: '', usefulLifeMonths: '', depreciationGroup: '',
  depreciationMethod: 'linear', okof: '', accumulatedDepreciation: '',
  fundingSource: '', warrantyUntil: '', supplierId: '',
  maintenanceIntervalMonths: '', nextMaintenanceDate: '',
  dailyCapacityHours: 8, notes: '',
};

export default function WarehouseAssetForm({ asset, tree, access, nested, onClose, onSaved }) {
  const isEdit = Boolean(asset);
  const [form, setForm] = useState(EMPTY);
  const [refs, setRefs] = useState({ categories: [], contractors: [], users: [] });
  const [storages, setStorages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('main');

  const canSeeCosts = access?.capabilities?.canSeeCosts;

  // Плоский список кабинетов из дерева: выбирать этаж отдельно здесь незачем,
  // а полный путь нужен, чтобы различить одинаковые номера в разных корпусах.
  const rooms = useMemo(() => {
    const out = [];
    for (const mc of tree?.medCenters || []) {
      for (const r of mc.rooms || []) {
        out.push({
          id: r.id,
          label: `${mc.name} · Каб. ${r.number}`
            + (r.name && r.name !== r.number ? ` — ${r.name}` : ''),
          storages: r.storages || [],
          responsibleUserId: r.responsible?.id || null,
        });
      }
      for (const b of mc.buildings || []) {
        for (const f of b.floors || []) {
          for (const r of f.rooms || []) {
            out.push({
              id: r.id,
              label: `${mc.name} · ${b.name} · ${f.number} эт. · Каб. ${r.number}`
                + (r.name && r.name !== r.number ? ` — ${r.name}` : ''),
              storages: r.storages || [],
              responsibleUserId: r.responsible?.id || null,
            });
          }
        }
      }
    }
    return out;
  }, [tree]);

  useEffect(() => {
    (async () => {
      try {
        const [cats, contractors] = await Promise.all([
          warehouseApi.categories(),
          warehouseApi.contractors({}),
        ]);
        setRefs(r => ({ ...r, categories: cats.data, contractors: contractors.data }));
      } catch {
        // Справочники не критичны для сохранения: без категории актив заводится.
      }
    })();
  }, []);

  useEffect(() => {
    if (!asset) { setForm(EMPTY); return; }
    const a = asset;
    setForm({
      ...EMPTY,
      ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, a[k] ?? EMPTY[k]])),
      categoryId: a.categoryId || '', roomId: a.roomId || '',
      storageId: a.storageId || '', responsibleUserId: a.responsibleUserId || '',
      supplierId: a.supplierId || '',
    });
  }, [asset]);

  // Места хранения зависят от выбранного кабинета.
  useEffect(() => {
    const room = rooms.find(r => r.id === form.roomId);
    setStorages(room?.storages || []);
    if (form.storageId && !(room?.storages || []).some(s => s.id === form.storageId)) {
      setForm(f => ({ ...f, storageId: '' }));
    }
  }, [form.roomId, form.storageId, rooms]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const selectedRoom = rooms.find(r => r.id === form.roomId);

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Укажите наименование'); setTab('main'); return; }
    if (!isEdit && (!form.roomId || !form.storageId)) {
      toast.error('Выберите кабинет и место хранения'); setTab('place'); return;
    }
    setSaving(true);
    try {
      // Пустые строки превращаем в null: сервер ждёт отсутствие значения, а не
      // пустую строку — иначе даты и числа падают на приведении типа.
      const payload = {};
      for (const [k, v] of Object.entries(form)) {
        payload[k] = v === '' ? null : v;
      }
      if (isEdit) {
        // Размещение и МОЛ через правку не меняются — они оформляются документом.
        delete payload.roomId;
        delete payload.storageId;
        delete payload.responsibleUserId;
        await warehouseApi.updateAsset(asset.id, payload);
        toast.success('Карточка обновлена');
      } else {
        const { data } = await warehouseApi.createAsset(payload);
        toast.success(`Поставлено на учёт: ${data.inventoryNumber}`);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    // nested — когда форму открыли из карточки актива: она должна лечь поверх неё,
    // а не под, иначе до полей не добраться, не закрыв карточку.
    <div className={`wh-modal ${nested ? 'wh-modal--nested' : ''}`} onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">
              {isEdit ? 'Карточка оборудования' : 'Постановка на учёт'}
            </div>
            <div className="wh-modal__sub">
              {isEdit
                ? <span className="wh-mono">{asset.inventoryNumber}</span>
                : 'Инвентарный номер присвоится автоматически по маске'}
            </div>
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="wh-modal__tabs">
          <button className={tab === 'main' ? 'is-active' : ''} onClick={() => setTab('main')}>
            Основное
          </button>
          <button className={tab === 'place' ? 'is-active' : ''} onClick={() => setTab('place')}>
            Размещение
          </button>
          {canSeeCosts && (
            <button className={tab === 'money' ? 'is-active' : ''} onClick={() => setTab('money')}>
              Стоимость и амортизация
            </button>
          )}
          <button className={tab === 'service' ? 'is-active' : ''} onClick={() => setTab('service')}>
            Обслуживание
          </button>
        </div>

        <div className="wh-modal__body">
          {tab === 'main' && (
            <div className="wh-form">
              <label>Наименование <b className="wh-req">*</b>
                <input value={form.name} autoFocus
                       placeholder="Аппарат ультразвуковой диагностический"
                       onChange={e => set('name', e.target.value)} />
              </label>
              <div className="wh-form__row2">
                <label>Модель
                  <input value={form.model || ''} placeholder="Mindray DC-70 Exp"
                         onChange={e => set('model', e.target.value)} />
                </label>
                <label>Производитель
                  <input value={form.manufacturer || ''} onChange={e => set('manufacturer', e.target.value)} />
                </label>
              </div>
              <div className="wh-form__row2">
                <label>Серийный номер
                  <input value={form.serialNumber || ''} onChange={e => set('serialNumber', e.target.value)} />
                </label>
                <label>Категория
                  <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
                    <option value="">—</option>
                    {refs.categories.filter(c => c.kind === 'fixed').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="wh-form__row2">
                <label>Статус
                  <select value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <label>Поставщик
                  <select value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                    <option value="">—</option>
                    {refs.contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
              <label>Примечание
                <textarea rows={3} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
              </label>
            </div>
          )}

          {tab === 'place' && (
            <div className="wh-form">
              {isEdit ? (
                <div className="wh-alert wh-alert--warning">
                  <AlertTriangle size={15} />
                  <div>
                    Размещение и материально ответственное лицо здесь не меняются.
                    Переезд актива оформляется документом перемещения — иначе он сменил
                    бы кабинет без следа в журнале, и отчёт «Движение активов» перестал
                    бы быть аудиторским.
                    <div className="wh-hint">
                      Сейчас: {asset.room ? `Каб. ${asset.room.number}` : 'не размещён'}
                      {asset.responsible?.displayName ? ` · МОЛ: ${asset.responsible.displayName}` : ''}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <label>Кабинет
                    <select value={form.roomId} onChange={e => {
                      set('roomId', e.target.value);
                      // МОЛ по умолчанию — ответственный за кабинет: в девяти случаях
                      // из десяти это он и есть, а поправить всегда можно.
                      const r = rooms.find(x => x.id === e.target.value);
                      if (r?.responsibleUserId) set('responsibleUserId', r.responsibleUserId);
                    }}>
                      <option value="">Выберите кабинет…</option>
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </label>
                  <label>Место хранения
                    <select value={form.storageId} disabled={!storages.length}
                            onChange={e => set('storageId', e.target.value)}>
                      <option value="">Выберите место хранения…</option>
                      {storages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  {selectedRoom && <div className="wh-hint">{selectedRoom.label}</div>}
                </>
              )}
            </div>
          )}

          {tab === 'money' && canSeeCosts && (
            <div className="wh-form">
              <div className="wh-alert wh-alert--warning">
                <AlertTriangle size={15} />
                <div>
                  Эти значения вводятся вручную и не рассчитываются порталом.
                  Владелец амортизации — бухгалтерия; когда появится обмен с 1С,
                  поля начнут приходить оттуда и перезапишут введённое здесь.
                </div>
              </div>
              <div className="wh-form__row2">
                <label>Первоначальная стоимость, ₽
                  <input type="number" step="0.01" min="0" value={form.initialCost ?? ''}
                         onChange={e => set('initialCost', e.target.value)} />
                </label>
                <label>Накопленная амортизация, ₽
                  <input type="number" step="0.01" min="0" value={form.accumulatedDepreciation ?? ''}
                         onChange={e => set('accumulatedDepreciation', e.target.value)} />
                </label>
              </div>
              <div className="wh-form__row2">
                <label>Срок полезного использования, мес.
                  <input type="number" min="1" value={form.usefulLifeMonths ?? ''}
                         onChange={e => set('usefulLifeMonths', e.target.value)} />
                </label>
                <label>Амортизационная группа
                  <input type="number" min="1" max="10" value={form.depreciationGroup ?? ''}
                         onChange={e => set('depreciationGroup', e.target.value)} />
                </label>
              </div>
              <div className="wh-form__row2">
                <label>Способ начисления
                  <select value={form.depreciationMethod}
                          onChange={e => set('depreciationMethod', e.target.value)}>
                    {DEPRECIATION_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
                <label>Код ОКОФ
                  <input value={form.okof || ''} placeholder="320.26.60.12"
                         onChange={e => set('okof', e.target.value)} />
                </label>
              </div>
              <div className="wh-form__row2">
                <label>Дата покупки
                  <input type="date" value={form.purchaseDate || ''}
                         onChange={e => set('purchaseDate', e.target.value)} />
                </label>
                <label>Дата ввода в эксплуатацию
                  <input type="date" value={form.commissioningDate || ''}
                         onChange={e => set('commissioningDate', e.target.value)} />
                </label>
              </div>
              <label>Источник финансирования
                <input value={form.fundingSource || ''} placeholder="Собственные средства, лизинг…"
                       onChange={e => set('fundingSource', e.target.value)} />
              </label>
            </div>
          )}

          {tab === 'service' && (
            <div className="wh-form">
              <div className="wh-form__row2">
                <label>Интервал ТО, мес.
                  <input type="number" min="1" max="120" value={form.maintenanceIntervalMonths ?? ''}
                         onChange={e => set('maintenanceIntervalMonths', e.target.value)} />
                </label>
                <label>Следующее ТО
                  <input type="date" value={form.nextMaintenanceDate || ''}
                         onChange={e => set('nextMaintenanceDate', e.target.value)} />
                </label>
              </div>
              <div className="wh-form__row2">
                <label>Гарантия до
                  <input type="date" value={form.warrantyUntil || ''}
                         onChange={e => set('warrantyUntil', e.target.value)} />
                </label>
                <label>Суточная ёмкость, ч
                  <input type="number" step="0.5" min="0" max="24" value={form.dailyCapacityHours ?? 8}
                         onChange={e => set('dailyCapacityHours', e.target.value)} />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit} disabled={saving || !form.name.trim()}>
            <Check size={15} /> {saving ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Поставить на учёт'}
          </button>
        </div>
      </div>
    </div>
  );
}
