import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, AlertCircle, Plus, Trash, Users as UsersIcon, Bell, ChevronDown, Search } from 'lucide-react';
import { users as usersApi } from '../../services/api';

// Компонент мультиселекта с поиском
function UserMultiSelect({ users, selectedIds, onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredUsers = users.filter(user => {
    const name = (user.displayName || user.username).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  const selectedUsers = users.filter(u => selectedIds.includes(u.id));

  const toggleUser = (userId) => {
    const newIds = selectedIds.includes(userId)
      ? selectedIds.filter(id => id !== userId)
      : [...selectedIds, userId];
    onChange(newIds);
  };

  const removeUser = (userId, e) => {
    e.stopPropagation();
    onChange(selectedIds.filter(id => id !== userId));
  };

  return (
    <div className="multi-select" ref={dropdownRef}>
      <div className="multi-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        <div className="multi-select-values">
          {selectedUsers.length === 0 ? (
            <span className="placeholder">{placeholder}</span>
          ) : (
            selectedUsers.map(user => (
              <span key={user.id} className="multi-select-tag">
                {user.displayName || user.username}
                <X size={14} onClick={(e) => removeUser(user.id, e)} />
              </span>
            ))
          )}
        </div>
        <ChevronDown size={16} className={isOpen ? 'rotate' : ''} />
      </div>

      {isOpen && (
        <div className="multi-select-dropdown">
          <div className="multi-select-search">
            <Search size={16} />
            <input
              type="text"
              placeholder="Поиск пользователей..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="multi-select-options">
            {filteredUsers.length === 0 ? (
              <div className="multi-select-empty">Пользователи не найдены</div>
            ) : (
              filteredUsers.map(user => (
                <label key={user.id} className="multi-select-option">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(user.id)}
                    onChange={() => toggleUser(user.id)}
                  />
                  <span>{user.displayName || user.username}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Предустановленные цвета (отсортированы по радуге)
const PRESET_COLORS = [
  '#ef4444', '#f43f5e', '#ec4899', '#d946ef', '#a855f7',
  '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4',
  '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308',
  '#facc15', '#f59e0b', '#f97316', '#64748b', '#4a90e2'
];

const EVENT_TYPES = {
  personal: 'Личное',
  meeting: 'Встреча',
  deadline: 'Дедлайн',
  reminder: 'Напоминание',
  accreditation: 'Аккредитация',
  vehicle_service: 'ТО транспорта',
  doctor_schedule: 'Расписание врача'
};

const PRIORITIES = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  urgent: 'Срочный'
};

const STATUSES = {
  planned: 'Запланировано',
  in_progress: 'В процессе',
  completed: 'Завершено',
  cancelled: 'Отменено'
};

// Функция для конвертации UTC в локальное время для input
const toLocalDateTimeString = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export default function EventModal({ event, selectedDate, onSave, onDelete, onClose }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    allDay: false,
    eventType: 'personal',
    priority: 'medium',
    status: 'planned',
    color: '#4a90e2',
    location: '',
    isRecurring: false,
    recurrenceRule: {
      frequency: 'daily',
      interval: 1,
      daysOfWeek: [],
      endDate: null
    },
    reminders: [],
    visibility: 'private',
    sharedWith: [],
    participants: []
  });

  const [allUsers, setAllUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Загрузка пользователей
  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoadingUsers(true);
        const { data } = await usersApi.list();
        setAllUsers(data);
      } catch (error) {
        console.error('Failed to load users:', error);
      } finally {
        setLoadingUsers(false);
      }
    };
    loadUsers();
  }, []);

  useEffect(() => {
    if (event) {
      // Редактирование существующего события
      setFormData({
        title: event.title || '',
        description: event.description || '',
        startTime: toLocalDateTimeString(event.startTime),
        endTime: toLocalDateTimeString(event.endTime),
        allDay: event.allDay || false,
        eventType: event.eventType || 'personal',
        priority: event.priority || 'medium',
        status: event.status || 'planned',
        color: event.color || '#4a90e2',
        location: event.location || '',
        isRecurring: event.isRecurring || false,
        recurrenceRule: event.recurrenceRule || {
          frequency: 'daily',
          interval: 1,
          daysOfWeek: [],
          endDate: null
        },
        reminders: event.reminders || [],
        visibility: event.visibility || 'private',
        sharedWith: event.sharedWith || [],
        participants: event.participants || []
      });
    } else if (selectedDate) {
      // Создание нового события с выбранной датой
      const startDate = new Date(selectedDate);
      startDate.setHours(9, 0, 0, 0);
      const endDate = new Date(startDate);
      endDate.setHours(10, 0, 0, 0);

      setFormData(prev => ({
        ...prev,
        startTime: toLocalDateTimeString(startDate),
        endTime: toLocalDateTimeString(endDate)
      }));
    } else {
      // Создание нового события без выбранной даты
      const now = new Date();
      const endTime = new Date(now.getTime() + 3600000);

      setFormData(prev => ({
        ...prev,
        startTime: toLocalDateTimeString(now),
        endTime: toLocalDateTimeString(endTime)
      }));
    }
  }, [event, selectedDate]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Обработчики для recurrenceRule
  const handleRecurrenceChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      recurrenceRule: {
        ...prev.recurrenceRule,
        [field]: value
      }
    }));
  };

  const toggleDayOfWeek = (day) => {
    setFormData(prev => {
      const daysOfWeek = prev.recurrenceRule.daysOfWeek || [];
      const newDays = daysOfWeek.includes(day)
        ? daysOfWeek.filter(d => d !== day)
        : [...daysOfWeek, day];
      return {
        ...prev,
        recurrenceRule: {
          ...prev.recurrenceRule,
          daysOfWeek: newDays
        }
      };
    });
  };

  // Обработчики для напоминаний
  const addReminder = () => {
    setFormData(prev => ({
      ...prev,
      reminders: [...prev.reminders, { type: 'notification', minutesBefore: 15 }]
    }));
  };

  const updateReminder = (index, field, value) => {
    setFormData(prev => {
      const newReminders = [...prev.reminders];
      newReminders[index] = { ...newReminders[index], [field]: value };
      return { ...prev, reminders: newReminders };
    });
  };

  const removeReminder = (index) => {
    setFormData(prev => ({
      ...prev,
      reminders: prev.reminders.filter((_, i) => i !== index)
    }));
  };

  // Обработчики для участников и расшаривания
  const handleParticipantsChange = (newParticipants) => {
    setFormData(prev => ({ ...prev, participants: newParticipants }));
  };

  const handleSharedWithChange = (newSharedWith) => {
    setFormData(prev => ({ ...prev, sharedWith: newSharedWith }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      alert('Введите название события');
      return;
    }

    const startDate = new Date(formData.startTime);
    const endDate = new Date(formData.endTime);
    
    if (endDate <= startDate) {
      alert('Время окончания должно быть позже времени начала');
      return;
    }

    const eventData = {
      ...formData,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString()
    };

    onSave(eventData);
  };

  const handleDelete = () => {
    if (event && event.id) {
      onDelete(event.id);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content event-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{event ? 'Редактировать событие' : 'Новое событие'}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Название *</label>
              <input
                type="text"
                value={formData.title}
                onChange={e => handleChange('title', e.target.value)}
                placeholder="Название события"
                required
              />
            </div>

            <div className="form-row three-cols">
              <div className="form-group">
                <label>Начало *</label>
                <input
                  type={formData.allDay ? "date" : "datetime-local"}
                  value={formData.allDay ? formData.startTime.split('T')[0] : formData.startTime}
                  onChange={e => handleChange('startTime', formData.allDay ? e.target.value + 'T00:00' : e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Окончание *</label>
                <input
                  type={formData.allDay ? "date" : "datetime-local"}
                  value={formData.allDay ? formData.endTime.split('T')[0] : formData.endTime}
                  onChange={e => handleChange('endTime', formData.allDay ? e.target.value + 'T23:59' : e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label className="checkbox-label" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={formData.allDay}
                    onChange={e => handleChange('allDay', e.target.checked)}
                  />
                  <span>Весь день</span>
                </label>
              </div>
            </div>

            <div className="form-row three-cols">
              <div className="form-group">
                <label>Тип</label>
                <select
                  value={formData.eventType}
                  onChange={e => handleChange('eventType', e.target.value)}
                >
                  {Object.entries(EVENT_TYPES).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Приоритет</label>
                <select
                  value={formData.priority}
                  onChange={e => handleChange('priority', e.target.value)}
                >
                  {Object.entries(PRIORITIES).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Статус</label>
                <select
                  value={formData.status}
                  onChange={e => handleChange('status', e.target.value)}
                >
                  {Object.entries(STATUSES).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row two-cols">
              <div className="form-group">
                <label>Описание</label>
                <textarea
                  value={formData.description}
                  onChange={e => handleChange('description', e.target.value)}
                  rows={3}
                  placeholder="Описание события..."
                />
              </div>

              <div className="form-group-vertical">
                <div className="form-group compact">
                  <label>Местоположение</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={e => handleChange('location', e.target.value)}
                    placeholder="Адрес или место"
                  />
                </div>
                <div className="form-group compact">
                  <label>Цвет</label>
                  <div className="color-picker-preset">
                    {PRESET_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        className={`color-option ${formData.color === color ? 'selected' : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={() => handleChange('color', color)}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-row two-cols">
              {/* Видимость */}
              <div className="form-group">
                <label>Видимость</label>
                <select
                  value={formData.visibility}
                  onChange={e => handleChange('visibility', e.target.value)}
                >
                  <option value="private">Только я</option>
                  <option value="shared">Выбранные пользователи</option>
                  <option value="public">Все пользователи</option>
                </select>
              </div>

              {/* Расшаривание */}
              {formData.visibility === 'shared' && (
                <div className="form-group">
                  <label>Поделиться с пользователями</label>
                  {loadingUsers ? (
                    <p className="help-text">Загрузка...</p>
                  ) : (
                    <UserMultiSelect
                      users={allUsers}
                      selectedIds={formData.sharedWith}
                      onChange={handleSharedWithChange}
                      placeholder="Выберите пользователей"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Участники события */}
            {formData.eventType === 'meeting' && (
              <div className="form-group">
                <label><UsersIcon size={16} /> Участники встречи</label>
                {loadingUsers ? (
                  <p className="help-text">Загрузка пользователей...</p>
                ) : (
                  <UserMultiSelect
                    users={allUsers}
                    selectedIds={formData.participants}
                    onChange={handleParticipantsChange}
                    placeholder="Выберите участников"
                  />
                )}
              </div>
            )}

            {/* Напоминания */}
            <div className="form-group">
              <div className="section-header">
                <label><Bell size={16} /> Напоминания</label>
                <button type="button" className="btn-add-reminder" onClick={addReminder} title="Добавить напоминание">
                  <Plus size={18} />
                </button>
              </div>
              {formData.reminders.length === 0 ? (
                <p className="help-text">Напоминания не добавлены</p>
              ) : (
                <div className="reminders-list">
                  {formData.reminders.map((reminder, index) => (
                    <div key={index} className="reminder-item">
                      <select
                        value={reminder.type}
                        onChange={e => updateReminder(index, 'type', e.target.value)}
                      >
                        <option value="notification">Уведомление</option>
                        <option value="email">Email</option>
                      </select>
                      <span>за</span>
                      <input
                        type="number"
                        min="1"
                        value={
                          reminder.minutesBefore >= 1440
                            ? reminder.minutesBefore / 1440
                            : reminder.minutesBefore >= 60
                            ? reminder.minutesBefore / 60
                            : reminder.minutesBefore
                        }
                        onChange={e => {
                          const value = parseInt(e.target.value) || 1;
                          const unit = reminder.minutesBefore >= 1440 ? 'days' : reminder.minutesBefore >= 60 ? 'hours' : 'minutes';
                          let minutes = value;
                          if (unit === 'hours') minutes = value * 60;
                          else if (unit === 'days') minutes = value * 1440;
                          updateReminder(index, 'minutesBefore', minutes);
                        }}
                        style={{ width: '70px' }}
                      />
                      <select
                        value={reminder.minutesBefore >= 1440 ? 'days' : reminder.minutesBefore >= 60 ? 'hours' : 'minutes'}
                        onChange={e => {
                          const unit = e.target.value;
                          const currentValue = reminder.minutesBefore >= 1440
                            ? Math.floor(reminder.minutesBefore / 1440)
                            : reminder.minutesBefore >= 60
                            ? Math.floor(reminder.minutesBefore / 60)
                            : reminder.minutesBefore;
                          let minutes = currentValue;
                          if (unit === 'hours') minutes = currentValue * 60;
                          else if (unit === 'days') minutes = currentValue * 1440;
                          updateReminder(index, 'minutesBefore', minutes);
                        }}
                      >
                        <option value="minutes">минут</option>
                        <option value="hours">часов</option>
                        <option value="days">дней</option>
                      </select>
                      <button type="button" className="btn-icon-danger" onClick={() => removeReminder(index)}>
                        <Trash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Повторяющееся событие */}
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isRecurring}
                  onChange={e => handleChange('isRecurring', e.target.checked)}
                />
                <span>Повторяющееся событие</span>
              </label>
            </div>

            {formData.isRecurring && (
              <div className="recurring-options">
                <div className="form-row two-cols">
                  <div className="form-group">
                    <label>Частота</label>
                    <select
                      value={formData.recurrenceRule.frequency}
                      onChange={e => handleRecurrenceChange('frequency', e.target.value)}
                    >
                      <option value="daily">Ежедневно</option>
                      <option value="weekly">Еженедельно</option>
                      <option value="monthly">Ежемесячно</option>
                      <option value="yearly">Ежегодно</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Интервал</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.recurrenceRule.interval}
                      onChange={e => handleRecurrenceChange('interval', parseInt(e.target.value))}
                    />
                  </div>
                </div>

                {formData.recurrenceRule.frequency === 'weekly' && (
                  <div className="form-group">
                    <label>Дни недели</label>
                    <div className="days-of-week">
                      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => (
                        <button
                          key={index}
                          type="button"
                          className={`day-button ${formData.recurrenceRule.daysOfWeek.includes(index + 1) ? 'active' : ''}`}
                          onClick={() => toggleDayOfWeek(index + 1)}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            {event && !event.isIntegrated && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
              >
                <Trash2 size={18} /> Удалить
              </button>
            )}
            <div className="modal-footer-right">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={event && event.isIntegrated}
              >
                <Save size={18} /> Сохранить
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}