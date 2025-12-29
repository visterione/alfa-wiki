import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, Search, User, LogOut, ChevronDown, Shield, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { search as searchApi, BASE_URL } from '../services/api';
import './Header.css';

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
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

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        try {
          // Используем fulltext endpoint для более точного поиска
          const { data } = await searchApi.fulltext(searchQuery);
          setSearchResults(data.results || []);
          setShowResults(true);
        } catch (error) {
          console.error('Search error:', error);
          // Fallback to regular search if fulltext fails
          try {
            const { data } = await searchApi.query(searchQuery);
            setSearchResults(data.results || []);
            setShowResults(true);
          } catch (fallbackError) {
            console.error('Fallback search error:', fallbackError);
          }
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
    // Если это старый полный URL с localhost - заменяем на текущий BASE_URL
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  // Аналогичная функция для логотипа
  const getLogoUrl = () => {
    if (!theme?.logo) return null;
    if (theme.logo.startsWith('http://localhost')) {
      const path = theme.logo.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (theme.logo.startsWith('http')) return theme.logo;
    return `${BASE_URL}/${theme.logo}`;
  };

  // Highlight search term in text
  const highlightText = (text, query) => {
    if (!text || !query) return text;
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() 
        ? <mark key={i} style={{ background: '#FFEB3B', padding: '0 2px', borderRadius: '2px' }}>{part}</mark>
        : part
    );
  };

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
                        {highlightText(result.title, searchQuery)}
                      </div>
                      {result.excerpt && (
                        <div className="search-result-excerpt">
                          {highlightText(result.excerpt, searchQuery)}
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
        <div className="header-user" ref={dropdownRef}>
          <button 
            className="header-user-btn"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <div className="header-avatar">
              {getAvatarUrl() ? (
                <img src={getAvatarUrl()} alt={user?.displayName || user?.username} />
              ) : (
                (user?.displayName || user?.username || 'U')[0].toUpperCase()
              )}
            </div>
            <span className="header-user-name">
              {user?.displayName || user?.username}
            </span>
            <ChevronDown size={16} />
          </button>

          {showDropdown && (
            <div className="header-user-dropdown">
              <Link to="/profile" className="header-dropdown-item">
                <User size={16} />
                <span>Профиль</span>
              </Link>
              
              {isAdmin && (
                <>
                  <div className="header-dropdown-divider" />
                  <Link to="/admin" className="header-dropdown-item">
                    <Shield size={16} />
                    <span>Админ-панель</span>
                  </Link>
                </>
              )}
              
              <div className="header-dropdown-divider" />
              <button onClick={handleLogout} className="header-dropdown-item danger">
                <LogOut size={16} />
                <span>Выйти</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}