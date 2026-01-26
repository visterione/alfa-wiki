import React, { useEffect } from 'react';
import { X } from 'lucide-react';

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
                      <img
                        src={user.avatar || '/default-avatar.png'}
                        alt={user.displayName}
                        onError={(e) => {
                          e.target.src = '/default-avatar.png';
                        }}
                      />
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
