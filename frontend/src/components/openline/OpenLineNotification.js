import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import ChannelAvatar from './ChannelAvatar';
import '../ChatNotification.css';

// Сколько карточка висит сама. Как у мессенджера: оператор мог отойти, и
// вернувшись, он должен застать, кто писал, а не пустой угол экрана.
const AUTO_CLOSE_MS = 5 * 60 * 1000;

/** «+79001234567» → «+7 (900) 123-45-67»: сервер отдаёт телефон как хранит. */
function prettyName(name) {
  const d = String(name || '').replace(/\D/g, '');
  if (/^\+?\d{11}$/.test(String(name || '').trim())) {
    return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  }
  return name;
}

/**
 * Всплывающая карточка о реплике пациента (ver. 9.23).
 *
 * До этого приходило системное «Открытая линия: ответ пациента» — без имени и
 * без текста: чтобы понять, кто и о чём, надо было идти в раздел и искать.
 * Теперь карточка устроена как у мессенджера и стоит с ними в одной стопке в
 * правом нижнем углу: аватар, имя, начало реплики, щелчок открывает этот чат.
 *
 * Оформление берём у ChatNotification целиком, своё здесь только содержимое:
 * два всплывающих окна разного вида в одном углу читались бы как два разных
 * сорта событий, а событие одно — тебе написали.
 *
 * Аватар — тот же, что в списке обращений: канал связи в нижнем углу, медцентр
 * в верхнем. У оператора нескольких линий «чей это пациент» решает, бросать ли
 * текущий разговор.
 */
export default function OpenLineNotification({ notification, onClose, onClick }) {
  const [isExiting, setIsExiting] = useState(false);
  const { card, isNew, assigneeUserId } = notification;

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(onClose, 300); // длительность анимации ухода
  }, [onClose]);

  // Таймер ставится один раз на карточку и зовёт закрытие через ссылку:
  // перезапускать его на каждое пересоздание обработчика значило бы держать
  // карточку вечно — Layout передаёт onClose новой стрелкой на каждой отрисовке.
  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;

  useEffect(() => {
    const timer = setTimeout(() => closeRef.current(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Сигнал без карточки — от процесса, обновлённого раньше веб-части, — всё
  // равно показываем: общей надписью, как было до 9.23.
  const title = card ? prettyName(card.name) : 'Открытая линия';
  const text = card
    ? (card.text || (card.hasAttachment ? '📎 Вложение' : 'Новое сообщение'))
    : (assigneeUserId ? 'Ответ пациента' : 'Новое обращение');
  // Подпись над текстом — откуда реплика: новое обращение в очереди или
  // продолжение уже взятого. Это разные дела: первое ничьё, второе — твоё.
  const kind = assigneeUserId ? null : (isNew ? 'новое обращение' : 'в очереди');

  return (
    <div className={`chat-notification ${isExiting ? 'exiting' : ''}`} onClick={onClick}>
      <ChannelAvatar platform={card?.platform} medCenter={card?.medCenter} size={48} />
      <div className="chat-notification-content">
        <div className="chat-notification-header">
          <span className="chat-notification-name">{title}</span>
        </div>
        <div className="chat-notification-message">
          {kind && <span className="chat-notification-sender">{kind}:</span>}
          {kind && ' '}
          {text}
        </div>
      </div>
      <button
        className="chat-notification-close"
        onClick={(e) => { e.stopPropagation(); handleClose(); }}
        aria-label="Закрыть"
      >
        <X size={16} />
      </button>
    </div>
  );
}
