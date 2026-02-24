import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { kanban } from '../services/api';
import { Plus, Settings, FileText, User, ClipboardList } from 'lucide-react';
import './BoardsList.css';

const BoardsList = () => {
  const navigate = useNavigate();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchBoards();
  }, []);

  const fetchBoards = async () => {
    try {
      setLoading(true);
      const response = await kanban.getBoards();
      setBoards(response.data);
    } catch (error) {
      console.error('Error fetching boards:', error);
      setError('Ошибка при загрузке досок');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBoard = async (e) => {
    e.preventDefault();
    if (!newBoard.name.trim()) {
      setError('Введите название доски');
      return;
    }

    try {
      setCreating(true);
      setError('');
      const response = await kanban.createBoard({
        name: newBoard.name.trim(),
        description: newBoard.description.trim() || null
      });
      setBoards([response.data, ...boards]);
      setShowCreateModal(false);
      setNewBoard({ name: '', description: '' });
    } catch (error) {
      console.error('Error creating board:', error);
      setError(error.response?.data?.message || 'Ошибка при создании доски');
    } finally {
      setCreating(false);
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'owner': return 'Владелец';
      case 'editor': return 'Редактор';
      case 'viewer': return 'Наблюдатель';
      default: return role;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner': return '#10b981';
      case 'editor': return '#3b82f6';
      case 'viewer': return '#94a3b8';
      default: return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="boards-list-container">
        <div className="boards-list-header">
          <h1>Доски задач</h1>
        </div>
        <div className="boards-list-loading">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="boards-list-container">
      <div className="boards-list-header">
        <h1>Доски задач</h1>
        <button className="btn-create-board" onClick={() => setShowCreateModal(true)}>
          <Plus size={20} />
          Создать доску
        </button>
      </div>

      {boards.length === 0 ? (
        <div className="boards-list-empty">
          <div className="empty-icon">
            <ClipboardList size={64} strokeWidth={1.5} />
          </div>
          <h2>У вас пока нет досок</h2>
          <p>Создайте свою первую Kanban доску для управления задачами</p>
          <button className="btn-create-first" onClick={() => setShowCreateModal(true)}>
            Создать первую доску
          </button>
        </div>
      ) : (
        <div className="boards-grid">
          {boards.map(board => (
            <div key={board.id} className="board-card">
              <div className="board-card-header">
                <h3 onClick={() => navigate(`/kanban/board/${board.id}`)}>{board.name}</h3>
                <div className="board-role" style={{ background: getRoleColor(board.userRole) }}>
                  {getRoleLabel(board.userRole)}
                </div>
              </div>

              {board.description && (
                <p className="board-description">{board.description}</p>
              )}

              <div className="board-card-footer">
                <div className="board-stats">
                  <span className="stat">
                    <FileText size={16} />
                    {board.taskCount || 0} задач
                  </span>
                  {board.owner && (
                    <span className="stat owner">
                      <User size={16} />
                      {board.owner.displayName}
                    </span>
                  )}
                </div>

                <div className="board-actions">
                  {board.userRole === 'owner' && (
                    <button
                      className="btn-icon"
                      onClick={() => navigate(`/kanban/board/${board.id}/settings`)}
                      title="Настройки доски"
                    >
                      <Settings size={18} />
                    </button>
                  )}
                  <button
                    className="btn-open"
                    onClick={() => navigate(`/kanban/board/${board.id}`)}
                  >
                    Открыть
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Board Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Создать новую доску</h2>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateBoard} className="create-board-form">
              {error && <div className="error-message">{error}</div>}

              <div className="form-group">
                <label htmlFor="board-name">Название доски *</label>
                <input
                  id="board-name"
                  type="text"
                  value={newBoard.name}
                  onChange={(e) => setNewBoard({ ...newBoard, name: e.target.value })}
                  placeholder="Например: Разработка проекта"
                  maxLength={255}
                  disabled={creating}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="board-description">Описание (необязательно)</label>
                <textarea
                  id="board-description"
                  value={newBoard.description}
                  onChange={(e) => setNewBoard({ ...newBoard, description: e.target.value })}
                  placeholder="Краткое описание доски..."
                  rows={3}
                  disabled={creating}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={creating || !newBoard.name.trim()}
                >
                  {creating ? 'Создание...' : 'Создать доску'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BoardsList;
