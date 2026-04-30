import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, Users, FileText, Settings, Eye, Pencil, Crown } from 'lucide-react';
import { roles } from '../../services/api';
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
  const [form, setForm] = useState({ name: '', description: '', permissions: defaultPerms });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await roles.list();
      setRoleList(data);
    } catch (e) { toast.error('Ошибка'); }
    finally { setLoading(false); }
  };

  const openModal = (role = null) => {
    if (role) {
      setForm({ name: role.name, description: role.description || '', permissions: role.permissions || defaultPerms });
    } else {
      setForm({ name: '', description: '', permissions: defaultPerms });
    }
    setModal({ open: true, role });
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
                <th style={{ textAlign: 'center', width: 150 }}>Права</th>
              </tr>
            </thead>
            <tbody>
              {roleList.map(role => (
                <tr key={role.id} className="role-row" onClick={() => openModal(role)}>
                  <td>
                    <div className="role-cell-name">
                      {role.isSystem && <Crown size={15} style={{ color: '#f59e0b', marginRight: 7, flexShrink: 0 }} />}
                      {role.name}
                    </div>
                    {role.description && <div className="role-cell-desc">{role.description}</div>}
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
