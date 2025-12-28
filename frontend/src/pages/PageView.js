import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Edit, Star, StarOff, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pages } from '../services/api';
import toast from 'react-hot-toast';
import './PageView.css';

export default function PageView() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { hasPermission, isAdmin } = useAuth();
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPage();
  }, [slug]);

  const loadPage = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await pages.get(slug);
      setPage(data);
      
      // Apply custom CSS if exists
      if (data.customCss) {
        const styleEl = document.createElement('style');
        styleEl.id = 'page-custom-css';
        styleEl.textContent = data.customCss;
        document.head.appendChild(styleEl);
      }
      
      // Execute custom JS if exists (be careful with this)
      if (data.customJs) {
        try {
          // eslint-disable-next-line no-eval
          eval(data.customJs);
        } catch (e) {
          console.error('Custom JS error:', e);
        }
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Страница не найдена');
      } else if (err.response?.status === 403) {
        setError('У вас нет доступа к этой странице');
      } else {
        setError('Ошибка загрузки страницы');
      }
    } finally {
      setLoading(false);
    }

    return () => {
      const styleEl = document.getElementById('page-custom-css');
      if (styleEl) styleEl.remove();
    };
  };

  const toggleFavorite = async () => {
    try {
      const { data } = await pages.toggleFavorite(page.id);
      setPage({ ...page, isFavorite: data.isFavorite });
      toast.success(data.isFavorite ? 'Добавлено в избранное' : 'Удалено из избранного');
    } catch (error) {
      toast.error('Ошибка');
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <h2>{error}</h2>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          <ArrowLeft size={18} />
          На главную
        </button>
      </div>
    );
  }

  const canEdit = isAdmin || hasPermission('pages', 'write');

  return (
    <div className="page-view">
      <div className="page-header">
        <div className="page-header-content">
          <h1>{page.title}</h1>
          {page.description && (
            <p className="page-description">{page.description}</p>
          )}
        </div>
        <div className="page-actions">
          <button 
            className="btn btn-ghost btn-icon" 
            onClick={toggleFavorite}
            title={page.isFavorite ? 'Убрать из избранного' : 'В избранное'}
          >
            {page.isFavorite ? (
              <Star size={20} style={{ color: 'var(--warning)', fill: 'var(--warning)' }} />
            ) : (
              <StarOff size={20} />
            )}
          </button>
          {canEdit && (
            <Link to={`/page/${slug}/edit`} className="btn btn-primary">
              <Edit size={18} />
              Редактировать
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <div className="page-content" dangerouslySetInnerHTML={{ __html: page.content }} />
      </div>

      {page.keywords && page.keywords.length > 0 && (
        <div className="page-keywords">
          {page.keywords.map((keyword, idx) => (
            <span key={idx} className="badge">{keyword}</span>
          ))}
        </div>
      )}
    </div>
  );
}