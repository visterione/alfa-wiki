import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2, Plus, Trash2, X, Save, Upload, Image as ImageIcon,
  Briefcase, ArrowLeft, EyeOff
} from 'lucide-react';
import {
  medCenters as medCentersApi,
  organizations as organizationsApi,
  media as mediaApi,
  users as usersApi
} from '../../services/api';
import { useMedCenters } from '../../context/MedCentersContext';
import toast from 'react-hot-toast';
import './AdminMedCenters.css';

// Порядок дней задаём здесь, а не Object.keys(workingHours): в JSON они лежат в
// том порядке, в каком их когда-то сохранили, и воскресенье уезжало в середину.
const DAYS = [
  { key: 'mon', label: 'Пн' },
  { key: 'tue', label: 'Вт' },
  { key: 'wed', label: 'Ср' },
  { key: 'thu', label: 'Чт' },
  { key: 'fri', label: 'Пт' },
  { key: 'sat', label: 'Сб' },
  { key: 'sun', label: 'Вс' }
];

const emptyMedCenter = {
  id: null,
  name: '',
  code: '',
  displayName: '',
  description: '',
  organizationId: '',
  misClinicIds: [],
  botOrgKey: '',
  importAliases: [],
  color: '#94a3b8',
  logoUrl: '',
  logoSquareUrl: '',
  address: '',
  city: '',
  lat: '',
  lng: '',
  phones: [],
  email: '',
  site: '',
  workingHours: {},
  workingHoursNote: '',
  chiefDoctorUserId: '',
  chiefDoctorName: '',
  isVirtual: false,
  isActive: true,
  sortOrder: 100
};

const emptyOrganization = {
  id: null,
  name: '',
  shortName: '',
  inn: '',
  kpp: '',
  ogrn: '',
  legalAddress: '',
  directorName: '',
  directorTitle: 'Генеральный директор',
  phone: '',
  email: '',
  isActive: true,
  sortOrder: 100
};

// Форма работает со строками (поля ввода), сервер — с массивами и числами.
function toForm(mc) {
  return {
    ...emptyMedCenter,
    ...mc,
    organizationId: mc.organizationId || '',
    chiefDoctorUserId: mc.chiefDoctorUserId || '',
    misClinicIds: mc.misClinicIds || [],
    importAliases: mc.importAliases || [],
    phones: mc.phones || [],
    workingHours: mc.workingHours || {},
    lat: mc.lat ?? '',
    lng: mc.lng ?? '',
    // null в текстовых полях превратил бы input в неуправляемый.
    ...Object.fromEntries(
      ['code', 'displayName', 'description', 'botOrgKey', 'logoUrl', 'logoSquareUrl',
       'address', 'city', 'email', 'site', 'workingHoursNote', 'chiefDoctorName']
        .map(k => [k, mc[k] ?? ''])
    )
  };
}

export default function AdminMedCenters() {
  const { reload: reloadRegistry } = useMedCenters();

  const [tab, setTab] = useState('medCenters');
  const [medCenters, setMedCenters] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);       // форма медцентра
  const [editingOrg, setEditingOrg] = useState(null); // форма организации
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);   // 'logoUrl' | 'logoSquareUrl'

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Служебные и отключённые тоже: это единственное место, где их видно и правят.
      const [mcRes, orgRes] = await Promise.all([
        medCentersApi.list({ includeVirtual: true, includeInactive: true }),
        organizationsApi.list()
      ]);
      setMedCenters(mcRes.data || []);
      setOrgs(orgRes.data || []);
    } catch (error) {
      console.error('Ошибка загрузки справочника:', error);
      toast.error('Ошибка загрузки справочника медцентров');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Список сотрудников для выбора главврача. Именно listBasic, а не list: полный
  // список — только для админов раздела «Пользователи», а право на справочник
  // медцентров выдают отдельно. Ошибку глотаем: без списка остаётся поле «ФИО
  // вручную», и остальные поля формы править это не мешает.
  useEffect(() => {
    usersApi.listBasic()
      .then(res => setStaff(Array.isArray(res.data) ? res.data : []))
      .catch(() => setStaff([]));
  }, []);

  const orgName = useCallback(
    id => orgs.find(o => o.id === id)?.shortName || orgs.find(o => o.id === id)?.name || null,
    [orgs]
  );

  const sorted = useMemo(
    () => [...medCenters].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name)),
    [medCenters]
  );

  // ─── Медцентры ────────────────────────────────────────────────────────────

  const saveMedCenter = async () => {
    if (!editing.name.trim()) return toast.error('Название обязательно');
    setSaving(true);
    try {
      const payload = {
        ...editing,
        lat: editing.lat === '' ? null : Number(editing.lat),
        lng: editing.lng === '' ? null : Number(editing.lng),
        organizationId: editing.organizationId || null,
        chiefDoctorUserId: editing.chiefDoctorUserId || null,
        phones: (editing.phones || []).filter(p => p && p.value && p.value.trim())
      };
      if (editing.id) {
        await medCentersApi.update(editing.id, payload);
        toast.success('Медцентр сохранён');
      } else {
        await medCentersApi.create(payload);
        toast.success('Медцентр создан');
      }
      setEditing(null);
      await loadAll();
      // Справочник читают все экраны — обновляем его, не дожидаясь перезагрузки страницы.
      reloadRegistry();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const removeMedCenter = async (mc) => {
    if (!window.confirm(`Удалить «${mc.name}»? Если на него уже ссылаются, лучше снять флаг «Активен».`)) return;
    try {
      await medCentersApi.delete(mc.id);
      toast.success('Медцентр удалён');
      await loadAll();
      reloadRegistry();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка удаления');
    }
  };

  // Логотип грузим в общую медиатеку и храним только ссылку: свой каталог для
  // картинок медцентров дал бы ещё одно место, где файлы теряются при переносе.
  const uploadLogo = async (field, file) => {
    if (!file) return;
    setUploading(field);
    try {
      const { data } = await mediaApi.upload(file);
      setEditing(prev => ({ ...prev, [field]: data.url }));
      toast.success('Логотип загружен');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить логотип');
    } finally {
      setUploading(null);
    }
  };

  const setDay = (day, value) => setEditing(prev => ({
    ...prev,
    workingHours: { ...prev.workingHours, [day]: value }
  }));

  // ─── Организации ──────────────────────────────────────────────────────────

  const saveOrg = async () => {
    if (!editingOrg.name.trim()) return toast.error('Название организации обязательно');
    setSaving(true);
    try {
      if (editingOrg.id) {
        await organizationsApi.update(editingOrg.id, editingOrg);
        toast.success('Организация сохранена');
      } else {
        await organizationsApi.create(editingOrg);
        toast.success('Организация создана');
      }
      setEditingOrg(null);
      await loadAll();
      reloadRegistry();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const removeOrg = async (org) => {
    if (!window.confirm(`Удалить «${org.name}»?`)) return;
    try {
      await organizationsApi.delete(org.id);
      toast.success('Организация удалена');
      await loadAll();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка удаления');
    }
  };

  // ─── Рендер ───────────────────────────────────────────────────────────────

  if (loading) return <div className="amc-page"><div className="amc-empty">Загрузка…</div></div>;

  if (editing) {
    return (
      <div className="amc-page">
        <div className="amc-header">
          <button className="amc-btn" onClick={() => setEditing(null)}>
            <ArrowLeft size={16} /> К списку
          </button>
          <button className="amc-btn amc-btn-primary" onClick={saveMedCenter} disabled={saving}>
            <Save size={16} /> {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>

        <h2 className="amc-form-title">{editing.id ? editing.name : 'Новый медцентр'}</h2>

        <section className="amc-section">
          <h3>Основное</h3>
          <div className="amc-grid">
            <label>Название
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                     placeholder="Кидс" />
            </label>
            <label>Полное название
              <input value={editing.displayName} onChange={e => setEditing({ ...editing, displayName: e.target.value })}
                     placeholder="МЦ Альфа Кидс" />
            </label>
            <label>Код
              <input value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })}
                     placeholder="kids" />
              <small>Латиница, цифры, дефис. Не меняется при переименовании</small>
            </label>
            <label>Юрлицо
              <select value={editing.organizationId}
                      onChange={e => setEditing({ ...editing, organizationId: e.target.value })}>
                <option value="">— не указано —</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.shortName || o.name}</option>)}
              </select>
            </label>
            <label>Порядок
              <input type="number" value={editing.sortOrder}
                     onChange={e => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
              <small>Чем меньше, тем выше в списках и приоритетнее цвет метки</small>
            </label>
            <label>Фирменный цвет
              <span className="amc-color-row">
                <input type="color" value={editing.color || '#94a3b8'}
                       onChange={e => setEditing({ ...editing, color: e.target.value })} />
                <input value={editing.color || ''} onChange={e => setEditing({ ...editing, color: e.target.value })}
                       placeholder="#de64a1" />
              </span>
            </label>
          </div>
          <label className="amc-full">Описание
            <textarea rows={2} value={editing.description}
                      onChange={e => setEditing({ ...editing, description: e.target.value })} />
          </label>
          <div className="amc-flags">
            <label className="amc-check">
              <input type="checkbox" checked={editing.isActive}
                     onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />
              Активен
            </label>
            <label className="amc-check">
              <input type="checkbox" checked={editing.isVirtual}
                     onChange={e => setEditing({ ...editing, isVirtual: e.target.checked })} />
              Служебная группировка
              <small>Не филиал: не показывается там, где выбирают медцентр</small>
            </label>
          </div>
        </section>

        <section className="amc-section">
          <h3>Связь с внешними системами</h3>
          <div className="amc-grid">
            <label>ID клиник в МИС
              <input value={(editing.misClinicIds || []).join(', ')}
                     onChange={e => setEditing({ ...editing, misClinicIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                     placeholder="11, 12" />
              <small>Через запятую. Несколько — если у филиала исторически два id</small>
            </label>
            <label>Ключ организации у ботов
              <input value={editing.botOrgKey} onChange={e => setEditing({ ...editing, botOrgKey: e.target.value })}
                     placeholder="alfa-deti" />
            </label>
            <label className="amc-full">Названия в импортируемых файлах
              <input value={(editing.importAliases || []).join(', ')}
                     onChange={e => setEditing({ ...editing, importAliases: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                     placeholder="альфа kids, альфа кидс" />
              <small>Через запятую. Как клинику называют в Excel-выгрузках. Само название и полное название сверяются всегда — их дублировать не нужно</small>
            </label>
          </div>
        </section>

        <section className="amc-section">
          <h3>Логотипы</h3>
          <div className="amc-logos">
            {[['logoUrl', 'Основной'], ['logoSquareUrl', 'Квадратный']].map(([field, label]) => (
              <div key={field} className="amc-logo-box">
                <span className="amc-logo-label">{label}</span>
                <div className="amc-logo-preview" style={{ background: editing.color || 'var(--bg-tertiary)' }}>
                  {editing[field]
                    ? <img src={editing[field]} alt="" onError={e => { e.target.style.display = 'none'; }} />
                    : <ImageIcon size={22} />}
                </div>
                <input value={editing[field]} onChange={e => setEditing({ ...editing, [field]: e.target.value })}
                       placeholder="/uploads/…" />
                <label className="amc-btn amc-btn-small">
                  <Upload size={14} /> {uploading === field ? 'Загрузка…' : 'Загрузить'}
                  <input type="file" accept="image/*" hidden
                         onChange={e => uploadLogo(field, e.target.files?.[0])} />
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="amc-section">
          <h3>Контакты и адрес</h3>
          <div className="amc-grid">
            <label>Город
              <input value={editing.city} onChange={e => setEditing({ ...editing, city: e.target.value })} />
            </label>
            <label>Адрес
              <input value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} />
            </label>
            <label>Широта
              <input value={editing.lat} onChange={e => setEditing({ ...editing, lat: e.target.value })}
                     placeholder="44.8951" />
            </label>
            <label>Долгота
              <input value={editing.lng} onChange={e => setEditing({ ...editing, lng: e.target.value })}
                     placeholder="37.3164" />
            </label>
            <label>Почта
              <input value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} />
            </label>
            <label>Сайт
              <input value={editing.site} onChange={e => setEditing({ ...editing, site: e.target.value })} />
            </label>
          </div>

          <div className="amc-phones">
            <span className="amc-sub">Телефоны</span>
            {(editing.phones || []).map((phone, i) => (
              <div key={i} className="amc-phone-row">
                <input value={phone.label || ''} placeholder="Регистратура"
                       onChange={e => {
                         const phones = [...editing.phones];
                         phones[i] = { ...phones[i], label: e.target.value };
                         setEditing({ ...editing, phones });
                       }} />
                <input value={phone.value || ''} placeholder="+7 (861) 000-00-00"
                       onChange={e => {
                         const phones = [...editing.phones];
                         phones[i] = { ...phones[i], value: e.target.value };
                         setEditing({ ...editing, phones });
                       }} />
                <button className="amc-icon-btn" title="Убрать"
                        onClick={() => setEditing({ ...editing, phones: editing.phones.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button className="amc-btn amc-btn-small"
                    onClick={() => setEditing({ ...editing, phones: [...(editing.phones || []), { label: '', value: '' }] })}>
              <Plus size={14} /> Телефон
            </button>
          </div>
        </section>

        <section className="amc-section">
          <h3>График работы</h3>
          <div className="amc-hours">
            {DAYS.map(({ key, label }) => {
              const value = editing.workingHours?.[key];
              const isOpen = !!value;
              return (
                <div key={key} className="amc-hours-row">
                  <label className="amc-check amc-day">
                    <input type="checkbox" checked={isOpen}
                           onChange={e => setDay(key, e.target.checked ? { from: '08:00', to: '20:00' } : null)} />
                    {label}
                  </label>
                  {isOpen ? (
                    <>
                      <input type="time" value={value.from || ''}
                             onChange={e => setDay(key, { ...value, from: e.target.value })} />
                      <span>—</span>
                      <input type="time" value={value.to || ''}
                             onChange={e => setDay(key, { ...value, to: e.target.value })} />
                    </>
                  ) : <span className="amc-dayoff">выходной</span>}
                </div>
              );
            })}
          </div>
          <label className="amc-full">Приписка к графику
            <input value={editing.workingHoursNote}
                   onChange={e => setEditing({ ...editing, workingHoursNote: e.target.value })}
                   placeholder="приём по записи" />
          </label>
        </section>

        <section className="amc-section">
          <h3>Главный врач</h3>
          <div className="amc-grid">
            <label>Сотрудник портала
              <select value={editing.chiefDoctorUserId}
                      onChange={e => setEditing({ ...editing, chiefDoctorUserId: e.target.value })}>
                <option value="">— не выбран —</option>
                {staff.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
              </select>
            </label>
            <label>ФИО вручную
              <input value={editing.chiefDoctorName}
                     onChange={e => setEditing({ ...editing, chiefDoctorName: e.target.value })} />
              <small>Если у главврача нет учётной записи</small>
            </label>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="amc-page">
      <div className="amc-header">
        <div className="amc-header-title">
          <Building2 size={24} />
          <h1>Медцентры</h1>
        </div>
        {tab === 'medCenters'
          ? <button className="amc-btn amc-btn-primary" onClick={() => setEditing({ ...emptyMedCenter })}>
              <Plus size={16} /> Медцентр
            </button>
          : <button className="amc-btn amc-btn-primary" onClick={() => setEditingOrg({ ...emptyOrganization })}>
              <Plus size={16} /> Организацию
            </button>}
      </div>

      <div className="amc-tabs">
        <button className={tab === 'medCenters' ? 'active' : ''} onClick={() => setTab('medCenters')}>
          <Building2 size={15} /> Филиалы ({medCenters.length})
        </button>
        <button className={tab === 'orgs' ? 'active' : ''} onClick={() => setTab('orgs')}>
          <Briefcase size={15} /> Юрлица ({orgs.length})
        </button>
      </div>

      {tab === 'medCenters' && (
        <div className="amc-list">
          {sorted.map(mc => (
            <div key={mc.id} className={`amc-card ${mc.isActive ? '' : 'amc-card-off'}`}>
              <div className="amc-card-logo" style={{ background: mc.color || 'var(--bg-tertiary)' }}>
                {(mc.logoSquareUrl || mc.logoUrl)
                  ? <img src={mc.logoSquareUrl || mc.logoUrl} alt="" onError={e => { e.target.style.display = 'none'; }} />
                  : <span>{mc.name.slice(0, 2)}</span>}
              </div>
              <div className="amc-card-main">
                <div className="amc-card-name">
                  {mc.name}
                  {mc.isVirtual && <span className="amc-tag">служебный</span>}
                  {!mc.isActive && <span className="amc-tag amc-tag-off"><EyeOff size={11} /> отключён</span>}
                </div>
                <div className="amc-card-meta">
                  {[
                    mc.code,
                    orgName(mc.organizationId),
                    mc.misClinicIds?.length ? `МИС: ${mc.misClinicIds.join(', ')}` : null,
                    mc.address
                  ].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="amc-card-actions">
                <button className="amc-btn amc-btn-small" onClick={() => setEditing(toForm(mc))}>Изменить</button>
                <button className="amc-icon-btn amc-danger" title="Удалить" onClick={() => removeMedCenter(mc)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'orgs' && (
        <div className="amc-list">
          {orgs.length === 0 && (
            <div className="amc-empty">
              Юрлиц пока нет. Заведите ООО и ИП — тогда у каждого филиала появятся реквизиты для справок и договоров.
            </div>
          )}
          {orgs.map(org => (
            <div key={org.id} className={`amc-card ${org.isActive ? '' : 'amc-card-off'}`}>
              <div className="amc-card-logo amc-card-logo-org"><Briefcase size={18} /></div>
              <div className="amc-card-main">
                <div className="amc-card-name">{org.shortName || org.name}</div>
                <div className="amc-card-meta">
                  {[org.inn && `ИНН ${org.inn}`, org.directorName, org.legalAddress].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="amc-card-actions">
                <button className="amc-btn amc-btn-small"
                        onClick={() => setEditingOrg({ ...emptyOrganization, ...org })}>Изменить</button>
                <button className="amc-icon-btn amc-danger" title="Удалить" onClick={() => removeOrg(org)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingOrg && (
        <div className="amc-modal-backdrop" onClick={() => setEditingOrg(null)}>
          <div className="amc-modal" onClick={e => e.stopPropagation()}>
            <div className="amc-modal-head">
              <h3>{editingOrg.id ? 'Организация' : 'Новая организация'}</h3>
              <button className="amc-icon-btn" onClick={() => setEditingOrg(null)}><X size={16} /></button>
            </div>
            <div className="amc-grid">
              <label className="amc-full">Полное наименование
                <input value={editingOrg.name} onChange={e => setEditingOrg({ ...editingOrg, name: e.target.value })}
                       placeholder="Общество с ограниченной ответственностью «...»" />
              </label>
              <label>Короткое имя
                <input value={editingOrg.shortName || ''}
                       onChange={e => setEditingOrg({ ...editingOrg, shortName: e.target.value })}
                       placeholder="ООО «Альфа»" />
              </label>
              <label>ИНН
                <input value={editingOrg.inn || ''} onChange={e => setEditingOrg({ ...editingOrg, inn: e.target.value })}
                       placeholder="10 цифр, у ИП 12" />
              </label>
              <label>КПП
                <input value={editingOrg.kpp || ''} onChange={e => setEditingOrg({ ...editingOrg, kpp: e.target.value })} />
              </label>
              <label>ОГРН
                <input value={editingOrg.ogrn || ''} onChange={e => setEditingOrg({ ...editingOrg, ogrn: e.target.value })} />
              </label>
              <label className="amc-full">Юридический адрес
                <input value={editingOrg.legalAddress || ''}
                       onChange={e => setEditingOrg({ ...editingOrg, legalAddress: e.target.value })} />
              </label>
              <label>Подписант
                <input value={editingOrg.directorName || ''}
                       onChange={e => setEditingOrg({ ...editingOrg, directorName: e.target.value })}
                       placeholder="Иванов И. И." />
              </label>
              <label>Должность подписанта
                <input value={editingOrg.directorTitle || ''}
                       onChange={e => setEditingOrg({ ...editingOrg, directorTitle: e.target.value })} />
              </label>
              <label>Телефон
                <input value={editingOrg.phone || ''}
                       onChange={e => setEditingOrg({ ...editingOrg, phone: e.target.value })} />
              </label>
              <label>Почта
                <input value={editingOrg.email || ''}
                       onChange={e => setEditingOrg({ ...editingOrg, email: e.target.value })} />
              </label>
            </div>
            <label className="amc-check">
              <input type="checkbox" checked={editingOrg.isActive}
                     onChange={e => setEditingOrg({ ...editingOrg, isActive: e.target.checked })} />
              Активна
            </label>
            <div className="amc-modal-foot">
              <button className="amc-btn" onClick={() => setEditingOrg(null)}>Отмена</button>
              <button className="amc-btn amc-btn-primary" onClick={saveOrg} disabled={saving}>
                <Save size={16} /> {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
