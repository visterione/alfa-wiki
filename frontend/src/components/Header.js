import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, Search, User, LogOut, ChevronDown, Shield, FileText, Star, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { search as searchApi, chat, BASE_URL } from '../services/api';
import './Header.css';

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Загружаем количество непрочитанных сообщений
  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 10000); // Обновляем каждые 10 сек
    return () => clearInterval(interval);
  }, []);

  const loadUnreadCount = async () => {
    try {
      const { data } = await chat.getUnreadCount();
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        try {
          const { data } = await searchApi.query(searchQuery);
          setSearchResults(data.results || []);
          setShowResults(true);
        } catch (error) {
          console.error('Search error:', error);
        }
      } else {
        setSearchResults([]);
        setShowResults(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleResultClick = (result) => {
    setShowResults(false);
    setSearchQuery('');
    navigate(result.url);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getAvatarUrl = () => {
    if (!user?.avatar) return null;
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  const getLogoUrl = () => {
    if (!theme?.logo) return null;
    if (theme.logo.startsWith('http://localhost')) {
      const path = theme.logo.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (theme.logo.startsWith('http')) return theme.logo;
    return `${BASE_URL}/${theme.logo}`;
  };

  // Функция для подсветки найденного текста
  const highlightText = (text, query) => {
    if (!text || !query) return text;
    
    const parts = [];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let lastIndex = 0;
    let index = lowerText.indexOf(lowerQuery);
    
    while (index !== -1) {
      // Добавляем текст до совпадения
      if (index > lastIndex) {
        parts.push({
          text: text.substring(lastIndex, index),
          highlight: false
        });
      }
      
      // Добавляем совпадение
      parts.push({
        text: text.substring(index, index + query.length),
        highlight: true
      });
      
      lastIndex = index + query.length;
      index = lowerText.indexOf(lowerQuery, lastIndex);
    }
    
    // Добавляем оставшийся текст
    if (lastIndex < text.length) {
      parts.push({
        text: text.substring(lastIndex),
        highlight: false
      });
    }
    
    return parts;
  };

  const isOnChat = location.pathname === '/';

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-toggle" onClick={onToggleSidebar}>
          <Menu size={20} />
        </button>
        <Link to="/" className="header-logo">
          {getLogoUrl() ? (
            <img src={getLogoUrl()} alt={theme?.siteName || 'Wiki'} />
          ) : (
            theme?.siteName || 'Alfa Wiki'
          )}
        </Link>
      </div>

      <div className="header-center">
        <div className="header-search" ref={searchRef}>
          <Search size={18} />
          <input
            type="text"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {showResults && (
            <div className="search-dropdown">
              {searchResults.length > 0 ? (
                searchResults.map((result, idx) => (
                  <div
                    key={idx}
                    className="search-result"
                    onClick={() => handleResultClick(result)}
                  >
                    <FileText size={16} />
                    <div className="search-result-content">
                      <div className="search-result-title">
                        {highlightText(result.title, searchQuery).map((part, i) => (
                          part.highlight ? (
                            <mark key={i}>{part.text}</mark>
                          ) : (
                            <span key={i}>{part.text}</span>
                          )
                        ))}
                      </div>
                      {result.excerpt && (
                        <div className="search-result-excerpt">
                          {highlightText(result.excerpt, searchQuery).map((part, i) => (
                            part.highlight ? (
                              <mark key={i}>{part.text}</mark>
                            ) : (
                              <span key={i}>{part.text}</span>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="search-no-results">Ничего не найдено</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        {/* Кнопка Чата */}
        <Link to="/" className={`header-icon-btn ${isOnChat ? 'active' : ''}`} title="Сообщения">
          <MessageCircle size={20} />
          {unreadCount > 0 && (
            <span className="header-icon-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        {/* Кнопка Избранного */}
        <Link to="/favorites" className={`header-icon-btn ${location.pathname === '/favorites' ? 'active' : ''}`} title="Избранное">
          <Star size={20} />
        </Link>

        {/* User Dropdown */}
        <div className="header-user" ref={dropdownRef}>
          <button 
            className="header-user-btn"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <div className="header-avatar">
              {getAvatarUrl() ? (
                <img src={getAvatarUrl()} alt="" />
              ) : (
                <User size={18} />
              )}
            </div>
            <span className="header-username">{user?.displayName || user?.username}</span>
            <ChevronDown size={16} className="header-chevron" />
          </button>

          {showDropdown && (
            <div className="header-dropdown">
              <div className="header-dropdown-user">
                <div className="header-dropdown-avatar">
                  {getAvatarUrl() ? (
                    <img src={getAvatarUrl()} alt="" />
                  ) : (
                    <User size={24} />
                  )}
                </div>
                <div className="header-dropdown-info">
                  <div className="header-dropdown-name">{user?.displayName || user?.username}</div>
                  <div className="header-dropdown-role">{user?.role?.name || 'Пользователь'}</div>
                </div>
              </div>
              
              
              <Link 
                to="/profile" 
                className="header-dropdown-item"
                onClick={() => setShowDropdown(false)}
              >
                <User size={16} />
                Настройки
              </Link>
            
              <div className="header-dropdown-divider" />

              {isAdmin && (
                <Link 
                  to="/admin" 
                  className="header-dropdown-item"
                  onClick={() => setShowDropdown(false)}
                >
                  <Shield size={16} />
                  Администрирование
                </Link>
              )}
              
              <div className="header-dropdown-divider" />
              
              <button className="header-dropdown-item danger" onClick={handleLogout}>
                <LogOut size={16} />
                Выход
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}