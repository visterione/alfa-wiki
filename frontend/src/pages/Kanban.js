import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { kanban, users, BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
  Plus,
  X,
  Edit2,
  Trash2,
  Calendar,
  User,
  Tag,
  AlertCircle,
  Clock,
  Paperclip,
  Download,
  Search,
  Archive
} from 'lucide-react';
import './Kanban.css';

const COLUMNS = [
  { id: 'backlog', title: 'В очереди', color: '#94a3b8' },
  { id: 'todo', title: 'К выполнению', color: '#3b82f6' },
  { id: 'in_progress', title: 'В работе', color: '#f59e0b' },
  { id: 'review', title: 'На проверке', color: '#8b5cf6' },
  { id: 'done', title: 'Завершено', color: '#10b981' }
];

const PRIORITY_CONFIG = {
  low: { label: 'Низкий', color: '#e8f5e9', textColor: '#2e7d32' },
  medium: { label: 'Средний', color: '#e3f2fd', textColor: '#1565c0' },
  high: { label: 'Высокий', color: '#fff3e0', textColor: '#e65100' },
  urgent: { label: 'Срочно', color: '#ffebee', textColor: '#c62828' }
};

function Kanban() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ canRead: false, canWrite: false });
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'backlog',
    priority: 'medium',
    assigneeIds: [],
    tags: [],
    dueDate: '',
    attachments: []
  });
  const [tagInput, setTagInput] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Проверяем доступ
      const accessRes = await kanban.checkAccess();
      setAccess(accessRes.data);

      if (!accessRes.data.canRead) {
        toast.error('У вас нет доступа к Канбану');
        return;
      }

      // Загружаем задачи
      const tasksRes = await kanban.getTasks();
      setTasks(tasksRes.data);

      // Загружаем список пользователей для назначения
      const usersRes = await users.list();
      setUsersList(usersRes.data);
    } catch (error) {
      console.error('Error loading kanban data:', error);
      toast.error('Ошибка при загрузке данных');
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (result) => {
    if (!result.destination || !access.canWrite) return;

    const { draggableId, source, destination } = result;

    // Если перемещение в ту же колонку на то же место
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    try {
      const taskId = draggableId;
      const newStatus = destination.droppableId;
      const newSortOrder = destination.index;

      // Обновляем задачу на сервере
      await kanban.moveTask(taskId, newStatus, newSortOrder);

      // Обновляем локальное состояние
      setTasks(prevTasks => {
        const updatedTasks = prevTasks.map(task =>
          task.id === taskId ? { ...task, status: newStatus, sortOrder: newSortOrder } : task
        );
        return updatedTasks;
      });

      toast.success('Задача перемещена');
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Ошибка при перемещении задачи');
    }
  };

  const openCreateModal = (status = 'backlog') => {
    setEditingTask(null);
    setFormData({
      title: '',
      description: '',
      status,
      priority: 'medium',
      assigneeIds: [],
      tags: [],
      dueDate: '',
      attachments: []
    });
    setAssigneeSearch('');
    setShowTaskModal(true);
  };

  const openEditModal = (task) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      assigneeIds: task.assigneeIds || [],
      tags: task.tags || [],
      dueDate: task.dueDate ? task.dueDate.substring(0, 16) : '',
      attachments: task.attachments || []
    });
    setAssigneeSearch('');
    setShowTaskModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast.error('Введите название задачи');
      return;
    }

    try {
      const dataToSend = {
        ...formData,
        assigneeIds: formData.assigneeIds || [],
        dueDate: formData.dueDate || null,
        attachments: formData.attachments || []
      };

      if (editingTask) {
        await kanban.updateTask(editingTask.id, dataToSend);
        toast.success('Задача обновлена');
      } else {
        await kanban.createTask(dataToSend);
        toast.success('Задача создана');
      }

      setShowTaskModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving task:', error);
      toast.error('Ошибка при сохранении задачи');
    }
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm('Удалить эту задачу?')) return;

    try {
      await kanban.deleteTask(taskId);
      toast.success('Задача удалена');
      loadData();
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Ошибка при удалении задачи');
    }
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const removeTag = (tag) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });
  };

  const toggleAssignee = (userId) => {
    const isSelected = formData.assigneeIds.includes(userId);
    if (isSelected) {
      setFormData({
        ...formData,
        assigneeIds: formData.assigneeIds.filter(id => id !== userId)
      });
    } else {
      setFormData({
        ...formData,
        assigneeIds: [...formData.assigneeIds, userId]
      });
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingFile(true);
      const response = await kanban.uploadFile(file);
      setFormData({
        ...formData,
        attachments: [...formData.attachments, response.data]
      });
      toast.success('Файл загружен');
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Ошибка при загрузке файла');
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const removeAttachment = async (fileId) => {
    if (editingTask) {
      try {
        await kanban.deleteFile(fileId, editingTask.id);
        toast.success('Файл удален');
      } catch (error) {
        console.error('Error deleting file:', error);
        toast.error('Ошибка при удалении файла');
      }
    }
    setFormData({
      ...formData,
      attachments: formData.attachments.filter(f => f.id !== fileId)
    });
  };

  const getTasksByColumn = (columnId) => {
    return tasks
      .filter(task => task.status === columnId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const isOverdue = (dueDate) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const getAvatarUrl = (avatar) => {
    if (!avatar) return null;
    return `${BASE_URL}/${avatar}`;
  };

  if (loading) {
    return <div className="kanban-loading">Загрузка...</div>;
  }

  if (!access.canRead) {
    return (
      <div className="kanban-no-access">
        <AlertCircle size={48} />
        <h2>Доступ запрещен</h2>
        <p>У вас нет прав для просмотра Канбан-доски</p>
      </div>
    );
  }

  return (
    <div className="kanban-page">
      <div className="kanban-header">
        <h1>Доска задач</h1>
        <div className="kanban-header-actions">
          {access.canWrite && (
            <>
              <button className="btn-secondary" onClick={() => navigate('/kanban/archive')}>
                <Archive size={18} />
                Архив
              </button>
              <button className="btn-primary" onClick={() => openCreateModal()}>
                <Plus size={18} />
                Создать задачу
              </button>
            </>
          )}
        </div>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {COLUMNS.map(column => (
            <div key={column.id} className="kanban-column">
              <div className="kanban-column-header" style={{ borderTopColor: column.color }}>
                <h3>{column.title}</h3>
                <span className="task-count">{getTasksByColumn(column.id).length}</span>
                {access.canWrite && (
                  <button
                    className="btn-icon"
                    onClick={() => openCreateModal(column.id)}
                    title="Добавить задачу"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>

              <Droppable droppableId={column.id} isDropDisabled={!access.canWrite}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`kanban-column-content ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                  >
                    {getTasksByColumn(column.id).map((task, index) => (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={index}
                        isDragDisabled={!access.canWrite}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`kanban-task ${snapshot.isDragging ? 'dragging' : ''}`}
                            style={{
                              ...provided.draggableProps.style,
                              backgroundColor: PRIORITY_CONFIG[task.priority]?.color || '#ffffff',
                              color: PRIORITY_CONFIG[task.priority]?.textColor || '#000000'
                            }}
                          >
                            <div className="task-header">
                              <h4>{task.title}</h4>
                              {access.canWrite && (
                                <div className="task-actions">
                                  <button onClick={() => openEditModal(task)} title="Редактировать">
                                    <Edit2 size={14} />
                                  </button>
                                  <button onClick={() => handleDelete(task.id)} title="Удалить">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>

                            {task.description && (
                              <p className="task-description">{task.description}</p>
                            )}

                            {task.tags && task.tags.length > 0 && (
                              <div className="task-tags">
                                {task.tags.map(tag => (
                                  <span key={tag} className="task-tag">
                                    <Tag size={12} />
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="task-footer">
                              {task.assignees && task.assignees.length > 0 && (
                                <div className="task-assignees">
                                  {task.assignees.slice(0, 3).map((assignee, idx) => (
                                    <div
                                      key={assignee.id}
                                      className="task-assignee"
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
                                    <div className="task-assignee more-assignees" title={`Еще ${task.assignees.length - 3}`}>
                                      +{task.assignees.length - 3}
                                    </div>
                                  )}
                                </div>
                              )}

                              {task.attachments && task.attachments.length > 0 && (
                                <div className="task-attachments-indicator">
                                  <Paperclip size={14} />
                                  {task.attachments.length}
                                </div>
                              )}

                              {task.dueDate && (
                                <div className={`task-due-date ${isOverdue(task.dueDate) ? 'overdue' : ''}`}>
                                  <Clock size={14} />
                                  {formatDate(task.dueDate)}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTask ? 'Редактировать задачу' : 'Создать задачу'}</h2>
              <button className="btn-icon" onClick={() => setShowTaskModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="task-form">
              <div className="form-group">
                <label>Название задачи *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Введите название задачи"
                  required
                />
              </div>

              <div className="form-group">
                <label>Описание</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Введите описание задачи"
                  rows={4}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Статус</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    {COLUMNS.map(col => (
                      <option key={col.id} value={col.id}>{col.title}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Приоритет</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  >
                    {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Исполнители</label>
                <div className="assignee-selector">
                  <div className="assignee-search">
                    <Search size={16} />
                    <input
                      type="text"
                      value={assigneeSearch}
                      onChange={(e) => setAssigneeSearch(e.target.value)}
                      placeholder="Поиск по имени..."
                    />
                  </div>
                  <div className="assignee-list">
                    {usersList
                      .filter(u => {
                        const searchLower = assigneeSearch.toLowerCase();
                        return (
                          (u.displayName || '').toLowerCase().includes(searchLower) ||
                          (u.username || '').toLowerCase().includes(searchLower)
                        );
                      })
                      .sort((a, b) => {
                        const nameA = (a.displayName || a.username).toLowerCase();
                        const nameB = (b.displayName || b.username).toLowerCase();
                        return nameA.localeCompare(nameB);
                      })
                      .map(u => (
                        <label key={u.id} className="assignee-item">
                          <input
                            type="checkbox"
                            checked={formData.assigneeIds.includes(u.id)}
                            onChange={() => toggleAssignee(u.id)}
                          />
                          <div className="assignee-info">
                            {getAvatarUrl(u.avatar) ? (
                              <img src={getAvatarUrl(u.avatar)} alt="" className="assignee-avatar" />
                            ) : (
                              <div className="assignee-avatar-placeholder">
                                {(u.displayName || u.username).substring(0, 2).toUpperCase()}
                              </div>
                            )}
                            <span>{u.displayName || u.username}</span>
                          </div>
                        </label>
                      ))}
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Срок выполнения</label>
                  <input
                    type="datetime-local"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Теги</label>
                <div className="tags-input">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    placeholder="Введите тег и нажмите Enter"
                  />
                  <button type="button" onClick={addTag} className="btn-secondary">
                    Добавить
                  </button>
                </div>
                {formData.tags.length > 0 && (
                  <div className="tags-list">
                    {formData.tags.map(tag => (
                      <span key={tag} className="tag-item">
                        {tag}
                        <button type="button" onClick={() => removeTag(tag)}>
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Прикрепленные файлы</label>
                <div className="attachments-section">
                  <input
                    type="file"
                    id="file-upload"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => document.getElementById('file-upload').click()}
                    disabled={uploadingFile}
                  >
                    <Paperclip size={16} />
                    {uploadingFile ? 'Загрузка...' : 'Прикрепить файл'}
                  </button>
                </div>
                {formData.attachments && formData.attachments.length > 0 && (
                  <div className="attachments-list">
                    {formData.attachments.map(file => (
                      <div key={file.id} className="attachment-item">
                        <Paperclip size={14} />
                        <span className="attachment-name">{file.filename}</span>
                        <span className="attachment-size">
                          ({Math.round(file.size / 1024)} KB)
                        </span>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => removeAttachment(file.id)}
                          title="Удалить файл"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowTaskModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary">
                  {editingTask ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Kanban;
