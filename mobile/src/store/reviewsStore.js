import {useEffect, useState} from 'react';

import {reviews as reviewsApi} from '../services/api';

/**
 * Доступ к модулю отзывов и счётчик назначенного мне.
 *
 * Устроено как warehouseStore и по той же причине: и то и другое нужно панели
 * навигации, которая живёт вне любого экрана и дождаться чужого запроса не
 * может. Кнопка отзывов в колесе не рисуется тем, у кого нет ни одной доски, —
 * а это половина сотрудников.
 *
 * Доступ определяется наличием досок, а не отдельным правом: своего права у
 * модуля нет, доступ раздаётся по доскам (владелец или разрешение), и пустой
 * список — это и есть «модуль не для вас».
 */

let boards = null;
let pending = null;
const listeners = new Set();

const publish = (value) => {
  boards = value;
  listeners.forEach(fn => fn(value));
};

/** Доски из кэша или null, если ещё не спрашивали. Без запроса. */
export function getReviewBoards() {
  return boards;
}

export function loadReviewBoards({force = false} = {}) {
  if (boards && !force) return Promise.resolve(boards);
  if (pending) return pending;

  pending = reviewsApi.boards()
    .then(({data}) => (Array.isArray(data) ? data : []))
    // Сеть отвалилась или доступа нет — в обоих случаях показывать нечего.
    // Пустой список не запоминаем: следующий заход попробует снова.
    .catch(() => null)
    .then((data) => {
      pending = null;
      if (data) publish(data);
      return data || [];
    });

  return pending;
}

export function useReviewBoards() {
  const [value, setValue] = useState(boards);

  useEffect(() => {
    setValue(boards);
    listeners.add(setValue);
    loadReviewBoards();
    return () => { listeners.delete(setValue); };
  }, []);

  return value;
}

/**
 * Счётчик на кнопке отзывов: сколько назначено лично мне и не доведено до
 * решения. Не «сколько всего отзывов на досках» — это число ничего не требует
 * от конкретного человека и в бейдже висело бы вечным упрёком.
 */
let badge = 0;
const badgeListeners = new Set();

export function setReviewsBadge(value) {
  const next = Math.max(0, Math.trunc(value) || 0);
  if (next === badge) return;
  badge = next;
  badgeListeners.forEach(fn => fn(badge));
}

export function useReviewsBadge() {
  const [value, setValue] = useState(badge);

  useEffect(() => {
    setValue(badge);
    badgeListeners.add(setValue);
    return () => { badgeListeners.delete(setValue); };
  }, []);

  return value;
}

export function refreshReviewsBadge() {
  return reviewsApi.assignedCount()
    .then(({data}) => {
      setReviewsBadge(data?.count);
      return data?.count || 0;
    })
    .catch(() => badge);
}

/** Сброс при выходе: следующий вошедший не должен унаследовать чужие доски. */
export function resetReviews() {
  boards = null;
  pending = null;
  setReviewsBadge(0);
  listeners.forEach(fn => fn(null));
}
