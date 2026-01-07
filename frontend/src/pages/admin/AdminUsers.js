import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck, UserX, Shield, ShieldOff, Mail } from 'lucide-react';
import { users, roles } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminUsers() {
  const [userList, setUserList] = useState([]);
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState({ open: false, user: null });
  const [form, setForm] = useState({ 
    username: '', 
    password: '', 
    displayName: '', 
    email: '', 
    roleId: '', 
    isAdmin: false, 
    isActive: true,
    twoFactorEnabled: false 
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [u, r] = await Promise.all([users.list(), roles.list()]);
      setUserList(u.data);
      setRoleList(r.data);
    } catch (e) { toast.error('Ошибка загрузки'); }
    finally { setLoading(false); }
  };

  const openModal = (user = null) => {
    if (user) {
      setForm({ 
        username: user.username, 
        password: '', 
        displayName: user.displayName || '', 
        email: user.email || '', 
        roleId: user.roleId || '', 
        isAdmin: user.isAdmin, 
        isActive: user.isActive,
        twoFactorEnabled: user.twoFactorEnabled || false
      });
    } else {
      setForm({ 
        username: '', 
        password: '', 
        displayName: '', 
        email: '', 
        roleId: '', 
        isAdmin: false, 
        isActive: true,
        twoFactorEnabled: false
      });
    }
    setModal({ open: true, user });
  };

  const handleSave = async () => {
    if (!form.username) { toast.error('Введите логин'); return; }
    if (!modal.user && !form.password) { toast.error('Введите пароль'); return; }
    
    // Проверка email при включённой 2FA
    if (form.twoFactorEnabled && !form.email) {
      toast.error('Для включения 2FA необходимо указать email');
      return;
    }
    
    try {
      if (modal.user) {
        const data = { ...form };
        if (!data.password) delete data.password;
        await users.update(modal.user.id, data);
        toast.success('Пользователь обновлён');
      } else {
        await users.create(form);
        toast.success('Пользователь создан');
      }
      setModal({ open: false, user: null });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Удалить пользователя "${user.username}"?`)) return;
    try {
      await users.delete(user.id);
      toast.success('Удалено');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const filtered = userList.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.displayName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Пользователи</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>
          <Plus size={18} /> Добавить
        </button>
      </div>

      <div className="admin-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input type="text" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Email</th>
                <th>Роль</th>
                <th>2FA</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar">{user.username[0].toUpperCase()}</div>
                      <div>
                        <div className="user-name">{user.displayName || user.username}</div>
                        <div className="user-login">@{user.username}</div>
                      </div>
                      {user.isAdmin && <span className="badge badge-primary">Admin</span>}
                    </div>
                  </td>
                  <td>
                    {user.email ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Mail size={14} style={{ color: 'var(--text-tertiary)' }} />
                        {user.email}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                  <td>{user.role?.name || '—'}</td>
                  <td>
                    {user.twoFactorEnabled ? (
                      <span className="badge badge-success" title="Двухфакторная аутентификация включена">
                        <Shield size={12} /> Включена
                      </span>
                    ) : (
                      <span className="badge badge-secondary" title="Обычная авторизация">
                        <ShieldOff size={12} /> Выключена
                      </span>
                    )}
                  </td>
                  <td>
                    {user.isActive ? (
                      <span className="badge badge-success"><UserCheck size={12} /> Активен</span>
                    ) : (
                      <span className="badge badge-error"><UserX size={12} /> Неактивен</span>
                    )}
                  </td>
                  <td>
                    <div className="action-btns">
                      <button className="btn btn-ghost btn-sm" onClick={() => openModal(user)}>
                        <Edit size={16} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(user)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal.open && (
        <div className="modal-overlay" onClick={() => setModal({ open: false, user: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal.user ? 'Редактировать пользователя' : 'Новый пользователь'}</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Логин *</label>
                <input className="input" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Пароль {modal.user ? '(оставьте пустым)' : '*'}</label>
                <input className="input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Отображаемое имя</label>
                <input className="input" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Email {form.twoFactorEnabled && <span style={{color: 'var(--error)'}}>*</span>}</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                {form.twoFactorEnabled && !form.email && (
                  <small style={{ color: 'var(--error)', marginTop: 4, display: 'block' }}>
                    Email обязателен для двухфакторной аутентификации
                  </small>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Роль</label>
                <select className="select" value={form.roleId} onChange={e => setForm({...form, roleId: e.target.value})}>
                  <option value="">Без роли</option>
                  {roleList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="checkbox-item">
                  <input type="checkbox" checked={form.isAdmin} onChange={e => setForm({...form, isAdmin: e.target.checked})} />
                  Администратор
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-item">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({...form, isActive: e.target.checked})} />
                  Активен
                </label>
              </div>
              
              {/* 2FA Toggle */}
              <div className="form-group" style={{ 
                background: 'var(--bg-secondary)', 
                padding: 16, 
                borderRadius: 'var(--radius-md)',
                border: form.twoFactorEnabled ? '2px solid var(--primary)' : '2px solid transparent'
              }}>
                <label className="checkbox-item" style={{ marginBottom: 8 }}>
                  <input 
                    type="checkbox" 
                    checked={form.twoFactorEnabled} 
                    onChange={e => setForm({...form, twoFactorEnabled: e.target.checked})} 
                  />
                  <Shield size={18} style={{ color: form.twoFactorEnabled ? 'var(--primary)' : 'var(--text-secondary)' }} />
                  <span style={{ fontWeight: 500 }}>Двухфакторная аутентификация (2FA)</span>
                </label>
                <p style={{ 
                  fontSize: 13, 
                  color: 'var(--text-secondary)', 
                  margin: '8px 0 0 32px', 
                  lineHeight: 1.5 
                }}>
                  При входе пользователю будет отправлен код подтверждения на email. 
                  Это повышает безопасность учётной записи.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal({ open: false, user: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}