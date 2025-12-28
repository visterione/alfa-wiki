import React, { useState, useRef } from 'react';
import { User, Lock, Camera, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth, media } from '../services/api';
import toast from 'react-hot-toast';
import './Profile.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export default function Profile() {
  const { user, refreshUser } = useAuth();
  
  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef(null);
  
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

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Максимальный размер файла 5MB');
      return;
    }

    setUploadingAvatar(true);
    try {
      const { data } = await media.upload(file);
      const avatarUrl = `${API_URL}/${data.path}`;
      
      await auth.updateProfile({ avatar: avatarUrl });
      if (refreshUser) await refreshUser();
      
      toast.success('Фото профиля обновлено');
    } catch (e) {
      toast.error('Ошибка загрузки фото');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getAvatarUrl = () => {
    if (!user?.avatar) return null;
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${API_URL}/${user.avatar}`;
  };

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1>Настройки профиля</h1>
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
      </div>

      <div className="profile-content">
        {activeTab === 'profile' && (
          <div className="card">
            <div className="card-header">
              <h3>Информация профиля</h3>
            </div>
            <div className="card-body">
              <div className="profile-avatar-section">
                <div 
                  className={`profile-avatar-large editable ${uploadingAvatar ? 'uploading' : ''}`}
                  onClick={handleAvatarClick}
                >
                  {uploadingAvatar ? (
                    <div className="loading-spinner" />
                  ) : getAvatarUrl() ? (
                    <img src={getAvatarUrl()} alt="" />
                  ) : (
                    <User size={48} />
                  )}
                  <div className="avatar-overlay">
                    <Camera size={24} />
                  </div>
                </div>
                <input 
                  ref={fileInputRef}
                  type="file" 
                  accept="image/*" 
                  hidden 
                  onChange={handleAvatarChange}
                />
                <div className="profile-avatar-info">
                  <div className="profile-username">@{user?.username}</div>
                  <div className="profile-role">{user?.role?.name || (user?.isAdmin ? 'Администратор' : 'Пользователь')}</div>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={handleAvatarClick}
                    disabled={uploadingAvatar}
                  >
                    <Camera size={14} />
                    Изменить фото
                  </button>
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
                {saving ? <div className="loading-spinner" style={{width: 18, height: 18}} /> : <Save size={18} />}
                Сохранить
              </button>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="card">
            <div className="card-header">
              <h3>Смена пароля</h3>
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
                {saving ? <div className="loading-spinner" style={{width: 18, height: 18}} /> : <Lock size={18} />}
                Изменить пароль
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}