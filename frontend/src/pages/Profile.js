import React, { useState } from 'react';
import { User, Lock, Palette, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { auth } from '../services/api';
import toast from 'react-hot-toast';
import './Profile.css';

const colorPresets = [
  { name: 'Синий', color: '#007AFF' },
  { name: 'Фиолетовый', color: '#5856D6' },
  { name: 'Зелёный', color: '#34C759' },
  { name: 'Оранжевый', color: '#FF9500' },
  { name: 'Красный', color: '#FF3B30' },
  { name: 'Розовый', color: '#AF52DE' },
  { name: 'Тёмно-синий', color: '#1a5fb4' },
  { name: 'Бирюзовый', color: '#00BCD4' },
];

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { theme, updateTheme } = useTheme();
  
  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  
  // Profile form
  const [profileForm, setProfileForm] = useState({
    displayName: user?.displayName || '',
    email: user?.email || ''
  });
  
  // Password form
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  // Theme settings (local preference stored in localStorage)
  const [selectedColor, setSelectedColor] = useState(
    localStorage.getItem('userThemeColor') || theme.primaryColor
  );

  const handleProfileSave = async () => {
    setSaving(true);
    try {
      await auth.updateProfile(profileForm);
      if (refreshUser) await refreshUser();
      toast.success('Профиль обновлён');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('Пароль должен быть минимум 6 символов');
      return;
    }
    
    setSaving(true);
    try {
      await auth.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      toast.success('Пароль изменён');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Неверный текущий пароль');
    } finally {
      setSaving(false);
    }
  };

  const handleColorSelect = (color) => {
    setSelectedColor(color);
    localStorage.setItem('userThemeColor', color);
    updateTheme({ ...theme, primaryColor: color });
  };

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1>Настройки</h1>
      </div>

      <div className="profile-tabs">
        <button 
          className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <User size={18} />
          Профиль
        </button>
        <button 
          className={`profile-tab ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <Lock size={18} />
          Безопасность
        </button>
        <button 
          className={`profile-tab ${activeTab === 'appearance' ? 'active' : ''}`}
          onClick={() => setActiveTab('appearance')}
        >
          <Palette size={18} />
          Внешний вид
        </button>
      </div>

      <div className="profile-content">
        {activeTab === 'profile' && (
          <div className="card">
            <div className="card-header">
              <h3>Информация профиля</h3>
            </div>
            <div className="card-body">
              <div className="profile-avatar-section">
                <div className="profile-avatar-large">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" />
                  ) : (
                    <User size={48} />
                  )}
                </div>
                <div className="profile-avatar-info">
                  <div className="profile-username">@{user?.username}</div>
                  <div className="profile-role">{user?.role?.name || (user?.isAdmin ? 'Администратор' : 'Пользователь')}</div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Отображаемое имя</label>
                <input 
                  className="input" 
                  value={profileForm.displayName}
                  onChange={(e) => setProfileForm({...profileForm, displayName: e.target.value})}
                  placeholder="Ваше имя"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input 
                  className="input" 
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({...profileForm, email: e.target.value})}
                  placeholder="email@example.com"
                />
              </div>

              <button 
                className="btn btn-primary" 
                onClick={handleProfileSave}
                disabled={saving}
              >
                {saving ? <div className="loading-spinner-small" /> : <Save size={18} />}
                Сохранить
              </button>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="card">
            <div className="card-header">
              <h3>Изменить пароль</h3>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Текущий пароль</label>
                <input 
                  className="input" 
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Новый пароль</label>
                <input 
                  className="input" 
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Подтвердите новый пароль</label>
                <input 
                  className="input" 
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                />
              </div>

              <button 
                className="btn btn-primary" 
                onClick={handlePasswordChange}
                disabled={saving || !passwordForm.currentPassword || !passwordForm.newPassword}
              >
                {saving ? <div className="loading-spinner-small" /> : <Lock size={18} />}
                Изменить пароль
              </button>
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="card">
            <div className="card-header">
              <h3>Цветовая тема</h3>
            </div>
            <div className="card-body">
              <p className="text-muted" style={{ marginBottom: 20 }}>
                Выберите основной цвет интерфейса. Эта настройка сохраняется только для вашего браузера.
              </p>
              
              <div className="color-presets-grid">
                {colorPresets.map(({ name, color }) => (
                  <button
                    key={color}
                    className={`color-preset-btn ${selectedColor === color ? 'active' : ''}`}
                    style={{ '--preset-color': color }}
                    onClick={() => handleColorSelect(color)}
                  >
                    <span className="color-preset-swatch" style={{ background: color }} />
                    <span className="color-preset-name">{name}</span>
                  </button>
                ))}
              </div>

              <div className="color-custom">
                <label className="form-label">Или выберите свой цвет:</label>
                <div className="color-custom-input">
                  <input 
                    type="color" 
                    value={selectedColor}
                    onChange={(e) => handleColorSelect(e.target.value)}
                  />
                  <input 
                    className="input"
                    value={selectedColor}
                    onChange={(e) => handleColorSelect(e.target.value)}
                    style={{ width: 120 }}
                  />
                </div>
              </div>

              <div className="theme-preview">
                <div className="theme-preview-label">Предпросмотр:</div>
                <div className="theme-preview-box">
                  <button className="btn btn-primary btn-sm">Кнопка</button>
                  <span className="badge badge-primary">Метка</span>
                  <a href="#preview" style={{ color: selectedColor }}>Ссылка</a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}