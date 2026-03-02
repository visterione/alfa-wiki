import React from 'react';
import { BASE_URL } from '../../services/api';

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

const MessageReactions = ({ reactions, onReactionClick, onShowDetails }) => {
  if (!reactions || reactions.length === 0) {
    return null;
  }

  return (
    <div className="message-reactions">
      {reactions.map(({ emoji, count, users, hasReacted }) => {
        const singleUser = count === 1 && users?.[0];
        const avatarUrl = singleUser ? getAvatarUrl(singleUser.avatar) : null;

        return (
          <button
            key={emoji}
            className={`reaction-badge ${hasReacted ? 'active' : ''}`}
            onClick={() => onReactionClick(emoji, hasReacted)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onShowDetails();
            }}
            title={hasReacted ? 'Убрать реакцию' : 'Добавить реакцию'}
          >
            {singleUser && (
              avatarUrl
                ? <img className="reaction-badge__avatar" src={avatarUrl} alt="" />
                : <span className="reaction-badge__initials">{(singleUser.displayName || '?')[0].toUpperCase()}</span>
            )}
            {count > 1 && <span className="count">{count}</span>}
            <span className="emoji">{emoji}</span>
          </button>
        );
      })}
    </div>
  );
};

export default MessageReactions;
