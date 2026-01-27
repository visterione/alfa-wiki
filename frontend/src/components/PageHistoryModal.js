import React, { useState, useEffect } from 'react';
import { X, Clock, User, FileText, Eye, EyeOff } from 'lucide-react';
import { pages } from '../services/api';
import toast from 'react-hot-toast';
import './PageHistoryModal.css';

export default function PageHistoryModal({ pageId, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [pageId]);

  const loadHistory = async () => {
    try {
      const { data } = await pages.getHistory(pageId);
      setHistory(data);
    } catch (error) {
      toast.error('Не удалось загрузить историю');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'created':
        return <FileText size={16} />;
      case 'published':
        return <Eye size={16} />;
      case 'unpublished':
        return <EyeOff size={16} />;
      default:
        return <Clock size={16} />;
    }
  };

  const getActionLabel = (action) => {
    switch (action) {
      case 'created':
        return 'Создание';
      case 'updated':
        return 'Редактирование';
      case 'published':
        return 'Публикация';
      case 'unpublished':
        return 'Снятие публикации';
      default:
        return action;
    }
  };

  const getActionClass = (action) => {
    switch (action) {
      case 'created':
        return 'action-created';
      case 'published':
        return 'action-published';
      case 'unpublished':
        return 'action-unpublished';
      default:
        return 'action-updated';
    }
  };

  return (
    <div className="page-history-modal-overlay" onClick={onClose}>
      <div className="page-history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-history-modal-header">
          <h3>
            <Clock size={20} />
            Журнал изменений
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="page-history-modal-body">
          {loading ? (
            <div className="page-history-loading">
              <div className="loading-spinner" />
              <p>Загрузка истории...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="page-history-empty">
              <Clock size={48} />
              <p>История изменений пуста</p>
            </div>
          ) : (
            <div className="page-history-timeline">
              {history.map((entry) => (
                <div key={entry.id} className="page-history-entry">
                  <div className={`history-action-badge ${getActionClass(entry.action)}`}>
                    {getActionIcon(entry.action)}
                  </div>
                  <div className="history-content">
                    <div className="history-header">
                      <div className="history-user">
                        {entry.user?.avatar ? (
                          <img src={entry.user.avatar} alt="" className="history-avatar" />
                        ) : (
                          <div className="history-avatar-placeholder">
                            <User size={16} />
                          </div>
                        )}
                        <span className="history-username">
                          {entry.user?.displayName || entry.user?.username || 'Неизвестный'}
                        </span>
                      </div>
                      <span className="history-action-label">
                        {getActionLabel(entry.action)}
                      </span>
                    </div>
                    {entry.changesSummary && (
                      <div className="history-summary">{entry.changesSummary}</div>
                    )}
                    <div className="history-date">
                      <Clock size={14} />
                      {formatDate(entry.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="page-history-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
