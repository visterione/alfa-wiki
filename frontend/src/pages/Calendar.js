import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Plus, Filter, Calendar as CalendarIcon,
  Clock, MapPin, Users, Tag, AlertCircle, CheckCircle, X
} from 'lucide-react';
import { calendar as calendarApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
  EventModal,
  MonthView,
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
  const { user: currentUser } = useAuth();
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
    priorities: []
  });

  // Синхронизация currentDate с URL параметром date
  useEffect(() => {
    const dateParam = searchParams.get('date');
    if (dateParam) {
      const newDate = new Date(dateParam);
      // Проверяем что дата валидна и отличается от текущей
      if (!isNaN(newDate.getTime())) {
        const isDifferent =
          newDate.getDate() !== currentDate.getDate() ||
          newDate.getMonth() !== currentDate.getMonth() ||
          newDate.getFullYear() !== currentDate.getFullYear();

        if (isDifferent) {
          setCurrentDate(newDate);
        }
      }
    }
  }, [searchParams]);

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

      // Загрузка интегрированных событий (бэкенд фильтрует по доступу к страницам)
      try {
        const { data: integratedData } = await calendarApi.getIntegratedEvents(
          start.toISOString(),
          end.toISOString(),
          'accreditation,vehicle'
        );
        setIntegratedEvents(integratedData);
      } catch (integratedError) {
        console.warn('Failed to load integrated events:', integratedError);
        // Не показываем ошибку пользователю, так как это не критично
        setIntegratedEvents([]);
      }
    } catch (error) {
      console.error('Failed to load events:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Ошибка загрузки событий';
      toast.error(errorMessage);
      setEvents([]);
      setIntegratedEvents([]);
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


  const handleSaveEvent = async (eventData, parentEventId) => {
    try {
      // Если передан parentEventId, значит редактируем родительское событие (всю серию)
      const eventIdToUpdate = parentEventId || selectedEvent?.id;

      if (eventIdToUpdate) {
        await calendarApi.updateEvent(eventIdToUpdate, eventData);
        toast.success(parentEventId ? 'Серия событий обновлена' : 'Событие обновлено');
      } else {
        await calendarApi.createEvent(eventData);
        toast.success('Событие создано');
      }
      window.dispatchEvent(new Event('calendar-events-changed'));
      closeEventModal();
      loadEvents();
      loadUpcoming();
    } catch (error) {
      console.error('Failed to save event:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Ошибка сохранения события';
      toast.error(errorMessage);
    }
  };

  const handleDeleteEvent = async (eventId, event) => {
    // Проверяем, является ли это экземпляром повторяющегося события
    // Используем :: как разделитель (UUID содержит дефисы, поэтому нельзя использовать -)
    const isRecurringInstance = event?.isInstance || eventId.includes('::');

    if (isRecurringInstance) {
      // Это экземпляр повторяющегося события
      const parentId = event?.parentEventId || eventId.split('::')[0];
      const instanceDate = event?.instanceDate || event?.startTime;

      // Создаем кастомный диалог выбора
      const dialog = document.createElement('div');
      dialog.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        backdrop-filter: blur(4px);
      `;

      dialog.innerHTML = `
        <div style="
          background: white;
          border-radius: 12px;
          padding: 24px;
          max-width: 480px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        ">
          <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #1f2937;">
            Удалить повторяющееся событие
          </h3>
          <p style="margin: 0 0 24px 0; font-size: 14px; color: #6b7280; line-height: 1.5;">
            Это событие является частью серии повторяющихся событий. Что вы хотите сделать?
          </p>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button id="delete-instance-btn" style="
              padding: 12px 20px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            ">
              Удалить только этот экземпляр
            </button>
            <button id="delete-all-btn" style="
              padding: 12px 20px;
              background: #ef4444;
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            ">
              Удалить все повторения
            </button>
            <button id="cancel-btn" style="
              padding: 12px 20px;
              background: #f3f4f6;
              color: #374151;
              border: 1px solid #d1d5db;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            ">
              Отмена
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      // Обработчики кнопок
      const handleChoice = async (choice) => {
        document.body.removeChild(dialog);

        if (choice === 'instance') {
          try {
            await calendarApi.deleteEventInstance(parentId, instanceDate);
            toast.success('Экземпляр события удален');
            closeEventModal();
            loadEvents();
            loadUpcoming();
          } catch (error) {
            console.error('Failed to delete event instance:', error);
            const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Ошибка удаления экземпляра события';
            toast.error(errorMessage);
          }
        } else if (choice === 'all') {
          try {
            await calendarApi.deleteEvent(parentId);
            toast.success('Все повторения события удалены');
            closeEventModal();
            loadEvents();
            loadUpcoming();
          } catch (error) {
            console.error('Failed to delete recurring event:', error);
            const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Ошибка удаления повторяющегося события';
            toast.error(errorMessage);
          }
        }
      };

      dialog.querySelector('#delete-instance-btn').onclick = () => handleChoice('instance');
      dialog.querySelector('#delete-all-btn').onclick = () => handleChoice('all');
      dialog.querySelector('#cancel-btn').onclick = () => handleChoice('cancel');
      dialog.onclick = (e) => {
        if (e.target === dialog) handleChoice('cancel');
      };

      // Добавляем hover эффекты
      const buttons = dialog.querySelectorAll('button');
      buttons.forEach(btn => {
        btn.onmouseenter = () => {
          if (btn.id === 'delete-instance-btn') {
            btn.style.background = '#2563eb';
          } else if (btn.id === 'delete-all-btn') {
            btn.style.background = '#dc2626';
          } else {
            btn.style.background = '#e5e7eb';
          }
        };
        btn.onmouseleave = () => {
          if (btn.id === 'delete-instance-btn') {
            btn.style.background = '#3b82f6';
          } else if (btn.id === 'delete-all-btn') {
            btn.style.background = '#ef4444';
          } else {
            btn.style.background = '#f3f4f6';
          }
        };
      });
    } else {
      // Обычное событие
      if (!window.confirm('Удалить это событие?')) return;

      try {
        await calendarApi.deleteEvent(eventId);
        toast.success('Событие удалено');
        closeEventModal();
        loadEvents();
        loadUpcoming();
      } catch (error) {
        console.error('Failed to delete event:', error);
        const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Ошибка удаления события';
        toast.error(errorMessage);
      }
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
            currentUser={currentUser}
            onSave={handleSaveEvent}
            onDelete={handleDeleteEvent}
            onClose={closeEventModal}
        />
        )}
    </div>
  );
}
