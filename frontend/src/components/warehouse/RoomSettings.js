import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Plus, Power, X } from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';

/**
 * Настройка кабинета: отделение, тип, ёмкость, материально ответственное лицо и
 * места хранения.
 *
 * До этого экрана всё перечисленное существовало только в API. Кабинет заводился
 * в редакторе планов вместе с геометрией и после этого не редактировался вовсе:
 * МОЛ назначить было негде, места хранения — негде создать. Для модуля, где МОЛ
 * определяет права, а место хранения обязательно у каждого остатка, это делало
 * настройку невыполнимой.
 *
 * Форма живёт здесь, а не в редакторе планов, по той же причине, по которой
 * свойства кабинета там правятся отдельным запросом: редактор — это работа с
 * геометрией, и неверный клик в нём не должен задевать ответственного.
 *
 * Места хранения не удаляются, а выключаются. На них ссылаются остатки и история
 * движений: удалённая полка оборвала бы проводки, по которым выясняют, куда делся
 * материал.
 */

const ROOM_KINDS = [
  { value: 'office', label: 'Кабинет' },
  { value: 'operating', label: 'Операционная' },
  { value: 'dressing', label: 'Перевязочная' },
  { value: 'procedure', label: 'Процедурный' },
  { value: 'lab', label: 'Лабораторная' },
  { value: 'storage', label: 'Склад' },
  { value: 'reception', label: 'Ресепшн' },
  { value: 'tech', label: 'Техническое' },
];

const STORAGE_KINDS = [
  { value: 'cabinet', label: 'Шкаф' },
  { value: 'shelf', label: 'Стеллаж / полка' },
  { value: 'fridge', label: 'Холодильник' },
  { value: 'freezer', label: 'Морозильник' },
  { value: 'safe', label: 'Сейф' },
  { value: 'cart', label: 'Тележка' },
  { value: 'room', label: 'Помещение целиком' },
];

// Холодильник и морозильник — единственные места, где температура это не
// справочная мелочь, а условие хранения: по ней считается нарушение режима.
const NEEDS_TEMP = new Set(['fridge', 'freezer']);

const kindLabel = (list, value) => list.find(k => k.value === value)?.label || value;

export default function RoomSettings({ room, departments, onClose, onSaved }) {
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    departmentId: room.departmentId || '',
    kind: room.kind || 'office',
    capacityHours: Number(room.capacityHours) || 8,
    responsibleUserId: room.responsible?.id || '',
  });
  const [storages, setStorages] = useState(room.storages || []);
  const [adding, setAdding] = useState(null);

  useEffect(() => {
    usersApi.listBasic().then(({ data }) => setUsers(data)).catch(() => {});
  }, []);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await warehouseApi.updateRoom(room.id, {
        departmentId: form.departmentId || null,
        kind: form.kind,
        capacityHours: Number(form.capacityHours) || 0,
        responsibleUserId: form.responsibleUserId || null,
      });
      toast.success('Кабинет сохранён');
      await onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить кабинет');
    } finally { setSaving(false); }
  };

  const addStorage = async () => {
    if (!adding?.name?.trim()) return toast.error('Нужно название места хранения');
    try {
      const { data } = await warehouseApi.createStorage({
        roomId: room.id,
        name: adding.name.trim(),
        kind: adding.kind,
        tempMinC: NEEDS_TEMP.has(adding.kind) && adding.tempMinC !== '' ? Number(adding.tempMinC) : null,
        tempMaxC: NEEDS_TEMP.has(adding.kind) && adding.tempMaxC !== '' ? Number(adding.tempMaxC) : null,
      });
      setStorages(list => [...list, data]);
      setAdding(null);
      await onSaved?.();
      toast.success(`«${data.name}» добавлено`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось добавить место хранения');
    }
  };

  const disableStorage = async (storage) => {
    if (!window.confirm(`Выключить «${storage.name}»? Остатки и история движений останутся.`)) return;
    try {
      await warehouseApi.updateStorage(storage.id, { isActive: false });
      setStorages(list => list.filter(s => s.id !== storage.id));
      await onSaved?.();
      toast.success('Выключено');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось выключить');
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">
            Каб. {room.number}{room.name && room.name !== room.number ? ` — ${room.name}` : ''}
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="wh-modal__body">
          <div className="wh-form">
            <label>Отделение
              <select value={form.departmentId} onChange={e => set('departmentId', e.target.value)}>
                <option value="">— без отделения —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>

            <div className="wh-form__row2">
              <label>Тип
                <select value={form.kind} onChange={e => set('kind', e.target.value)}>
                  {ROOM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <label>Ёмкость, ч
                <input type="number" step="0.5" value={form.capacityHours}
                       onChange={e => set('capacityHours', e.target.value)} />
              </label>
            </div>

            <label>Материально ответственное лицо
              <select value={form.responsibleUserId} onChange={e => set('responsibleUserId', e.target.value)}>
                <option value="">— не назначен —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
              </select>
            </label>
            <p className="wh-hint">
              Из этого поля выводится роль МОЛ со всеми правами по кабинету. Отдельно
              её выдавать не нужно: она появляется и снимается вместе с назначением.
            </p>
          </div>

          <div className="wh-section-head">
            <div className="wh-subhead">Места хранения</div>
            {!adding && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm"
                      onClick={() => setAdding({ name: '', kind: 'cabinet', tempMinC: '', tempMaxC: '' })}>
                <Plus size={13} /> Добавить
              </button>
            )}
          </div>

          {!storages.length && !adding && (
            <div className="wh-empty-inline">
              Мест хранения нет. Материалы нельзя оприходовать в кабинет напрямую —
              им нужна полка, шкаф или холодильник. Заведите хотя бы одно.
            </div>
          )}

          {storages.map(s => (
            <div key={s.id} className="wh-storage-row">
              <div>
                <div className="wh-cell-main">{s.name}</div>
                <div className="wh-cell-sub wh-muted">
                  {kindLabel(STORAGE_KINDS, s.kind)}
                  {s.tempMinC !== null && s.tempMinC !== undefined && (
                    ` · ${s.tempMinC}…${s.tempMaxC} °C`
                  )}
                </div>
              </div>
              <button className="wh-icon-btn wh-icon-btn--danger" title="Выключить"
                      onClick={() => disableStorage(s)}>
                <Power size={15} />
              </button>
            </div>
          ))}

          {adding && (
            <div className="wh-storage-row wh-storage-row--form">
              <div className="wh-form">
                <label>Название
                  <input autoFocus value={adding.name} placeholder="Шкаф А, полка 2"
                         onChange={e => setAdding(a => ({ ...a, name: e.target.value }))}
                         onKeyDown={e => { if (e.key === 'Enter') addStorage(); }} />
                </label>
                <label>Тип
                  <select value={adding.kind} onChange={e => setAdding(a => ({ ...a, kind: e.target.value }))}>
                    {STORAGE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </label>
                {NEEDS_TEMP.has(adding.kind) && (
                  <div className="wh-form__row2">
                    <label>Темп. от, °C
                      <input type="number" step="0.5" value={adding.tempMinC}
                             onChange={e => setAdding(a => ({ ...a, tempMinC: e.target.value }))} />
                    </label>
                    <label>Темп. до, °C
                      <input type="number" step="0.5" value={adding.tempMaxC}
                             onChange={e => setAdding(a => ({ ...a, tempMaxC: e.target.value }))} />
                    </label>
                  </div>
                )}
                <div className="wh-form__actions">
                  <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => setAdding(null)}>
                    Отмена
                  </button>
                  <button className="wh-btn wh-btn--primary wh-btn--sm" onClick={addStorage}>
                    <Check size={13} /> Добавить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Закрыть</button>
          <button className="wh-btn wh-btn--primary" onClick={save} disabled={saving}>
            <Check size={15} /> {saving ? 'Сохраняю…' : 'Сохранить кабинет'}
          </button>
        </div>
      </div>
    </div>
  );
}
