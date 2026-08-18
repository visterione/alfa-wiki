import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './TaskNotification.css';

/**
 * Всплывающее уведомление модуля «Задачи».
 *
 * Живёт рядом с уведомлениями чата и намеренно повторяет их поведение: то же
 * место в углу, та же анимация, тот же крестик. Разное здесь только одно — эти
 * гаснут сами через полминуты, а не висят до закрытия, как сообщения.
 * Уведомление о задаче не требует ответа: сама задача никуда не денется, она
 * лежит во входящих, и её счётчик виден на кнопке модуля.
 */
export default function TaskNotification({ notification, onClose, onClick }) {
  const [isExiting, setIsExiting] = useState(false);

  // onClose пересоздаётся на каждый рендер списка. Через ref он не попадает в
  // зависимости таймера — иначе тот перезапускался бы на каждом рендере и
  // уведомление не гасло бы никогда.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => closeRef.current(), 300);
    }, 30000);
    return () => clearTimeout(timer);
  }, []);

  const close = event => {
    event.stopPropagation();
    setIsExiting(true);
    setTimeout(onClose, 300);
  };

  return (
    <div
      className={`task-notification ${isExiting ? 'exiting' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={event => event.key === 'Enter' && onClick()}
    >
      <div className="task-notification-content">
        <div className="task-notification-header">
          <span className="task-notification-title">{notification.title}</span>
          <button className="task-notification-close" onClick={close} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
        <div className="task-notification-body">{notification.body}</div>
        {notification.code && (
          <div className="task-notification-code">{notification.code}</div>
        )}
      </div>
    </div>
  );
}
