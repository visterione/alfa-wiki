import React from 'react';

const weekDays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export default function MonthView({ currentDate, events, onEventClick, onCellClick }) {
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();
    const days = [];

    // Дни предыдущего месяца
    const prevMonth = new Date(year, month, 0);
    const prevMonthDays = prevMonth.getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthDays - i),
        isOtherMonth: true
      });
    }
    
    // Дни текущего месяца
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(year, month, i),
        isOtherMonth: false
      });
    }
    
    // Дни следующего месяца
    const remainingCells = 42 - days.length; // 6 недель
    for (let i = 1; i <= remainingCells; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isOtherMonth: true
      });
    }
    
    return days;
  };

  const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  const getEventsForDay = (date) => {
    if (!events || !Array.isArray(events)) return [];
    
    return events.filter(event => {
      if (!event || !event.startTime) return false;
      
      const eventDate = new Date(event.startTime);
      return eventDate.getDate() === date.getDate() &&
             eventDate.getMonth() === date.getMonth() &&
             eventDate.getFullYear() === date.getFullYear();
    });
  };

  const days = getDaysInMonth();

  return (
    <div className="month-view">
      {/* Header */}
      <div className="month-view-header">
        {weekDays.map(day => (
          <div key={day} className="month-view-weekday">
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="month-view-grid">
        {days.map((day, index) => {
          const dayEvents = getEventsForDay(day.date);
          const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
          
          return (
            <div
              key={index}
              className={`month-view-day ${day.isOtherMonth ? 'other-month' : ''} ${isToday(day.date) ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`}
              onClick={() => !day.isOtherMonth && onCellClick(day.date)}
            >
              <div className="day-number">{day.date.getDate()}</div>
              <div className="day-events">
                {dayEvents.slice(0, 3).map(event => (
                  <div
                    key={event.id}
                    className="day-event-item"
                    style={{ borderLeftColor: event.color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                  >
                    <span className="event-time">
                      {new Date(event.startTime).toLocaleTimeString('ru-RU', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>
                    <span className="event-title">{event.title}</span>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="day-events-more">
                    +{dayEvents.length - 3} еще
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}