import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Newspaper, ChevronRight, Sparkles, Star } from 'lucide-react';
import { releaseNotes as releaseNotesApi } from '../services/api';
import { useSocket } from '../context/SocketContext';
import './WhatsNewMenu.css';

// Короткое текстовое превью из HTML-контента новости
function excerpt(html, len = 120) {
  try {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > len ? text.slice(0, len) + '…' : text;
  } catch {
    return '';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

const PREVIEW_LIMIT = 5;

export default function WhatsNewMenu() {
  const navigate = useNavigate();
  const { releaseUnreadCount, setReleaseUnreadCount } = useSocket();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadPreview();
  };

  const loadPreview = async () => {
    setLoading(true);
    try {
      const { data } = await releaseNotesApi.list({ page: 1, limit: PREVIEW_LIMIT });
      setNotes(data?.items || []);
    } catch (error) {
      console.error('Ошибка загрузки превью нововведений:', error);
    } finally {
      setLoading(false);
    }
  };

  const openNote = async (note) => {
    setOpen(false);
    if (!note.isRead) {
      try {
        await releaseNotesApi.markRead(note.id);
        const { data } = await releaseNotesApi.unreadCount();
        setReleaseUnreadCount(data.count || 0);
      } catch {}
    }
    navigate(`/whats-new#note-${note.id}`);
  };

  const openAll = () => {
    setOpen(false);
    navigate('/whats-new');
  };

  return (
    <div className="wnm" ref={ref}>
      <button className="wnm-btn" onClick={toggle} title="Что нового">
        <Newspaper size={20} />
        {releaseUnreadCount > 0 && (
          <span className="wnm-badge">{releaseUnreadCount > 99 ? '99+' : releaseUnreadCount}</span>
        )}
      </button>

      {open && (
        <div className="wnm-dropdown">
          <div className="wnm-dropdown-head">
            <Newspaper size={16} />
            <span>Что нового</span>
          </div>

          <div className="wnm-list">
            {loading ? (
              <div className="wnm-state">Загрузка…</div>
            ) : notes.length === 0 ? (
              <div className="wnm-state">
                <Sparkles size={26} />
                <span>Пока нет нововведений</span>
              </div>
            ) : (
              notes.map(note => (
                <button
                  key={note.id}
                  className={`wnm-item${note.isRead ? '' : ' wnm-item--unread'}`}
                  onClick={() => openNote(note)}
                >
                  <div className="wnm-item-top">
                    {note.severity === 'important' && (
                      <Star size={14} className="wnm-star" title="Важное" />
                    )}
                    <span className="wnm-item-title">{note.title}</span>
                    {!note.isRead && <span className="wnm-dot" />}
                  </div>
                  <div className="wnm-item-meta">
                    {note.version && <span className="wnm-ver">v{note.version}</span>}
                    <span className="wnm-date">{formatDate(note.publishedAt)}</span>
                  </div>
                  {excerpt(note.content) && (
                    <div className="wnm-item-excerpt">{excerpt(note.content)}</div>
                  )}
                </button>
              ))
            )}
          </div>

          <button className="wnm-more" onClick={openAll}>
            Все обновления
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
