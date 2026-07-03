import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ContentRenderer from './ContentRenderer';
import './ReleaseNoteModal.css';

// Показывает важные непрочитанные нововведения при входе.
// notes — массив полных объектов release note; onClose(ids) вызывается при закрытии.
export default function ReleaseNoteModal({ notes, onClose }) {
  const navigate = useNavigate();

  if (!notes || notes.length === 0) return null;

  const ids = notes.map(n => n.id);

  const handleClose = () => onClose(ids);

  const handleOpenCenter = () => {
    onClose(ids);
    navigate('/whats-new');
  };

  return (
    <div className="rnm-overlay" onClick={handleClose}>
      <div className="rnm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rnm-head">
          <div className="rnm-head-title">
            <Sparkles size={20} />
            <span>Что нового</span>
          </div>
          <button className="rnm-close" onClick={handleClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="rnm-body">
          {notes.map(note => (
            <div key={note.id} className="rnm-note">
              <div className="rnm-note-title">
                {note.title}
                {note.version && <span className="rnm-ver">v{note.version}</span>}
              </div>
              <div className="rnm-note-content">
                <ContentRenderer content={note.content} />
              </div>
            </div>
          ))}
        </div>

        <div className="rnm-footer">
          <button className="rnm-btn rnm-btn-ghost" onClick={handleOpenCenter}>
            Все обновления
          </button>
          <button className="rnm-btn rnm-btn-primary" onClick={handleClose}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
