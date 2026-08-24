/**
 * Мелкие общие элементы модуля.
 *
 * Свои, а не импортированные из «Задач»: визуальный язык у модулей общий, но
 * связывать их кодом ради бейджа значит получить неожиданную поломку в одном,
 * когда правят другой.
 */

import React from 'react';

export function Badge({ tone = 'muted', children }) {
  if (!children) return null;
  return <span className={`onb-badge onb-badge-${tone}`}>{children}</span>;
}

export function professionsText(list) {
  return (list || []).map(p => p.name).join(', ') || '—';
}

/** Срок задачи: до какого числа либо на сколько рабочих часов просрочена. */
export function dueText(task) {
  if (!task.dueAt) return '';
  if (task.overdue) return `просрочка ${task.overdueHours} ч`;
  return new Date(task.dueAt).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

export function dateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}
