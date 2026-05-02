import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, UserCheck, UserX, Shield, ShieldOff, Copy, RefreshCw, User, Building2, X as XIcon, ChevronDown, Download, Loader, Camera, Crown } from 'lucide-react';
import { users, roles, BASE_URL } from '../../services/api';
import DatePickerInput from '../../components/DatePickerInput';
import toast from 'react-hot-toast';
import '../Admin.css';

// Компонент для множественного выбора
function MultiSelect({ label, placeholder, value, onChange, options, optionKey = 'id', optionLabel = 'name', optionDescription = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({});
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

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

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setIsOpen(prev => !prev);
  };

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
          ref={triggerRef}
          className={`multi-select-trigger ${isOpen ? 'open' : ''}`}
          onClick={handleToggle}
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
          <div className="multi-select-dropdown" style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            right: 'auto',
            zIndex: 9999,
          }}>
            {options.map(option => (
              <div
                key={option[optionKey]}
                className="multi-select-option"
                onClick={() => toggleOption(option[optionKey])}
              >
                <span className={`admin-toggle-track${value.includes(option[optionKey]) ? ' on' : ''}`} style={{ flexShrink: 0 }} />
                <input type="checkbox" style={{ display: 'none' }} checked={value.includes(option[optionKey])} onChange={() => {}} />
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
  const [filterRole, setFilterRole] = useState('');
  const [filterMedCenter, setFilterMedCenter] = useState('');
  const [modal, setModal] = useState({ open: false, user: null });
  const [misDropdown, setMisDropdown] = useState({ open: false, results: [], searching: false });
  const [avatarHover, setAvatarHover] = useState(false);
  const avatarInputRef = useRef(null);
  const misDropdownRef = useRef(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    email: '',
    avatar: '',
    phone: '',
    position: '',
    specialty: '',
    gender: '',
    birthDate: '',
    bio: '',
    roleIds: [],
    medCenterIds: [],
    isAdmin: false,
    isActive: true,
    twoFactorEnabled: true,
    canEditDoctorCards: false,
    canEditAnalyses: false,
    canEditServices: false,
    canAccessSalary: false,
    canManagePromotions: false,
    adminAccess: {
      pages: false,
      sidebar: false,
      users: false,
      roles: false,
      media: false,
      backup: false,
      settings: false,
      courses: false,
      journal: false,
      reviews: false
    }
  });

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!misDropdown.open) return;
    const handleClickOutside = (e) => {
      if (misDropdownRef.current && !misDropdownRef.current.contains(e.target)) {
        setMisDropdown(prev => ({ ...prev, open: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [misDropdown.open]);

  const handleAvatarFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const res = await users.uploadAvatar(file);
      setForm(prev => ({ ...prev, avatar: res.data.avatarPath }));
    } catch {
      toast.error('Ошибка загрузки фото');
    }
  };

  const searchRenovatio = async () => {
    const q = form.displayName.trim();
    setMisDropdown({ open: true, results: [], searching: true });
    try {
      const res = await users.misSearch(q);
      setMisDropdown({ open: true, results: res.data, searching: false });
    } catch {
      toast.error('Ошибка поиска в Renovatio');
      setMisDropdown({ open: false, results: [], searching: false });
    }
  };

  const selectMisEmployee = async (emp) => {
    setMisDropdown({ open: false, results: [], searching: true });
    try {
      let avatar = '';
      if (emp.avatar_small) {
        try {
          const res = await users.misAvatar(emp.avatar_small);
          avatar = res.data.avatarPath;
        } catch { /* аватар не скачался — не блокируем */ }
      }
      const username = generateUniqueUsername(emp.name || '');
      const specialty = [].concat(emp.profession_titles || []).filter(Boolean).join(', ');
      const gRaw = (emp.gender || '').toString().toLowerCase().trim();
      const gender = (gRaw === 'male' || gRaw === 'm' || gRaw === 'м' || gRaw.startsWith('муж')) ? 'male'
        : (gRaw === 'female' || gRaw === 'f' || gRaw === 'ж' || gRaw.startsWith('жен')) ? 'female'
        : gRaw === '1' ? 'male'
        : gRaw === '2' ? 'female'
        : '';
      // birth_date может прийти как YYYY-MM-DD или DD.MM.YYYY
      let birthDate = '';
      if (emp.birth_date) {
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(emp.birth_date)) {
          const [d, m, y] = emp.birth_date.split('.');
          birthDate = `${y}-${m}-${d}`;
        } else {
          birthDate = emp.birth_date.slice(0, 10);
        }
      }
      setForm(prev => ({
        ...prev,
        displayName: emp.name || '',
        email: emp.email || '',
        avatar,
        username,
        phone: emp.phone || prev.phone,
        specialty: specialty || prev.specialty,
        gender: gender || prev.gender,
        birthDate: birthDate || prev.birthDate,
      }));
      setMisDropdown({ open: false, results: [], searching: false });
    } catch {
      toast.error('Ошибка импорта сотрудника');
      setMisDropdown({ open: false, results: [], searching: false });
    }
  };

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
        avatar: user.avatar || '',
        phone: user.phone || '',
        position: user.position || '',
        specialty: user.specialty || '',
        gender: user.gender || '',
        birthDate: user.birthDate || '',
        bio: user.bio || '',
        roleIds: user.roles ? user.roles.map(r => r.id) : [],
        medCenterIds: user.medCenters ? user.medCenters.map(mc => mc.id) : [],
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        twoFactorEnabled: user.twoFactorEnabled || false,
        canEditDoctorCards: user.canEditDoctorCards || false,
        canEditAnalyses: user.canEditAnalyses || false,
        canEditServices: user.canEditServices || false,
        canAccessSalary: user.canAccessSalary || false,
        canManagePromotions: user.canManagePromotions || false,
        adminAccess: user.adminAccess || {
          pages: false,
          sidebar: false,
          users: false,
          roles: false,
          media: false,
          backup: false,
          settings: false,
          courses: false,
          journal: false,
          reviews: false
        }
      });
    } else {
      const newPassword = generatePassword();
      setForm({
        username: '',
        password: newPassword,
        displayName: '',
        email: '',
        avatar: '',
        phone: '',
        position: '',
        specialty: '',
        gender: '',
        birthDate: '',
        bio: '',
        roleIds: [],
        medCenterIds: [],
        isAdmin: false,
        isActive: true,
        twoFactorEnabled: true,
        canEditDoctorCards: false,
        canEditAnalyses: false,
        canEditServices: false,
        canAccessSalary: false,
        canManagePromotions: false,
        adminAccess: {
          pages: false,
          sidebar: false,
          users: false,
          roles: false,
          media: false,
          backup: false,
          settings: false,
          courses: false,
          journal: false,
          reviews: false
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
      setModal({ open: false, user: null });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const filtered = userList.filter(u => {
    // Фильтрация по поиску
    const matchesSearch = u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(search.toLowerCase());

    // Фильтрация по роли (сравниваем UUID-строки напрямую)
    let matchesRole = true;
    if (filterRole) {
      matchesRole = (u.roles && u.roles.length > 0 && u.roles.some(r => r.id === filterRole)) ||
                    (u.role && u.role.id === filterRole);
    }

    // Фильтрация по медцентру (тоже UUID)
    let matchesMedCenter = true;
    if (filterMedCenter) {
      matchesMedCenter = u.medCenters && u.medCenters.length > 0 && u.medCenters.some(mc => mc.id === filterMedCenter);
    }

    return matchesSearch && matchesRole && matchesMedCenter;
  }).sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, 'ru'));

  return (
    <div className="admin-page users-page">
      <div className="admin-header">
        <h1>Пользователи</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>
          Добавить
        </button>
      </div>

      <div className="admin-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input type="text" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <select
          className="filter-select"
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          <option value="">Все роли</option>
          {roleList.map(role => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={filterMedCenter}
          onChange={e => setFilterMedCenter(e.target.value)}
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          <option value="">Все медцентры</option>
          {medCenterList.map(mc => (
            <option key={mc.id} value={mc.id}>{mc.name}</option>
          ))}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: '25%', textAlign: 'left' }}>Пользователь</th>
                <th style={{ textAlign: 'left' }}>Email</th>
                <th style={{ textAlign: 'left' }}>Роли</th>
                <th style={{ textAlign: 'left' }}>Медцентры</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id} onClick={() => openModal(user)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar">
                        {getAvatarUrl(user) ? (
                          <img src={getAvatarUrl(user)} alt={user.displayName || user.username} />
                        ) : (
                          <User size={20} strokeWidth={2} />
                        )}
                      </div>
                      <div>
                        <div className="user-name">{user.displayName || user.username}</div>
                        <div className="user-login">@{user.username}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                        <span title={user.isAdmin ? 'Администратор' : 'Не администратор'} style={{ display: 'flex', color: user.isAdmin ? 'var(--warning)' : 'var(--text-tertiary)', opacity: user.isAdmin ? 1 : 0.4 }}>
                          <Crown size={15} />
                        </span>
                        {user.twoFactorEnabled ? (
                          <span title="Двухфакторная аутентификация включена" style={{ display: 'flex', color: 'var(--success)' }}>
                            <Shield size={15} />
                          </span>
                        ) : (
                          <span title="2FA выключена" style={{ display: 'flex', color: 'var(--text-tertiary)' }}>
                            <ShieldOff size={15} />
                          </span>
                        )}
                        {user.isActive ? (
                          <span title="Активен" style={{ display: 'flex', color: 'var(--success)' }}>
                            <UserCheck size={15} />
                          </span>
                        ) : (
                          <span title="Неактивен" style={{ display: 'flex', color: 'var(--error)' }}>
                            <UserX size={15} />
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {user.email || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </td>
                  <td>
                    {user.roles && user.roles.length > 0 ? (
                      <span style={{ fontSize: 13 }}>{user.roles.map(r => r.name).join(', ')}</span>
                    ) : user.role ? (
                      <span style={{ fontSize: 13 }}>{user.role.name}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>—</span>
                    )}
                  </td>
                  <td>
                    {user.medCenters && user.medCenters.length > 0 ? (
                      <span style={{ fontSize: 13 }}>{user.medCenters.map(mc => mc.name).join(', ')}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>—</span>
                    )}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 600px', gap: 24 }}>
                {/* Левая колонка */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Аватар + Имя/Логин */}
                  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                <div
                  onMouseEnter={() => setAvatarHover(true)}
                  onMouseLeave={() => setAvatarHover(false)}
                  style={{ flexShrink: 0, position: 'relative', width: 148, height: 148 }}
                >
                  <div
                    onClick={() => avatarInputRef.current?.click()}
                    style={{
                      width: '100%', height: '100%', borderRadius: '50%',
                      background: 'var(--bg-secondary)', overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid var(--border)', cursor: 'pointer',
                    }}
                  >
                    {form.avatar
                      ? <img src={`${BASE_URL}/${form.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <User size={54} style={{ color: 'var(--text-tertiary)' }} />
                    }
                  </div>
                  {avatarHover && (
                    <div
                      onClick={() => avatarInputRef.current?.click()}
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: '50%', cursor: 'pointer',
                      }}
                    >
                      <Camera size={28} style={{ color: '#fff' }} />
                    </div>
                  )}
                  {form.avatar && avatarHover && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setForm({ ...form, avatar: '' }); }}
                      style={{
                        position: 'absolute', top: 4, right: 4,
                        background: 'rgba(0,0,0,0.6)', border: 'none',
                        borderRadius: '50%', width: 22, height: 22,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: '#fff', padding: 0, zIndex: 1,
                      }}
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                  <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarFileChange} />
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {!modal.user ? (
                    <>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Отображаемое имя *</label>
                        <div style={{ position: 'relative' }} ref={misDropdownRef}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              className="input"
                              value={form.displayName}
                              onChange={e => handleDisplayNameChange(e.target.value)}
                              placeholder="Иванов Иван Иванович"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={searchRenovatio}
                              disabled={misDropdown.searching}
                              style={{
                                background: '#90bc38', color: '#fff', border: 'none',
                                borderRadius: 'var(--radius-md)', padding: '0 14px',
                                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6
                              }}
                            >
                              {misDropdown.searching
                                ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                : <><Search size={14} />Renovatio</>
                              }
                            </button>
                          </div>

                          {misDropdown.open && (
                            <div style={{
                              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000,
                              background: 'var(--bg-primary)', border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                              maxHeight: 260, overflowY: 'auto'
                            }}>
                              {misDropdown.results.length === 0 && (
                                <div style={{ padding: '12px 16px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                                  Ничего не найдено
                                </div>
                              )}
                              {misDropdown.results.map(emp => (
                                <div
                                  key={emp.id}
                                  onClick={() => selectMisEmployee(emp)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 12px', cursor: 'pointer', transition: 'background 0.12s'
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                                  onMouseLeave={e => e.currentTarget.style.background = ''}
                                >
                                  <div style={{
                                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                                    background: 'var(--bg-secondary)', overflow: 'hidden',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                  }}>
                                    {emp.avatar_small
                                      ? <img src={emp.avatar_small} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                                      : <User size={16} style={{ color: 'var(--text-tertiary)' }} />
                                    }
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 500, fontSize: 13 }}>{emp.name}</div>
                                    {emp.profession_titles && [].concat(emp.profession_titles).length > 0 && (
                                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                                        {[].concat(emp.profession_titles).join(', ')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Логин</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="input"
                            value={form.username}
                            onChange={e => setForm({...form, username: e.target.value})}
                            placeholder="ivanov_i_i"
                            style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                          />
                          <button type="button" onClick={() => setForm({...form, isActive: !form.isActive})}
                            title={form.isActive ? 'Активен' : 'Неактивен'}
                            style={{ width: 40, height: 40, padding: 0, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: form.isActive ? 'var(--primary, #2563eb)' : 'var(--error)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                            {form.isActive ? <UserCheck size={18} /> : <UserX size={18} />}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Отображаемое имя</label>
                        <input className="input" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Логин *</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input className="input" value={form.username} onChange={e => setForm({...form, username: e.target.value})} style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }} />
                          <button type="button" onClick={() => setForm({...form, isActive: !form.isActive})}
                            title={form.isActive ? 'Активен' : 'Неактивен'}
                            style={{ width: 40, height: 40, padding: 0, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: form.isActive ? 'var(--primary, #2563eb)' : 'var(--error)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                            {form.isActive ? <UserCheck size={18} /> : <UserX size={18} />}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {!modal.user ? (
                      <>
                        <div className="form-group">
                          <label className="form-label">Пароль</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              className="input"
                              type="text"
                              value={form.password}
                              readOnly
                              style={{ flex: 1, background: 'var(--bg-secondary)' }}
                            />
                            <button type="button" className="btn btn-primary" onClick={copyPassword} title="Скопировать пароль" style={{ width: 40, height: 40, padding: 0, flexShrink: 0 }}>
                              <Copy size={16} />
                            </button>
                            <button type="button" className="btn btn-primary" onClick={regeneratePassword} title="Сгенерировать новый пароль" style={{ width: 40, height: 40, padding: 0, flexShrink: 0 }}>
                              <RefreshCw size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Email *</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              className="input"
                              type="email"
                              value={form.email}
                              onChange={e => setForm({...form, email: e.target.value})}
                              placeholder="user@example.com"
                              style={{ flex: 1, background: 'var(--bg-secondary)' }}
                            />
                            <button type="button" disabled title="2FA включена по умолчанию для новых пользователей"
                              style={{ width: 40, height: 40, padding: 0, flexShrink: 0, background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary, #2563eb)', opacity: 0.5, cursor: 'default' }}>
                              <Shield size={18} />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-group">
                          <label className="form-label">Новый пароль</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              className="input"
                              type="text"
                              value={form.password}
                              onChange={e => setForm({...form, password: e.target.value})}
                              placeholder="Оставьте пустым, чтобы не менять"
                              style={{ flex: 1, background: 'var(--bg-secondary)' }}
                            />
                            <button type="button" className="btn btn-primary" onClick={copyPassword} title="Скопировать пароль" disabled={!form.password} style={{ width: 40, height: 40, padding: 0, flexShrink: 0 }}>
                              <Copy size={16} />
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={regeneratePassword} title="Сгенерировать новый пароль" style={{ width: 40, height: 40, padding: 0, flexShrink: 0 }}>
                              <RefreshCw size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Email{form.twoFactorEnabled && <span style={{color: 'var(--error)'}}> *</span>}</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input className="input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ flex: 1, background: 'var(--bg-secondary)' }} />
                            <button type="button"
                              onClick={() => setForm({...form, twoFactorEnabled: !form.twoFactorEnabled})}
                              title={form.twoFactorEnabled ? 'Двухфакторная аутентификация включена' : 'Двухфакторная аутентификация выключена'}
                              style={{ width: 40, height: 40, padding: 0, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: form.twoFactorEnabled ? 'var(--primary, #2563eb)' : 'var(--error)' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                              {form.twoFactorEnabled ? <Shield size={18} /> : <ShieldOff size={18} />}
                            </button>
                          </div>
                          {form.twoFactorEnabled && !form.email && (
                            <small style={{ color: 'var(--error)', marginTop: 4, display: 'block' }}>Email обязателен для 2FA</small>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Телефон</label>
                      <input
                        className="input"
                        value={form.phone}
                        onChange={e => setForm({...form, phone: e.target.value})}
                        placeholder="+7 (999) 000-00-00"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Пол</label>
                      <select
                        className="input"
                        value={form.gender}
                        onChange={e => setForm({...form, gender: e.target.value})}
                        style={{ cursor: 'pointer', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                      >
                        <option value="">Не указан</option>
                        <option value="male">Мужской</option>
                        <option value="female">Женский</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Дата рождения</label>
                      <DatePickerInput
                        value={form.birthDate}
                        onChange={val => setForm({...form, birthDate: val})}
                        placeholder="Выберите дату"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Должность</label>
                    <input
                      className="input"
                      value={form.position}
                      onChange={e => setForm({...form, position: e.target.value})}
                      placeholder="Менеджер, администратор..."
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Специальность</label>
                    <input
                      className="input"
                      value={form.specialty}
                      onChange={e => setForm({...form, specialty: e.target.value})}
                      placeholder="Терапевт, хирург..."
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                    />
                  </div>


                </div>

                {/* Правая колонка — Доступ к админ-разделам */}
                <div className="form-group" style={{
                  background: 'var(--bg-secondary)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)'
                }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: 13,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-secondary)',
                    paddingBottom: 12,
                    marginBottom: 16,
                    borderBottom: '1px solid var(--border)'
                  }}>
                    Доступ к админ-разделам
                  </div>

                  <label className="admin-toggle-item admin-main" style={{ marginBottom: 16 }}>
                    <span className={`admin-toggle-track${form.isAdmin ? ' on' : ''}`} />
                    <input type="checkbox" style={{ display: 'none' }}
                      checked={form.isAdmin}
                      onChange={e => setForm({...form, isAdmin: e.target.checked})}
                    />
                    <span className="admin-toggle-label">Администратор (полный доступ ко всем разделам)</span>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 12px' }}>
                    {[
                      { key: 'pages', label: 'Страницы' },
                      { key: 'sidebar', label: 'Меню навигации' },
                      { key: 'users', label: 'Пользователи' },
                      { key: 'roles', label: 'Роли и права' },
                      { key: 'media', label: 'Медиафайлы' },
                      { key: 'backup', label: 'Резервные копии' },
                      { key: 'settings', label: 'Настройки' },
                      { key: 'courses', label: 'Курсы' },
                      { key: 'journal', label: 'Журнал страниц' },
                      { key: 'reviews', label: 'Отзывы' },
                    ].map(({ key, label }) => {
                      const checked = form.isAdmin || (form.adminAccess[key] ?? false);
                      return (
                        <label key={key} className="admin-toggle-item">
                          <span className={`admin-toggle-track${checked ? ' on' : ''}${form.isAdmin ? ' forced' : ''}`} />
                          <input type="checkbox" style={{ display: 'none' }}
                            checked={checked}
                            onChange={e => !form.isAdmin && setForm({...form, adminAccess: {...form.adminAccess, [key]: e.target.checked}})}
                            disabled={form.isAdmin}
                          />
                          <span className="admin-toggle-label">{label}</span>
                        </label>
                      );
                    })}
                    <label className="admin-toggle-item">
                      <span className={`admin-toggle-track${(form.isAdmin || form.canEditDoctorCards) ? ' on' : ''}${form.isAdmin ? ' forced' : ''}`} />
                      <input type="checkbox" style={{ display: 'none' }}
                        checked={form.isAdmin || form.canEditDoctorCards}
                        onChange={e => !form.isAdmin && setForm({...form, canEditDoctorCards: e.target.checked})}
                        disabled={form.isAdmin}
                      />
                      <span className="admin-toggle-label">Карточки врачей</span>
                    </label>
                    <label className="admin-toggle-item">
                      <span className={`admin-toggle-track${(form.isAdmin || form.canEditAnalyses) ? ' on' : ''}${form.isAdmin ? ' forced' : ''}`} />
                      <input type="checkbox" style={{ display: 'none' }}
                        checked={form.isAdmin || form.canEditAnalyses}
                        onChange={e => !form.isAdmin && setForm({...form, canEditAnalyses: e.target.checked})}
                        disabled={form.isAdmin}
                      />
                      <span className="admin-toggle-label">Анализы</span>
                    </label>
                    <label className="admin-toggle-item">
                      <span className={`admin-toggle-track${(form.isAdmin || form.canEditServices) ? ' on' : ''}${form.isAdmin ? ' forced' : ''}`} />
                      <input type="checkbox" style={{ display: 'none' }}
                        checked={form.isAdmin || form.canEditServices}
                        onChange={e => !form.isAdmin && setForm({...form, canEditServices: e.target.checked})}
                        disabled={form.isAdmin}
                      />
                      <span className="admin-toggle-label">Услуги</span>
                    </label>
                    <label className="admin-toggle-item">
                      <span className={`admin-toggle-track${(form.isAdmin || form.canAccessSalary) ? ' on' : ''}${form.isAdmin ? ' forced' : ''}`} />
                      <input type="checkbox" style={{ display: 'none' }}
                        checked={form.isAdmin || form.canAccessSalary}
                        onChange={e => !form.isAdmin && setForm({...form, canAccessSalary: e.target.checked})}
                        disabled={form.isAdmin}
                      />
                      <span className="admin-toggle-label">Зарплата</span>
                    </label>
                    <label className="admin-toggle-item">
                      <span className={`admin-toggle-track${(form.isAdmin || form.canManagePromotions) ? ' on' : ''}${form.isAdmin ? ' forced' : ''}`} />
                      <input type="checkbox" style={{ display: 'none' }}
                        checked={form.isAdmin || form.canManagePromotions}
                        onChange={e => !form.isAdmin && setForm({...form, canManagePromotions: e.target.checked})}
                        disabled={form.isAdmin}
                      />
                      <span className="admin-toggle-label">Акции</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {modal.user && (
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(modal.user)}
                  style={{ marginRight: 'auto', width: 120 }}
                >
                  Удалить
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setModal({ open: false, user: null })} style={{ width: 120 }}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSave} style={{ width: 120 }}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}