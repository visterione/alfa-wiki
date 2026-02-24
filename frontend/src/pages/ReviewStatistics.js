import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Star, MessageSquare,
  TrendingUp, Users, Clock, CheckCircle, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { reviews } from '../services/api';
import { REVIEW_STATUSES, DECISION_CATEGORIES } from '../utils/reviewConstants';
import toast from 'react-hot-toast';
import './ReviewStatistics.css';

const ReviewStatistics = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState(null);
  const [stats, setStats] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [doctorSort, setDoctorSort] = useState({ field: 'avgRating', direction: 'desc' });

  // Даты фильтра (по умолчанию текущий месяц)
  const [dateFrom, setDateFrom] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
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
    }));

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

  const handleDoctorSort = (field) => {
    setDoctorSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedDoctors = useMemo(() => {
    if (!stats?.topDoctors) return [];

    const sorted = [...stats.topDoctors].sort((a, b) => {
      let aVal = a[doctorSort.field];
      let bVal = b[doctorSort.field];

      // Handle name sorting
      if (doctorSort.field === 'name') {
        return doctorSort.direction === 'desc'
          ? bVal.localeCompare(aVal, 'ru')
          : aVal.localeCompare(bVal, 'ru');
      }

      // Handle numeric sorting
      aVal = aVal || 0;
      bVal = bVal || 0;
      return doctorSort.direction === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return sorted;
  }, [stats?.topDoctors, doctorSort]);

  const SortIcon = ({ field }) => {
    if (doctorSort.field !== field) {
      return <ArrowUpDown size={14} className="sort-icon inactive" />;
    }
    return doctorSort.direction === 'desc'
      ? <ArrowDown size={14} className="sort-icon active" />
      : <ArrowUp size={14} className="sort-icon active" />;
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
          <h1>Статистика</h1>
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
                        background: '#3b82f6'
                      }}
                    />
                  </div>
                  <div className="bar-value">{platform.count}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* По решениям */}
        <div className="stats-card">
          <h3>
            <CheckCircle size={18} />
            Принятые решения
          </h3>
          {(() => {
            const totalDecisions = DECISION_CATEGORIES.reduce(
              (sum, cat) => sum + (stats?.decisions?.[cat.id] || 0), 0
            );
            return totalDecisions === 0 ? (
              <div className="no-data">
                Нет финализированных отзывов за период
              </div>
            ) : (
              <div className="chart-container">
                {DECISION_CATEGORIES.map(cat => {
                  const count = stats?.decisions?.[cat.id] || 0;
                  const pct = totalDecisions > 0 ? Math.round((count / totalDecisions) * 100) : 0;
                  return (
                    <div key={cat.id} className="bar-row">
                      <div className="bar-label">{cat.label}</div>
                      <div className="bar-wrapper">
                        <div
                          className="bar"
                          style={{ width: `${pct}%`, background: '#3b82f6' }}
                        />
                      </div>
                      <div className="bar-value">{count}</div>
                    </div>
                  );
                })}
                <div className="decisions-total">
                  Итого: {totalDecisions} из {stats?.finalized || 0} финализированных
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Динамика по времени */}
      {stats?.dailyStats?.data && stats.dailyStats.data.length > 0 && (
        <div className="stats-card full-width">
          <h3>
            <TrendingUp size={18} />
            Динамика {stats.dailyStats.period === 'day' ? 'по дням' : stats.dailyStats.period === 'week' ? 'по неделям' : 'по месяцам'}
          </h3>
          <div className="line-chart-container">
            {(() => {
              const period = stats.dailyStats.period;
              const dateFormat = period === 'month'
                ? { month: 'short', year: 'numeric' }
                : period === 'week'
                ? { day: '2-digit', month: 'short' }
                : { day: '2-digit', month: '2-digit' };

              const chartData = stats.dailyStats.data.map(d => ({
                ...d,
                label: new Date(d.date).toLocaleDateString('ru-RU', dateFormat)
              }));

              const CustomTooltip = ({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="recharts-custom-tooltip">
                    <p className="tooltip-date">{label}</p>
                    {payload.map((entry) => (
                      <p key={entry.dataKey} style={{ color: entry.color }}>
                        {entry.name}: <strong>{entry.value}</strong>
                      </p>
                    ))}
                  </div>
                );
              };

              return (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(148,163,184,0.3)' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="positive"
                      name="Позитивные"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="negative"
                      name="Негативные"
                      stroke="#ef4444"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#ef4444', strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      )}

      {/* Рейтинг врачей (если есть данные) */}
      {stats?.topDoctors && stats.topDoctors.length > 0 && (
        <div className="stats-card full-width">
          <h3>
            <Users size={18} />
            Рейтинг врачей
          </h3>
          <div className="doctors-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="sortable" onClick={() => handleDoctorSort('name')}>
                    Врач <SortIcon field="name" />
                  </th>
                  <th className="sortable" onClick={() => handleDoctorSort('count')}>
                    Отзывов <SortIcon field="count" />
                  </th>
                  <th className="sortable" onClick={() => handleDoctorSort('avgRating')}>
                    Средняя оценка <SortIcon field="avgRating" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedDoctors.map((doc, idx) => (
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
