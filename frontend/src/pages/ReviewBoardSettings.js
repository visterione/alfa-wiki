import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Users, UserPlus, X, Search, Trash2,
  RefreshCw, CheckCircle, AlertCircle, Eye, EyeOff, Play, User, Bell, ChevronDown
} from 'lucide-react';
import { reviews, users } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import './ReviewBoardSettings.css';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:9001';

const ReviewBoardSettings = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Board info
  const [boardName, setBoardName] = useState('');
  const [boardDescription, setBoardDescription] = useState('');

  // Permissions
  const [permissions, setPermissions] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedRole, setSelectedRole] = useState('editor');

  // Notification settings (per-user)
  const [notificationSettings, setNotificationSettings] = useState({
    newPositiveReview: { roles: [], users: [] },
    newNegativeReview: { roles: [], users: [] },
    statusChange: { roles: [], users: [] },
    workComplete: { roles: [], users: [] },
    archiveReview: { roles: [], users: [] }
  });
  const [openNotifFor, setOpenNotifFor] = useState(null);

  // Sync state
  const [syncConfigs, setSyncConfigs] = useState([]);
  const [syncEdits, setSyncEdits] = useState({});       // { provider: { credentials, isEnabled } }
  const [syncVisible, setSyncVisible] = useState({});   // { provider: { fieldKey: bool } }
  const [syncTesting, setSyncTesting] = useState({});   // { provider: bool }
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncFilials, setSyncFilials] = useState(null); // список филиалов после тестирования

  // Active tab
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    loadData();
  }, [boardId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [boardRes, permissionsRes, usersRes, syncRes, settingsRes] = await Promise.all([
        reviews.getBoard(boardId),
        reviews.getBoardPermissions(boardId),
        users.listBasic({ access: 'reviews' }),
        reviews.getSyncConfigs(boardId).catch(() => ({ data: [] })),
        reviews.getBoardSettings(boardId).catch(() => ({ data: {} }))
      ]);

      const boardData = boardRes.data;
      setBoard(boardData);
      setBoardName(boardData.name);
      setBoardDescription(boardData.description || '');
      setPermissions(permissionsRes.data);
      setUsersList(usersRes.data);
      setSyncConfigs(syncRes.data || []);
      const ns = settingsRes.data?.notificationSettings;
      if (ns) setNotificationSettings({
        newPositiveReview: ns.newPositiveReview || { roles: [], users: [] },
        newNegativeReview: ns.newNegativeReview || { roles: [], users: [] },
        statusChange: ns.statusChange || { roles: [], users: [] },
        workComplete: ns.workComplete || { roles: [], users: [] },
        archiveReview: ns.archiveReview || { roles: [], users: [] }
      });

      if (boardData.userRole !== 'owner' && !user.isAdmin) {
        toast.error('Только владелец может редактировать настройки');
        navigate(`/reviews/board/${boardId}`);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      toast.error('Ошибка при загрузке настроек');
      navigate('/reviews');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBoard = async () => {
    if (!window.confirm(`Удалить доску "${board.name}" и все её отзывы? Это действие необратимо.`)) return;
    try {
      await reviews.deleteBoard(boardId);
      toast.success('Доска удалена');
      navigate('/reviews');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка при удалении доски');
    }
  };

  const handleSaveGeneral = async () => {
    if (!boardName.trim()) {
      toast.error('Название доски обязательно');
      return;
    }

    try {
      setSaving(true);
      await reviews.updateBoard(boardId, {
        name: boardName.trim(),
        description: boardDescription.trim() || null
      });
      toast.success('Настройки сохранены');
    } catch (err) {
      console.error('Error saving:', err);
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  // Permissions management
  const handleAddPermission = async () => {
    if (!selectedUserId) {
      toast.error('Выберите пользователя');
      return;
    }

    try {
      const response = await reviews.addBoardPermission(boardId, {
        userId: selectedUserId,
        role: selectedRole
      });
      setPermissions([...permissions, response.data]);
      setShowAddUser(false);
      setSearchQuery('');
      setSelectedUserId(null);
      toast.success('Пользователь добавлен');
    } catch (err) {
      console.error('Error adding permission:', err);
      toast.error(err.response?.data?.error || 'Ошибка при добавлении');
    }
  };

  const handleChangePermissionRole = async (permId, newRole) => {
    try {
      await reviews.updateBoardPermission(boardId, permId, { role: newRole });
      setPermissions(permissions.map(p =>
        p.id === permId ? { ...p, role: newRole } : p
      ));
      toast.success('Роль изменена');
    } catch (err) {
      console.error('Error updating permission:', err);
      toast.error('Ошибка при изменении роли');
    }
  };

  const handleRemovePermission = async (permId) => {
    if (!window.confirm('Удалить доступ пользователя?')) return;

    try {
      await reviews.deleteBoardPermission(boardId, permId);
      setPermissions(permissions.filter(p => p.id !== permId));
      toast.success('Доступ удалён');
    } catch (err) {
      console.error('Error removing permission:', err);
      toast.error(err.response?.data?.error || 'Ошибка при удалении');
    }
  };

  const NOTIF_EVENTS = [
    { key: 'newPositiveReview', label: 'Новый положительный отзыв' },
    { key: 'newNegativeReview', label: 'Новый отрицательный отзыв' },
    { key: 'statusChange', label: 'Изменение статуса' },
    { key: 'workComplete', label: 'Завершение работы' },
    { key: 'archiveReview', label: 'Архив' }
  ];

  const getNotifCount = (uid) =>
    NOTIF_EVENTS.filter(e => notificationSettings[e.key]?.users?.includes(uid)).length;

  const toggleNotificationUser = (event, userId) => {
    setNotificationSettings(prev => {
      const ev = prev[event] || { roles: [], users: [] };
      const us = ev.users?.includes(userId)
        ? ev.users.filter(u => u !== userId)
        : [...(ev.users || []), userId];
      return { ...prev, [event]: { ...ev, users: us } };
    });
  };

  const handleSaveNotifications = async () => {
    try {
      setSaving(true);
      await reviews.updateBoardSettings(boardId, { notificationSettings });
      toast.success('Настройки уведомлений сохранены');
    } catch (err) {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  // ── Sync handlers ─────────────────────────────────────────────────────────

  const getSyncEdit = (provider) => syncEdits[provider] || {};

  const setSyncField = (provider, field, value) => {
    setSyncEdits(prev => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value }
    }));
  };

  const setSyncCredField = (provider, key, value) => {
    setSyncEdits(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        credentials: { ...(prev[provider]?.credentials || {}), [key]: value }
      }
    }));
  };

  const toggleFieldVisibility = (provider, fieldKey) => {
    setSyncVisible(prev => ({
      ...prev,
      [provider]: { ...(prev[provider] || {}), [fieldKey]: !(prev[provider]?.[fieldKey]) }
    }));
  };

  const getSyncCredentials = (config) => {
    const edited = syncEdits[config.provider]?.credentials;
    if (edited) {
      // Мержим: берём то что пользователь не менял из конфига, изменённое — из edits
      const merged = { ...config.credentials };
      Object.entries(edited).forEach(([k, v]) => { if (v !== undefined) merged[k] = v; });
      return merged;
    }
    return config.credentials;
  };

  const handleSaveSyncConfig = async (config) => {
    try {
      const edit = getSyncEdit(config.provider);
      const credentials = getSyncCredentials(config);
      const isEnabled = edit.isEnabled !== undefined ? edit.isEnabled : config.isEnabled;

      await reviews.saveSyncConfig(boardId, config.provider, { isEnabled, credentials });

      // Обновляем локальный стейт
      setSyncConfigs(prev => prev.map(c =>
        c.provider === config.provider ? { ...c, isEnabled, credentials: { ...c.credentials, ...credentials } } : c
      ));
      setSyncEdits(prev => { const next = { ...prev }; delete next[config.provider]; return next; });
      toast.success(`Настройки ${config.label} сохранены`);
    } catch (err) {
      toast.error('Ошибка при сохранении');
    }
  };

  const handleTestSync = async (config) => {
    setSyncTesting(prev => ({ ...prev, [config.provider]: true }));
    setSyncFilials(null);
    try {
      const credentials = getSyncCredentials(config);
      const res = await reviews.testSyncConnection(boardId, config.provider, credentials);
      if (res.data.success) {
        toast.success(`${config.label}: ${res.data.message}`);
        if (res.data.filials?.length) setSyncFilials(res.data.filials);
      } else {
        toast.error(`${config.label}: ${res.data.message}`);
      }
    } catch (err) {
      toast.error('Ошибка проверки подключения');
    } finally {
      setSyncTesting(prev => ({ ...prev, [config.provider]: false }));
    }
  };

  const handleRunSyncProvider = async (config) => {
    setSyncRunning(true);
    try {
      await reviews.runSyncProvider(boardId, config.provider);
      toast.success(`Синхронизация ${config.label} запущена — результат появится через несколько секунд`);
      // Обновим статус через 5 сек
      setTimeout(async () => {
        try {
          const res = await reviews.getSyncConfigs(boardId);
          setSyncConfigs(res.data || []);
        } catch (_) {}
        setSyncRunning(false);
      }, 5000);
    } catch (err) {
      toast.error('Ошибка запуска синхронизации');
      setSyncRunning(false);
    }
  };

  const handleRunAllSync = async () => {
    setSyncRunning(true);
    try {
      await reviews.runSync(boardId);
      toast.success('Синхронизация всех площадок запущена');
      setTimeout(async () => {
        try {
          const res = await reviews.getSyncConfigs(boardId);
          setSyncConfigs(res.data || []);
        } catch (_) {}
        setSyncRunning(false);
      }, 8000);
    } catch (err) {
      toast.error('Ошибка запуска синхронизации');
      setSyncRunning(false);
    }
  };

  // ── End sync handlers ──────────────────────────────────────────────────────

  const getAvatarUrl = (avatarPath) => {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    return `${BASE_URL}/${avatarPath}`;
  };

  const availableUsers = usersList.filter(u => {
    const search = searchQuery.toLowerCase();
    const matchesSearch = (u.displayName || '').toLowerCase().includes(search) ||
      (u.username || '').toLowerCase().includes(search);
    const notAlreadyAdded = !permissions.find(p => p.userId === u.id);
    const notOwner = u.id !== board?.ownerId;
    return matchesSearch && notAlreadyAdded && notOwner;
  });

  if (loading) {
    return (
      <div className="review-settings-loading">
        <div className="loading-spinner" />
        <p>Загрузка настроек...</p>
      </div>
    );
  }

  return (
    <div className="review-settings-page">
      <div className="settings-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate(`/reviews/board/${boardId}`)}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1>Настройки доски</h1>
            <p>{board?.name}</p>
          </div>
        </div>
      </div>

      <div className="settings-tabs">
        <button
          className={`tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Основные
        </button>
        <button
          className={`tab ${activeTab === 'permissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('permissions')}
        >
          <Users size={16} />
          Доступ
        </button>
        <button
          className={`tab ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >
          <RefreshCw size={16} />
          Синхронизация
        </button>
      </div>

      <div className="settings-content">
        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="settings-section">
            <h2>Основные настройки</h2>

            <div className="form-group">
              <label>Название доски</label>
              <input
                type="text"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                placeholder="Название доски"
              />
            </div>

            <div className="form-group">
              <label>Описание</label>
              <textarea
                value={boardDescription}
                onChange={(e) => setBoardDescription(e.target.value)}
                placeholder="Описание доски (необязательно)"
                rows={3}
              />
            </div>

            <button
              className="btn-save"
              onClick={handleSaveGeneral}
              disabled={saving}
            >
              <Save size={16} />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>

            <div className="danger-zone">
              <div className="danger-action">
                <div className="danger-action-info">
                  <strong>Удалить доску</strong>
                  <p>Безвозвратно удалит доску и все её отзывы</p>
                </div>
                <button className="btn-delete-board" onClick={handleDeleteBoard}>
                  <Trash2 size={16} />
                  Удалить доску
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Permissions Tab */}
        {activeTab === 'permissions' && (
          <div className="settings-section">
            <div className="section-header">
              <h2>Управление доступом</h2>
              <button className="btn-add" onClick={() => setShowAddUser(true)}>
                <UserPlus size={16} />
                Добавить
              </button>
            </div>

            {/* Overlay to close notification dropdown on outside click */}
            {openNotifFor && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setOpenNotifFor(null)} />
            )}

            <div className="permissions-list">
              {/* Owner */}
              <div className="permission-item">
                <div className="perm-user-info">
                  {getAvatarUrl(board?.owner?.avatar) ? (
                    <img src={getAvatarUrl(board?.owner?.avatar)} alt="" className="perm-avatar-img" />
                  ) : (
                    <div className="perm-avatar"><User size={18} /></div>
                  )}
                  <div className="perm-user-details">
                    <span className="name">{board?.owner?.displayName || board?.owner?.username}</span>
                    <span className="email">{board?.owner?.email}</span>
                  </div>
                </div>
                <div className="perm-actions-group">
                  {/* Notification dropdown */}
                  <div className="notif-dropdown-wrap" onMouseDown={e => e.stopPropagation()}>
                    <button
                      className={`notif-btn${getNotifCount(board?.ownerId) > 0 ? ' active' : ''}`}
                      onClick={() => setOpenNotifFor(p => p === board?.ownerId ? null : board?.ownerId)}
                    >
                      <Bell size={12} />
                      {getNotifCount(board?.ownerId) > 0 && <span>{getNotifCount(board?.ownerId)}</span>}
                      <ChevronDown size={10} />
                    </button>
                    {openNotifFor === board?.ownerId && (
                      <div className="notif-panel">
                        {NOTIF_EVENTS.map(({ key, label }) => {
                          const checked = notificationSettings[key]?.users?.includes(board?.ownerId) || false;
                          return (
                            <label key={key} className="notif-option">
                              <span>{label}</span>
                              <span className={`notif-toggle${checked ? ' on' : ''}`} />
                              <input type="checkbox" checked={checked} onChange={() => toggleNotificationUser(key, board?.ownerId)} />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="role-badge owner">Владелец</div>
                </div>
              </div>

              {/* Other users */}
              {permissions.filter(p => p.role !== 'owner').map(perm => (
                <div key={perm.id} className="permission-item">
                  <div className="perm-user-info">
                    {getAvatarUrl(perm.user?.avatar) ? (
                      <img src={getAvatarUrl(perm.user?.avatar)} alt="" className="perm-avatar-img" />
                    ) : (
                      <div className="perm-avatar"><User size={18} /></div>
                    )}
                    <div className="perm-user-details">
                      <span className="name">{perm.user?.displayName || perm.user?.username}</span>
                    </div>
                  </div>
                  <div className="perm-actions-group">
                    {/* Notification dropdown */}
                    <div className="notif-dropdown-wrap" onMouseDown={e => e.stopPropagation()}>
                      <button
                        className={`notif-btn${getNotifCount(perm.userId) > 0 ? ' active' : ''}`}
                        onClick={() => setOpenNotifFor(p => p === perm.userId ? null : perm.userId)}
                      >
                        <Bell size={12} />
                        {getNotifCount(perm.userId) > 0 && <span>{getNotifCount(perm.userId)}</span>}
                        <ChevronDown size={10} />
                      </button>
                      {openNotifFor === perm.userId && (
                        <div className="notif-panel">
                          {NOTIF_EVENTS.map(({ key, label }) => {
                            const checked = notificationSettings[key]?.users?.includes(perm.userId) || false;
                            return (
                              <label key={key} className="notif-option">
                                <span>{label}</span>
                                <span className={`notif-toggle${checked ? ' on' : ''}`} />
                                <input type="checkbox" checked={checked} onChange={() => toggleNotificationUser(key, perm.userId)} />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <select
                      className="perm-role-select"
                      value={perm.role}
                      onChange={(e) => handleChangePermissionRole(perm.id, e.target.value)}
                    >
                      <option value="editor">Редактор</option>
                      <option value="viewer">Наблюдатель</option>
                    </select>
                    <button className="perm-remove-btn" onClick={() => handleRemovePermission(perm.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}

              {permissions.filter(p => p.role !== 'owner').length === 0 && (
                <div className="empty-state">
                  <p>Нет добавленных пользователей</p>
                </div>
              )}
            </div>

            <div className="perm-notifications-footer">
              <button className="btn-save" onClick={handleSaveNotifications} disabled={saving}>
                <Save size={14} />
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>

            {/* Add user modal */}
            {showAddUser && (
              <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
                <div className="modal-content small" onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Добавить пользователя</h3>
                    <button className="btn-close" onClick={() => setShowAddUser(false)}>
                      <X size={20} />
                    </button>
                  </div>

                  <div className="modal-body">
                    <div className="search-box">
                      <Search size={16} />
                      <input
                        type="text"
                        placeholder="Поиск пользователя..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setSelectedUserId(null);
                        }}
                      />
                    </div>

                    {searchQuery && (
                      <div className="users-dropdown">
                        {availableUsers.slice(0, 5).map(u => (
                          <div
                            key={u.id}
                            className={`user-option ${selectedUserId === u.id ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedUserId(u.id);
                              setSearchQuery(u.displayName || u.username);
                            }}
                          >
                            {u.displayName || u.username}
                          </div>
                        ))}
                        {availableUsers.length === 0 && (
                          <div className="no-results">Пользователи не найдены</div>
                        )}
                      </div>
                    )}

                    <div className="form-group">
                      <label>Роль</label>
                      <select
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                      >
                        <option value="editor">Редактор</option>
                        <option value="viewer">Наблюдатель</option>
                      </select>
                    </div>
                  </div>

                  <div className="modal-footer">
                    <button className="btn-cancel" onClick={() => setShowAddUser(false)}>
                      Отмена
                    </button>
                    <button
                      className="btn-submit"
                      onClick={handleAddPermission}
                      disabled={!selectedUserId}
                    >
                      Добавить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sync Tab */}
        {activeTab === 'sync' && (() => {
          const config = syncConfigs[0];
          if (!config) return (
            <div className="settings-section">
              <h2>Синхронизация отзывов</h2>
              <p className="section-description">Загрузка...</p>
            </div>
          );

          const edit = getSyncEdit(config.provider);
          const isEnabled = edit.isEnabled !== undefined ? edit.isEnabled : config.isEnabled;
          const hasEdits = Object.keys(edit).length > 0;

          return (
            <div className="settings-section">
              <div className="section-header">
                <h2>Синхронизация отзывов</h2>
                {isEnabled && config.isConfigured && (
                  <button
                    className="btn-add"
                    onClick={() => handleRunSyncProvider(config)}
                    disabled={syncRunning}
                  >
                    <RefreshCw size={16} className={syncRunning ? 'spinning' : ''} />
                    {syncRunning ? 'Синхронизация...' : 'Синхронизировать'}
                  </button>
                )}
              </div>

              <div className="sync-config-card enabled-always">
                {/* Заголовок */}
                <div className="sync-card-header">
                  <div className="sync-platform-info">
                    <span className="sync-platform-name">{config.label}</span>
                  </div>
                  <div className="sync-card-controls">
                    {/* Статус */}
                    {config.lastSyncAt && (
                      <div className={`sync-status-badge ${config.lastSyncStatus}`}>
                        {config.lastSyncStatus === 'success' && (
                          <><CheckCircle size={12} /> +{config.lastSyncCount} · {new Date(config.lastSyncAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                        )}
                        {config.lastSyncStatus === 'error' && (
                          <><AlertCircle size={12} /> Ошибка</>
                        )}
                        {config.lastSyncStatus === 'running' && (
                          <><RefreshCw size={12} className="spinning" /> Выполняется...</>
                        )}
                      </div>
                    )}
                    {/* Тоггл */}
                    <label className="sync-toggle">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={e => setSyncField(config.provider, 'isEnabled', e.target.checked)}
                      />
                      <span className="sync-toggle-slider" />
                    </label>
                  </div>
                </div>

                {/* Ошибка */}
                {config.lastSyncStatus === 'error' && config.lastSyncError && (
                  <div className="sync-error-text">{config.lastSyncError}</div>
                )}

                {/* Поля credentials */}
                <div className="sync-credentials">
                  {config.credentialsSchema.map(field => {
                    const fromEdit = edit?.credentials?.[field.key];
                    const currentVal = fromEdit !== undefined
                      ? fromEdit
                      : (config.credentials?.[field.key] || '');
                    // Если пароль пришёл с сервера как "••••••••" и пользователь ещё не редактировал —
                    // показываем поле пустым с placeholder, чтобы не сбивать с толку
                    const isServerMasked = field.type === 'password' && currentVal === '••••••••' && fromEdit === undefined;
                    const isVisible = syncVisible[config.provider]?.[field.key];
                    const inputType = field.type === 'password'
                      ? (isVisible ? 'text' : 'password')
                      : 'text';

                    return (
                      <div key={field.key} className="form-group sync-field">
                        <label>{field.label}</label>
                        <div className="sync-input-wrap">
                          <input
                            type={inputType}
                            value={isServerMasked ? '' : currentVal}
                            placeholder={isServerMasked ? '(пароль сохранён)' : (field.placeholder || '')}
                            onChange={e => setSyncCredField(config.provider, field.key, e.target.value)}
                          />
                          {field.type === 'password' && (
                            <button
                              type="button"
                              className="btn-eye"
                              onClick={() => toggleFieldVisibility(config.provider, field.key)}
                            >
                              {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Список филиалов (после тестирования) */}
                {syncFilials && (
                  <div className="sync-filials-list">
                    <p className="sync-filials-title">Доступные филиалы в вашем аккаунте:</p>
                    <table className="sync-filials-table">
                      <thead>
                        <tr><th>ID</th><th>Название</th><th>Площадки</th></tr>
                      </thead>
                      <tbody>
                        {syncFilials.map(f => (
                          <tr key={f.id}>
                            <td>
                              <code
                                className="sync-filial-id"
                                onClick={() => setSyncCredField(config.provider, 'filialId', f.id)}
                                title="Нажмите, чтобы выбрать"
                              >{f.id}</code>
                            </td>
                            <td>{f.name}</td>
                            <td className="sync-filial-platforms">{(f.platforms || []).join(', ') || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="field-hint">Нажмите на ID, чтобы скопировать его в поле «ID филиала»</p>
                  </div>
                )}

                {/* Кнопки */}
                <div className="sync-card-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => handleTestSync(config)}
                    disabled={syncTesting[config.provider]}
                  >
                    {syncTesting[config.provider] ? 'Проверяем...' : 'Проверить подключение'}
                  </button>
                  {hasEdits && (
                    <button
                      className="btn-save"
                      onClick={() => handleSaveSyncConfig(config)}
                    >
                      <Save size={14} />
                      Сохранить
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default ReviewBoardSettings;
