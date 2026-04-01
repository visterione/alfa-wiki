import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { BASE_URL } from '../services/api';
import './AnnouncementNotification.css';

export default function AnnouncementNotification({ notification, onClose, onClick }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => handleClose(), 300000);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onClose, 300);
  };

  const authorName = notification.author?.displayName || notification.author?.username || 'Объявление';
  const avatarSrc = notification.author?.avatar ? `${BASE_URL}${notification.author.avatar}` : null;

  const bodyText = (notification.body || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 100) || null;

  return (
    <div
      className={`ann-notif${isExiting ? ' exiting' : ''}`}
      onClick={() => { handleClose(); onClick(); }}
    >
      <div className="ann-notif__icon">
        {avatarSrc
          ? <img src={avatarSrc} alt={authorName} />
          : <Megaphone size={22} />
        }
      </div>
      <div className="ann-notif__content">
        <div className="ann-notif__label">Новое объявление</div>
        <div className="ann-notif__title">{notification.title}</div>
        {bodyText && <div className="ann-notif__preview">{bodyText}</div>}
      </div>
      <button
        className="ann-notif__close"
        onClick={(e) => { e.stopPropagation(); handleClose(); }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
