/**
 * Мелкие общие элементы модуля.
 *
 * Свои, а не импортированные из «Задач»: визуальный язык у модулей общий, но
 * связывать их кодом ради бейджа значит получить неожиданную поломку в одном,
 * когда правят другой.
 */

import React from 'react';
import { BASE_URL } from '../../services/api';

export function Badge({ tone = 'muted', children }) {
  if (!children) return null;
  return <span className={`onb-badge onb-badge-${tone}`}>{children}</span>;
}

/** Системная аватарка пользователя с инициалами, если фото не загружено. */
export function UserAvatar({ user, className = '' }) {
  const name = user?.displayName || user?.username || '';
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || '•';
  const src = avatarUrl(user?.avatar);

  return (
    <span className={`onb-user-avatar ${className}`.trim()} aria-hidden="true">
      <span>{initials}</span>
      {src && <img src={src} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
    </span>
  );
}

function avatarUrl(avatar) {
  if (!avatar) return null;
  if (avatar.startsWith('http://localhost')) {
    return `${BASE_URL}/${avatar.replace(/^http:\/\/localhost:\d+\//, '')}`;
  }
  if (avatar.startsWith('http')) return avatar;
  return `${BASE_URL}/${avatar.replace(/^\/+/, '')}`;
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
