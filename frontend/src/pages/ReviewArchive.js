import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Archive, Search, Download, Star, Calendar, User,
  MessageSquare, Filter, ChevronDown, X, ExternalLink, FileText,
  Plus, ArrowRight, UserCheck, CheckCircle2, Clock, Paperclip, Reply
} from 'lucide-react';
import { reviews, BASE_URL } from '../services/api';
import {
  REVIEW_STATUSES, getStatusColor,
  HISTORY_ACTION_LABELS, formatDuration
} from '../utils/reviewConstants';
import toast from 'react-hot-toast';
import './ReviewArchive.css';

const ReviewArchive = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [archiveData, setArchiveData] = useState([]);
  const [boards, setBoards] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });

  // Фильтры
  const [filters, setFilters] = useState({
    boardId: '',
    platformId: '',
    rating: '',
    doctor: '',
    dateFrom: '',
    dateTo: '',
    search: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [doctors, setDoctors] = useState([]);

  // Детали отзыва
  const [selectedReview, setSelectedReview] = useState(null);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadArchive();
  }, [filters, pagination.page]);

  const loadInitialData = async () => {
    try {
      const [boardsRes, platformsRes] = await Promise.all([
        reviews.getBoards(),
        reviews.getPlatforms()
      ]);
      setBoards(boardsRes.data);
      setPlatforms(platformsRes.data);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  };

  const loadArchive = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...Object.fromEntries(
          Object.entries(filters).filter(([_, v]) => v !== '')
        )
      };

      const response = await reviews.getArchive(params);
      setArchiveData(response.data.reviews);
      setPagination(prev => ({ ...prev, total: response.data.total }));

      // Собираем уникальных врачей для автокомплита
      const uniqueDoctors = [...new Set(response.data.reviews
        .map(r => r.doctorName)
        .filter(Boolean))];
      setDoctors(prev => [...new Set([...prev, ...uniqueDoctors])]);
    } catch (err) {
      console.error('Error loading archive:', err);
      toast.error('Ошибка при загрузке архива');
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.page, pagination.limit]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      boardId: '',
      platformId: '',
      rating: '',
      doctor: '',
      dateFrom: '',
      dateTo: '',
      search: ''
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  const openReviewDetails = async (review) => {
    setSelectedReview(review);
    setLoadingHistory(true);
    try {
      const response = await reviews.getReview(review.id);
      setReviewHistory(response.data.history || []);
    } catch (err) {
      console.error('Error loading review details:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDownloadPdf = async (review) => {
    try {
      const response = await reviews.getReviewPdf(review.id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `review-${review.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error downloading PDF:', err);
      toast.error('Ошибка при скачивании PDF');
    }
  };

  const handleRestore = async (review) => {
    if (!window.confirm('Восстановить отзыв из архива?')) return;

    try {
      await reviews.restoreReview(review.id);
      setArchiveData(prev => prev.filter(r => r.id !== review.id));
      setSelectedReview(null);
      toast.success('Отзыв восстановлен');
    } catch (err) {
      console.error('Error restoring review:', err);
      toast.error('Ошибка при восстановлении');
    }
  };

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatDateTime = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Небольшая цветная «плашка» статуса для цепочки переходов
  const StatusChip = ({ label }) => {
    const color = REVIEW_STATUSES.find(s => s.label === label)?.color || '#94a3b8';
    return (
      <span className="status-chip" style={{ color, borderColor: color, background: `${color}1a` }}>
        {label || '—'}
      </span>
    );
  };

  // Метаданные для типа события: иконка, цвет, заголовок и детализированное описание
  const getHistoryMeta = (item) => {
    const userName = item.user?.displayName || item.user?.username || 'Система';
    switch (item.action) {
      case 'created':
        return {
          icon: Plus, color: '#6366f1', title: 'Отзыв создан',
          detail: <>Добавил: <strong>{userName}</strong></>
        };
      case 'status_change':
        return {
          icon: ArrowRight, color: getStatusColor(REVIEW_STATUSES.find(s => s.label === item.newValue)?.id) || '#3b82f6',
          title: 'Смена этапа',
          detail: (
            <span className="status-transition">
              <StatusChip label={item.oldValue} />
              <ArrowRight size={14} className="transition-arrow" />
              <StatusChip label={item.newValue} />
              <span className="transition-actor">· {userName}</span>
            </span>
          )
        };
      case 'assignment':
        return {
          icon: UserCheck, color: '#0ea5e9',
          title: item.newValue && item.newValue !== 'Снято назначение' ? 'Назначен ответственный' : 'Назначение снято',
          detail: item.newValue && item.newValue !== 'Снято назначение'
            ? <><strong>{userName}</strong> назначил ответственным: <strong>{item.newValue}</strong></>
            : <><strong>{userName}</strong> снял назначение</>
        };
      case 'finalized':
        return {
          icon: CheckCircle2, color: '#10b981', title: 'Решение принято',
          detail: <><strong>{userName}</strong> финализировал отзыв. Решение: <strong>{item.newValue}</strong></>
        };
      case 'file_upload':
        return {
          icon: Paperclip, color: '#8b5cf6', title: 'Загружен файл',
          detail: <><strong>{userName}</strong> прикрепил файлы</>
        };
      case 'replied':
        return {
          icon: Reply, color: '#f59e0b', title: 'Ответ на площадке',
          detail: <>Отправил: <strong>{userName}</strong></>
        };
      case 'comment':
      default:
        return {
          icon: MessageSquare, color: '#64748b',
          title: HISTORY_ACTION_LABELS[item.action] || 'Комментарий',
          detail: <><strong>{userName}</strong></>
        };
    }
  };

  const getRatingStars = (rating) => {
    if (!rating) return null;
    const r = parseInt(rating);
    return (
      <div className="rating-stars">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            size={14}
            fill={i <= r ? '#f59e0b' : 'none'}
            color={i <= r ? '#f59e0b' : '#d1d5db'}
          />
        ))}
      </div>
    );
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="review-archive-page">
      <div className="archive-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate('/reviews')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1>
              <Archive size={24} />
              Архив отзывов
            </h1>
            <p>Все обработанные отзывы со всех досок</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Поиск по тексту..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
            />
            {filters.search && (
              <button onClick={() => handleFilterChange('search', '')}>
                <X size={16} />
              </button>
            )}
          </div>

          <button
            className={`btn-filter ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={18} />
            Фильтры
            {hasActiveFilters && <span className="filter-count">!</span>}
            <ChevronDown size={16} className={showFilters ? 'rotated' : ''} />
          </button>
        </div>
      </div>

      {/* Панель фильтров */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filters-grid">
            <div className="filter-group">
              <label>Медцентр</label>
              <select
                value={filters.boardId}
                onChange={(e) => handleFilterChange('boardId', e.target.value)}
              >
                <option value="">Все медцентры</option>
                {boards.map(board => (
                  <option key={board.id} value={board.id}>{board.name}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Площадка</label>
              <select
                value={filters.platformId}
                onChange={(e) => handleFilterChange('platformId', e.target.value)}
              >
                <option value="">Все площадки</option>
                {platforms.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Оценка</label>
              <select
                value={filters.rating}
                onChange={(e) => handleFilterChange('rating', e.target.value)}
              >
                <option value="">Любая</option>
                {[5, 4, 3, 2, 1].map(r => (
                  <option key={r} value={r}>{'★'.repeat(r)} ({r})</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Врач</label>
              <input
                type="text"
                list="doctors-list"
                placeholder="Введите имя врача"
                value={filters.doctor}
                onChange={(e) => handleFilterChange('doctor', e.target.value)}
              />
              <datalist id="doctors-list">
                {doctors.map((d, i) => (
                  <option key={i} value={d} />
                ))}
              </datalist>
            </div>

            <div className="filter-group">
              <label>Дата от</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              />
            </div>

            <div className="filter-group">
              <label>Дата до</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              />
            </div>
          </div>

          {hasActiveFilters && (
            <button className="btn-clear-filters" onClick={clearFilters}>
              <X size={16} />
              Сбросить фильтры
            </button>
          )}
        </div>
      )}

      {/* Статистика */}
      <div className="archive-stats">
        <span>Найдено: <strong>{pagination.total}</strong> отзывов</span>
      </div>

      {/* Таблица */}
      <div className="archive-content">
        {loading ? (
          <div className="archive-loading">
            <div className="loading-spinner" />
            <p>Загрузка архива...</p>
          </div>
        ) : archiveData.length === 0 ? (
          <div className="archive-empty">
            <Archive size={64} strokeWidth={1} />
            <h2>Архив пуст</h2>
            <p>
              {hasActiveFilters
                ? 'Нет отзывов, соответствующих фильтрам'
                : 'Пока нет обработанных отзывов'}
            </p>
          </div>
        ) : (
          <>
            <div className="archive-table-wrapper">
              <table className="archive-table">
                <thead>
                  <tr>
                    <th>Дата отзыва</th>
                    <th>Медцентр</th>
                    <th>Пациент</th>
                    <th>Площадка</th>
                    <th>Врач</th>
                    <th>Оценка</th>
                    <th>Решение</th>
                    <th>Финализирован</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {archiveData.map(review => (
                    <tr key={review.id} onClick={() => openReviewDetails(review)}>
                      <td>{formatDate(review.reviewDate)}</td>
                      <td>
                        <span className="board-name">{review.board?.name || '—'}</span>
                      </td>
                      <td>
                        <div className="patient-cell">
                          <User size={14} />
                          {review.patientName}
                        </div>
                      </td>
                      <td>
                        <span className="platform-badge">
                          {review.platform?.name || '—'}
                        </span>
                      </td>
                      <td>{review.doctorName || '—'}</td>
                      <td>{getRatingStars(review.rating)}</td>
                      <td>
                        <span className={`decision-badge ${review.decisionCategory || 'none'}`}>
                          {review.decisionCategory === 'positive' && 'Положительное'}
                          {review.decisionCategory === 'negative' && 'Отрицательное'}
                          {review.decisionCategory === 'neutral' && 'Нейтральное'}
                          {!review.decisionCategory && '—'}
                        </span>
                      </td>
                      <td>{formatDate(review.finalizedAt)}</td>
                      <td>
                        <div className="row-actions" onClick={e => e.stopPropagation()}>
                          {review.reportPdfPath && (
                            <button
                              className="btn-icon"
                              onClick={() => handleDownloadPdf(review)}
                              title="Скачать PDF"
                            >
                              <Download size={16} />
                            </button>
                          )}
                          <button
                            className="btn-icon"
                            onClick={() => navigate(`/reviews/board/${review.boardId}`)}
                            title="Перейти к доске"
                          >
                            <ExternalLink size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Пагинация */}
            {totalPages > 1 && (
              <div className="archive-pagination">
                <button
                  disabled={pagination.page === 1}
                  onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                >
                  ← Назад
                </button>
                <span>
                  Страница {pagination.page} из {totalPages}
                </span>
                <button
                  disabled={pagination.page >= totalPages}
                  onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                >
                  Вперёд →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Модальное окно деталей */}
      {selectedReview && (
        <div className="modal-overlay" onClick={() => setSelectedReview(null)}>
          <div className="modal-content large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FileText size={20} />
                Отзыв от {formatDate(selectedReview.reviewDate)}
              </h3>
              <button className="btn-close" onClick={() => setSelectedReview(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="review-details-grid">
                <div className="detail-row">
                  <span className="label">Медцентр:</span>
                  <span className="value">{selectedReview.board?.name}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Пациент:</span>
                  <span className="value">{selectedReview.patientName}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Площадка:</span>
                  <span className="value">{selectedReview.platform?.name || '—'}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Врач:</span>
                  <span className="value">{selectedReview.doctorName || '—'}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Оценка:</span>
                  <span className="value">{getRatingStars(selectedReview.rating)}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Финализирован:</span>
                  <span className="value">{formatDateTime(selectedReview.finalizedAt)}</span>
                </div>
              </div>

              <div className="review-text-section">
                <h4>Текст отзыва</h4>
                <div className="review-text">{selectedReview.reviewText || 'Нет текста'}</div>
              </div>

              {selectedReview.additionalInfo && (
                <div className="review-text-section">
                  <h4>Дополнительная информация</h4>
                  <div className="review-text">{selectedReview.additionalInfo}</div>
                </div>
              )}

              {selectedReview.decisionCategory && (
                <div className="decision-section">
                  <h4>Принятое решение</h4>
                  <div className={`decision-block ${selectedReview.decisionCategory}`}>
                    <span className="decision-label">
                      {selectedReview.decisionCategory === 'positive' && '✓ Положительное решение'}
                      {selectedReview.decisionCategory === 'negative' && '✗ Отрицательное решение'}
                      {selectedReview.decisionCategory === 'neutral' && '○ Нейтральное решение'}
                    </span>
                    {selectedReview.decisionDescription && (
                      <p className="decision-description">{selectedReview.decisionDescription}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="history-section">
                <h4>История обработки</h4>
                {loadingHistory ? (
                  <div className="loading-spinner small" />
                ) : reviewHistory.length === 0 ? (
                  <p className="no-history">Нет записей в истории</p>
                ) : (
                  <div className="history-timeline history-timeline--rich">
                    {(() => {
                      // История приходит отсортированной по возрастанию. Считаем,
                      // сколько отзыв простоял на предыдущем этапе до каждой смены статуса.
                      const sorted = [...reviewHistory].sort(
                        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
                      );
                      let stageStart = sorted[0]?.createdAt || null;

                      return sorted.map((item, idx) => {
                        const meta = getHistoryMeta(item);
                        const Icon = meta.icon;

                        // Длительность предыдущего этапа для событий смены статуса/финализации
                        let stageDuration = null;
                        if (item.action === 'status_change' || item.action === 'finalized') {
                          if (stageStart) stageDuration = formatDuration(stageStart, item.createdAt);
                          stageStart = item.createdAt;
                        }

                        return (
                          <div key={item.id || idx} className="history-item">
                            <div className="history-dot" style={{ background: meta.color, boxShadow: `0 0 0 3px ${meta.color}22` }}>
                              <Icon size={12} color="#fff" />
                            </div>
                            <div className="history-content" style={{ borderLeft: `3px solid ${meta.color}` }}>
                              <div className="history-header">
                                <span className="history-action" style={{ color: meta.color }}>{meta.title}</span>
                                <span className="history-date">{formatDateTime(item.createdAt)}</span>
                              </div>
                              <div className="history-detail">{meta.detail}</div>
                              {stageDuration && (
                                <div className="history-stage-duration" style={{ color: meta.color, borderColor: `${meta.color}55` }}>
                                  <Clock size={11} />
                                  <span>Предыдущий этап длился {stageDuration}</span>
                                </div>
                              )}
                              {item.comment && (
                                <div className="history-comment">{item.comment}</div>
                              )}
                              {item.attachments && item.attachments.length > 0 && (
                                <div className="history-attachments">
                                  {item.attachments.map((file, i) => (
                                    <a
                                      key={i}
                                      href={`${BASE_URL}/${file.path}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="history-attachment-link"
                                    >
                                      <Paperclip size={12} />
                                      <span>{file.filename}</span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => handleRestore(selectedReview)}>
                Восстановить из архива
              </button>
              {selectedReview.reportPdfPath && (
                <button className="btn-primary" onClick={() => handleDownloadPdf(selectedReview)}>
                  <Download size={16} />
                  Скачать PDF
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewArchive;
