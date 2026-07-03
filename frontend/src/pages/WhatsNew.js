import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Newspaper, Sparkles, Star, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { releaseNotes as releaseNotesApi } from '../services/api';
import { useSocket } from '../context/SocketContext';
import ContentRenderer from '../components/ContentRenderer';
import './WhatsNew.css';

const PAGE_SIZE = 10;

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch {
    return '';
  }
}

// Короткое текстовое превью из HTML-контента
function excerpt(html, len = 180) {
  try {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > len ? text.slice(0, len) + '…' : text;
  } catch {
    return '';
  }
}

export default function WhatsNew() {
  const { setReleaseUnreadCount } = useSocket();
  const location = useLocation();
  const [notes, setNotes] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [markedRead, setMarkedRead] = useState(false);

  const loadPage = useCallback(async (p) => {
    setLoading(true);
    try {
      const { data } = await releaseNotesApi.list({ page: p, limit: PAGE_SIZE });
      setNotes(data?.items || []);
      setTotalPages(data?.totalPages || 1);
    } catch (error) {
      console.error('Ошибка загрузки нововведений:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page, loadPage]);

  // Открытие центра = всё увидено: один раз помечаем прочитанным и обнуляем badge
  useEffect(() => {
    if (markedRead || loading) return;
    setMarkedRead(true);
    releaseNotesApi.markAllRead()
      .then(() => setReleaseUnreadCount(0))
      .catch(() => {});
  }, [markedRead, loading, setReleaseUnreadCount]);

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Автораскрытие + прокрутка к новости при переходе с якорем (#note-<id>)
  useEffect(() => {
    if (loading || !location.hash) return;
    const id = location.hash.replace('#note-', '');
    setExpanded(prev => new Set(prev).add(id));
    const el = document.querySelector(location.hash);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('whatsnew-card--highlight');
      const t = setTimeout(() => el.classList.remove('whatsnew-card--highlight'), 2000);
      return () => clearTimeout(t);
    }
  }, [loading, location.hash, notes]);

  return (
    <div className="whatsnew-page">
      <div className="whatsnew-header">
        <Newspaper size={26} />
        <h1>Что нового</h1>
      </div>

      {loading ? (
        <div className="whatsnew-empty">Загрузка…</div>
      ) : notes.length === 0 ? (
        <div className="whatsnew-empty">
          <Sparkles size={40} />
          <p>Пока нет нововведений</p>
        </div>
      ) : (
        <>
          <div className="whatsnew-list">
            {notes.map(note => {
              const isOpen = expanded.has(note.id);
              return (
                <article
                  key={note.id}
                  id={`note-${note.id}`}
                  className={`whatsnew-card${note.isRead ? '' : ' whatsnew-card--unread'}`}
                >
                  <button
                    className="whatsnew-card-head"
                    onClick={() => toggle(note.id)}
                    aria-expanded={isOpen}
                  >
                    <div className="whatsnew-card-titles">
                      <h2 className="whatsnew-card-title">
                        {note.severity === 'important' && (
                          <Star size={17} className="whatsnew-star" title="Важное" />
                        )}
                        {note.title}
                      </h2>
                      <div className="whatsnew-card-meta">
                        {note.version && <span className="whatsnew-version">v{note.version}</span>}
                        <span className="whatsnew-date">{formatDate(note.publishedAt)}</span>
                        {!note.isRead && <span className="whatsnew-new-dot" title="Новое" />}
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`whatsnew-chevron${isOpen ? ' whatsnew-chevron--open' : ''}`}
                    />
                  </button>

                  {isOpen ? (
                    <div className="whatsnew-card-body">
                      <ContentRenderer content={note.content} />
                    </div>
                  ) : (
                    excerpt(note.content) && (
                      <p className="whatsnew-card-excerpt" onClick={() => toggle(note.id)}>
                        {excerpt(note.content)}
                      </p>
                    )
                  )}
                </article>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="whatsnew-pagination">
              <button
                className="whatsnew-page-btn"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} /> Назад
              </button>
              <span className="whatsnew-page-info">Страница {page} из {totalPages}</span>
              <button
                className="whatsnew-page-btn"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Далее <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
