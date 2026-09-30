import React, { useEffect, useState } from 'react';
import { X, User } from 'lucide-react';
import { BASE_URL } from '../../services/api';
import { MisAvatar } from '../MisBadge';

const getAvatarUrl = (avatar) => {
  if (!avatar) return null;
  if (avatar.startsWith('http://localhost') || avatar.startsWith('https://localhost')) {
    const p = avatar.replace(/^https?:\/\/localhost:\d+\//, '');
    return `${BASE_URL}/${p}`;
  }
  if (avatar.startsWith('http')) return avatar;
  const normalised = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  return `${BASE_URL}/${normalised}`;
};

const UserAvatar = ({ userId, avatar, displayName }) => {
  const [broken, setBroken] = useState(false);
  const url = getAvatarUrl(avatar);

  return (
    <MisAvatar userId={userId} size={32}>
      {!url || broken ? (
        <div className="reaction-avatar-placeholder">
          <User size={16} />
        </div>
      ) : (
        <img src={url} alt={displayName} onError={() => setBroken(true)} />
      )}
    </MisAvatar>
  );
};

const ReactionDetailsModal = ({ reactions, onClose }) => {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="reaction-details-backdrop" onClick={handleBackdropClick}>
      <div className="reaction-details-modal">
        <div className="reaction-details-header">
          <h3>Реакции на сообщение</h3>
          <button className="reaction-details-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="reaction-details-content">
          {reactions && reactions.length > 0 ? (
            reactions.map(({ emoji, users }) => (
              <div key={emoji} className="reaction-group">
                <div className="reaction-emoji-header">
                  <span className="emoji-large">{emoji}</span>
                  <span className="count">{users.length}</span>
                </div>
                <div className="users-list">
                  {users.map((user) => (
                    <div key={user.id} className="user-item">
                      <UserAvatar userId={user.id} avatar={user.avatar} displayName={user.displayName} />
                      <span>{user.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="reaction-details-empty">
              <p>Нет реакций на это сообщение</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReactionDetailsModal;
