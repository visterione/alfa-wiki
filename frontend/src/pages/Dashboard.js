import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Clock, Star, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pages } from '../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function Dashboard() {
  const { user, hasPermission, isAdmin } = useAuth();
  const [recentPages, setRecentPages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPages();
  }, []);

  const loadPages = async () => {
    try {
      const { data } = await pages.list({ published: 'true', limit: 10 });
      setRecentPages(data.rows || []);
    } catch (error) {
      console.error('Failed to load pages:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Добро пожаловать, {user?.displayName || user?.username}!</h1>
          <p className="text-muted">База знаний медицинского центра</p>
        </div>
        {(isAdmin || hasPermission('pages', 'write')) && (
          <Link to="/new-page" className="btn btn-primary">
            <Plus size={18} />
            Создать страницу
          </Link>
        )}
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Clock size={20} />
              Последние обновления
            </h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <div className="loading-spinner" style={{ margin: '0 auto' }} />
              </div>
            ) : recentPages.length > 0 ? (
              <div className="page-list">
                {recentPages.map(page => (
                  <Link 
                    key={page.id} 
                    to={`/page/${page.slug}`}
                    className="page-list-item"
                  >
                    <div className="page-list-icon">
                      <FileText size={18} />
                    </div>
                    <div className="page-list-content">
                      <div className="page-list-title">{page.title}</div>
                      <div className="page-list-meta">
                        {page.description && (
                          <span className="page-list-desc">
                            {page.description.substring(0, 100)}
                            {page.description.length > 100 ? '...' : ''}
                          </span>
                        )}
                        <span className="page-list-date">
                          {format(new Date(page.updatedAt), 'd MMM yyyy', { locale: ru })}
                        </span>
                      </div>
                    </div>
                    {page.isFavorite && (
                      <Star size={16} style={{ color: 'var(--warning)', fill: 'var(--warning)' }} />
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <FileText size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                <p>Страницы пока не созданы</p>
                {(isAdmin || hasPermission('pages', 'write')) && (
                  <Link to="/new-page" className="btn btn-primary" style={{ marginTop: '16px' }}>
                    Создать первую страницу
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-sidebar">
          <div className="card">
            <div className="card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <TrendingUp size={20} />
                Быстрые действия
              </h3>
            </div>
            <div className="card-body">
              <div className="quick-actions">
                {(isAdmin || hasPermission('pages', 'write')) && (
                  <Link to="/new-page" className="quick-action">
                    <Plus size={20} />
                    <span>Новая страница</span>
                  </Link>
                )}
                {isAdmin && (
                  <>
                    <Link to="/admin/users" className="quick-action">
                      <span>Управление пользователями</span>
                    </Link>
                    <Link to="/admin/sidebar" className="quick-action">
                      <span>Настройка меню</span>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 32px;
        }
        .dashboard-header h1 {
          margin-bottom: 4px;
        }
        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 24px;
        }
        .page-list-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 24px;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-light);
          transition: background var(--transition-fast);
        }
        .page-list-item:last-child {
          border-bottom: none;
        }
        .page-list-item:hover {
          background: var(--bg-secondary);
        }
        .page-list-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary-light);
          color: var(--primary);
          border-radius: var(--radius-sm);
          flex-shrink: 0;
        }
        .page-list-content {
          flex: 1;
          min-width: 0;
        }
        .page-list-title {
          font-weight: 500;
          margin-bottom: 4px;
        }
        .page-list-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .page-list-desc {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .quick-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .quick-action {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--bg-secondary);
          color: var(--text-primary);
          border-radius: var(--radius-sm);
          font-size: 14px;
          transition: all var(--transition-fast);
        }
        .quick-action:hover {
          background: var(--primary-light);
          color: var(--primary);
        }
        @media (max-width: 1024px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
          .dashboard-sidebar {
            order: -1;
          }
        }
      `}</style>
    </div>
  );
}