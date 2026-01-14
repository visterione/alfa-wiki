import React, { useEffect, useState } from 'react';
import { User, Users, X } from 'lucide-react';
import { BASE_URL } from '../services/api';
import './ChatNotification.css';

export default function ChatNotification({ notification, onClose, onClick }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Auto-close after 5 minutes
    const timer = setTimeout(() => {
      handleClose();
    }, 300000); // 5 minutes = 300000 milliseconds

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match animation duration
  };

  const getAvatarUrl = (avatar) => {
    if (!avatar) return null;
    if (avatar.startsWith('http://localhost')) {
      const p = avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${p}`;
    }
    if (avatar.startsWith('http')) return avatar;
    return `${BASE_URL}/${avatar}`;
  };

  const getMessagePreview = (message) => {
    if (message.type === 'system') {
      return message.content;
    }

    let preview = message.content || '';

    if (message.attachments && message.attachments.length > 0) {
      const allImages = message.attachments.every(a => a.mimeType?.startsWith('image/'));
      const attachmentText = allImages
        ? `📷 Фото${message.attachments.length > 1 ? ` (${message.attachments.length})` : ''}`
        : `📎 Файл${message.attachments.length > 1 ? ` (${message.attachments.length})` : ''}`;

      preview = preview ? `${attachmentText} ${preview}` : attachmentText;
    }

    // Limit preview length
    if (preview.length > 100) {
      preview = preview.substring(0, 100) + '...';
    }

    return preview || 'Новое сообщение';
  };

  const { chat, message } = notification;

  return (
    <div
      className={`chat-notification ${isExiting ? 'exiting' : ''}`}
      onClick={onClick}
    >
      <div className="chat-notification-avatar">
        {getAvatarUrl(chat.avatar) ? (
          <img src={getAvatarUrl(chat.avatar)} alt="" />
        ) : (
          chat.type === 'group' ? <Users size={24} /> : <User size={24} />
        )}
      </div>
      <div className="chat-notification-content">
        <div className="chat-notification-header">
          <span className="chat-notification-name">{chat.displayName}</span>
        </div>
        <div className="chat-notification-message">
          {message.sender && chat.type === 'group' && (
            <span className="chat-notification-sender">
              {message.sender.displayName || message.sender.username}:
            </span>
          )}
          {' '}
          {getMessagePreview(message)}
        </div>
      </div>
      <button
        className="chat-notification-close"
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
