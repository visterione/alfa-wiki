import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Archive
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
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ canWrite: false });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [accessData, tasksData] = await Promise.all([
        kanban.checkAccess(),
        kanban.getArchive()
      ]);
      setAccess(accessData.data);
      setTasks(tasksData.data);
    } catch (error) {
      console.error('Error loading archive:', error);
      toast.error('Ошибка при загрузке архива');
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

  if (loading) {
    return <div className="archive-loading">Загрузка архива...</div>;
  }

  if (!access.canWrite) {
    return (
      <div className="archive-no-access">
        <Archive size={48} />
        <h2>Доступ запрещен</h2>
        <p>У вас нет прав для просмотра архива задач</p>
        <button className="btn-secondary" onClick={() => navigate('/kanban')}>
          <ArrowLeft size={16} />
          Вернуться к доске
        </button>
      </div>
    );
  }

  return (
    <div className="archive-page">
      <div className="archive-header">
        <button className="btn-icon-lg" onClick={() => navigate('/kanban')} title="Назад к доске">
          <ArrowLeft size={20} />
        </button>
        <div className="archive-title">
          <Archive size={24} />
          <h1>Архив задач</h1>
          <span className="task-count">{tasks.length}</span>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="archive-empty">
          <Archive size={64} />
          <h2>Архив пуст</h2>
          <p>Завершенные задачи автоматически архивируются через 1 день</p>
        </div>
      ) : (
        <div className="archive-list">
          {tasks.map(task => (
            <div
              key={task.id}
              className="archive-task"
              style={{
                backgroundColor: PRIORITY_CONFIG[task.priority]?.color || '#ffffff',
                color: PRIORITY_CONFIG[task.priority]?.textColor || '#000000'
              }}
            >
              <div className="archive-task-header">
                <h3>{task.title}</h3>
                <button
                  className="btn-icon"
                  onClick={() => handleRestore(task.id)}
                  title="Восстановить"
                >
                  <RotateCcw size={16} />
                </button>
              </div>

              {task.description && (
                <p className="archive-task-description">{task.description}</p>
              )}

              <div className="archive-task-meta">
                {task.tags && task.tags.length > 0 && (
                  <div className="archive-tags">
                    {task.tags.map(tag => (
                      <span key={tag} className="archive-tag">
                        <Tag size={12} />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="archive-task-info">
                  {task.assignees && task.assignees.length > 0 && (
                    <div className="archive-assignees">
                      {task.assignees.slice(0, 3).map((assignee, idx) => (
                        <div
                          key={assignee.id}
                          className="archive-assignee"
                          title={assignee.displayName || assignee.username}
                          style={{ zIndex: task.assignees.length - idx }}
                        >
                          {getAvatarUrl(assignee.avatar) ? (
                            <img src={getAvatarUrl(assignee.avatar)} alt={assignee.displayName || assignee.username} />
                          ) : (
                            <div className="avatar-placeholder">
                              {(assignee.displayName || assignee.username).substring(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                      ))}
                      {task.assignees.length > 3 && (
                        <div className="archive-assignee more-assignees" title={`Еще ${task.assignees.length - 3}`}>
                          +{task.assignees.length - 3}
                        </div>
                      )}
                    </div>
                  )}

                  {task.attachments && task.attachments.length > 0 && (
                    <div className="archive-attachments-indicator">
                      <Paperclip size={14} />
                      {task.attachments.length}
                    </div>
                  )}

                  <div className="archive-dates">
                    <div className="archive-date">
                      <Calendar size={14} />
                      Архивировано: {formatDate(task.archivedAt)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default KanbanArchive;
