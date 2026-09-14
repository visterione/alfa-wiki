import React, { useEffect } from 'react';
import { X, User, Check, Clock } from 'lucide-react';
import { BASE_URL } from '../../services/api';
import { readersOf, formatSeenAt } from '../../utils/readReceipts';

// Кто и когда просмотрел сообщение (ver. 8.26).
//
// Отдельное окно, а не подпись под сообщением: в личной переписке время нужно
// изредка, а в группе на двадцать человек список не поместился бы в ленту.
// Галочка в ленте отвечает на вопрос «прочитано ли», окно — на вопрос «кем и
// во сколько».

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

const ReaderAvatar = ({ avatar, displayName }) => {
  const [broken, setBroken] = React.useState(false);
  const url = getAvatarUrl(avatar);

  if (!url || broken) {
    return (
      <div className="read-receipt-avatar-placeholder">
        <User size={16} />
      </div>
    );
  }
  return <img className="read-receipt-avatar" src={url} alt={displayName} onError={() => setBroken(true)} />;
};

const ReadReceiptsModal = ({ message, members, onClose }) => {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const readers = readersOf(members, message);
  const readIds = new Set(readers.map(r => String(r.userId)));
  const pending = (members || []).filter(m => !readIds.has(String(m.userId)));

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="read-receipts-backdrop" onClick={handleBackdropClick}>
      <div className="read-receipts-modal">
        <div className="read-receipts-header">
          <h3>Кто прочитал</h3>
          <button className="read-receipts-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="read-receipts-content">
          {readers.length === 0 && pending.length === 0 && (
            <div className="read-receipts-empty"><p>В чате больше никого нет</p></div>
          )}

          {readers.length > 0 && (
            <div className="read-receipts-group">
              <div className="read-receipts-group-title">
                <Check size={14} /> Прочитали
                {members.length > 1 && <span className="count">{readers.length} из {members.length}</span>}
              </div>
              {readers.map(reader => (
                <div key={reader.userId} className="read-receipt-item">
                  <ReaderAvatar avatar={reader.avatar} displayName={reader.displayName} />
                  <span className="read-receipt-name">{reader.displayName}</span>
                  <span className="read-receipt-time">{formatSeenAt(reader.at)}</span>
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div className="read-receipts-group">
              <div className="read-receipts-group-title">
                <Clock size={14} /> Ещё не открыли
                <span className="count">{pending.length}</span>
              </div>
              {pending.map(member => (
                <div key={member.userId} className="read-receipt-item read-receipt-item--pending">
                  <ReaderAvatar avatar={member.avatar} displayName={member.displayName} />
                  <span className="read-receipt-name">{member.displayName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReadReceiptsModal;
