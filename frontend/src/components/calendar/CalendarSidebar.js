import React from 'react';
import { ChevronLeft, ChevronRight, Filter, Clock, MapPin } from 'lucide-react';

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const EVENT_TYPES = {
  personal: { label: 'Личное', color: '#4a90e2' },
  meeting: { label: 'Встреча', color: '#10b981' },
  deadline: { label: 'Дедлайн', color: '#ef4444' },
  reminder: { label: 'Напоминание', color: '#f59e0b' },
  accreditation: { label: 'Аккредитация', color: '#ef4444' },
  vehicle_service: { label: 'ТО транспорта', color: '#f59e0b' },
  doctor_schedule: { label: 'Расписание врача', color: '#8b5cf6' }
};

// === MINI CALENDAR ===
export function MiniCalendar({ selectedDate, onDateSelect }) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date(selectedDate));

  const getDaysInMonth = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();
    const days = [];

    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    const remainingCells = 7 - (days.length % 7);
    if (remainingCells < 7) {
      for (let i = 1; i <= remainingCells; i++) {
        days.push(new Date(year, month + 1, i));
      }
    }

    return days;
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const isSelected = (date) => {
    if (!date) return false;
    return date.getDate() === selectedDate.getDate() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getFullYear() === selectedDate.getFullYear();
  };

  const isOtherMonth = (date) => {
    if (!date) return false;
    return date.getMonth() !== currentMonth.getMonth();
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const days = getDaysInMonth();

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-header">
        <button onClick={goToPreviousMonth}>
          <ChevronLeft size={16} />
        </button>
        <div className="mini-calendar-title">
          {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </div>
        <button onClick={goToNextMonth}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mini-calendar-grid">
        {weekDays.map(day => (
          <div key={day} className="mini-calendar-weekday">
            {day}
          </div>
        ))}
        {days.map((date, index) => {
          const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6);
          const otherMonth = isOtherMonth(date);

          return (
            <div
              key={index}
              className={`mini-calendar-day ${!date ? 'empty' : ''} ${isToday(date) ? 'today' : ''} ${isSelected(date) ? 'selected' : ''} ${isWeekend ? 'weekend' : ''} ${otherMonth ? 'other-month' : ''}`}
              onClick={() => date && !otherMonth && onDateSelect(date)}
            >
              {date ? date.getDate() : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === EVENT FILTERS ===
export function EventFilters({ filters, onChange }) {
  const [showFilters, setShowFilters] = React.useState(false);

  const toggleType = (type) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter(t => t !== type)
      : [...filters.types, type];
    onChange({ ...filters, types: newTypes });
  };

  return (
    <div className="event-filters">
      <button
        className="filters-toggle"
        onClick={() => setShowFilters(!showFilters)}
      >
        <Filter size={18} />
        <span>Фильтры</span>
        {(filters.types.length > 0 || !filters.showIntegrated) && (
          <span className="filter-badge">{filters.types.length}</span>
        )}
      </button>

      {showFilters && (
        <div className="filters-content">
          <div className="filter-section">
            <label className="filter-label">Типы событий</label>
            {Object.entries(EVENT_TYPES).map(([key, { label, color }]) => (
              <label key={key} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={filters.types.includes(key)}
                  onChange={() => toggleType(key)}
                />
                <span className="event-type-indicator" style={{ backgroundColor: color }} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="filter-section">
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={filters.showIntegrated}
                onChange={e => onChange({ ...filters, showIntegrated: e.target.checked })}
              />
              <span>Показать интегрированные события</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// === UPCOMING EVENTS ===
export function UpcomingEvents({ events, onEventClick }) {
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Сегодня';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Завтра';
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short'
      });
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="upcoming-events">
      <h3>Предстоящие события</h3>
      {events.length === 0 ? (
        <div className="upcoming-empty">
          <Clock size={32} />
          <p>Нет предстоящих событий</p>
        </div>
      ) : (
        <div className="upcoming-list">
          {events.map(event => (
            <div
              key={event.id}
              className="upcoming-event"
              onClick={() => onEventClick(event)}
              style={{ borderLeftColor: event.color }}
            >
              <div className="upcoming-event-date">
                {formatDate(event.startTime)}
              </div>
              <div className="upcoming-event-title">{event.title}</div>
              <div className="upcoming-event-time">
                <Clock size={14} />
                {formatTime(event.startTime)}
              </div>
              {event.location && (
                <div className="upcoming-event-location">
                  <MapPin size={14} />
                  {event.location}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}