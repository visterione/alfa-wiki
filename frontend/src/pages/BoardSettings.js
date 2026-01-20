import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { kanban } from '../services/api';
import { users } from '../services/api';
import { ArrowLeft } from 'lucide-react';
import './BoardSettings.css';

const BoardSettings = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedRole, setSelectedRole] = useState('editor');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, [boardId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [boardRes, permissionsRes, usersRes] = await Promise.all([
        kanban.getBoard(boardId),
        kanban.getBoardPermissions(boardId),
        users.list()
      ]);
      setBoard(boardRes.data);
      setPermissions(permissionsRes.data);
      setAllUsers(usersRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Ошибка при загрузке данных');
      if (error.response?.status === 403) {
        setError('У вас нет прав для просмотра настроек этой доски');
      } else if (error.response?.status === 404) {
        setError('Доска не найдена');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddPermission = async () => {
    if (!selectedUser) return;

    try {
      setError('');
      const response = await kanban.addBoardPermission(boardId, {
        userId: selectedUser,
        role: selectedRole
      });
      setPermissions([...permissions, response.data]);
      setSelectedUser(null);
      setSearchQuery('');
    } catch (error) {
      setError(error.response?.data?.message || 'Ошибка при добавлении доступа');
    }
  };

  const handleChangeRole = async (permId, newRole) => {
    try {
      await kanban.updateBoardPermission(boardId, permId, { role: newRole });
      setPermissions(permissions.map(p =>
        p.id === permId ? { ...p, role: newRole } : p
      ));
    } catch (error) {
      alert(error.response?.data?.message || 'Ошибка при изменении роли');
    }
  };

  const handleRemovePermission = async (permId) => {
    try {
      await kanban.deleteBoardPermission(boardId, permId);
      setPermissions(permissions.filter(p => p.id !== permId));
    } catch (error) {
      alert(error.response?.data?.message || 'Ошибка при удалении доступа');
    }
  };

  const availableUsers = allUsers.filter(u =>
    u.id !== board?.ownerId &&
    !permissions.find(p => p.userId === u.id) &&
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRoleLabel = (role) => {
    switch (role) {
      case 'editor': return 'Редактор';
      case 'viewer': return 'Наблюдатель';
      default: return role;
    }
  };

  if (loading) {
    return (
      <div className="board-settings-container">
        <div className="settings-loading">Загрузка...</div>
      </div>
    );
  }

  if (error && !board) {
    return (
      <div className="board-settings-container">
        <div className="settings-error">
          <h2>Ошибка</h2>
          <p>{error}</p>
          <button className="btn-back" onClick={() => navigate('/kanban')}>
            <ArrowLeft size={18} />
            Вернуться к доскам
          </button>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="board-settings-container">
        <div className="settings-error">
          <h2>Доска не найдена</h2>
          <button className="btn-back" onClick={() => navigate('/kanban')}>
            <ArrowLeft size={18} />
            Вернуться к доскам
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="board-settings-container">
      <div className="settings-header">
        <button className="btn-back" onClick={() => navigate(`/kanban/board/${boardId}`)}>
          <ArrowLeft size={18} />
          Назад к доске
        </button>
        <h1>Настройки доски: {board.name}</h1>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h2>Управление доступом</h2>
          <p className="section-description">
            Добавьте пользователей для совместной работы над доской
          </p>

          {error && <div className="error-message">{error}</div>}

          <div className="add-user-form">
            <div className="user-search">
              <input
                type="text"
                placeholder="Поиск пользователя..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedUser(null);
                }}
              />
              {searchQuery && availableUsers.length > 0 && (
                <div className="user-dropdown">
                  {availableUsers.slice(0, 5).map(user => (
                    <div
                      key={user.id}
                      className="user-option"
                      onClick={() => {
                        setSelectedUser(user.id);
                        setSearchQuery(user.displayName);
                      }}
                    >
                      {user.displayName} ({user.email})
                    </div>
                  ))}
                </div>
              )}
            </div>

            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              <option value="editor">Редактор</option>
              <option value="viewer">Наблюдатель</option>
            </select>

            <button
              className="btn-add"
              onClick={handleAddPermission}
              disabled={!selectedUser}
            >
              Добавить
            </button>
          </div>

          <div className="permissions-list">
            <div className="permission-item owner">
              <div className="permission-user">
                <span className="user-name">{board.owner?.displayName}</span>
                <span className="user-email">{board.owner?.email}</span>
              </div>
              <div className="permission-role owner-badge">Владелец</div>
            </div>

            {permissions.map(perm => (
              <div key={perm.id} className="permission-item">
                <div className="permission-user">
                  <span className="user-name">{perm.user.displayName}</span>
                  <span className="user-email">{perm.user.email}</span>
                </div>
                <div className="permission-actions">
                  <select
                    value={perm.role}
                    onChange={(e) => handleChangeRole(perm.id, e.target.value)}
                  >
                    <option value="editor">Редактор</option>
                    <option value="viewer">Наблюдатель</option>
                  </select>
                  <button
                    className="btn-remove"
                    onClick={() => handleRemovePermission(perm.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default BoardSettings;
