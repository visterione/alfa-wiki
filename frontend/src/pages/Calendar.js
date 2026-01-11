import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  ChevronLeft, ChevronRight, Plus, Filter, Calendar as CalendarIcon,
  Clock, MapPin, Users, Tag, AlertCircle, CheckCircle, X
} from 'lucide-react';
import { calendar as calendarApi } from '../services/api';
import toast from 'react-hot-toast';
import { 
  EventModal, 
  MonthView, 
  MiniCalendar, 
  EventFilters, 
  UpcomingEvents,
  WeekView,
  DayView,
  AgendaView 
} from '../components/calendar';
import './Calendar.css';

const EVENT_TYPES = {
  personal: { label: 'Личное', color: '#4a90e2' },
  meeting: { label: 'Встреча', color: '#10b981' },
  deadline: { label: 'Дедлайн', color: '#ef4444' },
  reminder: { label: 'Напоминание', color: '#f59e0b' },
  accreditation: { label: 'Аккредитация', color: '#ef4444' },
  vehicle_service: { label: 'ТО транспорта', color: '#f59e0b' },
  doctor_schedule: { label: 'Расписание врача', color: '#8b5cf6' }
};

const PRIORITIES = {
  low: { label: 'Низкий', color: '#94a3b8' },
  medium: { label: 'Средний', color: '#3b82f6' },
  high: { label: 'Высокий', color: '#f59e0b' },
  urgent: { label: 'Срочный', color: '#ef4444' }
};

const STATUSES = {
  planned: { label: 'Запланировано', icon: Clock },
  in_progress: { label: 'В процессе', icon: AlertCircle },
  completed: { label: 'Завершено', icon: CheckCircle },
  cancelled: { label: 'Отменено', icon: X }
};

export default function Calendar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState('month'); // 'month', 'week', 'day', 'agenda'
  const [currentDate, setCurrentDate] = useState(() => {
    const dateParam = searchParams.get('date');
    return dateParam ? new Date(dateParam) : new Date();
  });
  const [events, setEvents] = useState([]);
  const [integratedEvents, setIntegratedEvents] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [filters, setFilters] = useState({
    types: [],
    statuses: [],
    priorities: [],
    showIntegrated: true
  });

  useEffect(() => {
    loadEvents();
    loadUpcoming();
  }, [currentDate, view, filters]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const { start, end } = getDateRange();
      
      // Загрузка событий календаря
      const params = {
        start: start.toISOString(),
        end: end.toISOString()
      };
      
      if (filters.types.length > 0) {
        params.types = filters.types.join(',');
      }
      if (filters.statuses.length > 0) {
        params.statuses = filters.statuses.join(',');
      }
      if (filters.priorities.length > 0) {
        params.priorities = filters.priorities.join(',');
      }

      const { data: eventsData } = await calendarApi.getEvents(params);
      setEvents(eventsData);

      // Загрузка интегрированных событий
      if (filters.showIntegrated) {
        const { data: integratedData } = await calendarApi.getIntegratedEvents(
          start.toISOString(),
          end.toISOString(),
          'accreditation,vehicle'
        );
        setIntegratedEvents(integratedData);
      } else {
        setIntegratedEvents([]);
      }
    } catch (error) {
      console.error('Failed to load events:', error);
      toast.error('Ошибка загрузки событий');
    } finally {
      setLoading(false);
    }
  };

  const loadUpcoming = async () => {
    try {
      const { data } = await calendarApi.getUpcoming(7);
      setUpcomingEvents(data);
    } catch (error) {
      console.error('Failed to load upcoming events:', error);
    }
  };

  const getDateRange = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const day = currentDate.getDate();

    switch (view) {
      case 'month':
        return {
          start: new Date(year, month, 1),
          end: new Date(year, month + 1, 0, 23, 59, 59)
        };
      case 'week':
        const weekStart = new Date(currentDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59);
        return { start: weekStart, end: weekEnd };
      case 'day':
        return {
          start: new Date(year, month, day, 0, 0, 0),
          end: new Date(year, month, day, 23, 59, 59)
        };
      default:
        return {
          start: new Date(year, month, 1),
          end: new Date(year, month + 1, 0, 23, 59, 59)
        };
    }
  };

  const goToPrevious = () => {
    const newDate = new Date(currentDate);
    switch (view) {
      case 'month':
        newDate.setMonth(newDate.getMonth() - 1);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() - 7);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() - 1);
        break;
    }
    setCurrentDate(newDate);
  };

  const goToNext = () => {
    const newDate = new Date(currentDate);
    switch (view) {
      case 'month':
        newDate.setMonth(newDate.getMonth() + 1);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + 7);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() + 1);
        break;
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const formatCurrentPeriod = () => {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    
    switch (view) {
      case 'month':
        return `${months[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
      case 'week':
        const { start, end } = getDateRange();
        return `${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
      case 'day':
        return `${currentDate.getDate()} ${months[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
      default:
        return '';
    }
  };

    const openEventModal = (event = null, date = null) => {
    setSelectedEvent(event);
    setSelectedDate(date);
    setShowEventModal(true);
    };

  const closeEventModal = () => {
    setSelectedEvent(null);
    setSelectedDate(null);
    setShowEventModal(false);
    };


  const handleSaveEvent = async (eventData) => {
    try {
      if (selectedEvent) {
        await calendarApi.updateEvent(selectedEvent.id, eventData);
        toast.success('Событие обновлено');
      } else {
        await calendarApi.createEvent(eventData);
        toast.success('Событие создано');
      }
      closeEventModal();
      loadEvents();
      loadUpcoming();
    } catch (error) {
      console.error('Failed to save event:', error);
      toast.error('Ошибка сохранения события');
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm('Удалить это событие?')) return;
    
    try {
      await calendarApi.deleteEvent(eventId);
      toast.success('Событие удалено');
      closeEventModal();
      loadEvents();
      loadUpcoming();
    } catch (error) {
      console.error('Failed to delete event:', error);
      toast.error('Ошибка удаления события');
    }
  };

  const allEvents = [...events, ...integratedEvents];

  return (
    <div className="calendar-page">
      {/* Header */}
      <div className="calendar-header">
        <h1>Календарь</h1>
        <div className="calendar-controls">
          <button className="btn btn-secondary" onClick={goToToday}>
            Сегодня
          </button>
          
          <div className="calendar-navigation">
            <button className="nav-btn" onClick={goToPrevious}>
              <ChevronLeft size={20} />
            </button>
            <h2 className="period-title">{formatCurrentPeriod()}</h2>
            <button className="nav-btn" onClick={goToNext}>
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="view-switcher">
            <button 
              className={view === 'month' ? 'active' : ''} 
              onClick={() => setView('month')}
            >
              Месяц
            </button>
            <button 
              className={view === 'week' ? 'active' : ''} 
              onClick={() => setView('week')}
            >
              Неделя
            </button>
            <button 
              className={view === 'day' ? 'active' : ''} 
              onClick={() => setView('day')}
            >
              День
            </button>
            <button 
              className={view === 'agenda' ? 'active' : ''} 
              onClick={() => setView('agenda')}
            >
              Список
            </button>
          </div>

          <button className="btn btn-primary" onClick={() => openEventModal()}>
            <Plus size={18} /> Создать
          </button>
        </div>
      </div>

      <div className="calendar-body">
        {/* Sidebar */}
        <aside className="calendar-sidebar">
          <MiniCalendar 
            selectedDate={currentDate}
            onDateSelect={setCurrentDate}
          />
          
          <EventFilters 
            filters={filters}
            onChange={setFilters}
          />

          <UpcomingEvents 
            events={upcomingEvents}
            onEventClick={openEventModal}
          />
        </aside>

        {/* Main Calendar View */}
        <main className="calendar-main">
          {loading ? (
            <div className="calendar-loading">
              <div className="loading-spinner" />
            </div>
          ) : (
            <>
              {view === 'month' && (
                <MonthView 
                    currentDate={currentDate}
                    events={allEvents}
                    onEventClick={openEventModal}
                    onCellClick={(date) => openEventModal(null, date)}
                />
              )}
              {view === 'week' && (
                <WeekView 
                  currentDate={currentDate}
                  events={allEvents}
                  onEventClick={openEventModal}
                />
              )}
              {view === 'day' && (
                <DayView 
                  currentDate={currentDate}
                  events={allEvents}
                  onEventClick={openEventModal}
                />
              )}
              {view === 'agenda' && (
                <AgendaView 
                  events={allEvents}
                  onEventClick={openEventModal}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Event Modal */}
      {showEventModal && (
        <EventModal
            event={selectedEvent}
            selectedDate={selectedDate}
            onSave={handleSaveEvent}
            onDelete={handleDeleteEvent}
            onClose={closeEventModal}
        />
        )}
    </div>
  );
}