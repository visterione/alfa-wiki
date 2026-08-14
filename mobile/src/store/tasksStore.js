/**
 * Счётчик входящих задач для значка на вкладке.
 *
 * Устроен как unreadStore и по той же причине: подписчик (нижняя панель) и
 * источник (экран входящих) живут в разных ветках дерева, а пока человек сидит
 * в чате или профиле, значок — единственный признак, что ему поставили задачу.
 *
 * Отличие от чата в одном: у сообщений есть сокет, а у задач его нет, поэтому
 * значение обновляет тот экран модуля, который в данный момент открыт. Своего
 * опроса по таймеру здесь нет намеренно — фоновый запрос раз в минуту ради
 * цифры на значке сажает батарею заметнее, чем стоит эта цифра.
 */

import {useEffect, useState} from 'react';

let count = 0;
const listeners = new Set();

export function setInboxCount(value) {
  const next = Math.max(0, Math.trunc(value) || 0);
  if (next === count) return;
  count = next;
  listeners.forEach(fn => fn(count));
}

export function getInboxCount() {
  return count;
}

export function useInboxCount() {
  const [value, setValue] = useState(count);

  useEffect(() => {
    // Значение могло измениться между рендером и подпиской
    setValue(count);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
