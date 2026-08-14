/**
 * Хуки выборки: загрузка человека и события дня.
 *
 * Разведены намеренно и повторяют разделение на бэкенде. Загрузка приходит из
 * /tasks/people/:id/load — числами, без названий. События приходят из календаря
 * и проходят фильтр видимости. Экран, которому нужны только цифры, не должен
 * тянуть содержимое чужих дел «на всякий случай».
 */

import { useState, useEffect, useCallback } from 'react';
import { tasks as api, calendar as calendarApi } from '../../../services/api';

/** Загрузка одного человека за период: [{date, hours, norm, free, color}]. */
export function usePersonLoad(userId, start, end) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId || !start || !end) return;
    setLoading(true);
    try {
      const { data } = await api.getPersonLoad(userId, start, end);
      setDays(data.days || []);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [userId, start, end]);

  useEffect(() => { reload(); }, [reload]);
  return { days, loading, reload };
}

/** Загрузка дня — одним объектом, для шапок и полос. */
export function useDayLoad(userId, date) {
  const { days, loading, reload } = usePersonLoad(userId, date, date);
  return { load: days[0] || null, loading, reload };
}

/**
 * События календаря за период.
 *
 * Обезличенные приходят с isOpaque: true и без названия — интерфейс обязан
 * рисовать их как «занято», а не как событие с пустым заголовком.
 */
export function useEvents(start, end) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!start || !end) return;
    setLoading(true);
    try {
      const { data } = await calendarApi.getEvents({
        start: `${start}T00:00:00`,
        end: `${end}T23:59:59`,
      });
      setEvents(Array.isArray(data) ? data : (data.events || []));
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { reload(); }, [reload]);
  return { events, loading, reload };
}

/** События одного дня в порядке показа: плавающие блоки после жёстких встреч. */
export function dayEvents(events, date) {
  return (events || [])
    .filter(e => String(e.startTime).slice(0, 10) === date)
    .sort((a, b) => {
      if (a.isFloating !== b.isFloating) return a.isFloating ? 1 : -1;
      return String(a.startTime).localeCompare(String(b.startTime));
    });
}

/** Часы события — длительность, а не время начала: у плавающих оно условное. */
export function eventHours(event) {
  const from = new Date(event.startTime).getTime();
  const to = new Date(event.endTime).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / 3600000;
}
