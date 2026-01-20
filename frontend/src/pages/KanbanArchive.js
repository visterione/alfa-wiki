import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { kanban, BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  RotateCcw,
  Calendar,
  User as UserIcon,
  Tag,
  Paperclip,
  Archive,
  Printer,
  Eye,
  Download,
  X
} from 'lucide-react';
import './KanbanArchive.css';

const PRIORITY_CONFIG = {
  low: { label: 'Низкий', color: '#e8f5e9', textColor: '#2e7d32' },
  medium: { label: 'Средний', color: '#e3f2fd', textColor: '#1565c0' },
  high: { label: 'Высокий', color: '#fff3e0', textColor: '#e65100' },
  urgent: { label: 'Срочно', color: '#ffebee', textColor: '#c62828' }
};

function KanbanArchive() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id: boardId } = useParams();
  const [board, setBoard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ canWrite: false });
  const printRef = useRef();
  const [selectedTask, setSelectedTask] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  useEffect(() => {
    if (!boardId) {
      navigate('/kanban');
      return;
    }
    loadData();
  }, [boardId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Загружаем информацию о доске
      const boardRes = await kanban.getBoard(boardId);
      setBoard(boardRes.data);

      // Определяем права доступа
      const userRole = boardRes.data.userRole;
      setAccess({
        canWrite: userRole === 'owner' || userRole === 'editor'
      });

      // Загружаем архивные задачи доски
      const tasksData = await kanban.getArchive(boardId);
      setTasks(tasksData.data);
    } catch (error) {
      console.error('Error loading archive:', error);
      toast.error('Ошибка при загрузке архива');
      if (error.response?.status === 403 || error.response?.status === 404) {
        navigate('/kanban');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (taskId) => {
    if (!window.confirm('Восстановить задачу из архива?')) return;

    try {
      await kanban.restoreTask(taskId);
      toast.success('Задача восстановлена');
      loadData();
    } catch (error) {
      console.error('Error restoring task:', error);
      toast.error('Ошибка при восстановлении задачи');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getAvatarUrl = (avatar) => {
    if (!avatar) return null;
    return `${BASE_URL}/${avatar}`;
  };

  const handlePrint = () => {
    window.print();
  };

  const getStatusLabel = (status) => {
    const statusMap = {
      'backlog': 'В очереди',
      'todo': 'К выполнению',
      'in_progress': 'В работе',
      'done': 'Завершено'
    };
    return statusMap[status] || status;
  };

  const handleViewDetails = (task) => {
    setSelectedTask(task);
    setShowDetailsModal(true);
  };

  const downloadAttachment = (file) => {
    let filePath = file.path;
    if (filePath.includes('backend/')) {
      filePath = filePath.substring(filePath.indexOf('uploads/'));
    } else if (filePath.match(/^[A-Z]:\\/)) {
      filePath = filePath.substring(filePath.indexOf('uploads\\'));
    }
    const fileUrl = `${BASE_URL}/${filePath}`;
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = file.filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return <div className="archive-loading">Загрузка архива...</div>;
  }

  if (!access.canWrite) {
    return (
      <div className="archive-no-access">
        <Archive size={48} />
        <h2>Доступ запрещен</h2>
        <p>У вас нет прав для просмотра архива задач</p>
        <button className="btn-secondary" onClick={() => navigate(`/kanban/board/${boardId}`)}>
          <ArrowLeft size={16} />
          Вернуться к доске
        </button>
      </div>
    );
  }

  return (
    <div className="archive-page">
      <div className="archive-header no-print">
        <div className="archive-header-left">
          <button className="btn-icon-lg" onClick={() => navigate(`/kanban/board/${boardId}`)} title="Назад к доске">
            <ArrowLeft size={20} />
          </button>
          <div className="archive-title">
            <Archive size={24} />
            <h1>Архив: {board?.name || 'Задачи'}</h1>
            <span className="task-count">{tasks.length}</span>
          </div>
        </div>
        {tasks.length > 0 && access.canWrite && (
          <button className="btn-print" onClick={handlePrint} title="Печать архива">
            <Printer size={18} />
            Печать отчёта
          </button>
        )}
      </div>

      <div className="print-header">
        <h1>Архив задач: {board?.name}</h1>
        <p className="print-date">Дата формирования отчёта: {formatDate(new Date().toISOString())}</p>
        <p className="print-stats">Всего задач в архиве: {tasks.length}</p>
      </div>

      {tasks.length === 0 ? (
        <div className="archive-empty">
          <Archive size={64} />
          <h2>Архив пуст</h2>
        </div>
      ) : (
        <div className="archive-table-container" ref={printRef}>
          <table className="archive-table">
            <thead>
              <tr>
                <th className="col-number">#</th>
                <th className="col-title">Название задачи</th>
                <th className="col-status">Статус</th>
                <th className="col-priority">Приоритет</th>
                <th className="col-assignees">Исполнители</th>
                <th className="col-date">Дата архивации</th>
                <th className="col-actions no-print">Действия</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, index) => (
                <tr key={task.id} className={`priority-${task.priority}`}>
                  <td className="col-number">{index + 1}</td>
                  <td className="col-title">
                    <div className="task-title-cell">
                      <strong>{task.title}</strong>
                      {task.description && (
                        <p className="task-description-preview">{task.description}</p>
                      )}
                    </div>
                  </td>
                  <td className="col-status">
                    <span className="status-badge">{getStatusLabel(task.status)}</span>
                  </td>
                  <td className="col-priority">
                    <span className="priority-badge" style={{
                      backgroundColor: PRIORITY_CONFIG[task.priority]?.color,
                      color: PRIORITY_CONFIG[task.priority]?.textColor
                    }}>
                      {PRIORITY_CONFIG[task.priority]?.label}
                    </span>
                  </td>
                  <td className="col-assignees">
                    {task.assignees && task.assignees.length > 0 ? (
                      <div className="assignees-list">
                        {task.assignees.map(assignee => (
                          <div key={assignee.id} className="assignee-name">
                            {assignee.displayName || assignee.username}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="no-data">—</span>
                    )}
                  </td>
                  <td className="col-date">{formatDate(task.archivedAt)}</td>
                  <td className="col-actions no-print">
                    <div className="action-buttons">
                      <button
                        className="btn-action btn-view"
                        onClick={() => handleViewDetails(task)}
                        title="Просмотр деталей"
                      >
                        <Eye size={14} />
                      </button>
                      {access.canWrite && (
                        <button
                          className="btn-action btn-restore"
                          onClick={() => handleRestore(task.id)}
                          title="Восстановить задачу"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && selectedTask && (
        <div className="modal-overlay" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content task-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Детали задачи</h2>
              <button className="btn-close" onClick={() => setShowDetailsModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-section">
                <label className="detail-label">Название</label>
                <div className="detail-value task-title">{selectedTask.title}</div>
              </div>

              {selectedTask.description && (
                <div className="detail-section">
                  <label className="detail-label">Описание</label>
                  <div className="detail-value task-description">{selectedTask.description}</div>
                </div>
              )}

              <div className="detail-row">
                <div className="detail-section">
                  <label className="detail-label">Статус</label>
                  <div className="detail-value">
                    <span className="status-badge">{getStatusLabel(selectedTask.status)}</span>
                  </div>
                </div>

                <div className="detail-section">
                  <label className="detail-label">Приоритет</label>
                  <div className="detail-value">
                    <span className="priority-badge" style={{
                      backgroundColor: PRIORITY_CONFIG[selectedTask.priority]?.color,
                      color: PRIORITY_CONFIG[selectedTask.priority]?.textColor
                    }}>
                      {PRIORITY_CONFIG[selectedTask.priority]?.label}
                    </span>
                  </div>
                </div>
              </div>

              {selectedTask.assignees && selectedTask.assignees.length > 0 && (
                <div className="detail-section">
                  <label className="detail-label">Исполнители</label>
                  <div className="detail-value">
                    <div className="assignees-list">
                      {selectedTask.assignees.map(assignee => (
                        <div key={assignee.id} className="assignee-item">
                          {getAvatarUrl(assignee.avatar) ? (
                            <img src={getAvatarUrl(assignee.avatar)} alt="" className="assignee-avatar-small" />
                          ) : (
                            <div className="assignee-avatar-placeholder-small">
                              {(assignee.displayName || assignee.username).substring(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span>{assignee.displayName || assignee.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedTask.tags && selectedTask.tags.length > 0 && (
                <div className="detail-section">
                  <label className="detail-label">Теги</label>
                  <div className="detail-value">
                    <div className="tags-list">
                      {selectedTask.tags.map(tag => (
                        <span key={tag} className="tag-badge">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="detail-section">
                <label className="detail-label">Дата архивации</label>
                <div className="detail-value">{formatDate(selectedTask.archivedAt)}</div>
              </div>

              {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                <div className="detail-section">
                  <label className="detail-label">Прикреплённые файлы</label>
                  <div className="detail-value">
                    <div className="attachments-list-modal">
                      {selectedTask.attachments.map(file => (
                        <div key={file.id} className="attachment-item-modal">
                          <div className="attachment-info">
                            <Paperclip size={16} />
                            <span className="attachment-name">{file.filename}</span>
                            <span className="attachment-size">
                              ({Math.round(file.size / 1024)} KB)
                            </span>
                          </div>
                          <button
                            className="btn-download"
                            onClick={() => downloadAttachment(file)}
                            title="Скачать файл"
                          >
                            <Download size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KanbanArchive;
