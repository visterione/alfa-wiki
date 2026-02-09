import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, Calendar, Star, MessageSquare,
  TrendingUp, Users, Clock, CheckCircle
} from 'lucide-react';
import { reviews } from '../services/api';
import { REVIEW_STATUSES, getStatusById } from '../utils/reviewConstants';
import toast from 'react-hot-toast';
import './ReviewStatistics.css';

const ReviewStatistics = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState(null);
  const [stats, setStats] = useState(null);
  const [platforms, setPlatforms] = useState([]);

  // Даты фильтра (по умолчанию текущий месяц)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
  });

  useEffect(() => {
    loadData();
  }, [boardId, dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [boardRes, statsRes, platformsRes] = await Promise.all([
        reviews.getBoard(boardId),
        reviews.getStats({ boardId, from: dateFrom, to: dateTo }),
        reviews.getPlatforms()
      ]);
      setBoard(boardRes.data);
      setStats(statsRes.data);
      setPlatforms(platformsRes.data);
    } catch (err) {
      console.error('Error loading statistics:', err);
      toast.error('Ошибка при загрузке статистики');
    } finally {
      setLoading(false);
    }
  };

  const setQuickPeriod = (period) => {
    const now = new Date();
    let from, to;

    switch (period) {
      case 'week':
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        to = now;
        break;
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        from = new Date(now.getFullYear(), quarter * 3, 1);
        to = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
        break;
      case 'year':
        from = new Date(now.getFullYear(), 0, 1);
        to = new Date(now.getFullYear(), 11, 31);
        break;
      default:
        return;
    }

    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
  };

  // Вычисляемые данные для графиков
  const chartData = useMemo(() => {
    if (!stats) return null;

    // Распределение по статусам
    const statusData = REVIEW_STATUSES.map(s => ({
      ...s,
      count: stats.byStatus?.[s.id] || 0
    }));

    // Распределение по площадкам
    const platformData = platforms.map(p => ({
      ...p,
      count: stats.byPlatform?.[p.id] || 0
    })).filter(p => p.count > 0);

    // Распределение по оценкам
    const ratingData = [5, 4, 3, 2, 1].map(r => ({
      rating: r,
      count: stats.byRating?.[r] || 0
    }));

    // Максимумы для нормализации
    const maxStatus = Math.max(...statusData.map(s => s.count), 1);
    const maxPlatform = Math.max(...platformData.map(p => p.count), 1);
    const maxRating = Math.max(...ratingData.map(r => r.count), 1);

    return {
      statusData,
      platformData,
      ratingData,
      maxStatus,
      maxPlatform,
      maxRating
    };
  }, [stats, platforms]);

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="review-stats-loading">
        <div className="loading-spinner" />
        <p>Загрузка статистики...</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="review-stats-error">
        <p>Доска не найдена</p>
        <button onClick={() => navigate('/reviews')}>Назад к доскам</button>
      </div>
    );
  }

  return (
    <div className="review-stats-page">
      <div className="stats-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate(`/reviews/board/${boardId}`)}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1>
              <BarChart3 size={24} />
              Статистика
            </h1>
            <p>{board.name}</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="date-range">
            <Calendar size={18} />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span>—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="quick-periods">
            <button onClick={() => setQuickPeriod('week')}>Неделя</button>
            <button onClick={() => setQuickPeriod('month')}>Месяц</button>
            <button onClick={() => setQuickPeriod('quarter')}>Квартал</button>
            <button onClick={() => setQuickPeriod('year')}>Год</button>
          </div>
        </div>
      </div>

      <div className="stats-period-info">
        Период: {formatDate(dateFrom)} — {formatDate(dateTo)}
      </div>

      {/* Общие показатели */}
      <div className="stats-summary">
        <div className="summary-card">
          <div className="card-icon blue">
            <MessageSquare size={24} />
          </div>
          <div className="card-content">
            <span className="card-value">{stats?.total || 0}</span>
            <span className="card-label">Всего отзывов</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon yellow">
            <Star size={24} />
          </div>
          <div className="card-content">
            <span className="card-value">{stats?.avgRating?.toFixed(1) || '—'}</span>
            <span className="card-label">Средняя оценка</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon green">
            <CheckCircle size={24} />
          </div>
          <div className="card-content">
            <span className="card-value">{stats?.finalized || 0}</span>
            <span className="card-label">Обработано</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon purple">
            <Clock size={24} />
          </div>
          <div className="card-content">
            <span className="card-value">{stats?.pending || 0}</span>
            <span className="card-label">В работе</span>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        {/* По статусам */}
        <div className="stats-card">
          <h3>
            <TrendingUp size={18} />
            По статусам
          </h3>
          <div className="chart-container">
            {chartData?.statusData.map(status => (
              <div key={status.id} className="bar-row">
                <div className="bar-label">
                  <span
                    className="status-dot"
                    style={{ background: status.color }}
                  />
                  {status.label}
                </div>
                <div className="bar-wrapper">
                  <div
                    className="bar"
                    style={{
                      width: `${(status.count / chartData.maxStatus) * 100}%`,
                      background: status.color
                    }}
                  />
                </div>
                <div className="bar-value">{status.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* По площадкам */}
        <div className="stats-card">
          <h3>
            <Users size={18} />
            По площадкам
          </h3>
          <div className="chart-container">
            {chartData?.platformData.length === 0 ? (
              <div className="no-data">Нет данных</div>
            ) : (
              chartData?.platformData.map(platform => (
                <div key={platform.id} className="bar-row">
                  <div className="bar-label">{platform.name}</div>
                  <div className="bar-wrapper">
                    <div
                      className="bar"
                      style={{
                        width: `${(platform.count / chartData.maxPlatform) * 100}%`,
                        background: '#a855f7'
                      }}
                    />
                  </div>
                  <div className="bar-value">{platform.count}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* По оценкам */}
        <div className="stats-card">
          <h3>
            <Star size={18} />
            По оценкам
          </h3>
          <div className="chart-container ratings-chart">
            {chartData?.ratingData.map(item => (
              <div key={item.rating} className="rating-row">
                <div className="rating-label">
                  {[...Array(item.rating)].map((_, i) => (
                    <Star key={i} size={14} fill="#f59e0b" color="#f59e0b" />
                  ))}
                </div>
                <div className="bar-wrapper">
                  <div
                    className="bar"
                    style={{
                      width: `${(item.count / chartData.maxRating) * 100}%`,
                      background: item.rating >= 4 ? '#10b981' : item.rating >= 3 ? '#f59e0b' : '#ef4444'
                    }}
                  />
                </div>
                <div className="bar-value">{item.count}</div>
              </div>
            ))}
          </div>

          {/* Распределение оценок в процентах */}
          <div className="rating-distribution">
            {chartData?.ratingData.map(item => {
              const percentage = stats?.total ? Math.round((item.count / stats.total) * 100) : 0;
              return (
                <div key={item.rating} className="distribution-item">
                  <span className="dist-rating">{item.rating}★</span>
                  <div className="dist-bar-wrapper">
                    <div
                      className="dist-bar"
                      style={{
                        width: `${percentage}%`,
                        background: item.rating >= 4 ? '#10b981' : item.rating >= 3 ? '#f59e0b' : '#ef4444'
                      }}
                    />
                  </div>
                  <span className="dist-percent">{percentage}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* По решениям */}
        <div className="stats-card">
          <h3>
            <CheckCircle size={18} />
            Принятые решения
          </h3>
          <div className="decisions-chart">
            <div className="decision-item positive">
              <div className="decision-icon">✓</div>
              <div className="decision-info">
                <span className="decision-label">Положительные</span>
                <span className="decision-value">{stats?.decisions?.positive || 0}</span>
              </div>
              <div
                className="decision-bar"
                style={{
                  width: `${stats?.finalized ? ((stats.decisions?.positive || 0) / stats.finalized) * 100 : 0}%`
                }}
              />
            </div>

            <div className="decision-item neutral">
              <div className="decision-icon">○</div>
              <div className="decision-info">
                <span className="decision-label">Нейтральные</span>
                <span className="decision-value">{stats?.decisions?.neutral || 0}</span>
              </div>
              <div
                className="decision-bar"
                style={{
                  width: `${stats?.finalized ? ((stats.decisions?.neutral || 0) / stats.finalized) * 100 : 0}%`
                }}
              />
            </div>

            <div className="decision-item negative">
              <div className="decision-icon">✗</div>
              <div className="decision-info">
                <span className="decision-label">Отрицательные</span>
                <span className="decision-value">{stats?.decisions?.negative || 0}</span>
              </div>
              <div
                className="decision-bar"
                style={{
                  width: `${stats?.finalized ? ((stats.decisions?.negative || 0) / stats.finalized) * 100 : 0}%`
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Топ врачей (если есть данные) */}
      {stats?.topDoctors && stats.topDoctors.length > 0 && (
        <div className="stats-card full-width">
          <h3>
            <Users size={18} />
            Топ врачей по количеству отзывов
          </h3>
          <div className="doctors-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Врач</th>
                  <th>Отзывов</th>
                  <th>Средняя оценка</th>
                  <th>Положительных</th>
                  <th>Отрицательных</th>
                </tr>
              </thead>
              <tbody>
                {stats.topDoctors.map((doc, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{doc.name}</td>
                    <td>{doc.count}</td>
                    <td>
                      <span className="doctor-rating">
                        <Star size={14} fill="#f59e0b" color="#f59e0b" />
                        {doc.avgRating?.toFixed(1) || '—'}
                      </span>
                    </td>
                    <td className="positive-count">{doc.positive || 0}</td>
                    <td className="negative-count">{doc.negative || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewStatistics;
