import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Archive,
  Filter,
  XCircle,
  ArrowLeft,
  Eye,
  CheckSquare
} from 'lucide-react';
import './Kanban.css';

const COLUMNS = [
  { id: 'backlog', title: 'В очереди', color: '#94a3b8' },
  { id: 'todo', title: 'К выполнению', color: '#3b82f6' },
  { id: 'in_progress', title: 'В работе', color: '#f59e0b' },
  { id: 'done', title: 'Завершено', color: '#10b981' }
];

const PRIORITY_CONFIG = {
  low: { label: 'Низкий', color: '#e8f5e9', textColor: '#2e7d32' },
  medium: { label: 'Средний', color: '#e3f2fd', textColor: '#1565c0' },
  high: { label: 'Высокий', color: '#fff3e0', textColor: '#e65100' },
  urgent: { label: 'Срочно', color: '#ffebee', textColor: '#c62828' }
};

// Utility functions for subtasks handling
const getSubtasksProgress = (subtasks) => {
  if (!subtasks || subtasks.length === 0) {
    return null;
  }

  const completed = subtasks.filter(st => st.completed).length;
  const total = subtasks.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, total, percent };
};

function Kanban() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: boardId } = useParams();
  const [board, setBoard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ canRead: false, canWrite: false });
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [viewingTask, setViewingTask] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'backlog',
    priority: 'medium',
    assigneeIds: [],
    tags: [],
    dueDate: '',
    attachments: [],
    subtasks: []
  });
  const [tagInput, setTagInput] = useState('');
  const [subtaskInput, setSubtaskInput] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showAttachmentsModal, setShowAttachmentsModal] = useState(false);
  const [selectedTaskAttachments, setSelectedTaskAttachments] = useState(null);

  // Фильтры
  const [filters, setFilters] = useState({
    tags: [],
    assignees: [],
    priorities: []
  });
  const [showFilters, setShowFilters] = useState(false);

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

      // Определяем права доступа на основе роли
      const userRole = boardRes.data.userRole;
      setAccess({
        canRead: true,
        canWrite: userRole === 'owner' || userRole === 'editor'
      });

      // Загружаем задачи доски
      const tasksRes = await kanban.getTasks(boardId);
      setTasks(tasksRes.data);

      // Загружаем список пользователей для назначения
      const usersRes = await users.listBasic();
      setUsersList(usersRes.data);
    } catch (error) {
      console.error('Error loading kanban data:', error);
      if (error.response?.status === 403) {
        toast.error('У вас нет доступа к этой доске');
        navigate('/kanban');
      } else if (error.response?.status === 404) {
        toast.error('Доска не найдена');
        navigate('/kanban');
      } else {
        toast.error('Ошибка при загрузке данных');
      }
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
      attachments: [],
      subtasks: []
    });
    setAssigneeSearch('');
    setSubtaskInput('');
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
      attachments: task.attachments || [],
      subtasks: task.subtasks || []
    });
    setAssigneeSearch('');
    setSubtaskInput('');
    setShowTaskModal(true);
  };

  const openViewModal = (task) => {
    setViewingTask(task);
    setShowViewModal(true);
  };

  const canEditTask = (task) => {
    // Проверяем: имеет ли пользователь права на запись в доске ИЛИ является исполнителем задачи
    if (access.canWrite) return true;
    if (task && task.assigneeIds && task.assigneeIds.includes(user.id)) return true;
    return false;
  };

  const handleSubtaskToggle = async (subtaskId) => {
    if (!viewingTask) return;

    const newSubtasks = (viewingTask.subtasks || []).map(st =>
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );

    try {
      await kanban.updateTask(viewingTask.id, {
        ...viewingTask,
        subtasks: newSubtasks
      });

      // Update local state
      setViewingTask({ ...viewingTask, subtasks: newSubtasks });
      setTasks(prevTasks =>
        prevTasks.map(t =>
          t.id === viewingTask.id ? { ...t, subtasks: newSubtasks } : t
        )
      );

      toast.success('Подзадача обновлена');
    } catch (error) {
      console.error('Error updating subtask:', error);
      toast.error('Ошибка при обновлении подзадачи');
    }
  };

  const addSubtask = () => {
    if (subtaskInput.trim()) {
      const newSubtask = {
        id: crypto.randomUUID(),
        text: subtaskInput.trim(),
        completed: false
      };
      setFormData({
        ...formData,
        subtasks: [...formData.subtasks, newSubtask]
      });
      setSubtaskInput('');
    }
  };

  const removeSubtask = (subtaskId) => {
    setFormData({
      ...formData,
      subtasks: formData.subtasks.filter(st => st.id !== subtaskId)
    });
  };

  const toggleSubtaskInForm = (subtaskId) => {
    setFormData({
      ...formData,
      subtasks: formData.subtasks.map(st =>
        st.id === subtaskId ? { ...st, completed: !st.completed } : st
      )
    });
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
        boardId: boardId,
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

  const handleArchive = async (taskId) => {
    if (!window.confirm('Отправить задачу в архив?')) return;

    try {
      await kanban.archiveTask(taskId);
      toast.success('Задача отправлена в архив');
      loadData();
    } catch (error) {
      console.error('Error archiving task:', error);
      toast.error('Ошибка при архивировании задачи');
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

  const downloadAttachment = (file) => {
    // Обрабатываем как старые абсолютные пути, так и новые относительные
    let filePath = file.path;

    // Если путь абсолютный (содержит "backend/uploads" или "C:/"), извлекаем только uploads/...
    if (filePath.includes('backend/')) {
      filePath = filePath.substring(filePath.indexOf('uploads/'));
    } else if (filePath.match(/^[A-Z]:\\/)) {
      // Windows абсолютный путь
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

  const showTaskAttachments = (task) => {
    setSelectedTaskAttachments(task);
    setShowAttachmentsModal(true);
  };

  const getTasksByColumn = (columnId) => {
    return tasks
      .filter(task => task.status === columnId)
      .filter(task => {
        // Фильтр по тегам
        if (filters.tags.length > 0) {
          if (!task.tags || !task.tags.some(tag => filters.tags.includes(tag))) {
            return false;
          }
        }

        // Фильтр по исполнителям
        if (filters.assignees.length > 0) {
          if (!task.assigneeIds || !task.assigneeIds.some(id => filters.assignees.includes(id))) {
            return false;
          }
        }

        // Фильтр по приоритетам
        if (filters.priorities.length > 0) {
          if (!filters.priorities.includes(task.priority)) {
            return false;
          }
        }

        return true;
      })
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

  // Получение всех уникальных тегов
  const getAllTags = () => {
    const tagsSet = new Set();
    tasks.forEach(task => {
      if (task.tags && Array.isArray(task.tags)) {
        task.tags.forEach(tag => tagsSet.add(tag));
      }
    });
    return Array.from(tagsSet).sort();
  };

  // Получение пользователей, которые являются исполнителями в задачах
  const getAssignedUsers = () => {
    const assignedUserIds = new Set();
    tasks.forEach(task => {
      if (task.assigneeIds && Array.isArray(task.assigneeIds)) {
        task.assigneeIds.forEach(id => assignedUserIds.add(id));
      }
    });
    // Фильтруем usersList, оставляя только тех, кто есть в задачах
    return usersList
      .filter(u => assignedUserIds.has(u.id))
      .sort((a, b) => {
        const nameA = (a.displayName || a.username).toLowerCase();
        const nameB = (b.displayName || b.username).toLowerCase();
        return nameA.localeCompare(nameB);
      });
  };

  // Переключение фильтра по тегу
  const toggleTagFilter = (tag) => {
    setFilters(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag]
    }));
  };

  // Переключение фильтра по исполнителю
  const toggleAssigneeFilter = (userId) => {
    setFilters(prev => ({
      ...prev,
      assignees: prev.assignees.includes(userId)
        ? prev.assignees.filter(id => id !== userId)
        : [...prev.assignees, userId]
    }));
  };

  // Переключение фильтра по приоритету
  const togglePriorityFilter = (priority) => {
    setFilters(prev => ({
      ...prev,
      priorities: prev.priorities.includes(priority)
        ? prev.priorities.filter(p => p !== priority)
        : [...prev.priorities, priority]
    }));
  };

  // Очистить все фильтры
  const clearFilters = () => {
    setFilters({
      tags: [],
      assignees: [],
      priorities: []
    });
  };

  // Проверка, есть ли активные фильтры
  const hasActiveFilters = () => {
    return filters.tags.length > 0 || filters.assignees.length > 0 || filters.priorities.length > 0;
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
        <div className="kanban-header-title">
          <button
            className="btn-back-to-list"
            onClick={() => navigate('/kanban')}
            title="Вернуться к списку досок"
          >
            <ArrowLeft size={18} />
          </button>
          <h1>{board?.name || 'Доска задач'}</h1>
        </div>
        <div className="kanban-header-actions">
          <button
            className={`btn-secondary ${hasActiveFilters() ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            title="Фильтры"
          >
            <Filter size={18} />
            Фильтры
            {hasActiveFilters() && <span className="filter-badge">{filters.tags.length + filters.assignees.length + filters.priorities.length}</span>}
          </button>
          {access.canWrite && (
            <>
              <button className="btn-secondary" onClick={() => navigate(`/kanban/board/${boardId}/archive`)}>
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

      {showFilters && (
        <div className="kanban-filters">
          <div className="filters-section">
            <div className="filter-group">
              <label>
                <Tag size={16} />
                Теги
              </label>
              <div className="filter-options">
                {getAllTags().length > 0 ? (
                  getAllTags().map(tag => (
                    <button
                      key={tag}
                      className={`filter-chip ${filters.tags.includes(tag) ? 'active' : ''}`}
                      onClick={() => toggleTagFilter(tag)}
                    >
                      {tag}
                    </button>
                  ))
                ) : (
                  <span className="filter-empty">Нет тегов</span>
                )}
              </div>
            </div>

            <div className="filter-group">
              <label>
                <User size={16} />
                Исполнители
              </label>
              <div className="filter-options">
                {getAssignedUsers().length > 0 ? (
                  getAssignedUsers().map(u => (
                    <button
                      key={u.id}
                      className={`filter-chip ${filters.assignees.includes(u.id) ? 'active' : ''}`}
                      onClick={() => toggleAssigneeFilter(u.id)}
                    >
                      {u.displayName || u.username}
                    </button>
                  ))
                ) : (
                  <span className="filter-empty">Нет исполнителей</span>
                )}
              </div>
            </div>

            <div className="filter-group">
              <label>
                <AlertCircle size={16} />
                Приоритет
              </label>
              <div className="filter-options">
                {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    className={`filter-chip ${filters.priorities.includes(key) ? 'active' : ''}`}
                    onClick={() => togglePriorityFilter(key)}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {hasActiveFilters() && (
            <button className="btn-clear-filters" onClick={clearFilters}>
              <XCircle size={16} />
              Очистить фильтры
            </button>
          )}
        </div>
      )}

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
                            onClick={() => openViewModal(task)}
                          >
                            <div className="task-header">
                              <h4>{task.title}</h4>
                              <div className="task-actions">
                                {access.canWrite && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEditModal(task); }}
                                      title="Редактировать"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleArchive(task.id); }}
                                      title="В архив"
                                    >
                                      <Archive size={14} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                                      title="Удалить"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
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

                            {(() => {
                              const progress = getSubtasksProgress(task.subtasks);
                              return progress && (
                                <div className="task-progress-bar">
                                  <div className="progress-bar-container">
                                    <div
                                      className="progress-bar-fill"
                                      style={{ width: `${progress.percent}%` }}
                                    />
                                  </div>
                                  <span className="progress-text">
                                    {progress.completed}/{progress.total}
                                  </span>
                                </div>
                              );
                            })()}

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
                                <div
                                  className="task-attachments-indicator"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    showTaskAttachments(task);
                                  }}
                                  title="Просмотреть прикрепленные файлы"
                                >
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
          <div className="modal-content task-modal" onClick={(e) => e.stopPropagation()}>
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

              <div className="form-layout-two-columns">
                <div className="form-column-left">
                  <div className="form-group">
                    <label>Срок выполнения</label>
                    <input
                      type="datetime-local"
                      value={formData.dueDate}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
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
                              <input
                                type="checkbox"
                                checked={formData.assigneeIds.includes(u.id)}
                                onChange={() => toggleAssignee(u.id)}
                              />
                            </label>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="form-column-right">
                  <div className="form-group">
                    <label>Описание</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Введите описание задачи"
                      rows={4}
                    />
                  </div>

                  <div className="form-group">
                    <label>Подзадачи</label>
                    <div className="subtasks-input">
                      <input
                        type="text"
                        value={subtaskInput}
                        onChange={(e) => setSubtaskInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
                        placeholder="Введите подзадачу и нажмите Enter"
                      />
                      <button type="button" onClick={addSubtask} className="btn-secondary">
                        <Plus size={16} />
                        Добавить
                      </button>
                    </div>
                    {formData.subtasks && formData.subtasks.length > 0 && (
                      <div className="subtasks-list">
                        {formData.subtasks.map(subtask => (
                          <div key={subtask.id} className="subtask-item">
                            <input
                              type="checkbox"
                              checked={subtask.completed}
                              onChange={() => toggleSubtaskInForm(subtask.id)}
                            />
                            <span className={subtask.completed ? 'completed' : ''}>
                              {subtask.text}
                            </span>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => removeSubtask(subtask.id)}
                              title="Удалить подзадачу"
                            >
                              <X size={14} />
                            </button>
                          </div>
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
                            <div className="attachment-actions">
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => downloadAttachment(file)}
                                title="Скачать файл"
                              >
                                <Download size={14} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => removeAttachment(file.id)}
                                title="Удалить файл"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
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

      {showAttachmentsModal && selectedTaskAttachments && (
        <div className="modal-overlay" onClick={() => setShowAttachmentsModal(false)}>
          <div className="modal-content attachments-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Прикрепленные файлы</h2>
              <button className="btn-icon" onClick={() => setShowAttachmentsModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <h3 className="task-title-in-modal">{selectedTaskAttachments.title}</h3>
              {selectedTaskAttachments.attachments && selectedTaskAttachments.attachments.length > 0 ? (
                <div className="attachments-list">
                  {selectedTaskAttachments.attachments.map(file => (
                    <div key={file.id} className="attachment-item">
                      <Paperclip size={16} />
                      <span className="attachment-name">{file.filename}</span>
                      <span className="attachment-size">
                        ({Math.round(file.size / 1024)} KB)
                      </span>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => downloadAttachment(file)}
                        title="Скачать файл"
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-attachments">Нет прикрепленных файлов</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showViewModal && viewingTask && (
        <div className="modal-overlay" onClick={() => setShowViewModal(false)}>
          <div className="modal-content task-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{viewingTask.title}</h2>
              <div className="modal-header-actions">
                {access.canWrite && (
                  <button
                    className="btn-icon"
                    onClick={() => {
                      setShowViewModal(false);
                      openEditModal(viewingTask);
                    }}
                    title="Редактировать"
                  >
                    <Edit2 size={20} />
                  </button>
                )}
                <button className="btn-icon" onClick={() => setShowViewModal(false)}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="modal-body task-view-body">
              <div className="view-section">
                <div className="view-row">
                  <div className="view-field">
                    <label>Статус</label>
                    <div className="view-value">
                      <span className="status-badge" style={{
                        backgroundColor: COLUMNS.find(c => c.id === viewingTask.status)?.color || '#ccc',
                        color: 'white'
                      }}>
                        {COLUMNS.find(c => c.id === viewingTask.status)?.title || viewingTask.status}
                      </span>
                    </div>
                  </div>

                  <div className="view-field">
                    <label>Приоритет</label>
                    <div className="view-value">
                      <span className="priority-badge" style={{
                        backgroundColor: PRIORITY_CONFIG[viewingTask.priority]?.color || '#fff',
                        color: PRIORITY_CONFIG[viewingTask.priority]?.textColor || '#000'
                      }}>
                        {PRIORITY_CONFIG[viewingTask.priority]?.label || viewingTask.priority}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="view-row">
                  {viewingTask.dueDate ? (
                    <div className="view-field">
                      <label>
                        <Calendar size={16} />
                        Срок выполнения
                      </label>
                      <div className={`view-value ${isOverdue(viewingTask.dueDate) ? 'overdue' : ''}`}>
                        {formatDate(viewingTask.dueDate)}
                      </div>
                    </div>
                  ) : (
                    <div className="view-field">
                      <label>
                        <Calendar size={16} />
                        Срок выполнения
                      </label>
                      <div className="view-value" style={{ color: 'var(--text-secondary)' }}>
                        Не указан
                      </div>
                    </div>
                  )}

                  {viewingTask.assignees && viewingTask.assignees.length > 0 ? (
                    <div className="view-field">
                      <label>
                        <User size={16} />
                        Исполнители
                      </label>
                      <div className="view-value assignees-list">
                        {viewingTask.assignees.map(assignee => (
                          <div key={assignee.id} className="assignee-chip">
                            {getAvatarUrl(assignee.avatar) ? (
                              <img src={getAvatarUrl(assignee.avatar)} alt="" />
                            ) : (
                              <div className="avatar-placeholder-small">
                                {(assignee.displayName || assignee.username).substring(0, 2).toUpperCase()}
                              </div>
                            )}
                            <span>{assignee.displayName || assignee.username}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="view-field">
                      <label>
                        <User size={16} />
                        Исполнители
                      </label>
                      <div className="view-value" style={{ color: 'var(--text-secondary)' }}>
                        Не назначены
                      </div>
                    </div>
                  )}
                </div>

                {viewingTask.tags && viewingTask.tags.length > 0 && (
                  <div className="view-field">
                    <label>
                      <Tag size={16} />
                      Теги
                    </label>
                    <div className="view-value tags-list">
                      {viewingTask.tags.map(tag => (
                        <span key={tag} className="tag-chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {viewingTask.description && (
                <div className="view-section">
                  <label>Описание</label>
                  <div className="view-description">
                    <div className="description-text">{viewingTask.description}</div>
                  </div>
                </div>
              )}

              {viewingTask.subtasks && viewingTask.subtasks.length > 0 && (
                <div className="view-section">
                  <label>Подзадачи</label>
                  <div className="view-subtasks">
                    {viewingTask.subtasks.map(subtask => (
                      <div key={subtask.id} className="subtask-item-view">
                        <input
                          type="checkbox"
                          checked={subtask.completed}
                          onChange={() => handleSubtaskToggle(subtask.id)}
                          disabled={!canEditTask(viewingTask)}
                        />
                        <span className={subtask.completed ? 'completed' : ''}>
                          {subtask.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewingTask.attachments && viewingTask.attachments.length > 0 && (
                <div className="view-section">
                  <label>
                    <Paperclip size={16} />
                    Прикрепленные файлы
                  </label>
                  <div className="attachments-list">
                    {viewingTask.attachments.map(file => (
                      <div key={file.id} className="attachment-item">
                        <Paperclip size={16} />
                        <span className="attachment-name">{file.filename}</span>
                        <span className="attachment-size">
                          ({Math.round(file.size / 1024)} KB)
                        </span>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => downloadAttachment(file)}
                          title="Скачать файл"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    ))}
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

export default Kanban;
