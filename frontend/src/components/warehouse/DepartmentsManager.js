import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Plus, Power, RotateCcw, Pencil, X } from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';

/**
 * Справочник отделений: завести, поправить, погасить и вернуть обратно.
 *
 * До этого экрана отделение можно было только создать — кнопкой в редакторе
 * планов, попутно с рисованием этажа. Поправить название или проставить
 * специальность было негде вовсе: маршрут правки на сервере есть с самого начала,
 * но ни один экран его не звал. Опечатка в названии и отделение без специальности
 * лечились запросом к API или правкой в базе.
 *
 * Живёт справочник во вкладке «Кабинеты», а не отдельной вкладкой модуля и не в
 * редакторе планов. Отделение — это разрез кабинетов, а не геометрия: смотрят на
 * него и правят его там же, где видят колонку «Отделение» и фильтр по ней.
 *
 * ── Почему специальность важнее, чем выглядит ────────────────────────────────
 *
 * Код специальности отделения попадает в маску инвентарного номера
 * (МЦ-2026-ХИРУРГ-00001) и берётся в момент постановки на учёт из отделения того
 * кабинета, куда встаёт актив. Номер после этого не меняется никогда — ни при
 * переезде актива, ни при правке отделения. Поэтому отделения заводят до того,
 * как заводить оборудование: кабинет без отделения даёт «АХО», и переставить
 * потом тысячу карточек в правильный код нельзя.
 *
 * ── Почему гашение, а не удаление ────────────────────────────────────────────
 *
 * На отделение ссылаются описи инвентаризации, нормы расхода и группировки в
 * отчётах за прошлые периоды. Удалённая строка оставила бы их без названия.
 * Сервер вдобавок не даёт погасить отделение, в котором остались кабинеты, — иначе
 * кабинет ссылался бы на невидимую строку и в списке выглядел бы «без отделения».
 */

const emptyForm = {
  id: null, medCenterId: '', name: '', specialtyCode: '', headUserId: '', color: '#4a90d9',
};

export default function DepartmentsManager({ tree, onClose, onChanged }) {
  const medCenters = useMemo(() => tree?.medCenters || [], [tree]);

  const [mcId, setMcId] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [specialties, setSpecialties] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const mcName = useCallback(
    id => medCenters.find(m => m.id === id)?.name || '—',
    [medCenters]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await warehouseApi.departments({
        ...(mcId ? { medCenterId: mcId } : {}),
        // Погашенные тянем всегда, когда включён их показ: без них вернуть
        // отделение обратно нельзя — его просто не видно.
        ...(showHidden ? { includeInactive: 1 } : {}),
      });
      setRows(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить отделения');
    } finally {
      setLoading(false);
    }
  }, [mcId, showHidden]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    warehouseApi.specialties().then(({ data }) => setSpecialties(data)).catch(() => {});
    usersApi.listBasic().then(({ data }) => setUsers(data)).catch(() => {});
  }, []);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const startCreate = () => setForm({
    ...emptyForm,
    // Медцентр из фильтра: справочник почти всегда открывают уже отфильтрованным
    // по площадке, которую заводят.
    medCenterId: mcId || medCenters[0]?.id || '',
  });

  const startEdit = (d) => setForm({
    id: d.id,
    medCenterId: d.medCenterId,
    name: d.name,
    specialtyCode: d.specialtyCode || '',
    headUserId: d.headUserId || d.head?.id || '',
    color: d.color || '#4a90d9',
  });

  const save = async () => {
    if (!form.name.trim()) return toast.error('Нужно название отделения');
    if (!form.id && !form.medCenterId) return toast.error('Выберите медцентр');

    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        specialtyCode: form.specialtyCode || null,
        headUserId: form.headUserId || null,
        color: form.color || null,
      };
      if (form.id) {
        const { data } = await warehouseApi.updateDepartment(form.id, body);
        // Смена кода касается только будущих номеров, и человек должен узнать об
        // этом в момент правки, а не когда сойдётся отчёт по инвентарным номерам.
        toast.success(data.specialtyChanged
          ? 'Сохранено. У выданных инвентарных номеров код прежний — он присваивается один раз'
          : 'Отделение сохранено');
      } else {
        await warehouseApi.createDepartment({ ...body, medCenterId: form.medCenterId });
        toast.success('Отделение добавлено');
      }
      setForm(null);
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить отделение');
    } finally {
      setSaving(false);
    }
  };

  const hide = async (d) => {
    if (!window.confirm(
      `Погасить отделение «${d.name}»? Оно исчезнет из фильтров и форм, `
      + 'но останется в описях и отчётах за прошлые периоды.'
    )) return;
    try {
      await warehouseApi.deleteDepartment(d.id);
      toast.success('Отделение погашено');
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось погасить отделение');
    }
  };

  const restore = async (d) => {
    try {
      await warehouseApi.updateDepartment(d.id, { isActive: true });
      toast.success('Отделение возвращено');
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось вернуть отделение');
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">Отделения</div>
            <div className="wh-modal__sub">
              Код специальности отделения попадает в инвентарные номера кабинетов,
              которые к нему привязаны
            </div>
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="wh-modal__body">
          <div className="wh-section-head">
            <div className="wh-form__row2">
              <select value={mcId} onChange={e => setMcId(e.target.value)}>
                <option value="">Все медцентры</option>
                {medCenters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <label className="wh-check">
                <input type="checkbox" checked={showHidden}
                       onChange={e => setShowHidden(e.target.checked)} />
                Показать погашенные
              </label>
            </div>
            {!form && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={startCreate}
                      disabled={!medCenters.length}>
                <Plus size={13} /> Новое отделение
              </button>
            )}
          </div>

          {form && (
            <div className="wh-storage-row wh-storage-row--form">
              <div className="wh-form">
                {!form.id && (
                  <label>Медцентр
                    <select value={form.medCenterId} onChange={e => set('medCenterId', e.target.value)}>
                      {medCenters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                )}
                <label>Название отделения
                  <input autoFocus value={form.name} placeholder="Хирургическое отделение"
                         onChange={e => set('name', e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') save(); }} />
                </label>
                <label>Специальность (код для инвентарных номеров)
                  <select value={form.specialtyCode} onChange={e => set('specialtyCode', e.target.value)}>
                    <option value="">— без специальности (номера пойдут с кодом АХО) —</option>
                    {specialties.map(s => (
                      <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </label>
                <label>Заведующий отделением
                  <select value={form.headUserId} onChange={e => set('headUserId', e.target.value)}>
                    <option value="">— не назначен —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                    ))}
                  </select>
                </label>
                {/* Заведующий — не подпись в карточке: по нему считаются права.
                    Ему открываются все кабинеты его отделения, даже если медцентр
                    в правах не перечислен. */}
                <div className="wh-cell-sub wh-muted">
                  Заведующему видны все кабинеты отделения — это право, а не справка.
                </div>
                <label>Цвет на плане
                  <input type="color" value={form.color || '#4a90d9'}
                         onChange={e => set('color', e.target.value)} />
                </label>
                <div className="wh-form__actions">
                  <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => setForm(null)}>
                    Отмена
                  </button>
                  <button className="wh-btn wh-btn--primary wh-btn--sm" onClick={save} disabled={saving}>
                    <Check size={13} /> {saving ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="wh-table-wrap">
            <table className="wh-table wh-table--compact">
              <thead>
                <tr>
                  <th>Отделение</th>
                  <th>Медцентр</th>
                  <th>Специальность</th>
                  <th>Заведующий</th>
                  <th className="wh-num">Кабинетов</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.id} className={d.isActive ? '' : 'wh-muted'}>
                    <td>
                      <span className="wh-rooms__dot" style={{ background: d.color || '#94a3b8' }} />
                      <span className="wh-cell-main">{d.name}</span>
                      {!d.isActive && <span className="wh-chip">погашено</span>}
                    </td>
                    <td>{mcName(d.medCenterId)}</td>
                    <td>
                      {d.specialtyCode || (
                        <span className="wh-chip wh-chip--warn"
                              title="Инвентарные номера кабинетов этого отделения пойдут с кодом АХО">
                          не задана
                        </span>
                      )}
                    </td>
                    <td>{d.head?.displayName || <span className="wh-muted">не назначен</span>}</td>
                    <td className="wh-num">{d.roomsCount}</td>
                    <td className="wh-num">
                      <button className="wh-icon-btn" title="Править"
                              onClick={() => startEdit(d)}>
                        <Pencil size={15} />
                      </button>
                      {d.isActive ? (
                        <button className="wh-icon-btn wh-icon-btn--danger"
                                title={d.roomsCount
                                  ? 'Сначала переведите кабинеты в другое отделение'
                                  : 'Погасить отделение'}
                                onClick={() => hide(d)}>
                          <Power size={15} />
                        </button>
                      ) : (
                        <button className="wh-icon-btn" title="Вернуть в работу"
                                onClick={() => restore(d)}>
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && !loading && (
                  <tr><td colSpan={6} className="wh-empty">
                    {/* Пустой справочник — обычное состояние на старте модуля, и
                        сказать здесь надо не «ничего нет», а чем это грозит. */}
                    Отделений нет. Пока их не завести, у всего оборудования будут
                    инвентарные номера с кодом АХО — и переприсвоить их потом нельзя.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
