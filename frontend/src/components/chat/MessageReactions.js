import React from 'react';

const MessageReactions = ({ reactions, onReactionClick, onShowDetails }) => {
  if (!reactions || reactions.length === 0) {
    return null;
  }

  return (
    <div className="message-reactions">
      {reactions.map(({ emoji, count, hasReacted }) => (
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
          <span className="emoji">{emoji}</span>
          {count > 1 && <span className="count">{count}</span>}
        </button>
      ))}
    </div>
  );
};

export default MessageReactions;
