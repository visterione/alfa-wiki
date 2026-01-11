// ПОЛНОСТЬЮ ЗАМЕНИТЕ содержимое файла frontend/src/components/calendar/EventModal.js на этот код:

import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, MapPin, AlertCircle } from 'lucide-react';

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
    recurrenceRule: null,
    reminders: [],
    visibility: 'private',
    sharedWith: []
  });

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
        recurrenceRule: event.recurrenceRule || null,
        reminders: event.reminders || [],
        visibility: event.visibility || 'private',
        sharedWith: event.sharedWith || []
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

            <div className="form-row two-cols">
              <div className="form-group">
                <label>Начало *</label>
                <input
                  type="datetime-local"
                  value={formData.startTime}
                  onChange={e => handleChange('startTime', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Окончание *</label>
                <input
                  type="datetime-local"
                  value={formData.endTime}
                  onChange={e => handleChange('endTime', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.allDay}
                  onChange={e => handleChange('allDay', e.target.checked)}
                />
                <span>Весь день</span>
              </label>
            </div>

            <div className="form-row four-cols">
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

              <div className="form-group">
                <label>Цвет</label>
                <input
                  type="color"
                  value={formData.color}
                  onChange={e => handleChange('color', e.target.value)}
                />
              </div>
            </div>

            <div className="form-row two-cols">
              <div className="form-group">
                <label>Описание</label>
                <textarea
                  value={formData.description}
                  onChange={e => handleChange('description', e.target.value)}
                  rows={4}
                  placeholder="Описание события..."
                />
              </div>

              <div className="form-group">
                <label>Местоположение</label>
                <div className="input-with-icon">
                  <MapPin size={18} />
                  <input
                    type="text"
                    value={formData.location}
                    onChange={e => handleChange('location', e.target.value)}
                    placeholder="Адрес или место"
                  />
                </div>

                <div className="form-group" style={{ marginTop: '16px' }}>
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
              </div>
            </div>

            <div className="form-row two-cols">
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.reminders.length > 0}
                    onChange={e => {
                      if (e.target.checked) {
                        handleChange('reminders', [
                          { type: 'notification', minutesBefore: 15 }
                        ]);
                      } else {
                        handleChange('reminders', []);
                      }
                    }}
                  />
                  <span>Напомнить за 15 минут</span>
                </label>
              </div>

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
            </div>

            {formData.isRecurring && (
              <div className="recurring-options">
                <div className="info-banner">
                  <AlertCircle size={18} />
                  <span>Расширенная настройка повторений будет доступна в следующей версии</span>
                </div>
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