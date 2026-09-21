import React from 'react';
import { Clock, MapPin, User } from 'lucide-react';
import {
  eventColor, eventSoftColor, eventTimeText, eventTitle, eventTypeLabel
} from './eventTypes';

// Вспомогательная функция для получения локальной даты из ISO строки
const getLocalDate = (isoString) => {
  const date = new Date(isoString);
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    date: date.getDate(),
    hours: date.getHours()
  };
};

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
      const eventLocalDate = getLocalDate(event.startTime);
      return eventLocalDate.date === date.getDate() &&
        eventLocalDate.month === date.getMonth() &&
        eventLocalDate.year === date.getFullYear();
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
                  className={`week-event ${event.status === 'completed' ? 'is-done' : ''}`}
                  style={{
                    backgroundColor: eventSoftColor(event),
                    borderLeftColor: eventColor(event)
                  }}
                  onClick={() => onEventClick(event)}
                >
                  <div className="week-event-time">{eventTimeText(event)}</div>
                  <div className="week-event-title">{eventTitle(event)}</div>
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
      const eventLocalDate = getLocalDate(event.startTime);
      return eventLocalDate.date === currentDate.getDate() &&
        eventLocalDate.month === currentDate.getMonth() &&
        eventLocalDate.year === currentDate.getFullYear() &&
        eventLocalDate.hours === hour;
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
                    className={`day-event ${event.status === 'completed' ? 'is-done' : ''}`}
                    style={{
                      backgroundColor: eventSoftColor(event),
                      borderLeftColor: eventColor(event)
                    }}
                    onClick={() => onEventClick(event)}
                  >
                    <div className="day-event-time">
                      {eventTimeText(event, { range: true })}
                    </div>
                    <div className="day-event-title">{eventTitle(event)}</div>
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
                  className={`agenda-event ${event.status === 'completed' ? 'is-done' : ''}`}
                  onClick={() => onEventClick(event)}
                  style={{ borderLeftColor: eventColor(event) }}
                >
                  <div className="agenda-event-time">
                    <Clock size={16} />
                    {eventTimeText(event, { range: true })}
                  </div>

                  <div className="agenda-event-main">
                    <h4 className="agenda-event-title">{eventTitle(event)}</h4>

                    <div className="agenda-event-meta">
                      <span className="event-type-badge" style={{ backgroundColor: eventColor(event) }}>
                        {eventTypeLabel(event)}
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