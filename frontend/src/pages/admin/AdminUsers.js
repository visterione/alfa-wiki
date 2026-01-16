import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck, UserX, Shield, ShieldOff, Mail, Copy, RefreshCw, User, Building2, X as XIcon, ChevronDown } from 'lucide-react';
import { users, roles, BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

// Компонент для множественного выбора
function MultiSelect({ label, placeholder, value, onChange, options, optionKey = 'id', optionLabel = 'name', optionDescription = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const selectedItems = options.filter(opt => value.includes(opt[optionKey]));

  const toggleOption = (optId) => {
    if (value.includes(optId)) {
      onChange(value.filter(id => id !== optId));
    } else {
      onChange([...value, optId]);
    }
  };

  const removeItem = (optId, e) => {
    e.stopPropagation();
    onChange(value.filter(id => id !== optId));
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div className="multi-select" ref={dropdownRef}>
        <div
          className={`multi-select-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
        >
          {selectedItems.length === 0 ? (
            <span className="multi-select-placeholder">{placeholder}</span>
          ) : (
            <div className="multi-select-values">
              {selectedItems.map(item => (
                <span key={item[optionKey]} className="multi-select-value">
                  {item[optionLabel]}
                  <button onClick={(e) => removeItem(item[optionKey], e)} type="button">
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <ChevronDown size={18} className={`multi-select-chevron ${isOpen ? 'open' : ''}`} />
        </div>

        {isOpen && (
          <div className="multi-select-dropdown">
            {options.map(option => (
              <div
                key={option[optionKey]}
                className="multi-select-option"
                onClick={() => toggleOption(option[optionKey])}
              >
                <input
                  type="checkbox"
                  checked={value.includes(option[optionKey])}
                  onChange={() => {}}
                />
                <div className="multi-select-option-label">
                  <div>{option[optionLabel]}</div>
                  {optionDescription && option[optionDescription] && (
                    <div className="multi-select-option-desc">{option[optionDescription]}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const [userList, setUserList] = useState([]);
  const [roleList, setRoleList] = useState([]);
  const [medCenterList, setMedCenterList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState({ open: false, user: null });
  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    email: '',
    roleIds: [],
    medCenterIds: [],
    isAdmin: false,
    isActive: true,
    twoFactorEnabled: true,  // По умолчанию включена
    adminAccess: {
      pages: false,
      sidebar: false,
      users: false,
      roles: false,
      media: false,
      backup: false,
      settings: false,
      courses: false,
      kanban: false
    }
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [u, r, mc] = await Promise.all([
        users.list(),
        roles.list(),
        users.getMedCenters()
      ]);
      setUserList(u.data);
      setRoleList(r.data);
      setMedCenterList(mc.data);
    } catch (e) {
      console.error('Load error:', e);
      toast.error('Ошибка загрузки');
    }
    finally { setLoading(false); }
  };

  // Получение URL аватара пользователя
  const getAvatarUrl = (user) => {
    if (!user?.avatar) return null;
    // Если это старый полный URL с localhost - заменяем на текущий BASE_URL
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  // Функция транслитерации кириллицы в латиницу
  const transliterate = (text) => {
    const map = {
      'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 
      'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 
      'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 
      'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 
      'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };
    
    return text.toLowerCase().split('').map(char => map[char] || char).join('');
  };

  // Генерация базового логина из отображаемого имени
  const generateBaseUsername = (displayName) => {
    if (!displayName.trim()) return '';
    
    // Разбиваем на слова
    const words = displayName.trim().split(/\s+/);
    
    if (words.length === 0) return '';
    
    // Первое слово полностью, остальные - первые буквы
    const firstWord = transliterate(words[0]);
    const initials = words.slice(1).map(word => transliterate(word[0] || '')).join('_');
    
    const username = initials ? `${firstWord}_${initials}` : firstWord;
    
    // Убираем все недопустимые символы и приводим к нижнему регистру
    return username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  };

  // Проверка уникальности логина и добавление суффикса при необходимости
  const generateUniqueUsername = (displayName) => {
    const baseUsername = generateBaseUsername(displayName);
    if (!baseUsername) return '';

    // Собираем все существующие логины (кроме текущего редактируемого пользователя)
    const existingUsernames = userList
      .filter(u => !modal.user || u.id !== modal.user.id)
      .map(u => u.username.toLowerCase());

    // Если базовый логин свободен - используем его
    if (!existingUsernames.includes(baseUsername)) {
      return baseUsername;
    }

    // Иначе ищем первый свободный вариант с суффиксом
    let counter = 1;
    let username = `${baseUsername}_${counter}`;
    
    while (existingUsernames.includes(username)) {
      counter++;
      username = `${baseUsername}_${counter}`;
      
      // Защита от бесконечного цикла (на всякий случай)
      if (counter > 1000) {
        toast.error('Не удалось сгенерировать уникальный логин');
        return baseUsername;
      }
    }

    // Показываем уведомление, что был добавлен суффикс
    if (counter > 1) {
      toast.info(`Логин "${baseUsername}" занят, использован "${username}"`, {
        duration: 4000
      });
    }

    return username;
  };

  // Генерация безопасного пароля
  const generatePassword = () => {
    const length = 12;
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    const all = lowercase + uppercase + numbers + special;
    
    let password = '';
    // Гарантируем хотя бы один символ каждого типа
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];
    
    // Заполняем оставшиеся символы
    for (let i = password.length; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }
    
    // Перемешиваем символы
    return password.split('').sort(() => Math.random() - 0.5).join('');
  };

  const openModal = (user = null) => {
    if (user) {
      setForm({
        username: user.username,
        password: '',
        displayName: user.displayName || '',
        email: user.email || '',
        roleIds: user.roles ? user.roles.map(r => r.id) : [],
        medCenterIds: user.medCenters ? user.medCenters.map(mc => mc.id) : [],
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        twoFactorEnabled: user.twoFactorEnabled || false,
        adminAccess: user.adminAccess || {
          pages: false,
          sidebar: false,
          users: false,
          roles: false,
          media: false,
          backup: false,
          settings: false,
          courses: false
        }
      });
    } else {
      // При создании нового пользователя генерируем пароль и включаем 2FA
      const newPassword = generatePassword();
      setForm({
        username: '',
        password: newPassword,
        displayName: '',
        email: '',
        roleIds: [],
        medCenterIds: [],
        isAdmin: false,
        isActive: true,
        twoFactorEnabled: true,  // По умолчанию включена для новых пользователей
        adminAccess: {
          pages: false,
          sidebar: false,
          users: false,
          roles: false,
          media: false,
          backup: false,
          settings: false,
          courses: false
        }
      });
    }
    setModal({ open: true, user });
  };

  // Обработчик изменения отображаемого имени
  const handleDisplayNameChange = (displayName) => {
    const username = generateUniqueUsername(displayName);
    setForm({
      ...form,
      displayName,
      username
    });
  };

  // Fallback метод копирования через создание временного элемента
  const fallbackCopy = () => {
    const textArea = document.createElement('textarea');
    textArea.value = form.password;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        toast.success('Пароль скопирован в буфер обмена');
      } else {
        toast.error('Не удалось скопировать пароль. Попробуйте выделить и скопировать вручную.');
      }
    } catch (err) {
      console.error('Ошибка копирования:', err);
      toast.error('Копирование не поддерживается в вашем браузере. Скопируйте пароль вручную.');
    } finally {
      document.body.removeChild(textArea);
    }
  };

  // Копирование пароля в буфер обмена
  const copyPassword = () => {
    // Проверяем доступность Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(form.password)
        .then(() => {
          toast.success('Пароль скопирован в буфер обмена');
        })
        .catch(err => {
          console.error('Ошибка копирования через Clipboard API:', err);
          fallbackCopy();
        });
    } else {
      // Fallback для старых браузеров или небезопасных контекстов
      fallbackCopy();
    }
  };

  // Перегенерация пароля
  const regeneratePassword = () => {
    const newPassword = generatePassword();
    setForm({ ...form, password: newPassword });
    toast.success('Пароль обновлен');
  };

  const handleSave = async () => {
    // Валидация для нового пользователя
    if (!modal.user) {
      if (!form.displayName.trim()) { 
        toast.error('Введите отображаемое имя'); 
        return; 
      }
      if (!form.username.trim()) { 
        toast.error('Логин не сгенерирован'); 
        return; 
      }
      if (!form.password) { 
        toast.error('Пароль не сгенерирован'); 
        return; 
      }
      if (!form.email.trim()) { 
        toast.error('Email обязателен для новых пользователей (включена 2FA)'); 
        return; 
      }
    } else {
      // Валидация для редактирования
      if (!form.username) { 
        toast.error('Введите логин'); 
        return; 
      }
    }
    
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
    <div className="admin-page users-page">
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
                <th>Роли</th>
                <th>Медцентры</th>
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
                      <div className="user-avatar">
                        {getAvatarUrl(user) ? (
                          <img src={getAvatarUrl(user)} alt={user.displayName || user.username} />
                        ) : (
                          user.username[0].toUpperCase()
                        )}
                      </div>
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
                  <td>
                    {user.roles && user.roles.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {user.roles.map(role => (
                          <span key={role.id} className="badge badge-info">
                            {role.name}
                          </span>
                        ))}
                      </div>
                    ) : user.role ? (
                      <span className="badge badge-info">{user.role.name}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>—</span>
                    )}
                  </td>
                  <td>
                    {user.medCenters && user.medCenters.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {user.medCenters.map(mc => (
                          <span key={mc.id} className="badge badge-secondary">
                            {mc.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>—</span>
                    )}
                  </td>
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
                  <td style={{ textAlign: 'center' }}>
                    <div className="action-btns" style={{ justifyContent: 'center' }}>
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
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal.user ? 'Редактировать пользователя' : 'Новый пользователь'}</h3>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                {!modal.user && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Отображаемое имя *</label>
                      <input
                        className="input"
                        value={form.displayName}
                        onChange={e => handleDisplayNameChange(e.target.value)}
                        placeholder="Иванов Иван Иванович"
                        autoFocus
                      />
                      <small style={{ color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                        На основе имени будет автоматически сгенерирован уникальный логин
                      </small>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Логин (автоматически)</label>
                      <input
                        className="input"
                        value={form.username}
                        onChange={e => setForm({...form, username: e.target.value})}
                        placeholder="ivanov_i_i"
                        style={{ background: 'var(--bg-secondary)' }}
                      />
                      <small style={{ color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                        Сгенерирован автоматически, можно изменить вручную
                      </small>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Пароль (автоматически)</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="input"
                          type="text"
                          value={form.password}
                          readOnly
                          style={{
                            flex: 1,
                            background: 'var(--bg-secondary)',
                            fontFamily: 'monospace',
                            fontSize: 14
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={copyPassword}
                          title="Скопировать пароль"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={regeneratePassword}
                          title="Сгенерировать новый пароль"
                        >
                          <RefreshCw size={16} />
                        </button>
                      </div>
                      <small style={{ color: 'var(--warning)', marginTop: 4, display: 'block' }}>
                        ⚠️ Скопируйте пароль - он больше не будет показан
                      </small>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Email *</label>
                      <input
                        className="input"
                        type="email"
                        value={form.email}
                        onChange={e => setForm({...form, email: e.target.value})}
                        placeholder="user@example.com"
                      />
                      <small style={{ color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                        Email обязателен для двухфакторной аутентификации
                      </small>
                    </div>
                  </>
                )}

                {modal.user && (
                <>
                  <div className="form-group">
                    <label className="form-label">Отображаемое имя</label>
                    <input className="input" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Логин *</label>
                    <input className="input" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Пароль (оставьте пустым)</label>
                    <input className="input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
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
                </>
              )}

              <MultiSelect
                label="Роли"
                placeholder="Выберите роли"
                value={form.roleIds}
                onChange={(newIds) => setForm({...form, roleIds: newIds})}
                options={roleList}
                optionLabel="name"
                optionDescription="description"
              />

              <MultiSelect
                label="Медицинские центры"
                placeholder="Выберите медцентры"
                value={form.medCenterIds}
                onChange={(newIds) => setForm({...form, medCenterIds: newIds})}
                options={medCenterList}
                optionLabel="name"
                optionDescription="displayName"
              />

              <div className="form-group">
                <label className="checkbox-item">
                  <input type="checkbox" checked={form.isAdmin} onChange={e => setForm({...form, isAdmin: e.target.checked})} />
                  Администратор
                </label>
              </div>

              {/* Гранулярный доступ к админ-разделам */}
              {!form.isAdmin && (
                <div className="form-group" style={{
                  background: 'var(--bg-secondary)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  marginTop: 16
                }}>
                  <div style={{ fontWeight: 500, marginBottom: 12, color: 'var(--text-primary)' }}>
                    Доступ к админ-разделам
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.pages}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, pages: e.target.checked}})}
                      />
                      Страницы
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.sidebar}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, sidebar: e.target.checked}})}
                      />
                      Меню навигации
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.users}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, users: e.target.checked}})}
                      />
                      Пользователи
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.roles}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, roles: e.target.checked}})}
                      />
                      Роли и права
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.media}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, media: e.target.checked}})}
                      />
                      Медиафайлы
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.backup}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, backup: e.target.checked}})}
                      />
                      Резервные копии
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.settings}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, settings: e.target.checked}})}
                      />
                      Настройки
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.courses}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, courses: e.target.checked}})}
                      />
                      Курсы
                    </label>
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.adminAccess.kanban}
                        onChange={e => setForm({...form, adminAccess: {...form.adminAccess, kanban: e.target.checked}})}
                      />
                      Канбан-доска
                    </label>
                  </div>
                  <p style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    margin: '8px 0 0 0',
                    lineHeight: 1.5
                  }}>
                    Выберите к каким админ-разделам будет доступ у пользователя.
                    Полные администраторы имеют доступ ко всем разделам.
                  </p>
                </div>
              )}

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
                    disabled={!modal.user} // Для новых пользователей всегда включена
                  />
                  <Shield size={18} style={{ color: form.twoFactorEnabled ? 'var(--primary)' : 'var(--text-secondary)' }} />
                  <span style={{ fontWeight: 500 }}>Двухфакторная аутентификация (2FA)</span>
                  {!modal.user && (
                    <span style={{ 
                      marginLeft: 'auto', 
                      fontSize: 12, 
                      color: 'var(--primary)',
                      fontWeight: 600 
                    }}>
                      Включена по умолчанию
                    </span>
                  )}
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