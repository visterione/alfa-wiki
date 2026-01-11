import React from 'react';
import { Clock, MapPin, User } from 'lucide-react';

// === WEEK VIEW ===
export function WeekView({ currentDate, events, onEventClick }) {
  const getWeekDays = () => {
    const days = [];
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay() + 1);

    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      days.push(day);
    }

    return days;
  };

  const getEventsForDay = (date) => {
    return events.filter(event => {
      const eventDate = new Date(event.startTime);
      return eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear();
    });
  };

  const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const weekDays = getWeekDays();
  const weekDayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  return (
    <div className="week-view">
      <div className="week-view-header">
        {weekDays.map((day, index) => (
          <div
            key={index}
            className={`week-view-day-header ${isToday(day) ? 'today' : ''}`}
          >
            <div className="day-name">{weekDayNames[index]}</div>
            <div className="day-number">{day.getDate()}</div>
          </div>
        ))}
      </div>

      <div className="week-view-grid">
        {weekDays.map((day, dayIndex) => {
          const dayEvents = getEventsForDay(day);

          return (
            <div
              key={dayIndex}
              className={`week-view-day ${isToday(day) ? 'today' : ''}`}
            >
              {dayEvents.map(event => (
                <div
                  key={event.id}
                  className="week-event"
                  style={{
                    backgroundColor: event.color + '20',
                    borderLeftColor: event.color
                  }}
                  onClick={() => onEventClick(event)}
                >
                  <div className="week-event-time">
                    {new Date(event.startTime).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                  <div className="week-event-title">{event.title}</div>
                  {event.location && (
                    <div className="week-event-location">
                      <MapPin size={12} />
                      {event.location}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === DAY VIEW ===
export function DayView({ currentDate, events, onEventClick }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getEventsForHour = (hour) => {
    return events.filter(event => {
      const eventDate = new Date(event.startTime);
      return eventDate.getDate() === currentDate.getDate() &&
        eventDate.getMonth() === currentDate.getMonth() &&
        eventDate.getFullYear() === currentDate.getFullYear() &&
        eventDate.getHours() === hour;
    });
  };

  const formatHour = (hour) => {
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  return (
    <div className="day-view">
      <div className="day-view-header">
        <h3>
          {currentDate.toLocaleDateString('ru-RU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })}
        </h3>
      </div>

      <div className="day-view-timeline">
        {hours.map(hour => {
          const hourEvents = getEventsForHour(hour);

          return (
            <div key={hour} className="day-view-hour">
              <div className="hour-label">{formatHour(hour)}</div>
              <div className="hour-events">
                {hourEvents.map(event => (
                  <div
                    key={event.id}
                    className="day-event"
                    style={{
                      backgroundColor: event.color + '20',
                      borderLeftColor: event.color
                    }}
                    onClick={() => onEventClick(event)}
                  >
                    <div className="day-event-time">
                      {new Date(event.startTime).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                      {' - '}
                      {new Date(event.endTime).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                    <div className="day-event-title">{event.title}</div>
                    {event.description && (
                      <div className="day-event-description">
                        {event.description}
                      </div>
                    )}
                    {event.location && (
                      <div className="day-event-location">
                        <MapPin size={14} />
                        {event.location}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === AGENDA VIEW ===
export function AgendaView({ events, onEventClick }) {
  // Группируем события по дням
  const groupedEvents = events.reduce((acc, event) => {
    const dateKey = new Date(event.startTime).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {});

  const formatTime = (dateStr) => {
    return new Date(dateStr).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const EVENT_TYPE_LABELS = {
    personal: 'Личное',
    meeting: 'Встреча',
    deadline: 'Дедлайн',
    reminder: 'Напоминание',
    accreditation: 'Аккредитация',
    vehicle_service: 'ТО транспорта',
    doctor_schedule: 'Расписание врача'
  };

  const PRIORITY_LABELS = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    urgent: 'Срочный'
  };

  return (
    <div className="agenda-view">
      {Object.keys(groupedEvents).length === 0 ? (
        <div className="agenda-empty">
          <Clock size={48} />
          <p>Нет событий для отображения</p>
        </div>
      ) : (
        Object.entries(groupedEvents).map(([date, dayEvents]) => (
          <div key={date} className="agenda-day">
            <div className="agenda-day-header">{date}</div>
            <div className="agenda-events">
              {dayEvents.map(event => (
                <div
                  key={event.id}
                  className="agenda-event"
                  onClick={() => onEventClick(event)}
                  style={{ borderLeftColor: event.color }}
                >
                  <div className="agenda-event-time">
                    <Clock size={16} />
                    {formatTime(event.startTime)} - {formatTime(event.endTime)}
                  </div>

                  <div className="agenda-event-main">
                    <h4 className="agenda-event-title">{event.title}</h4>

                    <div className="agenda-event-meta">
                      <span className="event-type-badge" style={{ backgroundColor: event.color }}>
                        {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                      </span>

                      {event.priority !== 'medium' && (
                        <span className={`priority-badge priority-${event.priority}`}>
                          {PRIORITY_LABELS[event.priority]}
                        </span>
                      )}

                      {event.isIntegrated && (
                        <span className="integrated-badge">
                          Интегрированное
                        </span>
                      )}
                    </div>

                    {event.description && (
                      <p className="agenda-event-description">
                        {event.description}
                      </p>
                    )}

                    {event.location && (
                      <div className="agenda-event-location">
                        <MapPin size={14} />
                        {event.location}
                      </div>
                    )}

                    {event.creator && (
                      <div className="agenda-event-creator">
                        <User size={14} />
                        {event.creator.displayName || event.creator.username}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}