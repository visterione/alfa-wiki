/**
 * Журнал заявки.
 *
 * Лентой, а не списком строк: у процесса есть ход, и читают его как хронологию
 * — «когда согласовали», «сколько провисела задача». Плоский список одинаковых
 * строк на это не отвечает, в нём даже вчерашнее от сегодняшнего не отделить.
 *
 * События идут сверху вниз от свежих к старым и разбиты по дням: внутри дня
 * важно время, между днями — сам факт перерыва.
 */

import React from 'react';
import { dateTime, UserAvatar } from './bits';

// Точки красим по смыслу события, а не по типу: человек ищет в журнале «где
// что-то пошло не так», и красное должно бросаться в глаза.
const TONE = {
  rejected: 'bad',
  cancelled: 'bad',
  revision: 'warn',
  task_unassigned: 'warn',
  chief_unassigned: 'warn',
  sla_reminded: 'warn',
  sla_escalated: 'bad',
  approved: 'ok',
  launched: 'ok',
  task_completed: 'ok',
  closed_unverified: 'warn',
  mis_created: 'ok',
  services_picked: 'ok',
};

const LABELS = {
  created: 'Заявка создана',
  submitted: 'Отправлена на согласование',
  approved: 'Согласована',
  revision: 'Возвращена на доработку',
  rejected: 'Отклонена',
  mis_created: 'Пользователь создан в «Реновации»',
  task_opened: 'Задача поставлена',
  task_claimed: 'Задача взята в работу',
  task_completed: 'Задача закрыта',
  closed_unverified: 'Закрыта без подтверждения из МИС',
  task_unassigned: 'Задача без исполнителя',
  chief_unassigned: 'Не назначен главврач филиала',
  doctor_services_invited: 'Врачу отправлен список услуг',
  services_picked: 'Врач отметил услуги',
  durations_applied: 'Длительности перенесены в настройки врача',
  launched: 'Врач запущен',
  cancelled: 'Процесс отменён',
  medcenter_changed: 'Сменён филиал',
  sla_reminded: 'Напоминание о просрочке',
  sla_escalated: 'Эскалация просрочки',
};

export default function JournalTab({ events = [], tasks = [] }) {
  if (!events.length) return <div className="onb-empty">Пока ничего не происходило</div>;

  const stepTitle = (key) => tasks.find(task => task.stepKey === key)?.title || key;
  const days = groupByDay(events);

  return (
    <div className="onb-journal">
      {days.map(day => (
        <section key={day.key}>
          <div className="onb-journal-day">{day.label}</div>

          {day.items.map(event => (
            <div className={`onb-journal-row is-${TONE[event.action] || 'muted'}`} key={event.id}>
              <time>{timeOf(event.createdAt)}</time>
              <i />
              <div className="onb-journal-body">
                <span className="onb-journal-what">{LABELS[event.action] || event.action}</span>
                {event.payload?.stepKey && (
                  <span className="onb-journal-step">{stepTitle(event.payload.stepKey)}</span>
                )}
                {details(event) && <div className="onb-journal-note">{details(event)}</div>}
                {event.author && (
                  <div className="onb-journal-who">
                    <UserAvatar user={event.author} />
                    <span>{event.author.displayName || event.author.username}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Подробности, ради которых в журнал и заглядывают. */
function details(event) {
  const payload = event.payload || {};
  if (event.action === 'revision' && payload.note) return payload.note;
  if (event.action === 'rejected' && payload.reason) return payload.reason;
  if (event.action === 'cancelled' && payload.reason) return payload.reason;
  if (event.action === 'sla_reminded' || event.action === 'sla_escalated') {
    return payload.hours ? `Просрочка ${payload.hours} рабочих часов` : null;
  }
  if (event.action === 'durations_applied' && payload.applied) {
    return `Услуг с изменённой длительностью: ${payload.applied}`;
  }
  if (event.action === 'mis_created' && payload.misUserId) {
    return `doctor_id ${payload.misUserId}`;
  }
  if (event.action === 'doctor_services_invited' && payload.mail === false) {
    return `Письмо не ушло: ${payload.reason || 'причина не указана'}`;
  }
  return null;
}

function groupByDay(events) {
  const days = new Map();
  for (const event of events) {
    const date = new Date(event.createdAt);
    const key = Number.isNaN(date.getTime())
      ? 'unknown'
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!days.has(key)) days.set(key, { key, label: dayLabel(date), items: [] });
    days.get(key).items.push(event);
  }
  return [...days.values()];
}

function dayLabel(date) {
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Сегодня';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Вчера';

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function timeOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dateTime(value);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
