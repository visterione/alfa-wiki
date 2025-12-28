import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Shield, Users } from 'lucide-react';
import { roles } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

const defaultPerms = {
  pages: { read: true, write: false, delete: false, admin: false },
  media: { read: true, upload: false, delete: false },
  users: { read: false, write: false, delete: false },
  settings: { read: false, write: false }
};

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
      setModal({ open: false, role: null });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const handleDelete = async (role) => {
    if (role.isSystem) { toast.error('Системную роль нельзя удалить'); return; }
    if (!window.confirm(`Удалить роль "${role.name}"?`)) return;
    try {
      await roles.delete(role.id);
      toast.success('Удалено');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const togglePerm = (category, perm) => {
    setForm({
      ...form,
      permissions: {
        ...form.permissions,
        [category]: { ...form.permissions[category], [perm]: !form.permissions[category]?.[perm] }
      }
    });
  };

  const PermCheckbox = ({ cat, perm, label }) => (
    <label className="checkbox-item">
      <input type="checkbox" checked={form.permissions[cat]?.[perm] || false} onChange={() => togglePerm(cat, perm)} />
      {label}
    </label>
  );

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Роли и права</h1>
        <button className="btn btn-primary" onClick={() => openModal()}><Plus size={18} /> Добавить</button>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : (
          <div className="roles-grid">
            {roleList.map(role => (
              <div key={role.id} className="role-card">
                <div className="role-card-header">
                  <div className="role-icon"><Shield size={24} /></div>
                  <div>
                    <h3>{role.name}</h3>
                    <p>{role.description || 'Без описания'}</p>
                  </div>
                  {role.isSystem && <span className="badge">Системная</span>}
                </div>
                <div className="role-card-perms">
                  {role.permissions?.pages?.write && <span className="badge badge-primary">Редактирование</span>}
                  {role.permissions?.pages?.delete && <span className="badge badge-warning">Удаление</span>}
                  {role.permissions?.users?.write && <span className="badge badge-error">Управление</span>}
                </div>
                <div className="role-card-footer">
                  <span><Users size={14} /> {role.users?.length || 0} пользователей</span>
                  <div className="action-btns">
                    <button className="btn btn-ghost btn-sm" onClick={() => openModal(role)}><Edit size={16} /></button>
                    {!role.isSystem && <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(role)}><Trash2 size={16} /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal.open && (
        <div className="modal-overlay" onClick={() => setModal({ open: false, role: null })}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{modal.role ? 'Редактировать роль' : 'Новая роль'}</h3></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название</label>
                <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} disabled={modal.role?.isSystem} />
              </div>
              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea className="textarea" value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} />
              </div>
              <div className="form-group">
                <label className="form-label">Права доступа</label>
                <div className="perms-grid">
                  <div className="perm-section">
                    <h4>Страницы</h4>
                    <PermCheckbox cat="pages" perm="read" label="Просмотр" />
                    <PermCheckbox cat="pages" perm="write" label="Редактирование" />
                    <PermCheckbox cat="pages" perm="delete" label="Удаление" />
                  </div>
                  <div className="perm-section">
                    <h4>Медиафайлы</h4>
                    <PermCheckbox cat="media" perm="read" label="Просмотр" />
                    <PermCheckbox cat="media" perm="upload" label="Загрузка" />
                    <PermCheckbox cat="media" perm="delete" label="Удаление" />
                  </div>
                  <div className="perm-section">
                    <h4>Пользователи</h4>
                    <PermCheckbox cat="users" perm="read" label="Просмотр" />
                    <PermCheckbox cat="users" perm="write" label="Управление" />
                  </div>
                  <div className="perm-section">
                    <h4>Настройки</h4>
                    <PermCheckbox cat="settings" perm="read" label="Просмотр" />
                    <PermCheckbox cat="settings" perm="write" label="Изменение" />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal({ open: false, role: null })}>Отмена</button>
              <button className="btn btn-primary" onClick={handleSave}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}