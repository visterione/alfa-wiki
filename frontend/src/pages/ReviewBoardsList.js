import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, MessageSquare, Star, User, Settings, Trash2, X, Archive
} from 'lucide-react';
import { reviews } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import './ReviewBoardsList.css';

const ReviewBoardsList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBoards();
  }, []);

  const loadBoards = async () => {
    try {
      setLoading(true);
      const response = await reviews.getBoards();
      setBoards(response.data);
    } catch (err) {
      console.error('Error loading boards:', err);
      toast.error('Ошибка при загрузке досок');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBoard = async (e) => {
    e.preventDefault();
    if (!newBoard.name.trim()) {
      setError('Название доски обязательно');
      return;
    }

    try {
      setCreating(true);
      setError('');
      const response = await reviews.createBoard(newBoard);
      setBoards([...boards, response.data]);
      setShowCreateModal(false);
      setNewBoard({ name: '', description: '' });
      toast.success('Доска создана');
      navigate(`/reviews/board/${response.data.id}`);
    } catch (err) {
      console.error('Error creating board:', err);
      setError(err.response?.data?.error || 'Ошибка при создании доски');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBoard = async (boardId, boardName) => {
    if (!window.confirm(`Удалить доску "${boardName}" и все её отзывы? Это действие необратимо.`)) {
      return;
    }

    try {
      await reviews.deleteBoard(boardId);
      setBoards(boards.filter(b => b.id !== boardId));
      toast.success('Доска удалена');
    } catch (err) {
      console.error('Error deleting board:', err);
      toast.error(err.response?.data?.error || 'Ошибка при удалении доски');
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

  const getRatingStars = (rating) => {
    if (!rating) return '—';
    const r = parseFloat(rating);
    return '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));
  };

  if (loading) {
    return (
      <div className="reviews-boards-loading">
        <div className="loading-spinner" />
        <p>Загрузка досок...</p>
      </div>
    );
  }

  return (
    <div className="reviews-boards-page">
      <div className="reviews-boards-header">
        <div className="header-left">
          <h1>Отзывы</h1>
        </div>
        <div className="header-actions">
          <button
            className="btn-archive"
            onClick={() => navigate('/reviews/archive')}
            title="Архив отзывов"
          >
            <Archive size={18} />
            Архив
          </button>
          <button
            className="btn-create-board"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={20} />
            Создать доску
          </button>
        </div>
      </div>

      {boards.length === 0 ? (
        <div className="reviews-boards-empty">
          <MessageSquare size={64} strokeWidth={1} />
          <h2>Нет доступных досок</h2>
          <p>Создайте первую доску для отзывов вашего медцентра</p>
          <button
            className="btn-create-first"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={20} />
            Создать доску
          </button>
        </div>
      ) : (
        <div className="reviews-boards-grid">
          {boards.map(board => (
            <div key={board.id} className="review-board-card">
              <div className="board-card-header">
                <h3 onClick={() => navigate(`/reviews/board/${board.id}`)}>
                  {board.name}
                </h3>
                <div
                  className="board-role"
                  style={{ background: getRoleColor(board.userRole) }}
                >
                  {getRoleLabel(board.userRole)}
                </div>
              </div>

              {board.description && (
                <p className="board-description">{board.description}</p>
              )}

              <div className="board-card-footer">
                <div className="board-stats">
                  <span className="stat">
                    <MessageSquare size={16} />
                    {board.reviewCount || 0} отзывов
                  </span>
                  {board.avgRating && (
                    <span className="stat rating">
                      <Star size={16} />
                      {board.avgRating}
                    </span>
                  )}
                  {board.owner && (
                    <span className="stat owner">
                      <User size={16} />
                      {board.owner.displayName || board.owner.username}
                    </span>
                  )}
                </div>

                <div className="board-actions">
                  {board.userRole === 'owner' && (
                    <>
                      <button
                        className="btn-icon"
                        onClick={() => navigate(`/reviews/board/${board.id}/settings`)}
                        title="Настройки"
                      >
                        <Settings size={18} />
                      </button>
                      <button
                        className="btn-icon btn-danger"
                        onClick={() => handleDeleteBoard(board.id, board.name)}
                        title="Удалить"
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  )}
                  <button
                    className="btn-open"
                    onClick={() => navigate(`/reviews/board/${board.id}`)}
                  >
                    Открыть
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модальное окно создания доски */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Создать доску отзывов</h2>
              <button
                className="btn-close"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                <X size={20} />
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
                  placeholder="Например: Медцентр на Ленина"
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
                  {creating ? 'Создание...' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewBoardsList;
