import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, Users, FileText, Settings, Eye, Pencil, Crown, Palette } from 'lucide-react';
import { roles, medCenters } from '../../services/api';
import UserBadge from '../../components/chat/UserBadge';
import BadgeIconPicker from '../../components/BadgeIconPicker';
import { DEFAULT_BADGE_COLOR } from '../../components/chat/badgeIcons';
import toast from 'react-hot-toast';
import '../Admin.css';

const defaultPerms = {
  pages: { read: true, write: false, delete: false, admin: false },
  users: { read: false, write: false, delete: false },
  settings: { read: false, write: false }
};

const permSections = [
  {
    key: 'pages',
    icon: <FileText size={14} />,
    title: 'Страницы',
    perms: [
      { perm: 'read', label: 'Просмотр' },
      { perm: 'write', label: 'Редактирование' },
      { perm: 'delete', label: 'Удаление' },
    ]
  },
  {
    key: 'users',
    icon: <Users size={14} />,
    title: 'Пользователи',
    perms: [
      { perm: 'read', label: 'Просмотр' },
      { perm: 'write', label: 'Управление' },
    ]
  },
  {
    key: 'settings',
    icon: <Settings size={14} />,
    title: 'Настройки',
    perms: [
      { perm: 'read', label: 'Просмотр' },
      { perm: 'write', label: 'Изменение' },
    ]
  },
];

const permGroups = [
  { key: 'pages',    Icon: FileText, label: 'Страницы',     perms: ['read', 'write', 'delete'] },
  { key: 'users',    Icon: Users,    label: 'Пользователи', perms: ['read', 'write', 'delete'] },
  { key: 'settings', Icon: Settings, label: 'Настройки',    perms: ['read', 'write']           },
];
const permActionIcons = { read: Eye, write: Pencil, delete: Trash2 };

const badgeDefaults = { chatBadgeIcon: '', chatBadgeLabel: '', badgePriority: 0 };

function RolePermIcons({ permissions }) {
  return (
    <div className="role-perm-icons">
      {permGroups.map(group => (
        <div key={group.key} className="role-perm-row">
          <group.Icon size={13} className="role-perm-cat-icon" />
          {group.perms.map(perm => {
            const Icon = permActionIcons[perm];
            const active = permissions?.[group.key]?.[perm] || false;
            return <Icon key={perm} size={14} style={{ color: active ? '#22c55e' : '#d1d5db' }} />;
          })}
        </div>
      ))}
    </div>
  );
}

function PermToggle({ cat, perm, label, permissions, onToggle }) {
  const isOn = permissions[cat]?.[perm] || false;
  return (
    <div className="admin-toggle-item" onClick={() => onToggle(cat, perm)}>
      <span className={`admin-toggle-track${isOn ? ' on' : ''}`} />
      <span className="admin-toggle-label">{label}</span>
    </div>
  );
}

export default function AdminRoles() {
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, role: null });
  const [form, setForm] = useState({ name: '', description: '', permissions: defaultPerms, ...badgeDefaults });
  const [clinics, setClinics] = useState([]);
  const [savingClinic, setSavingClinic] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [rolesRes, clinicsRes] = await Promise.all([roles.list(), medCenters.list()]);
      setRoleList(rolesRes.data);
      setClinics(clinicsRes.data);
    } catch (e) { toast.error('Ошибка'); }
    finally { setLoading(false); }
  };

  const openModal = (role = null) => {
    if (role) {
      setForm({
        name: role.name,
        description: role.description || '',
        permissions: role.permissions || defaultPerms,
        chatBadgeIcon: role.chatBadgeIcon || '',
        chatBadgeLabel: role.chatBadgeLabel || '',
        badgePriority: role.badgePriority ?? 0
      });
    } else {
      setForm({ name: '', description: '', permissions: defaultPerms, ...badgeDefaults });
    }
    setModal({ open: true, role });
  };

  // Цвет клиники правится прямо в списке — отдельная модалка ради одного
  // поля была бы лишней.
  const saveClinic = async (clinic, fields) => {
    setClinics(prev => prev.map(c => (c.id === clinic.id ? { ...c, ...fields } : c)));
    setSavingClinic(clinic.id);
    try {
      const { data } = await medCenters.update(clinic.id, fields);
      setClinics(prev => prev.map(c => (c.id === clinic.id ? data : c)));
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить цвет клиники');
      load();
    } finally {
      setSavingClinic(null);
    }
  };

  const closeModal = () => setModal({ open: false, role: null });

  const handleSave = async () => {
    if (!form.name) { toast.error('Введите название'); return; }
    try {
      if (modal.role) {
        await roles.update(modal.role.id, form);
        toast.success('Роль обновлена');
      } else {
        await roles.create(form);
        toast.success('Роль создана');
      }
      closeModal();
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const handleDelete = async () => {
    const role = modal.role;
    if (!window.confirm(`Удалить роль "${role.name}"?`)) return;
    try {
      await roles.delete(role.id);
      toast.success('Удалено');
      closeModal();
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const togglePerm = (category, perm) => {
    setForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [category]: { ...prev.permissions[category], [perm]: !prev.permissions[category]?.[perm] }
      }
    }));
  };

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Роли и права</h1>
        <button className="btn btn-primary" onClick={() => openModal()}><Plus size={18} /> Добавить</button>
      </div>

      <div className="admin-table-container">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : roleList.length === 0 ? (
          <div className="empty-state"><Shield size={40} /><p>Нет ролей</p></div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>Роль</th>
                <th style={{ textAlign: 'center', width: 130 }}>Метка в чате</th>
                <th style={{ textAlign: 'center', width: 150 }}>Права</th>
              </tr>
            </thead>
            <tbody>
              {roleList.map(role => (
                <tr key={role.id} className="role-row" onClick={() => openModal(role)}>
                  <td>
                    <div className="role-cell-name">
                      {role.isSystem && <Crown size={15} style={{ color: 'var(--amber-500)', marginRight: 7, flexShrink: 0 }} />}
                      {role.name}
                    </div>
                    {role.description && <div className="role-cell-desc">{role.description}</div>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {role.chatBadgeIcon ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <UserBadge
                          badge={{ value: role.chatBadgeIcon, color: DEFAULT_BADGE_COLOR, label: role.chatBadgeLabel }}
                          size={18}
                        />
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          приоритет {role.badgePriority ?? 0}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <RolePermIcons permissions={role.permissions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && clinics.length > 0 && (
        <div className="admin-table-container" style={{ marginTop: 20, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Palette size={16} style={{ color: 'var(--text-secondary)' }} />
            <h3 style={{ margin: 0, fontSize: 15 }}>Цвета клиник</h3>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            Цветом клиники красится метка сотрудника в чатах. Если сотрудник привязан
            к нескольким клиникам, берётся верхняя по порядку — его можно поменять
            числом справа. Цвет конкретного человека переопределяется в его карточке.
          </p>
          <div className="clinic-colors-grid">
            {clinics.map(clinic => (
              <div key={clinic.id} className="clinic-color-item" style={{ opacity: savingClinic === clinic.id ? .6 : 1 }}>
                <input
                  type="color"
                  value={clinic.color || DEFAULT_BADGE_COLOR}
                  /* onChange у color сыплется на каждое движение курсора по
                     палитре — сохраняем только когда её закрыли */
                  onChange={e => setClinics(prev => prev.map(c => (c.id === clinic.id ? { ...c, color: e.target.value } : c)))}
                  onBlur={e => saveClinic(clinic, { color: e.target.value })}
                  title={`Цвет клиники «${clinic.name}»`}
                />
                <span className="clinic-color-name">{clinic.name}</span>
                <input
                  className="input"
                  type="number"
                  value={clinic.sortOrder ?? 100}
                  style={{ width: 64, flexShrink: 0, padding: '4px 6px' }}
                  title="Порядок: чем меньше, тем приоритетнее при выборе цвета"
                  onChange={e => setClinics(prev => prev.map(c => (c.id === clinic.id ? { ...c, sortOrder: e.target.value } : c)))}
                  onBlur={e => saveClinic(clinic, { sortOrder: Number(e.target.value) || 100 })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {modal.open && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal.role ? 'Редактировать роль' : 'Новая роль'}</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Название роли"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="textarea"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="Краткое описание роли"
                />
              </div>
              <div className="form-group badge-field">
                <label className="form-label">Метка в чате</label>
                <div className="badge-field-preview">
                  <div className="badge-field-sample">
                    <span>{form.name || 'Сотрудник'}</span>
                    <UserBadge
                      badge={{ value: form.chatBadgeIcon, color: DEFAULT_BADGE_COLOR, label: form.chatBadgeLabel }}
                      size={16}
                    />
                  </div>
                  <div className="badge-field-source">
                    Иконку получат все сотрудники с этой ролью. Цвет подставится
                    от клиники сотрудника, здесь он показан нейтральным.
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <BadgeIconPicker
                    value={form.chatBadgeIcon}
                    onChange={icon => setForm({ ...form, chatBadgeIcon: icon })}
                    color={DEFAULT_BADGE_COLOR}
                    emptyLabel="Без метки"
                  />
                </div>

                <div className="badge-field-row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    className="input"
                    value={form.chatBadgeLabel}
                    maxLength={80}
                    placeholder="Подпись при наведении, например «Call-центр»"
                    onChange={e => setForm({ ...form, chatBadgeLabel: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    value={form.badgePriority}
                    style={{ width: 110, flexShrink: 0 }}
                    title="Чем больше, тем важнее роль, если у сотрудника их несколько"
                    onChange={e => setForm({ ...form, badgePriority: e.target.value })}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  Приоритет решает, чья иконка победит у сотрудника с несколькими ролями — чем больше, тем важнее.
                </div>
              </div>

              {!modal.role?.isSystem && (
                <div className="form-group">
                  <label className="form-label">Права доступа</label>
                  <div className="role-perms-grid">
                    {permSections.map(section => (
                      <div key={section.key} className="role-perm-section">
                        <div className="role-perm-section-header">
                          {section.icon}
                          <span>{section.title}</span>
                        </div>
                        <div className="role-perm-toggles">
                          {section.perms.map(({ perm, label }) => (
                            <PermToggle
                              key={perm}
                              cat={section.key}
                              perm={perm}
                              label={label}
                              permissions={form.permissions}
                              onToggle={togglePerm}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              {modal.role && !modal.role.isSystem && (
                <button className="btn btn-danger" style={{ width: 110 }} onClick={handleDelete}>Удалить</button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" style={{ width: 110 }} onClick={closeModal}>Отмена</button>
              <button className="btn btn-primary" style={{ width: 110 }} onClick={handleSave}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
