import React, { useState, useEffect } from 'react';
import { X, Clock, User, FileText, Eye, EyeOff, Download } from 'lucide-react';
import { pages, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './PageHistoryModal.css';

const extractText = (html) =>
  (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export default function PageHistoryModal({ pageId, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState(null);

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

  const getAvatarUrl = (user) => {
    if (!user?.avatar) return null;
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  const handleImageError = (e) => {
    // Скрываем битое изображение и показываем иконку
    e.target.style.display = 'none';
    if (e.target.nextSibling) {
      e.target.nextSibling.style.display = 'flex';
    }
  };

  const handleExportPdf = async () => {
    try {
      setExportingPdf(true);
      const response = await pages.exportHistoryPdf(pageId);

      // Создаем ссылку для скачивания
      const url = `${BASE_URL}/${response.data.filePath}`;
      const link = document.createElement('a');
      link.href = url;
      link.download = response.data.filename || 'page-history.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('PDF отчет успешно создан');
    } catch (error) {
      toast.error('Не удалось создать PDF отчет');
      console.error(error);
    } finally {
      setExportingPdf(false);
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
                        {getAvatarUrl(entry.user) ? (
                          <>
                            <img
                              src={getAvatarUrl(entry.user)}
                              alt=""
                              className="history-avatar"
                              onError={handleImageError}
                            />
                            <div className="history-avatar-placeholder" style={{ display: 'none' }}>
                              <User size={16} />
                            </div>
                          </>
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
                    {entry.changesSummary && !entry.metadata?.changes?.length && (
                      <div className="history-summary">{entry.changesSummary}</div>
                    )}
                    {entry.metadata?.changes?.length > 0 && (
                      <div className="history-changes-list">
                        {entry.metadata.changes.map((c, i) => (
                          <div key={i} className="history-change-item">
                            {/* Скалярные поля: было → стало */}
                            {c.from !== undefined && c.to !== undefined && (
                              <div className="hc-field-change">
                                <span className="hc-label">{c.label}:</span>
                                <span className="hc-old">«{String(c.from).slice(0, 80)}»</span>
                                <span className="hc-arrow">→</span>
                                <span className="hc-new">«{String(c.to).slice(0, 80)}»</span>
                              </div>
                            )}
                            {/* Создание объекта (только to) */}
                            {c.from === undefined && c.to !== undefined && c.field !== 'content' && (
                              <div className="hc-field-change">
                                <span className="hc-label">{c.label}:</span>
                                <span className="hc-new">«{String(c.to).slice(0, 80)}»</span>
                              </div>
                            )}
                            {/* Удаление объекта (только from) */}
                            {c.to === undefined && c.from !== undefined && c.field !== 'content' && (
                              <div className="hc-field-change">
                                <span className="hc-label">{c.label}:</span>
                                <span className="hc-old">«{String(c.from).slice(0, 80)}»</span>
                              </div>
                            )}
                            {/* Просто метка (папка, css, js) */}
                            {c.from === undefined && c.to === undefined && c.field !== 'content' && (
                              <div className="hc-label-only">{c.label}</div>
                            )}
                            {/* Diff содержимого (html/wysiwyg) */}
                            {c.field === 'content' && (c.addedLines || c.removedLines) && (
                              <div className="hc-content-diff">
                                <span className="hc-label">Содержимое:</span>
                                <div className="hc-diff-block">
                                  {c.removedLines?.map((line, j) => (
                                    <div key={`r${j}`} className="hc-diff-line hc-diff-removed">
                                      <span className="hc-diff-sign">−</span>{line}
                                    </div>
                                  ))}
                                  {c.addedLines?.map((line, j) => (
                                    <div key={`a${j}`} className="hc-diff-line hc-diff-added">
                                      <span className="hc-diff-sign">+</span>{line}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Diff таблицы (spreadsheet) */}
                            {c.field === 'content' && c.changedCells && (
                              <div className="hc-content-diff">
                                <span className="hc-label">Таблица:</span>
                                <div className="hc-diff-block">
                                  {c.changedCells.map((cell, j) => (
                                    <div key={j} className="hc-diff-line hc-diff-cell">
                                      <span className="hc-diff-cell-name">{cell.cell}</span>
                                      {cell.from !== '' && <span className="hc-diff-removed-inline">«{String(cell.from).slice(0, 60)}»</span>}
                                      <span className="hc-arrow">→</span>
                                      {cell.to !== '' && <span className="hc-diff-added-inline">«{String(cell.to).slice(0, 60)}»</span>}
                                      {cell.to === '' && <span className="hc-diff-removed-inline">удалено</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Содержимое обновлено (только форматирование) */}
                            {c.field === 'content' && !c.addedLines && !c.removedLines && !c.changedCells && (
                              <div className="hc-label-only">{c.label}</div>
                            )}
                          </div>
                        ))}
                      </div>
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
          <button
            className="btn btn-primary"
            onClick={handleExportPdf}
            disabled={exportingPdf || loading || history.length === 0}
          >
            <Download size={16} />
            {exportingPdf ? 'Формирование PDF...' : 'Экспорт в PDF'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
