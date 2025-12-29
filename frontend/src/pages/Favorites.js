import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, FileText, Clock, User, Trash2, ExternalLink, Search, BookmarkX } from 'lucide-react';
import { favorites } from '../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import './Favorites.css';

export default function Favorites() {
  const [favoritesList, setFavoritesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const { data } = await favorites.list();
      setFavoritesList(data);
    } catch (error) {
      console.error('Failed to load favorites:', error);
      toast.error('Ошибка загрузки избранного');
    } finally {
      setLoading(false);
    }
  };

  const removeFavorite = async (pageId, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await favorites.remove(pageId);
      setFavoritesList(prev => prev.filter(f => f.pageId !== pageId));
      toast.success('Удалено из избранного');
    } catch (error) {
      toast.error('Ошибка удаления');
    }
  };

  const filtered = favoritesList.filter(fav => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      fav.page?.title?.toLowerCase().includes(query) ||
      fav.page?.description?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="favorites-page">
        <div className="favorites-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="favorites-page">
      <div className="favorites-header">
        <div className="favorites-header-content">
          <div className="favorites-icon">
            <Star size={28} />
          </div>
          <div>
            <h1>Избранное</h1>
            <p className="favorites-subtitle">
              {favoritesList.length > 0 
                ? `${favoritesList.length} ${favoritesList.length === 1 ? 'страница' : 
                   favoritesList.length < 5 ? 'страницы' : 'страниц'}`
                : 'Нет сохранённых страниц'}
            </p>
          </div>
        </div>
        
        {favoritesList.length > 0 && (
          <div className="favorites-search">
            <Search size={18} />
            <input
              type="text"
              placeholder="Поиск в избранном..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {favoritesList.length === 0 ? (
        <div className="favorites-empty">
          <div className="favorites-empty-icon">
            <BookmarkX size={48} />
          </div>
          <h2>Пока ничего нет</h2>
          <p>Добавляйте страницы в избранное, нажимая на звёздочку при просмотре</p>
          <Link to="/" className="btn btn-primary">
            Перейти на главную
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="favorites-empty">
          <div className="favorites-empty-icon">
            <Search size={48} />
          </div>
          <h2>Ничего не найдено</h2>
          <p>Попробуйте изменить поисковый запрос</p>
        </div>
      ) : (
        <div className="favorites-grid">
          {filtered.map((fav) => (
            <Link 
              key={fav.id} 
              to={`/page/${fav.page?.slug}`} 
              className="favorite-card"
            >
              <div className="favorite-card-header">
                <div className="favorite-card-icon">
                  <FileText size={20} />
                </div>
                <button 
                  className="favorite-card-remove"
                  onClick={(e) => removeFavorite(fav.pageId, e)}
                  title="Удалить из избранного"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              
              <h3 className="favorite-card-title">{fav.page?.title}</h3>
              
              {fav.page?.description && (
                <p className="favorite-card-desc">
                  {fav.page.description.length > 100 
                    ? fav.page.description.substring(0, 100) + '...'
                    : fav.page.description}
                </p>
              )}
              
              <div className="favorite-card-meta">
                {fav.page?.author && (
                  <span className="favorite-card-author">
                    <User size={14} />
                    {fav.page.author.displayName || fav.page.author.username}
                  </span>
                )}
                <span className="favorite-card-date">
                  <Clock size={14} />
                  {format(new Date(fav.page?.updatedAt || fav.createdAt), 'd MMM yyyy', { locale: ru })}
                </span>
              </div>
              
              <div className="favorite-card-action">
                <ExternalLink size={14} />
                Открыть
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}