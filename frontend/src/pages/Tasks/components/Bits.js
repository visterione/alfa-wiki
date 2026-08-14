/**
 * Мелкие общие элементы модуля: аватарка, бейдж, полоса загрузки, пустое место.
 *
 * Вынесены отдельно, потому что встречаются на всех девяти экранах. Полоса
 * загрузки — самый нагруженный смыслом элемент модуля, и рисовать её в пяти
 * местах по-разному означало бы, что «красный» на разных экранах наступает в
 * разных точках.
 */

import React from 'react';
import { avatarColor, initials, userName, LOAD_TONE, LOAD_TITLE } from '../utils/labels';
import { hoursText } from '../utils/dates';

export function Avatar({ user, size = 26, title }) {
  if (!user) return null;
  const style = {
    width: size,
    height: size,
    background: user.avatar ? undefined : avatarColor(user.id),
    fontSize: Math.round(size * 0.4),
  };
  return (
    <span className="tsk-av" style={style} title={title || userName(user)}>
      {user.avatar
        ? <img src={user.avatar} alt="" />
        : initials(user)}
    </span>
  );
}

/** Стопка аватарок с нахлёстом — для задач на нескольких человек. */
export function AvatarStack({ users = [], size = 22, max = 4 }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="tsk-avs">
      {shown.map(u => <Avatar key={u?.id || Math.random()} user={u} size={size} />)}
      {rest > 0 && <span className="tsk-av tsk-av-rest" style={{ width: size, height: size }}>+{rest}</span>}
    </span>
  );
}

export function Badge({ tone = 'muted', children, title }) {
  return <span className={`tsk-badge tsk-badge-${tone}`} title={title}>{children}</span>;
}

/**
 * Полоса загрузки дня.
 *
 * Норма отмечена пунктиром, а не краем полосы: у каждого она своя, и без метки
 * две строки таблицы с одинаковой длиной заливки означали бы совершенно разное.
 * Переработка рисуется отдельным сегментом за пунктиром — иначе она упёрлась бы
 * в край и перестала расти визуально ровно там, где становится важной.
 */
export function LoadBar({ hours, norm, color, onVacation, compact }) {
  if (onVacation) {
    return (
      <div className={`tsk-bar tsk-bar-vac ${compact ? 'is-compact' : ''}`} title="Отпуск">
        <span className="tsk-bar-vac-label">отпуск</span>
      </div>
    );
  }
  if (norm === null || norm === undefined) {
    return <div className={`tsk-bar ${compact ? 'is-compact' : ''}`} title="Норма не задана" />;
  }

  // Шкала до 1,4 нормы: переработка должна быть видна, но не растягивать
  // спокойные дни в тонкую полоску.
  const scale = Math.max(norm * 1.4, 1);
  const fill = Math.min((hours || 0) / scale, 1) * 100;
  const normAt = (norm / scale) * 100;

  return (
    <div
      className={`tsk-bar ${compact ? 'is-compact' : ''}`}
      title={`${hoursText(hours)} из ${hoursText(norm)} — ${LOAD_TITLE[color] || ''}`}
    >
      <div className={`tsk-bar-fill tsk-bar-${LOAD_TONE[color] || 'ok'}`} style={{ width: `${fill}%` }} />
      <div className="tsk-bar-norm" style={{ left: `${normAt}%` }} />
    </div>
  );
}

export function Empty({ children, compact }) {
  return <div className={`tsk-empty ${compact ? 'is-compact' : ''}`}>{children}</div>;
}

export function Spinner({ text = 'Загружаем…' }) {
  return <div className="tsk-empty is-compact">{text}</div>;
}

/**
 * Пояснение сбоку или снизу экрана.
 *
 * В модуле много решений, которые без объяснения читаются как странность:
 * почему «мой день» отдельно от «графика», почему процент считается от суммы
 * норм, почему закрытая команда не показывается строкой «нет доступа».
 * Объяснять это в интерфейсе дешевле, чем отвечать на один и тот же вопрос.
 */
export function Note({ children }) {
  return <div className="tsk-note">{children}</div>;
}
