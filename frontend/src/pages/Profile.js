import React, { useState, useRef, useEffect, useCallback } from 'react';
import { User, Lock, Camera, Save, Eye, EyeOff, Phone, Briefcase, FileText, Building2, Calendar, Monitor, Smartphone, LogOut, Stethoscope } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth, media, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './Profile.css';
import DoctorProfileTab from './DoctorProfileTab';

function getPasswordStrength(password) {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { level: 'weak', label: 'Слабый', width: '33%' };
  if (score <= 3) return { level: 'medium', label: 'Средний', width: '66%' };
  return { level: 'strong', label: 'Надёжный', width: '100%' };
}

function formatSessionActivity(iso) {
  if (!iso) return 'активности не было';
  const diffMin = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMin < 5) return 'активна сейчас';
  if (diffMin < 60) return `${diffMin} мин назад`;
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function getInitials(displayName, username) {
  const name = displayName || username || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Profile() {
  const { user, refreshUser } = useAuth();

  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef(null);

  const [profileForm, setProfileForm] = useState({
    displayName: user?.displayName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    position: user?.position || '',
    bio: user?.bio || ''
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  // Активные сессии — «мои устройства». Появились в ver. 6.49 вместе с реестром
  // токенов: до него выданный токен нельзя было отозвать вообще никак.
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const toggleShowPassword = (field) =>
    setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }));

  const passwordStrength = getPasswordStrength(passwordForm.newPassword);

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
      // Сервер при смене пароля снимает все остальные сессии — список надо
      // перечитать, иначе в нём останутся уже мёртвые устройства.
      toast.success('Пароль изменён. Другие устройства отключены');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      loadSessions();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Неверный текущий пароль');
    } finally {
      setSaving(false);
    }
  };

  const loadSessions = useCallback(() => {
    setSessionsLoading(true);
    auth.sessions()
      .then(({ data }) => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'security') loadSessions();
  }, [activeTab, loadSessions]);

  const handleRevokeSession = async (id) => {
    try {
      await auth.revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      toast.success('Сессия завершена');
    } catch (e) {
      toast.error('Не удалось завершить сессию');
    }
  };

  const handleRevokeAll = async () => {
    if (!window.confirm('Выйти на всех остальных устройствах?')) return;
    try {
      const { data } = await auth.revokeAllSessions();
      setSessions(prev => prev.filter(s => s.isCurrent));
      toast.success(data.revoked ? `Отключено устройств: ${data.revoked}` : 'Других устройств нет');
    } catch (e) {
      toast.error('Не удалось завершить сессии');
    }
  };

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Выберите изображение'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Максимальный размер файла 5MB'); return; }

    setUploadingAvatar(true);
    try {
      const { data } = await media.upload(file);
      await auth.updateProfile({ avatar: data.path });
      if (refreshUser) await refreshUser();
      toast.success('Фото профиля обновлено');
    } catch (e) {
      toast.error('Ошибка загрузки фото');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getAvatarUrl = () => {
    if (!user?.avatar) return null;
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  const avatarUrl = getAvatarUrl();
  const initials = getInitials(user?.displayName, user?.username);

  const roleLabel = user?.isAdmin
    ? 'Администратор'
    : user?.roles?.length > 0
      ? user.roles.map(r => r.name).join(', ')
      : user?.role?.name || 'Пользователь';

  const joinDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const medCenters = user?.medCenters || [];
  const userRoleNames = [user?.role, ...(user?.roles || [])].filter(Boolean).map(role => role.name);
  const canViewDoctorTab = Boolean(user?.isAdmin || userRoleNames.includes('Врач'));

  return (
    <div className="profile-page">

      {/* Постоянный заголовок профиля */}
      <div className="profile-hero">
        <div className="profile-hero-avatar-wrap">
          <div
            className={`profile-hero-avatar ${uploadingAvatar ? 'uploading' : ''}`}
            onClick={handleAvatarClick}
          >
            {uploadingAvatar ? (
              <div className="loading-spinner" />
            ) : avatarUrl ? (
              <img src={avatarUrl} alt="" />
            ) : (
              <span className="profile-hero-initials">{initials}</span>
            )}
            <div className="avatar-overlay">
              <Camera size={22} />
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
        </div>

        <div className="profile-hero-info">
          <div className="profile-hero-name">{user?.displayName || user?.username}</div>
          <div className="profile-hero-username">@{user?.username}</div>

          <div className="profile-hero-meta">
            <span className="profile-hero-role-badge">{roleLabel}</span>
            {joinDate && (
              <span className="profile-hero-meta-item">
                <Calendar size={13} />
                В системе с {joinDate}
              </span>
            )}
          </div>

          {medCenters.length > 0 && (
            <div className="profile-hero-medcenters">
              <Building2 size={13} />
              {medCenters.map(mc => (
                <span key={mc.id} className="profile-medcenter-badge">{mc.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Табы */}
      <div className="profile-tabs">
        <button
          className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <User size={16} />
          Профиль
        </button>
        <button
          className={`profile-tab ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <Lock size={16} />
          Безопасность
        </button>
        {canViewDoctorTab && (
          <button
            className={`profile-tab ${activeTab === 'doctor' ? 'active' : ''}`}
            onClick={() => setActiveTab('doctor')}
          >
            <Stethoscope size={16} />
            Врач
          </button>
        )}
      </div>

      <div className="profile-content">

        {activeTab === 'doctor' && <DoctorProfileTab isAdmin={Boolean(user?.isAdmin)} />}

        {/* Таб: Профиль */}
        {activeTab === 'profile' && (
          <>
            <div className="card">
              <div className="card-header">
                <h3>Основная информация</h3>
              </div>
              <div className="card-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Отображаемое имя</label>
                    <input
                      className="input"
                      value={profileForm.displayName}
                      onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                      placeholder="Ваше имя"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      className="input"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      placeholder="email@example.com"
                    />
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleProfileSave}
                  disabled={saving}
                >
                  {saving ? <div className="loading-spinner" style={{ width: 18, height: 18 }} /> : <Save size={16} />}
                  Сохранить
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Дополнительная информация</h3>
              </div>
              <div className="card-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">
                      <Phone size={14} />
                      Телефон
                    </label>
                    <input
                      className="input"
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      placeholder="+7 (999) 000-00-00"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      <Briefcase size={14} />
                      Должность
                    </label>
                    <input
                      className="input"
                      value={profileForm.position}
                      onChange={(e) => setProfileForm({ ...profileForm, position: e.target.value })}
                      placeholder="Ваша должность"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <FileText size={14} />
                    О себе
                  </label>
                  <textarea
                    className="input profile-bio-textarea"
                    value={profileForm.bio}
                    onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                    placeholder="Краткое описание"
                    rows={3}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleProfileSave}
                  disabled={saving}
                >
                  {saving ? <div className="loading-spinner" style={{ width: 18, height: 18 }} /> : <Save size={16} />}
                  Сохранить
                </button>
              </div>
            </div>
          </>
        )}

        {/* Таб: Безопасность */}
        {activeTab === 'security' && (
          <div className="card">
            <div className="card-header">
              <h3>Смена пароля</h3>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Текущий пароль</label>
                <div className="input-password-wrap">
                  <input
                    className="input"
                    type={showPasswords.current ? 'text' : 'password'}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="input-password-toggle"
                    onClick={() => toggleShowPassword('current')}
                    tabIndex={-1}
                  >
                    {showPasswords.current ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Новый пароль</label>
                <div className="input-password-wrap">
                  <input
                    className="input"
                    type={showPasswords.new ? 'text' : 'password'}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="input-password-toggle"
                    onClick={() => toggleShowPassword('new')}
                    tabIndex={-1}
                  >
                    {showPasswords.new ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordStrength && (
                  <div className="password-strength">
                    <div className="password-strength-bar">
                      <div
                        className={`password-strength-fill strength-${passwordStrength.level}`}
                        style={{ width: passwordStrength.width }}
                      />
                    </div>
                    <span className={`password-strength-label strength-${passwordStrength.level}`}>
                      {passwordStrength.label}
                    </span>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Подтвердите новый пароль</label>
                <div className="input-password-wrap">
                  <input
                    className="input"
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="input-password-toggle"
                    onClick={() => toggleShowPassword('confirm')}
                    tabIndex={-1}
                  >
                    {showPasswords.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handlePasswordChange}
                disabled={saving || !passwordForm.currentPassword || !passwordForm.newPassword}
              >
                {saving ? <div className="loading-spinner" style={{ width: 18, height: 18 }} /> : <Lock size={16} />}
                Изменить пароль
              </button>
            </div>
          </div>
        )}

        {/* Активные сессии */}
        {activeTab === 'security' && (
          <div className="card">
            <div className="card-header profile-sessions-header">
              <h3>Активные сессии</h3>
              {sessions.filter(s => !s.isCurrent).length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={handleRevokeAll}>
                  <LogOut size={14} />
                  Выйти везде
                </button>
              )}
            </div>
            <div className="card-body">
              {sessionsLoading ? (
                <div className="loading-spinner" style={{ width: 20, height: 20 }} />
              ) : sessions.length === 0 ? (
                <p className="profile-sessions-empty">
                  Список пуст. Так бывает, если вход был выполнен до обновления —
                  переавторизуйтесь, и сессия появится здесь.
                </p>
              ) : (
                <div className="profile-sessions">
                  {sessions.map(s => (
                    <div key={s.id} className="profile-session">
                      <div className="profile-session-icon">
                        {s.platform === 'mobile' ? <Smartphone size={18} /> : <Monitor size={18} />}
                      </div>
                      <div className="profile-session-info">
                        <div className="profile-session-name">
                          {s.deviceName || (s.platform === 'mobile' ? 'Мобильное приложение' : 'Браузер')}
                          {s.isCurrent && <span className="profile-session-badge">это устройство</span>}
                        </div>
                        <div className="profile-session-meta">
                          {formatSessionActivity(s.lastActivityAt)}
                          {s.ip ? ` · ${s.ip}` : ''}
                        </div>
                      </div>
                      {!s.isCurrent && (
                        <button
                          className="profile-session-revoke"
                          onClick={() => handleRevokeSession(s.id)}
                          title="Завершить сессию"
                        >
                          <LogOut size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
