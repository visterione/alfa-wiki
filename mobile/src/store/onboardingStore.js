import {useEffect, useState} from 'react';

import {onboarding as onboardingApi} from '../services/api';

/**
 * Доступ к модулю онбординга и счётчик моих задач.
 *
 * Устроено как warehouseStore и reviewsStore, и по той же причине: оба нужны
 * панели навигации, которая живёт вне любого экрана и дождаться чужого запроса
 * не может. Раздел закрыт флагом adminAccess.onboarding, и у большинства
 * сотрудников его нет — кнопки в колесе им рисовать нельзя.
 *
 * Отдельной ручки «есть ли доступ» у модуля нет: /overview отвечает 403 тем,
 * кому раздел не положен, и этот отказ и есть ответ. Разбирать его здесь, а не
 * заводить на сервере ещё один маршрут ради одного булева значения, дешевле —
 * тем более что вместе с доступом приезжают числа для бейджа.
 */

// null — ещё не спрашивали; {allowed: false} — спросили и не положено
let overview = null;
let pending = null;
const listeners = new Set();

const publish = (value) => {
  overview = value;
  listeners.forEach(fn => fn(value));
};

/** Сводка из кэша или null, если ещё не спрашивали. Без запроса. */
export function getOnboardingAccess() {
  return overview;
}

export function loadOnboardingAccess({force = false} = {}) {
  if (overview && !force) return Promise.resolve(overview);
  if (pending) return pending;

  pending = onboardingApi.overview()
    .then(({data}) => ({allowed: true, ...data}))
    .catch(error => {
      // 403 — раздел не для этого человека, и это окончательный ответ.
      // Любая другая беда (нет сети, сервер лёг) ответом не является:
      // запоминать её нельзя, иначе раздел пропадёт до перезапуска.
      if (error.response?.status === 403) return {allowed: false};
      return null;
    })
    .then(data => {
      pending = null;
      if (data) {
        publish(data);
        setOnboardingBadge(data.myTasksCount);
      }
      return data || {allowed: false};
    });

  return pending;
}

export function useOnboardingAccess() {
  const [value, setValue] = useState(overview);

  useEffect(() => {
    setValue(overview);
    listeners.add(setValue);
    loadOnboardingAccess();
    return () => { listeners.delete(setValue); };
  }, []);

  return value;
}

/**
 * Счётчик на кнопке онбординга: сколько задач висит лично на мне.
 *
 * Не «сколько заявок в работе» — это число ничего не требует от конкретного
 * человека, и в бейдже висело бы вечным упрёком: главврач филиала видит все
 * заявки сети, но делать ему в них нечего, пока анкета не дошла до его шага.
 */
let badge = 0;
const badgeListeners = new Set();

export function setOnboardingBadge(value) {
  const next = Math.max(0, Math.trunc(value) || 0);
  if (next === badge) return;
  badge = next;
  badgeListeners.forEach(fn => fn(badge));
}

export function useOnboardingBadge() {
  const [value, setValue] = useState(badge);

  useEffect(() => {
    setValue(badge);
    badgeListeners.add(setValue);
    return () => { badgeListeners.delete(setValue); };
  }, []);

  return value;
}

/**
 * Перечитать счётчик. Дёргается по сокетному onboarding:changed — задачу мог
 * закрыть или перехватить коллега, и бейдж обязан погаснуть без перезахода
 * в раздел.
 */
export function refreshOnboardingBadge() {
  return onboardingApi.overview()
    .then(({data}) => {
      publish({allowed: true, ...data});
      setOnboardingBadge(data?.myTasksCount);
      return data?.myTasksCount || 0;
    })
    .catch(() => badge);
}

/** Сброс при выходе: следующий вошедший не должен унаследовать чужой доступ. */
export function resetOnboarding() {
  overview = null;
  pending = null;
  setOnboardingBadge(0);
  listeners.forEach(fn => fn(null));
}
