import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Users, UserPlus, X, Search, Trash2, User,
  Columns, GitBranch
} from 'lucide-react';
import { reviews, users } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { REVIEW_STATUSES } from '../utils/reviewConstants';
import ReviewWorkflowEditor from '../components/ReviewWorkflowEditor';
import './ReviewBoardSettings.css';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:9001';

const ReviewBoardSettings = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);

  // Permissions
  const [permissions, setPermissions] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedRole, setSelectedRole] = useState('editor');

  // Active tab
  // «Основные» и «Синхронизация» убраны (ver. 8.84): название и адрес доски
  // живут в карточке медцентра, а GetLoyalty отключён — открываем «Доступ».
  const [activeTab, setActiveTab] = useState('permissions');

  // Workflow config (visual node editor)
  const [workflowConfig, setWorkflowConfig] = useState({ nodes: [], edges: [] });
  const [workflowSaving, setWorkflowSaving] = useState(false);

  // Custom column names + per-column visible users
  const [columnNames, setColumnNames] = useState({});
  const [columnSettings, setColumnSettings] = useState({});
  const [columnNamesSaving, setColumnNamesSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [boardId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [boardRes, permissionsRes, usersRes, settingsRes] = await Promise.all([
        reviews.getBoard(boardId),
        reviews.getBoardPermissions(boardId),
        users.listBasic({ access: 'reviews' }),
        reviews.getBoardSettings(boardId).catch(() => ({ data: {} }))
      ]);

      const boardData = boardRes.data;
      setBoard(boardData);
      setPermissions(permissionsRes.data);
      setUsersList(usersRes.data);
      const wf = settingsRes.data?.workflowConfig;
      if (wf) setWorkflowConfig(wf);

      const cn = settingsRes.data?.columnNames;
      if (cn) setColumnNames(cn);

      const cs = settingsRes.data?.columnSettings;
      if (cs) setColumnSettings(cs);

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


  const handleSaveWorkflow = async ({ scenarios }) => {
    try {
      setWorkflowSaving(true);
      const config = { scenarios };
      await reviews.updateBoardSettings(boardId, { workflowConfig: config });
      setWorkflowConfig(config);
      toast.success('Сценарий сохранён');
    } catch (err) {
      toast.error('Ошибка при сохранении сценария');
    } finally {
      setWorkflowSaving(false);
    }
  };

  const handleSaveColumnNames = async () => {
    try {
      setColumnNamesSaving(true);
      await reviews.updateBoardSettings(boardId, { columnNames, columnSettings });
      toast.success('Настройки столбцов сохранены');
    } catch (err) {
      toast.error('Ошибка при сохранении');
    } finally {
      setColumnNamesSaving(false);
    }
  };

  const toggleColumnUser = (statusId, userId) => {
    setColumnSettings(prev => {
      const current = prev[statusId]?.visibleUserIds || [];
      const updated = current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId];
      return { ...prev, [statusId]: { ...prev[statusId], visibleUserIds: updated } };
    });
  };

  const getColumnVisibleUserIds = (statusId) =>
    columnSettings[statusId]?.visibleUserIds || [];

  const getColumnUserLabel = (statusId, userId) =>
    columnSettings[statusId]?.userLabels?.[userId] || '';

  const setColumnUserLabel = (statusId, userId, label) => {
    setColumnSettings(prev => ({
      ...prev,
      [statusId]: {
        ...prev[statusId],
        userLabels: { ...(prev[statusId]?.userLabels || {}), [userId]: label }
      }
    }));
  };

  const getAvatarUrl = (avatarPath) => {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http://localhost') || avatarPath.startsWith('https://localhost')) {
      const path = avatarPath.replace(/^https?:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
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
          className={`tab ${activeTab === 'permissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('permissions')}
        >
          <Users size={16} />
          Доступ
        </button>
        <button
          className={`tab ${activeTab === 'columns' ? 'active' : ''}`}
          onClick={() => setActiveTab('columns')}
        >
          <Columns size={16} />
          Столбцы
        </button>
        <button
          className={`tab ${activeTab === 'workflow' ? 'active' : ''}`}
          onClick={() => setActiveTab('workflow')}
        >
          <GitBranch size={16} />
          Сценарии
        </button>
      </div>

      <div className="settings-content">
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

        {/* Columns Tab */}
        {activeTab === 'columns' && (() => {
          // Участники доски: владелец + редакторы
          const colBoardMembers = [];
          if (board?.owner) colBoardMembers.push(board.owner);
          permissions.filter(p => p.role === 'editor' && p.user).forEach(p => {
            if (!colBoardMembers.find(m => m.id === p.user.id)) colBoardMembers.push(p.user);
          });

          return (
            <div className="settings-section">
              <h2>Настройки столбцов Kanban</h2>
              <p className="section-description">
                Задайте кастомные названия и выберите, кто из участников отображается в каждом столбце.
                Если никто не выбран — показываются все участники доски.
              </p>
              <div className="column-names-list">
                {REVIEW_STATUSES.map(status => {
                  const visibleIds = getColumnVisibleUserIds(status.id);
                  return (
                    <div className="column-settings-block" key={status.id}>
                      <div className="column-settings-header">
                        <span className="column-name-dot" style={{ background: status.color }} />
                        <span className="column-settings-title">{status.label}</span>
                      </div>
                      <div className="column-settings-body">
                        <div className="form-group column-name-row">
                          <label>Название</label>
                          <input
                            type="text"
                            value={columnNames[status.id] || ''}
                            onChange={e => setColumnNames(prev => ({ ...prev, [status.id]: e.target.value }))}
                            placeholder={status.label}
                            maxLength={60}
                          />
                        </div>
                        {status.id !== 'new' && status.id !== 'final' && colBoardMembers.length > 0 && (
                          <div className="form-group">
                            <label>Участники <span className="label-hint">(пусто = все; можно добавить подсказку под именем)</span></label>
                            <div className="column-members-checklist">
                              {colBoardMembers.map(m => {
                                const isChecked = visibleIds.includes(m.id);
                                return (
                                  <div key={m.id} className="column-member-row">
                                    <label className="column-member-check">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleColumnUser(status.id, m.id)}
                                      />
                                      <div className="column-member-avatar">
                                        {getAvatarUrl(m.avatar)
                                          ? <img src={getAvatarUrl(m.avatar)} alt="" />
                                          : <User size={12} />
                                        }
                                      </div>
                                      <span>{m.displayName || m.username}</span>
                                    </label>
                                    <input
                                      className="column-member-label-input"
                                      type="text"
                                      placeholder="Подпись под именем..."
                                      maxLength={60}
                                      value={getColumnUserLabel(status.id, m.id)}
                                      onChange={e => setColumnUserLabel(status.id, m.id, e.target.value)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn-save"
                onClick={handleSaveColumnNames}
                disabled={columnNamesSaving}
              >
                <Save size={16} />
                {columnNamesSaving ? 'Сохранение...' : 'Сохранить настройки столбцов'}
              </button>
            </div>
          );
        })()}

        {/* Workflow Tab */}
        {activeTab === 'workflow' && (
          <div className="settings-section settings-section--workflow">
            <h2>Сценарии автоматизации</h2>
            <ReviewWorkflowEditor
              key={workflowConfig ? JSON.stringify(workflowConfig.scenarios?.length ?? workflowConfig.nodes?.length) : 'empty'}
              initialConfig={workflowConfig}
              boardMembers={usersList}
              onSave={handleSaveWorkflow}
              saving={workflowSaving}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ReviewBoardSettings;
