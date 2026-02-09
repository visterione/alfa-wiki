import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Users, Bell, UserPlus, X, Search, Trash2, ChevronDown
} from 'lucide-react';
import { reviews, users } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { REVIEW_ROLES, ACCESS_ROLE_LABELS, ACCESS_ROLE_COLORS } from '../utils/reviewConstants';
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

  // Board roles
  const [boardRoles, setBoardRoles] = useState({});
  const [showAddRole, setShowAddRole] = useState(false);
  const [roleToAdd, setRoleToAdd] = useState('');
  const [userForRole, setUserForRole] = useState(null);
  const [roleSearchQuery, setRoleSearchQuery] = useState('');

  // Notification settings
  const [notificationSettings, setNotificationSettings] = useState({
    newReview: { roles: [], users: [] },
    statusChange: { roles: [], users: [] },
    assignment: { roles: [], users: [] }
  });

  // Active tab
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    loadData();
  }, [boardId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [boardRes, permissionsRes, rolesRes, settingsRes, usersRes] = await Promise.all([
        reviews.getBoard(boardId),
        reviews.getBoardPermissions(boardId),
        reviews.getBoardRoles(boardId),
        reviews.getBoardSettings(boardId),
        users.listBasic()
      ]);

      const boardData = boardRes.data;
      setBoard(boardData);
      setBoardName(boardData.name);
      setBoardDescription(boardData.description || '');
      setPermissions(permissionsRes.data);
      setBoardRoles(rolesRes.data);
      setNotificationSettings(settingsRes.data.notificationSettings || {
        newReview: { roles: [], users: [] },
        statusChange: { roles: [], users: [] },
        assignment: { roles: [], users: [] }
      });
      setUsersList(usersRes.data);

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

  // Board roles management
  const handleAddBoardRole = async () => {
    if (!roleToAdd || !userForRole) {
      toast.error('Выберите роль и пользователя');
      return;
    }

    try {
      const response = await reviews.addBoardRole(boardId, {
        roleName: roleToAdd,
        userId: userForRole
      });

      // Update local state
      setBoardRoles(prev => ({
        ...prev,
        [roleToAdd]: {
          ...prev[roleToAdd],
          users: [...(prev[roleToAdd]?.users || []), { id: response.data.id, user: response.data.user }]
        }
      }));

      setShowAddRole(false);
      setRoleToAdd('');
      setUserForRole(null);
      setRoleSearchQuery('');
      toast.success('Роль назначена');
    } catch (err) {
      console.error('Error adding role:', err);
      toast.error(err.response?.data?.error || 'Ошибка при назначении роли');
    }
  };

  const handleRemoveBoardRole = async (roleName, roleId) => {
    try {
      await reviews.deleteBoardRole(boardId, roleId);
      setBoardRoles(prev => ({
        ...prev,
        [roleName]: {
          ...prev[roleName],
          users: prev[roleName].users.filter(u => u.id !== roleId)
        }
      }));
      toast.success('Роль удалена');
    } catch (err) {
      console.error('Error removing role:', err);
      toast.error('Ошибка при удалении роли');
    }
  };

  // Notification settings
  const toggleNotificationRole = (event, roleName) => {
    setNotificationSettings(prev => {
      const eventSettings = prev[event] || { roles: [], users: [] };
      const roles = eventSettings.roles.includes(roleName)
        ? eventSettings.roles.filter(r => r !== roleName)
        : [...eventSettings.roles, roleName];
      return {
        ...prev,
        [event]: { ...eventSettings, roles }
      };
    });
  };

  const handleSaveNotifications = async () => {
    try {
      setSaving(true);
      await reviews.updateBoardSettings(boardId, { notificationSettings });
      toast.success('Настройки уведомлений сохранены');
    } catch (err) {
      console.error('Error saving notifications:', err);
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

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
          className={`tab ${activeTab === 'roles' ? 'active' : ''}`}
          onClick={() => setActiveTab('roles')}
        >
          Роли
        </button>
        <button
          className={`tab ${activeTab === 'notifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('notifications')}
        >
          <Bell size={16} />
          Уведомления
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

            <div className="permissions-list">
              {/* Owner */}
              <div className="permission-item owner">
                <div className="user-info">
                  {getAvatarUrl(board?.owner?.avatar) ? (
                    <img src={getAvatarUrl(board?.owner?.avatar)} alt="" />
                  ) : (
                    <div className="avatar-placeholder">
                      {(board?.owner?.displayName || board?.owner?.username || '').substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="user-details">
                    <span className="name">{board?.owner?.displayName || board?.owner?.username}</span>
                    <span className="email">{board?.owner?.email}</span>
                  </div>
                </div>
                <div className="role-badge owner">Владелец</div>
              </div>

              {/* Other users */}
              {permissions.filter(p => p.role !== 'owner').map(perm => (
                <div key={perm.id} className="permission-item">
                  <div className="user-info">
                    {getAvatarUrl(perm.user?.avatar) ? (
                      <img src={getAvatarUrl(perm.user?.avatar)} alt="" />
                    ) : (
                      <div className="avatar-placeholder">
                        {(perm.user?.displayName || perm.user?.username || '').substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="user-details">
                      <span className="name">{perm.user?.displayName || perm.user?.username}</span>
                    </div>
                  </div>
                  <div className="permission-actions">
                    <select
                      value={perm.role}
                      onChange={(e) => handleChangePermissionRole(perm.id, e.target.value)}
                    >
                      <option value="editor">Редактор</option>
                      <option value="viewer">Наблюдатель</option>
                    </select>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemovePermission(perm.id)}
                    >
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

        {/* Roles Tab */}
        {activeTab === 'roles' && (
          <div className="settings-section">
            <div className="section-header">
              <h2>Бизнес-роли</h2>
              <button className="btn-add" onClick={() => setShowAddRole(true)}>
                <UserPlus size={16} />
                Назначить
              </button>
            </div>

            <p className="section-description">
              Бизнес-роли определяют, кто получает уведомления и участвует в обработке отзывов.
            </p>

            <div className="roles-list">
              {REVIEW_ROLES.map(role => (
                <div key={role.id} className="role-section">
                  <div className="role-header">
                    <div className="role-info">
                      <h4>{role.label}</h4>
                      <span className="role-description">{role.description}</span>
                    </div>
                  </div>
                  <div className="role-users">
                    {boardRoles[role.id]?.users?.length > 0 ? (
                      boardRoles[role.id].users.map(assignment => (
                        <div key={assignment.id} className="role-user">
                          {getAvatarUrl(assignment.user?.avatar) ? (
                            <img src={getAvatarUrl(assignment.user?.avatar)} alt="" />
                          ) : (
                            <div className="avatar-placeholder">
                              {(assignment.user?.displayName || assignment.user?.username || '').substring(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span>{assignment.user?.displayName || assignment.user?.username}</span>
                          <button
                            className="btn-remove-role"
                            onClick={() => handleRemoveBoardRole(role.id, assignment.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="no-users">Не назначено</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add role modal */}
            {showAddRole && (
              <div className="modal-overlay" onClick={() => setShowAddRole(false)}>
                <div className="modal-content small" onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Назначить роль</h3>
                    <button className="btn-close" onClick={() => setShowAddRole(false)}>
                      <X size={20} />
                    </button>
                  </div>

                  <div className="modal-body">
                    <div className="form-group">
                      <label>Роль</label>
                      <select
                        value={roleToAdd}
                        onChange={(e) => setRoleToAdd(e.target.value)}
                      >
                        <option value="">Выберите роль</option>
                        {REVIEW_ROLES.map(r => (
                          <option key={r.id} value={r.id}>{r.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Пользователь</label>
                      <div className="search-box">
                        <Search size={16} />
                        <input
                          type="text"
                          placeholder="Поиск пользователя..."
                          value={roleSearchQuery}
                          onChange={(e) => {
                            setRoleSearchQuery(e.target.value);
                            setUserForRole(null);
                          }}
                        />
                      </div>

                      {roleSearchQuery && (
                        <div className="users-dropdown">
                          {usersList
                            .filter(u => {
                              const search = roleSearchQuery.toLowerCase();
                              return (u.displayName || '').toLowerCase().includes(search) ||
                                (u.username || '').toLowerCase().includes(search);
                            })
                            .slice(0, 5)
                            .map(u => (
                              <div
                                key={u.id}
                                className={`user-option ${userForRole === u.id ? 'selected' : ''}`}
                                onClick={() => {
                                  setUserForRole(u.id);
                                  setRoleSearchQuery(u.displayName || u.username);
                                }}
                              >
                                {u.displayName || u.username}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="modal-footer">
                    <button className="btn-cancel" onClick={() => setShowAddRole(false)}>
                      Отмена
                    </button>
                    <button
                      className="btn-submit"
                      onClick={handleAddBoardRole}
                      disabled={!roleToAdd || !userForRole}
                    >
                      Назначить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="settings-section">
            <h2>Настройки уведомлений</h2>
            <p className="section-description">
              Выберите, какие роли получают уведомления о событиях.
            </p>

            <div className="notification-settings">
              <div className="notification-group">
                <h4>Новый отзыв создан</h4>
                <div className="notification-roles">
                  {REVIEW_ROLES.map(role => (
                    <label key={role.id} className="role-checkbox">
                      <input
                        type="checkbox"
                        checked={notificationSettings.newReview?.roles?.includes(role.id) || false}
                        onChange={() => toggleNotificationRole('newReview', role.id)}
                      />
                      <span>{role.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="notification-group">
                <h4>Изменение статуса</h4>
                <div className="notification-roles">
                  {REVIEW_ROLES.map(role => (
                    <label key={role.id} className="role-checkbox">
                      <input
                        type="checkbox"
                        checked={notificationSettings.statusChange?.roles?.includes(role.id) || false}
                        onChange={() => toggleNotificationRole('statusChange', role.id)}
                      />
                      <span>{role.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="notification-group">
                <h4>Назначение ответственных</h4>
                <p className="group-note">Назначенные пользователи всегда получают уведомления.</p>
              </div>
            </div>

            <button
              className="btn-save"
              onClick={handleSaveNotifications}
              disabled={saving}
            >
              <Save size={16} />
              {saving ? 'Сохранение...' : 'Сохранить настройки'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReviewBoardSettings;
