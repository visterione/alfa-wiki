import {useEffect, useState} from 'react';

/**
 * Общее число непрочитанных сообщений.
 *
 * Нужно там, где списка чатов нет и взять число неоткуда, — на счётчике
 * центральной кнопки в нижней панели. Пока человек сидит в настройках или в
 * профиле, это единственный признак, что пришло новое сообщение.
 *
 * Значение не запрашивается отдельно, а публикуется экраном списка чатов: он и
 * так держит счётчики каждого чата и обновляет их по сокету. Свой запрос
 * означал бы второй источник правды, который рано или поздно разойдётся с
 * видимым списком — счётчик на кнопке показывал бы одно, а сам список другое.
 *
 * Магазин вне React, потому что подписчик (панель навигации) и источник
 * (экран списка) живут в разных ветках дерева.
 */

let total = 0;
const listeners = new Set();

export function setUnreadTotal(value) {
  const next = Math.max(0, Math.trunc(value) || 0);
  if (next === total) return;
  total = next;
  listeners.forEach(fn => fn(total));
}

export function getUnreadTotal() {
  return total;
}

export function useUnreadTotal() {
  const [value, setValue] = useState(total);

  useEffect(() => {
    // Значение могло измениться между рендером и подпиской
    setValue(total);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
